<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { useScrollLock } from '@/composables/useScrollLock';
import { useTaiwanHolidays } from '@/composables/useTaiwanHolidays';
import { dateInputRange } from '@/validation/work-item';

/**
 * 「複製本日」選目標日期的對話框：只負責畫面（選日期、顯示錯誤、按鈕狀態），
 * 實際的工時檢查與寫入由使用端（HomeView）處理。
 * 外觀與開關動畫比照 ConfirmDialog（置中卡片、淡入＋輕微縮放），使用端要用
 * <Transition name="copy-day-dialog"> 包住 <CopyDayDialog v-if>。
 */
const props = withDefaults(
  defineProps<{
    /** 來源日期（YYYY-MM-DD） */
    sourceDate: string;
    /** 來源日期要複製的紀錄筆數 */
    count: number;
    busy?: boolean;
    error?: string | null;
  }>(),
  {
    busy: false,
    error: null,
  },
);

const emit = defineEmits<{
  confirm: [targetDate: string];
  cancel: [];
}>();

const { findNextWorkday } = useTaiwanHolidays();

const targetDate = ref('');
const dateRange = dateInputRange('工作日期');
const displaySourceDate = computed(() => props.sourceDate.replaceAll('-', '/'));

// 預設下一個工作日（跳過週末與國定假日，補班日算工作日）；使用者先選了日期就不覆蓋
onMounted(async () => {
  const nextWorkday = await findNextWorkday(props.sourceDate, 1);
  if (!targetDate.value) targetDate.value = nextWorkday;
});

const requestCancel = (): void => {
  if (props.busy) return;
  emit('cancel');
};

const onConfirm = (): void => {
  if (props.busy || !targetDate.value) return;
  emit('confirm', targetDate.value);
};

// 有遮罩：開著時頁面不能捲動、不顯示捲軸
useScrollLock();
</script>

<template>
  <div class="copy-day-dialog">
    <div class="copy-day-dialog__backdrop" @click="requestCancel" />
    <div
      class="copy-day-dialog__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="copy-day-dialog-title"
    >
      <h2 id="copy-day-dialog-title" class="copy-day-dialog__title">複製本日紀錄</h2>
      <p class="copy-day-dialog__message">
        把 {{ displaySourceDate }} 的 {{ count }} 筆紀錄（含請假）依原本項次順序複製到：
      </p>
      <label class="copy-day-dialog__field" :class="{ 'copy-day-dialog__field--invalid': error }">
        目標日期
        <input
          v-model="targetDate"
          type="date"
          :min="dateRange.min"
          :max="dateRange.max"
          :disabled="busy"
        />
      </label>
      <p v-if="error" class="copy-day-dialog__error" role="alert">{{ error }}</p>
      <div class="copy-day-dialog__actions">
        <button type="button" class="copy-day-dialog__btn" :disabled="busy" @click="requestCancel">
          取消
        </button>
        <button
          type="button"
          class="copy-day-dialog__btn copy-day-dialog__btn--primary"
          :disabled="busy || !targetDate"
          @click="onConfirm"
        >
          {{ busy ? '複製中…' : '複製' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.copy-day-dialog {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.copy-day-dialog__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(27 31 39 / 40%);
}

.copy-day-dialog__panel {
  position: relative;
  width: 100%;
  max-width: 340px;
  padding: 24px;
  background: var(--color-black-000);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}

.copy-day-dialog__title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-black-800);
}

.copy-day-dialog__message {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-black-500);
}

.copy-day-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-black-500);

  input {
    padding: 8px 10px;
    font-family: inherit;
    font-size: 13px;
    color: var(--color-black-800);
    border: 1px solid var(--color-black-100);
    border-radius: 6px;

    &:disabled {
      color: var(--color-black-500);
      cursor: not-allowed;
      background: var(--color-black-050);
    }
  }

  &--invalid input {
    border-color: var(--color-red-600);
  }
}

.copy-day-dialog__error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-red-600);
}

.copy-day-dialog__actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.copy-day-dialog__btn {
  flex: 1;
  padding: 9px;
  font-size: 14px;
  color: var(--color-black-800);
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 6px;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &--primary {
    font-weight: 600;
    color: var(--color-black-000);
    background: var(--color-blue-500);
    border: none;
  }
}

// 開關動畫比照 ConfirmDialog；根元素也要有 transition，Vue 才等得到子元素的離場動畫播完
.copy-day-dialog-enter-active,
.copy-day-dialog-leave-active {
  transition: transform 0.2s ease;
}

.copy-day-dialog-enter-active .copy-day-dialog__panel,
.copy-day-dialog-leave-active .copy-day-dialog__panel {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.copy-day-dialog-enter-active .copy-day-dialog__backdrop,
.copy-day-dialog-leave-active .copy-day-dialog__backdrop {
  transition: opacity 0.2s ease;
}

.copy-day-dialog-enter-from .copy-day-dialog__panel,
.copy-day-dialog-leave-to .copy-day-dialog__panel {
  opacity: 0;
  transform: scale(0.95);
}

.copy-day-dialog-enter-from .copy-day-dialog__backdrop,
.copy-day-dialog-leave-to .copy-day-dialog__backdrop {
  opacity: 0;
}
</style>
