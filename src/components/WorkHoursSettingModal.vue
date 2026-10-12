<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import AppLoading from '@/components/AppLoading.vue';
import { useOptions } from '@/composables/useOptions';
import { useScrollLock } from '@/composables/useScrollLock';
import { useToast } from '@/composables/useToast';
import { ApiError } from '@/composables/useWorkItems';
import {
  roundToQuarter,
  validateWorkHoursSetting,
  workHoursTotal,
  type WorkHoursSetting,
} from '@/utils/work-hours';

/**
 * 工時設定：上班時間、下班時間、午休時間（選填），每日工時必須剛好 WORK_HOURS_DAILY_STANDARD 小時。
 * 設定後新增／編輯表單的「今日工時」下方多一列「工作時段」，換算規則在 utils/work-hours.ts。
 * 外觀、手機滿版、開關動畫比照 ExportModal
 */
const props = defineProps<{
  idToken: string;
}>();

const emit = defineEmits<{
  close: [];
  /** 登入錯誤（例如 token 過期）：由使用端關閉 Modal 並登出 */
  unauthorized: [];
}>();

const { workHours, loading, error, fetchOptions, saveWorkHours } = useOptions();
const { showToast } = useToast();

// 時間欄位的值（原生 time input，空白是空字串）
const draft = reactive({ start: '', end: '', breakStart: '', breakEnd: '' });
type DraftField = keyof typeof draft;

const fillDraft = (setting: WorkHoursSetting | null): void => {
  draft.start = setting?.start ?? '';
  draft.end = setting?.end ?? '';
  draft.breakStart = setting?.breakStart ?? '';
  draft.breakEnd = setting?.breakEnd ?? '';
};

// 工時設定跟選項清單同一次讀取，已讀過就直接用快取
watch(workHours, fillDraft, { immediate: true });
void fetchOptions();

const retry = (): void => {
  void fetchOptions();
};

// 送出的設定：午休沒填就不帶
const setting = computed<WorkHoursSetting>(() => ({
  start: draft.start,
  end: draft.end,
  ...(draft.breakStart && { breakStart: draft.breakStart }),
  ...(draft.breakEnd && { breakEnd: draft.breakEnd }),
}));

const total = computed(() => workHoursTotal(setting.value));

// 第一次按「儲存」才顯示錯誤，之後即時更新
const submitAttempted = ref(false);
const validationError = computed(() =>
  submitAttempted.value ? validateWorkHoursSetting(setting.value) : null,
);

// 離開時間欄位時四捨五入到最近的 15 分鐘（step 900 擋不住手動輸入的分鐘數）
const onTimeBlur = (field: DraftField): void => {
  draft[field] = roundToQuarter(draft[field]);
};

const busy = ref(false);

const handleError = (e: unknown, fallback: string): void => {
  showToast(e instanceof Error ? e.message : fallback);
  if (e instanceof ApiError && e.code === 'UNAUTHORIZED') emit('unauthorized');
};

const onSave = async (): Promise<void> => {
  if (busy.value) return;
  submitAttempted.value = true;
  if (validateWorkHoursSetting(setting.value)) return;
  busy.value = true;
  try {
    await saveWorkHours(props.idToken, setting.value);
    showToast('已儲存工時設定', 'success');
    emit('close');
  } catch (e) {
    handleError(e, '儲存工時設定失敗');
  } finally {
    busy.value = false;
  }
};

// 清除設定：欄位回到空白，表單不再出現工作時段
const onClear = async (): Promise<void> => {
  if (busy.value) return;
  busy.value = true;
  try {
    await saveWorkHours(props.idToken, null);
    submitAttempted.value = false;
    fillDraft(null);
    showToast('已清除工時設定', 'success');
  } catch (e) {
    handleError(e, '清除工時設定失敗');
  } finally {
    busy.value = false;
  }
};

const requestClose = (): void => {
  if (busy.value) return;
  emit('close');
};

// 有遮罩：開著時頁面不能捲動、不顯示捲軸
useScrollLock();
</script>

