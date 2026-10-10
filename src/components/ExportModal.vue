<script setup lang="ts">
import { NDatePicker } from 'naive-ui';
import { computed, ref, watch } from 'vue';

import { useToast } from '@/composables/useToast';
import { fetchByRange } from '@/composables/useWorkItems';
import { parseLocalDate, toLocalDateString } from '@/utils/date';
import {
  buildExportWorkbook,
  downloadBlob,
  EXPORT_MAX_DAYS,
  exportFileName,
  monthPeriod,
  periodDays,
  quarterPeriod,
  rangePeriod,
  yearPeriod,
  type ExportMode,
  type ExportPeriod,
} from '@/utils/export-excel';

/**
 * 匯出 Excel：選匯出方式（年份／季度／月份／指定天數）與範圍，讀出那段期間的紀錄（含請假）
 * 產生 .xlsx 下載。檔案的分頁、欄位、樣式規則在 utils/export-excel.ts。
 * 外觀、手機滿版、開關動畫比照 DaySummaryModal／OptionsManagerModal
 */
const props = defineProps<{
  /** DateNav 選到的那天（YYYY-MM-DD），「指定天數」的預設起訖日 */
  defaultDate: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { showToast } = useToast();

const MODES: { key: ExportMode; label: string }[] = [
  { key: 'year', label: '年份' },
  { key: 'quarter', label: '季度' },
  { key: 'month', label: '月份' },
  { key: 'range', label: '指定天數' },
];

const mode = ref<ExportMode>('year');

// NDatePicker 的值是本地時間的時間戳；年份、季度、月份預設今天所在的那段期間
const now = Date.now();
const yearValue = ref<number | null>(now);
const quarterValue = ref<number | null>(now);
const monthValue = ref<number | null>(now);
const defaultTimestamp = parseLocalDate(props.defaultDate).getTime();
const rangeValue = ref<[number, number] | null>([defaultTimestamp, defaultTimestamp]);

// 時間戳轉 YYYY-MM-DD 要用本地時間的年月日，不能用 toISOString（會換成 UTC，台灣時間凌晨會差一天）
const toIsoDate = (timestamp: number): string => toLocalDateString(new Date(timestamp));

const period = computed<ExportPeriod | null>(() => {
  if (mode.value === 'year') {
    return yearValue.value === null ? null : yearPeriod(new Date(yearValue.value).getFullYear());
  }
  if (mode.value === 'quarter') {
    if (quarterValue.value === null) return null;
    const d = new Date(quarterValue.value);
    return quarterPeriod(d.getFullYear(), Math.floor(d.getMonth() / 3) + 1);
  }
  if (mode.value === 'month') {
    if (monthValue.value === null) return null;
    const d = new Date(monthValue.value);
    return monthPeriod(d.getFullYear(), d.getMonth() + 1);
  }
  if (rangeValue.value === null) return null;
  return rangePeriod(toIsoDate(rangeValue.value[0]), toIsoDate(rangeValue.value[1]));
});

// 指定天數超過後端上限就先擋下，不送出
const rangeError = computed(() =>
  period.value && periodDays(period.value) > EXPORT_MAX_DAYS
    ? `日期範圍不可超過 ${EXPORT_MAX_DAYS} 天`
    : '',
);

const exporting = ref(false);
// 範圍內沒有紀錄時的提示，換了範圍就清掉
const emptyNotice = ref(false);
watch(period, () => {
  emptyNotice.value = false;
});

const canExport = computed(() => !!period.value && !rangeError.value && !exporting.value);

const onExport = async (): Promise<void> => {
  const target = period.value;
  if (!target || !canExport.value) return;
  exporting.value = true;
  emptyNotice.value = false;
  try {
    const items = await fetchByRange(target.from, target.to);
    if (items.length === 0) {
      emptyNotice.value = true;
      return;
    }
    const blob = await buildExportWorkbook(target, items);
    downloadBlob(blob, exportFileName(target));
    showToast(`已匯出 ${items.length} 筆紀錄`, 'success');
  } catch (e) {
    // 失敗時 Modal 維持開啟，可以直接重試
    showToast(e instanceof Error ? e.message : '匯出時發生未知錯誤');
  } finally {
    exporting.value = false;
  }
};

const requestClose = (): void => {
  if (exporting.value) return;
  emit('close');
};
</script>

<template>
  <div class="export-modal">
    <div class="export-modal__backdrop" @click="requestClose" />

    <div
      class="export-modal__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
    >
      <div class="export-modal__header">
        <h2 id="export-modal-title" class="export-modal__title">匯出 Excel</h2>
        <button
          type="button"
          class="export-modal__close-btn"
          aria-label="關閉"
          :disabled="exporting"
          @click="requestClose"
        >
          ✕
        </button>
      </div>

      <div class="export-modal__body">
        <div class="export-modal__mode" role="group" aria-label="匯出方式">
          <button
            v-for="option in MODES"
            :key="option.key"
            type="button"
            class="export-modal__mode-btn"
            :class="{ 'export-modal__mode-btn--active': mode === option.key }"
            :aria-pressed="mode === option.key"
            :disabled="exporting"
            @click="mode = option.key"
          >
            {{ option.label }}
          </button>
        </div>

        <div class="export-modal__field">
          <span class="export-modal__label">匯出範圍</span>
          <NDatePicker
            class="export-modal__picker"
            v-if="mode === 'year'"
            v-model:value="yearValue"
            type="year"
            format="yyyy 年"
            :disabled="exporting"
          />
          <NDatePicker
            class="export-modal__picker"
            v-else-if="mode === 'quarter'"
            v-model:value="quarterValue"
            type="quarter"
            format="yyyy 年 'Q'Q"
            :disabled="exporting"
          />
          <NDatePicker
            class="export-modal__picker"
            v-else-if="mode === 'month'"
            v-model:value="monthValue"
            type="month"
            format="yyyy/MM"
            :disabled="exporting"
          />
          <NDatePicker
            class="export-modal__picker"
            v-else
            v-model:value="rangeValue"
            type="daterange"
            format="yyyy/MM/dd"
            :first-day-of-week="6"
            :status="rangeError ? 'error' : undefined"
            :disabled="exporting"
          />
          <span v-if="rangeError" class="export-modal__error" role="alert">{{ rangeError }}</span>
        </div>

        <p v-if="emptyNotice" class="export-modal__notice" role="status">這段期間沒有紀錄</p>
      </div>

      <div class="export-modal__footer">
        <button
          type="button"
          class="export-modal__export-btn"
          :disabled="!canExport"
          :aria-busy="exporting"
          @click="onExport"
        >
          <span v-if="exporting" class="export-modal__spinner" aria-hidden="true" />
          {{ exporting ? '匯出中' : '匯出' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 手機：滿版全螢幕；桌面（≥768px）：置中的 Modal 卡片（比照 DaySummaryModal）
.export-modal {
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

.export-modal__backdrop {
  position: absolute;
  inset: 0;
  display: none;
  background: rgb(27 31 39 / 40%);

  @media (min-width: 768px) {
    display: block;
  }
}

.export-modal__panel {
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

.export-modal__header {
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

.export-modal__title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-black-800);
}

.export-modal__close-btn {
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

.export-modal__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;

  @media (min-width: 768px) {
    flex: none;
  }
}

// 匯出方式四選一，樣式比照 WorkItemForm 的「工作項目 ｜ 請假」切換
.export-modal__mode {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--color-black-050);
  border: 1px solid var(--color-black-100);
  border-radius: 8px;
}

.export-modal__mode-btn {
  flex: 1;
  padding: 6px 4px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-black-500);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;

  &--active {
    font-weight: 600;
    color: var(--color-blue-700);
    background: var(--color-black-000);
    box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.export-modal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.export-modal__picker {
  width: 100%;
}

.export-modal__label {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-black-800);
}

.export-modal__error {
  font-size: 13px;
  color: var(--color-red-600);
}

.export-modal__notice {
  margin: 0;
  font-size: 14px;
  color: var(--color-black-500);
}

.export-modal__footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}

.export-modal__export-btn {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 8px 20px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-black-000);
  cursor: pointer;
  background: var(--color-blue-500);
  border: none;
  border-radius: 8px;

  &:hover:not(:disabled) {
    background: var(--color-blue-700);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  @media (min-width: 768px) {
    width: auto;
  }
}

// 按鈕內的轉圈（白色，跟按鈕文字同色）
.export-modal__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgb(255 255 255 / 40%);
  border-top-color: var(--color-black-000);
  border-radius: 50%;
  animation: export-modal-spin 0.7s linear infinite;
}

@keyframes export-modal-spin {
  to {
    transform: rotate(360deg);
  }
}

/*
 * 開關動畫比照 DaySummaryModal：手機從下方滑入／滑出，桌面淡入＋輕微縮放。
 * 根元素也要宣告 transition-duration，Vue 才等得到子元素的離場動畫播完
 */
.export-modal-enter-active,
.export-modal-leave-active {
  transition: transform 0.2s ease;
}

.export-modal-enter-active .export-modal__panel,
.export-modal-leave-active .export-modal__panel {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.export-modal-enter-active .export-modal__backdrop,
.export-modal-leave-active .export-modal__backdrop {
  transition: opacity 0.2s ease;
}

.export-modal-enter-from .export-modal__panel,
.export-modal-leave-to .export-modal__panel {
  transform: translateY(100%);

  @media (min-width: 768px) {
    opacity: 0;
    transform: scale(0.95);
  }
}

.export-modal-enter-from .export-modal__backdrop,
.export-modal-leave-to .export-modal__backdrop {
  opacity: 0;
}
</style>
