<script setup lang="ts">
import { computed } from 'vue'

import { NDatePicker } from 'naive-ui'

import { useTaiwanHolidays } from '@/composables/useTaiwanHolidays'

const props = defineProps<{
  modelValue: string
  totalHours?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const toDateString = (d: Date): string => d.toISOString().slice(0, 10)

const shift = (days: number): void => {
  const d = new Date(props.modelValue)
  d.setDate(d.getDate() + days)
  emit('update:modelValue', toDateString(d))
}

const todayStr = computed(() => toDateString(new Date()))
const isToday = computed(() => props.modelValue === todayStr.value)

const goToday = (): void => {
  emit('update:modelValue', todayStr.value)
}

const pickerValue = computed(() => new Date(`${props.modelValue}T00:00:00`).getTime())

const onPickerUpdate = (value: number | null): void => {
  if (value === null) return
  emit('update:modelValue', toDateString(new Date(value)))
}

const { getDayOffLabel, isWorkday, findNextWorkday } = useTaiwanHolidays()

const dayOffLabel = computed(() => getDayOffLabel(props.modelValue))

const adjacentDate = (days: number): string => {
  const d = new Date(props.modelValue)
  d.setDate(d.getDate() + days)
  return toDateString(d)
}

// 「上一個工作日」的用途是跳過假日，如果緊鄰的那一天本來就是工作日，按下去
// 效果跟「上一天」一樣，沒有額外用途，所以停用
const prevWorkdayDisabled = computed(() => isWorkday(adjacentDate(-1)))
const nextWorkdayDisabled = computed(() => isWorkday(adjacentDate(1)))

const jumpToWorkday = async (direction: 1 | -1): Promise<void> => {
  const next = await findNextWorkday(props.modelValue, direction)
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="date-nav">
    <button
      type="button"
      class="date-nav__btn"
      aria-label="上一個工作日"
      title="上一個工作日"
      :disabled="prevWorkdayDisabled"
      @click="jumpToWorkday(-1)"
    >
      ⏮
    </button>
    <button type="button" class="date-nav__btn" aria-label="上一天" @click="shift(-1)">◀</button>
    <NDatePicker
      class="date-nav__picker"
      :class="{ 'date-nav__picker--today': isToday }"
      :value="pickerValue"
      type="date"
      format="yyyy/MM/dd (EEEEE)"
      :clearable="false"
      :actions="['now']"
      :first-day-of-week="6"
      @update:value="onPickerUpdate"
    />
    <button type="button" class="date-nav__btn" aria-label="下一天" @click="shift(1)">▶</button>
    <button
      type="button"
      class="date-nav__btn"
      aria-label="下一個工作日"
      title="下一個工作日"
      :disabled="nextWorkdayDisabled"
      @click="jumpToWorkday(1)"
    >
      ⏭
    </button>
    <span v-if="dayOffLabel" class="date-nav__holiday-badge">🏮 {{ dayOffLabel }}</span>
    <div class="date-nav__trailing">
      <span v-if="totalHours !== undefined" class="date-nav__total">
        今日工時合計：{{ totalHours }}hr
      </span>
      <!-- 今天時只是狀態標示（不可操作），用 span 而不是 disabled 按鈕 -->
      <span v-if="isToday" class="date-nav__today date-nav__today--current">今天</span>
      <button v-else type="button" class="date-nav__today" @click="goToday">回到今天</button>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.date-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 16px;

  @media (min-width: 768px) {
    flex-wrap: nowrap;
    padding: 16px 32px;
  }
}

.date-nav__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  aspect-ratio: 1/1;
  padding: 4px;
}

.date-nav__today {
  padding: 6px 12px;
  word-break: keep-all;
}

.date-nav__btn,
.date-nav__today {
  display: flex;
  font-size: 14px;
  color: var(--color-black-800);
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 8px;
}

.date-nav__btn:hover,
.date-nav__today:not(.date-nav__today--current):hover {
  color: var(--color-blue-500);
  border-color: var(--color-blue-500);
}

.date-nav__btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;

  &:hover {
    color: var(--color-black-800);
    border-color: var(--color-black-100);
  }
}

.date-nav__picker {
  width: 170px;
  max-width: calc(100% - (32px * 4) - (8px * 4));
}

/*
 * 這裡整段都要用 :deep()：NDatePicker／NInput 實際顯示文字跟畫邊框的都是內部
 * 元素，不是我們拿到 class 的這個外層根節點，Naive UI 直接在那些內部元素自己
 * 身上設定顏色（不是繼承外層），單寫在外層 class 上不會生效：
 * - 邊框：NInput 用兩個疊在一起的空 div 畫邊框（<div class="n-input__border">
 *   是預設常駐的邊框，<div class="n-input__state-border"> 是 hover/focus 時才
 *   淡入的狀態邊框），要蓋掉平常看到的顏色要改前者
 * - 文字：實際輸入框是 <input class="n-input__input-el">
 * 這是目前唯一會對 NDatePicker／NInput 內部 class 用 :deep() 的地方，套件升級
 * 如果改了這幾個內部 class 名稱，這段「今天」標色會失效，但不影響日期選擇功能。
 */
.date-nav__picker--today {
  border-radius: 6px;

  :deep(.n-input__border) {
    border-color: var(--color-blue-700);
  }

  :deep(.n-input__input-el) {
    color: var(--color-blue-700);
  }
}

.date-nav__today--current {
  padding-top: 5px;
  padding-bottom: 5px;
  font-weight: 500;
  color: var(--color-blue-500);
  cursor: default;
  background: transparent;
  border: 1px solid var(--color-blue-500);
  border-radius: 999px;
}

.date-nav__holiday-badge {
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-yellow-800);
  white-space: nowrap;
  border: 1px solid var(--color-yellow-800);
  border-radius: 999px;
}

.date-nav__trailing {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-left: auto;
}

.date-nav__total {
  font-size: 13px;
  color: var(--color-black-500);
  white-space: nowrap;
}
</style>
