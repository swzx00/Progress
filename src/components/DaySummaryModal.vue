<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';

import AppLoading from '@/components/AppLoading.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useAutoFill } from '@/composables/useAutoFill';
import { useGoogleAuth } from '@/composables/useGoogleAuth';
import { useScrollLock } from '@/composables/useScrollLock';
import { useToast } from '@/composables/useToast';
import { ApiError } from '@/composables/useWorkItems';
import type { WorkItem } from '@/types/work-item';
import {
  AUTO_FILL_NAME_MAX,
  isSameAutoFillSetting,
  validateAutoFillSetting,
  type AutoFillSetting,
} from '@/utils/auto-fill';
import { buildDaySummary } from '@/utils/day-summary';
import { WORK_HOURS_DAILY_STANDARD } from '@/utils/work-hours';

/**
 * 本日總結：把選到那天的工作紀錄照 buildDaySummary 的規則整理成文字，放在 Textarea 裡讓使用者
 * 複製（使用者決定可以先手動修改，修改內容不存檔、不送後端，關掉重開就恢復成產生的內容）。
 * 下方「自動填入」設定（存在後端，規則見 docs/auto-fill.md）：啟用後每個工作日自動把總結填進別人的試算表，
 * 「填入」按鈕可以把 Textarea 目前的文字馬上填進那天的格子。
 * 外觀、手機滿版、開關動畫比照 OptionsManagerModal
 */
const props = defineProps<{
  /** 那一天（YYYY-MM-DD） */
  date: string;
  items: WorkItem[];
  idToken: string;
}>();

const emit = defineEmits<{
  close: [];
  /** 登入錯誤（例如 token 過期）：由使用端關閉 Modal 並登出 */
  unauthorized: [];
}>();

const { showToast } = useToast();
const { withLoginRetry } = useGoogleAuth();
const { setting, fetchAutoFillSetting, saveAutoFillSetting, fillAutoFill } = useAutoFill();

const displayDate = computed(() => props.date.replaceAll('-', '/'));

const text = ref(buildDaySummary(props.items));
const isEmpty = text.value === '';

const copy = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text.value);
    showToast('已複製本日總結', 'success');
  } catch {
    showToast('複製失敗，請手動選取文字複製');
  }
};

// 登入錯誤：Toast 顯示原因，交給使用端關閉並登出；其他錯誤保留畫面讓使用者重試
const handleError = (e: unknown, fallback: string): void => {
  showToast(e instanceof Error ? e.message : fallback);
  if (e instanceof ApiError && e.code === 'UNAUTHORIZED') emit('unauthorized');
};

// ===== 自動填入設定 =====

const draft = reactive<AutoFillSetting>({ enabled: false, url: '', name: '' });
const fillDraft = (value: AutoFillSetting | null): void => {
  draft.enabled = value?.enabled ?? false;
  draft.url = value?.url ?? '';
  draft.name = value?.name ?? '';
};
watch(setting, fillDraft, { immediate: true });

// 已經讀過就直接用快取，沒讀過才去後端讀（設定只能登入後用 doPost 讀）
const settingLoading = ref(false);
const settingError = ref<string | null>(null);
const loadSetting = async (): Promise<void> => {
  settingLoading.value = true;
  settingError.value = null;
  try {
    await withLoginRetry(props.idToken, (token) => fetchAutoFillSetting(token));
  } catch (e) {
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') handleError(e, '');
    else settingError.value = e instanceof Error ? e.message : '自動填入設定載入失敗';
  } finally {
    settingLoading.value = false;
  }
};
if (!setting.value) void loadSetting();

const saving = ref(false);
const dirty = computed(() => !isSameAutoFillSetting(draft, setting.value ?? draft));
// 第一次按「儲存」才顯示錯誤，之後即時更新
const submitAttempted = ref(false);
const validationError = computed(() =>
  submitAttempted.value ? validateAutoFillSetting(draft) : null,
);

const onSave = async (): Promise<void> => {
  if (saving.value || !dirty.value) return;
  submitAttempted.value = true;
  if (validateAutoFillSetting(draft)) return;
  saving.value = true;
  try {
    const value = { ...draft };
    await withLoginRetry(props.idToken, (token) => saveAutoFillSetting(token, value));
    submitAttempted.value = false;
    showToast('已儲存自動填入設定', 'success');
  } catch (e) {
    handleError(e, '儲存自動填入設定失敗');
  } finally {
    saving.value = false;
  }
};

// ===== 填入 =====

// 只有後端存的設定是啟用時才能填（畫面上還沒儲存的開關不算）
const fillEnabled = computed(() => setting.value?.enabled === true);
const filling = ref(false);

