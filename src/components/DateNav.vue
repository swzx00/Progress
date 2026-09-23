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
      <button
        type="button"
        class="date-nav__today"
        :class="{ 'date-nav__today--current': isToday }"
        :disabled="isToday"
        @click="goToday"
      >
        {{ isToday ? '今天' : '回到今天' }}
      </button>
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
}

.date-nav__btn,
.date-nav__today {
  font-size: 14px;
  color: var(--color-ink);
  cursor: pointer;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
}

.date-nav__btn:hover,
.date-nav__today:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.date-nav__btn:disabled,
.date-nav__today:disabled {
  cursor: not-allowed;
  opacity: 0.4;

  &:hover {
    color: var(--color-ink);
    border-color: var(--color-border);
  }
}

.date-nav__picker {
  width: 170px;
}

/*
 * :deep() 不用在這裡是因為 class 是直接寫在 <NDatePicker> 標籤上，Vue 的 scoped
 * CSS 會把 scope 屬性直接掛在它的根節點，跟平常自己寫的元素一樣可以直接選到，
 * 不需要穿透子元件內部。用 outline（不是改 NInput 內部的 border 顏色）是刻意選擇：
 * 不用去扣 Naive UI 內部的 class 名稱，比較不會因為套件版本升級而失效。
 */
.date-nav__picker--today {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
  border-radius: 6px;
}

.date-nav__today--current {
  color: #fff;
  cursor: default;
  background: var(--color-accent);
  border-color: var(--color-accent);

  &:disabled {
    opacity: 1;
  }
}

.date-nav__holiday-badge {
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-holiday);
  white-space: nowrap;
  border: 1px solid var(--color-holiday);
  border-radius: 999px;
}

.date-nav__trailing {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-left: auto;
}

.date-nav__total {
  font-size: 13px;
  color: var(--color-ink-muted);
  white-space: nowrap;
}
</style>