<template>
  <div class="work-hours-setting">
    <div class="work-hours-setting__backdrop" @click="requestClose" />

    <div
      class="work-hours-setting__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-hours-setting-title"
    >
      <div class="work-hours-setting__header">
        <h2 id="work-hours-setting-title" class="work-hours-setting__title">工時設定</h2>
        <button
          type="button"
          class="work-hours-setting__close-btn"
          aria-label="關閉"
          :disabled="busy"
          @click="requestClose"
        >
          ✕
        </button>
      </div>

      <AppLoading v-if="loading" class="work-hours-setting__state" />
      <div v-else-if="error" class="work-hours-setting__state work-hours-setting__state--error">
        <span>{{ error }}</span>
        <button type="button" class="work-hours-setting__retry-btn" @click="retry">重新載入</button>
      </div>

      <template v-else>
        <form
          id="work-hours-setting-form"
          class="work-hours-setting__body"
          novalidate
          @submit.prevent="onSave"
        >
          <p class="work-hours-setting__desc">
            設定後，新增／編輯工作紀錄時可以填工作時段，自動換算今日工時。
          </p>

          <div class="work-hours-setting__row">
            <label class="work-hours-setting__field">
              <span class="work-hours-setting__label">
                上班時間<span class="work-hours-setting__required" aria-hidden="true">＊</span>
              </span>
              <input
                v-model="draft.start"
                type="time"
                step="900"
                :disabled="busy"
                @blur="onTimeBlur('start')"
              />
            </label>
            <label class="work-hours-setting__field">
              <span class="work-hours-setting__label">
                下班時間<span class="work-hours-setting__required" aria-hidden="true">＊</span>
              </span>
              <input
                v-model="draft.end"
                type="time"
                step="900"
                :disabled="busy"
                @blur="onTimeBlur('end')"
              />
            </label>
          </div>

          <fieldset class="work-hours-setting__fieldset">
            <legend class="work-hours-setting__label">午休時間（選填）</legend>
            <div class="work-hours-setting__range">
              <input
                v-model="draft.breakStart"
                type="time"
                step="900"
                aria-label="午休開始"
                :disabled="busy"
                @blur="onTimeBlur('breakStart')"
              />
              <span class="work-hours-setting__range-sep" aria-hidden="true">～</span>
              <input
                v-model="draft.breakEnd"
                type="time"
                step="900"
                aria-label="午休結束"
                :disabled="busy"
                @blur="onTimeBlur('breakEnd')"
              />
            </div>
          </fieldset>

          <p class="work-hours-setting__total" role="status">
            每日工時：{{ total === null ? '—' : `${total} 小時` }}
          </p>
          <span v-if="validationError" class="work-hours-setting__error" role="alert">
            {{ validationError }}
          </span>
        </form>

        <div class="work-hours-setting__footer">
          <button
            type="button"
            class="work-hours-setting__btn"
            :disabled="busy || !workHours"
            @click="onClear"
          >
            清除設定
          </button>
          <button
            type="submit"
            form="work-hours-setting-form"
            class="work-hours-setting__btn work-hours-setting__btn--primary"
            :disabled="busy"
            :aria-busy="busy"
          >
            <span v-if="busy" class="work-hours-setting__spinner" aria-hidden="true" />
            {{ busy ? '處理中' : '儲存' }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 手機：滿版全螢幕；桌面（≥768px）：置中的 Modal 卡片（比照 ExportModal）
.work-hours-setting {
  position: fixed;
  inset: 0;
  z-index: 100;

  @media (min-width: 768px) {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
}

.work-hours-setting__backdrop {
  position: absolute;
  inset: 0;
  display: none;
  background: rgb(27 31 39 / 40%);

  @media (min-width: 768px) {
    display: block;
  }
}

.work-hours-setting__panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: var(--color-black-000);

  @media (min-width: 768px) {
    position: relative;
    inset: auto;
    width: 100%;
    max-width: 480px;
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
  }
}

.work-hours-setting__header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--color-black-100);

  @media (min-width: 768px) {
    padding-bottom: 0;
    border-bottom: none;
  }
}

.work-hours-setting__title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-black-800);
}

