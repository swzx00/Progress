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

const goToday = (): void => {
  emit('update:modelValue', toDateString(new Date()))
}

const pickerValue = computed(() => new Date(`${props.modelValue}T00:00:00`).getTime())

const onPickerUpdate = (value: number | null): void => {
  if (value === null) return
  emit('update:modelValue', toDateString(new Date(value)))
}

const { getHolidayName } = useTaiwanHolidays()

const holidayName = computed(() => getHolidayName(props.modelValue))
</script>

<template>
  <div class="date-nav">
    <button type="button" class="date-nav__btn" aria-label="上一天" @click="shift(-1)">◀</button>
    <NDatePicker
      class="date-nav__picker"
      :value="pickerValue"
      type="date"
      format="yyyy/MM/dd (EEEEE)"
      :clearable="false"
      :actions="['now']"
      :first-day-of-week="6"
      @update:value="onPickerUpdate"
    />
    <span v-if="holidayName" class="date-nav__holiday-badge">🏮 {{ holidayName }}</span>
    <button type="button" class="date-nav__btn" aria-label="下一天" @click="shift(1)">▶</button>

    <div class="date-nav__trailing">
      <span v-if="totalHours !== undefined" class="date-nav__total">
        今日工時合計：{{ totalHours }}hr
      </span>
      <button type="button" class="date-nav__today" @click="goToday">回到今天</button>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.date-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 16px;
  @media (min-width: 768px) {
    flex-wrap: nowrap;
    padding: 16px 32px;
  }
}

.date-nav__btn {
  display: flex;
  justify-content: center;
  align-items: center;
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
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-ink);
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}

.date-nav__btn:hover,
.date-nav__today:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.date-nav__picker {
  width: 170px;
}

.date-nav__holiday-badge {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-holiday);
  border: 1px solid var(--color-holiday);
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}

.date-nav__trailing {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}

.date-nav__total {
  font-size: 13px;
  color: var(--color-ink-muted);
  white-space: nowrap;
}
</style>
