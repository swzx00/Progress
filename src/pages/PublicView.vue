<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import DateNav from '@/components/DateNav.vue'
import WorkItemTable from '@/components/WorkItemTable.vue'
import { useWorkItems } from '@/composables/useWorkItems'

const toDateString = (d: Date): string => d.toISOString().slice(0, 10)

const selectedDate = ref(toDateString(new Date()))
const { items, loading, error, fetchByDate } = useWorkItems()

watch(selectedDate, (date) => fetchByDate(date), { immediate: true })

const totalHours = computed(() =>
  loading.value ? undefined : items.value.reduce((sum, item) => sum + item.今日工時, 0),
)
</script>

<template>
  <div class="public-view">
    <header class="public-view__header">
      <h1 class="public-view__title">工作進度</h1>
      <span class="public-view__badge">唯讀模式</span>
    </header>

    <DateNav v-model="selectedDate" :total-hours="totalHours" />

    <p v-if="loading" class="public-view__status">載入中…</p>
    <p v-else-if="error" class="public-view__status public-view__status--error">{{ error }}</p>
    <WorkItemTable v-else :items="items" :today="toDateString(new Date())" />
  </div>
</template>

<style scoped lang="scss">
.public-view {
  width: 100dvw;
  height: 100dvh;
  border: 1px solid red;
}

.public-view__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 1px solid green;
  @media (min-width: 768px) {
    padding: 24px 32px;
  }
}

.public-view__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-ink);
  margin: 0;
}

.public-view__badge {
  font-size: 12px;
  color: var(--color-ink-muted);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 2px 10px;
}

.public-view__status {
  color: var(--color-ink-muted);
  padding: 24px 0;
}

.public-view__status--error {
  color: var(--color-danger);
}
</style>