.work-hours-setting__close-btn {
  padding: 4px;
  font-size: 16px;
  line-height: 1;
  color: var(--color-black-500);
  cursor: pointer;
  background: transparent;
  border: none;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

// 讀取中／讀取失敗
.work-hours-setting__state {
  padding: 32px 0;

  &--error {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    color: var(--color-red-600);
    text-align: center;
  }
}

.work-hours-setting__retry-btn {
  padding: 6px 12px;
  font-size: 14px;
  color: var(--color-black-600);
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-300);
  border-radius: 6px;

  &:hover {
    color: var(--color-black-700);
    background: var(--color-black-050);
  }
}

.work-hours-setting__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;

  @media (min-width: 768px) {
    flex: none;
  }
}

.work-hours-setting__desc {
  margin: 0;
  font-size: 13px;
  color: var(--color-black-500);
}

.work-hours-setting__row {
  display: flex;
  gap: 12px;
}

.work-hours-setting__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.work-hours-setting__fieldset {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 0;
  margin: 0;
  border: none;
}

.work-hours-setting__label {
  display: flex;
  gap: 2px;
  align-items: baseline;
  padding: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-black-800);
}

.work-hours-setting__required {
  color: var(--color-red-600);
}

.work-hours-setting__range {
  display: flex;
  gap: 8px;
  align-items: center;

  input {
    flex: 1;
    min-width: 0;
  }
}

.work-hours-setting__range-sep {
  color: var(--color-black-500);
}

.work-hours-setting__field input,
.work-hours-setting__range input {
  padding: 8px 10px;
  font-family: inherit;
  font-size: 14px;
  color: var(--color-black-800);
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 6px;

  &:disabled {
    color: var(--color-black-500);
    cursor: not-allowed;
    background: var(--color-black-050);
  }
}

.work-hours-setting__total {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-blue-700);
}

.work-hours-setting__error {
  margin-top: -8px;
  font-size: 13px;
  color: var(--color-red-600);
}

.work-hours-setting__footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 16px;
}

.work-hours-setting__btn {
  display: inline-flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 8px 20px;
  font-size: 14px;
  color: var(--color-black-600);
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-300);
  border-radius: 8px;

  &:hover:not(:disabled) {
    color: var(--color-black-700);
    background: var(--color-black-050);
  }

  &--primary {
    font-weight: 600;
    color: var(--color-black-000);
    background: var(--color-blue-500);
    border-color: var(--color-blue-500);

    &:hover:not(:disabled) {
      color: var(--color-black-000);
      background: var(--color-blue-700);
      border-color: var(--color-blue-700);
    }
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  @media (min-width: 768px) {
    flex: none;
  }
}

// 按鈕內的轉圈（白色，跟按鈕文字同色）
.work-hours-setting__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgb(255 255 255 / 40%);
  border-top-color: var(--color-black-000);
  border-radius: 50%;
  animation: work-hours-setting-spin 0.7s linear infinite;
}

@keyframes work-hours-setting-spin {
  to {
    transform: rotate(360deg);
  }
}

/*
 * 開關動畫比照 ExportModal：手機從下方滑入／滑出，桌面淡入＋輕微縮放。
 * 根元素也要宣告 transition-duration，Vue 才等得到子元素的離場動畫播完
 */
.work-hours-setting-enter-active,
.work-hours-setting-leave-active {
  transition: transform 0.2s ease;
}

.work-hours-setting-enter-active .work-hours-setting__panel,
.work-hours-setting-leave-active .work-hours-setting__panel {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.work-hours-setting-enter-active .work-hours-setting__backdrop,
.work-hours-setting-leave-active .work-hours-setting__backdrop {
  transition: opacity 0.2s ease;
}

.work-hours-setting-enter-from .work-hours-setting__panel,
.work-hours-setting-leave-to .work-hours-setting__panel {
  transform: translateY(100%);

  @media (min-width: 768px) {
    opacity: 0;
    transform: scale(0.95);
  }
}

.work-hours-setting-enter-from .work-hours-setting__backdrop,
.work-hours-setting-leave-to .work-hours-setting__backdrop {
  opacity: 0;
}
</style>
