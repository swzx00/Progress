<script setup lang="ts">
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

const onDateInput = (event: Event): void => {
  const value = (event.target as HTMLInputElement).value
  if (value) emit('update:modelValue', value)
}
</script>

<template>
  <div class="date-nav">
    <button type="button" class="date-nav__btn" aria-label="上一天" @click="shift(-1)">◀</button>
    <input type="date" class="date-nav__input" :value="modelValue" @change="onDateInput" />
    <button type="button" class="date-nav__btn" aria-label="下一天" @click="shift(1)">▶</button>

    <div class="date-nav__trailing">
      <span v-if="totalHours !== undefined" class="date-nav__total">
        今日工時合計：{{ totalHours }}hr
      </span>
      <button type="button" class="date-nav__today" @click="goToday">回到今天</button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.date-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  @media (min-width: 768px) {
    padding: 16px 32px;
  }
}

.date-nav__btn,
.date-nav__today {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-ink);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
}

.date-nav__btn:hover,
.date-nav__today:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.date-nav__input {
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 14px;
  color: var(--color-ink);
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