// 這天的工時合計（含請假）。未滿每日工時標準時先跳確認（使用者決定）：紀錄可能還沒填完；
// 自動執行遇到這種情況直接不寫入，手動填入讓使用者自己決定
const dayHours = computed(
  () =>
    Math.round(props.items.reduce((sum, item) => sum + (Number(item.今日工時) || 0), 0) * 100) /
    100,
);
const hoursConfirmOpen = ref(false);

const onFillClick = (): void => {
  if (filling.value || !fillEnabled.value || !text.value.trim()) return;
  if (dayHours.value < WORK_HOURS_DAILY_STANDARD) {
    hoursConfirmOpen.value = true;
    return;
  }
  void fill();
};

const confirmFill = (): void => {
  hoursConfirmOpen.value = false;
  void fill();
};

const fill = async (): Promise<void> => {
  if (filling.value || !fillEnabled.value || !text.value.trim()) return;
  filling.value = true;
  try {
    const value = text.value;
    const status = await withLoginRetry(props.idToken, (token) =>
      fillAutoFill(token, props.date, value),
    );
    showToast(
      status === 'unchanged' ? '對方的試算表已經是一樣的內容' : '已填入對方的試算表',
      'success',
    );
  } catch (e) {
    handleError(e, '填入失敗');
  } finally {
    filling.value = false;
  }
};

// 有遮罩：開著時頁面不能捲動、不顯示捲軸
useScrollLock();
</script>

<template>
  <div class="day-summary">
    <div class="day-summary__backdrop" @click="emit('close')" />

    <div
      class="day-summary__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-summary-title"
    >
      <div class="day-summary__header">
        <h2 id="day-summary-title" class="day-summary__title">本日總結</h2>
        <span class="day-summary__date">{{ displayDate }}</span>
        <button
          type="button"
          class="day-summary__close-btn"
          aria-label="關閉"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <p v-if="isEmpty" class="day-summary__empty">這天沒有紀錄</p>
      <template v-else>
        <textarea
          v-model="text"
          class="day-summary__textarea"
          aria-label="本日總結內容"
          spellcheck="false"
        />
        <div class="day-summary__footer">
          <button
            type="button"
            class="day-summary__btn day-summary__fill-btn"
            :disabled="!fillEnabled || filling || !text.trim()"
            :aria-busy="filling"
            :title="fillEnabled ? '把上面的內容填進對方試算表的這一天' : '啟用自動填入後才能使用'"
            @click="onFillClick"
          >
            {{ filling ? '填入中' : '填入' }}
          </button>
          <button
            type="button"
            class="day-summary__btn day-summary__btn--primary day-summary__copy-btn"
            @click="copy"
          >
            複製
          </button>
        </div>
      </template>

      <section class="day-summary__auto-fill" aria-labelledby="day-summary-auto-fill-title">
        <h3 id="day-summary-auto-fill-title" class="day-summary__subtitle">自動填入</h3>

        <AppLoading v-if="settingLoading" label="設定載入中…" class="day-summary__state" />
        <div v-else-if="settingError" class="day-summary__state day-summary__state--error">
          <span>{{ settingError }}</span>
          <button type="button" class="day-summary__btn" @click="loadSetting">重新載入</button>
        </div>

        <form
          v-else
          class="day-summary__form"
          novalidate
          aria-label="自動填入設定"
          @submit.prevent="onSave"
        >
          <label class="day-summary__switch">
            <input v-model="draft.enabled" type="checkbox" :disabled="saving" />
            <span>啟用</span>
          </label>
          <p class="day-summary__desc">
            每個工作日 16:00～17:00 把當天的總結填進下面的試算表；工時未滿 8
            小時、格子已經有內容時不寫入。結果都會用 LINE 通知（LINE 沒設定好時改寄信）。
          </p>

          <label class="day-summary__field">
            <span class="day-summary__label">試算表網址</span>
            <input
              v-model="draft.url"
              type="url"
              inputmode="url"
              placeholder="https://docs.google.com/spreadsheets/d/…"
              :disabled="!draft.enabled || saving"
            />
          </label>
          <label class="day-summary__field">
            <span class="day-summary__label">姓名</span>
            <input
              v-model="draft.name"
              type="text"
              :maxlength="AUTO_FILL_NAME_MAX"
              placeholder="跟試算表上的寫法一樣"
              :disabled="!draft.enabled || saving"
            />
          </label>

          <span v-if="validationError" class="day-summary__error" role="alert">
            {{ validationError }}
          </span>

          <div class="day-summary__form-actions">
            <button
              type="submit"
              class="day-summary__btn day-summary__btn--primary"
              :disabled="!dirty || saving"
              :aria-busy="saving"
            >
              {{ saving ? '儲存中' : '儲存' }}
            </button>
          </div>
        </form>
      </section>
    </div>

    <ConfirmDialog
      v-if="hoursConfirmOpen"
      :title="`工時未滿 ${WORK_HOURS_DAILY_STANDARD} 小時`"
      :message="`這天的工時合計 ${dayHours} 小時，未滿 ${WORK_HOURS_DAILY_STANDARD} 小時，紀錄可能還沒填完。確定要填入嗎？`"
      confirm-label="填入"
      cancel-label="取消"
      @confirm="confirmFill"
      @cancel="hoursConfirmOpen = false"
    />
  </div>
</template>

<style scoped lang="scss">
// 手機：滿版全螢幕；桌面（≥768px）：置中的 Modal 卡片（比照 OptionsManagerModal）
.day-summary {
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

.day-summary__backdrop {
  position: absolute;
  inset: 0;
  display: none;
  background: rgb(27 31 39 / 40%);

  @media (min-width: 768px) {
    display: block;
  }
}

.day-summary__panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;

  // 下方多了自動填入設定，矮的螢幕放不下時整個面板捲動（Textarea 至少保留 min-height）
  overflow-y: auto;
  background: var(--color-black-000);

  @media (min-width: 768px) {
    position: relative;
    inset: auto;
    width: 100%;
    max-width: 560px;
    height: min(90vh, 760px);
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
  }
}

.day-summary__header {
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

.day-summary__title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-black-800);
}

.day-summary__date {
  flex: 1;
  font-size: 13px;
  color: var(--color-black-500);
}

.day-summary__close-btn {
  padding: 4px;
  font-size: 16px;
  line-height: 1;
  color: var(--color-black-500);
  cursor: pointer;
  background: transparent;
  border: none;
}

.day-summary__empty {
  padding: 16px 0;
  margin: 0;
  color: var(--color-black-500);
}

.day-summary__textarea {
  flex: 1;
  min-height: 120px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-black-800);

  // 很長、中間沒空白的英文（或網址）直接在字中間折行，不會整串被推到下一行、看起來跟「- 」分開
  overflow-wrap: anywhere;
  resize: none;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 8px;

  &:focus {
    outline: none;
    border-color: var(--color-blue-500);
  }
}

.day-summary__footer {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 12px;
}

.day-summary__btn {
  flex: 1;
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

// 自動填入設定：在總結下方，用細線隔開
.day-summary__auto-fill {
  flex: none;
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid var(--color-black-100);
}

.day-summary__subtitle {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 700;
  color: var(--color-black-800);
}

// 讀取中／讀取失敗
.day-summary__state {
  padding: 16px 0;

  &--error {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    color: var(--color-red-600);
    text-align: center;
  }
}

.day-summary__form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.day-summary__switch {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-black-800);
  cursor: pointer;

  input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--color-blue-500);
    cursor: pointer;
  }
}

.day-summary__desc {
  margin: 0;
  font-size: 13px;
  color: var(--color-black-500);
}

.day-summary__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;

  input {
    padding: 8px 10px;
    font-family: inherit;
    font-size: 14px;
    color: var(--color-black-800);
    background: var(--color-black-000);
    border: 1px solid var(--color-black-100);
    border-radius: 6px;

    &:focus {
      outline: none;
      border-color: var(--color-blue-500);
    }

    &:disabled {
      color: var(--color-black-500);
      cursor: not-allowed;
      background: var(--color-black-050);
    }
  }
}

.day-summary__label {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-black-800);
}

.day-summary__error {
  font-size: 13px;
  color: var(--color-red-600);
}

.day-summary__form-actions {
  display: flex;
  justify-content: flex-end;
}

/*
 * 開關動畫比照 OptionsManagerModal：手機從下方滑入／滑出，桌面淡入＋輕微縮放。
 * 根元素也要宣告 transition-duration，Vue 才等得到子元素的離場動畫播完
 */
.day-summary-enter-active,
.day-summary-leave-active {
  transition: transform 0.2s ease;
}

.day-summary-enter-active .day-summary__panel,
.day-summary-leave-active .day-summary__panel {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.day-summary-enter-active .day-summary__backdrop,
.day-summary-leave-active .day-summary__backdrop {
  transition: opacity 0.2s ease;
}

.day-summary-enter-from .day-summary__panel,
.day-summary-leave-to .day-summary__panel {
  transform: translateY(100%);

  @media (min-width: 768px) {
    opacity: 0;
    transform: scale(0.95);
  }
}

.day-summary-enter-from .day-summary__backdrop,
.day-summary-leave-to .day-summary__backdrop {
  opacity: 0;
}
</style>
