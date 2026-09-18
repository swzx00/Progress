<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DateNav from '@/components/DateNav.vue'
import WorkItemForm from '@/components/WorkItemForm.vue'
import WorkItemTable from '@/components/WorkItemTable.vue'
import { useGoogleAuth } from '@/composables/useGoogleAuth'
import { useWorkItems } from '@/composables/useWorkItems'
import type { WorkItem } from '@/types/work-item'

const toDateString = (d: Date): string => d.toISOString().slice(0, 10)

const { userEmail } = useGoogleAuth()

const selectedDate = ref(toDateString(new Date()))
const { items, loading, error, fetchByDate, createItem, updateItem, deleteItem } = useWorkItems()

watch(selectedDate, (date) => fetchByDate(date), { immediate: true })

const totalHours = computed(() =>
  loading.value ? undefined : items.value.reduce((sum, item) => sum + item.今日工時, 0),
)

const formOpen = ref(false)
const editingItem = ref<WorkItem | null>(null)
const saving = ref(false)
const saveError = ref<string | null>(null)

const openCreateForm = (): void => {
  editingItem.value = null
  saveError.value = null
  formOpen.value = true
}

const openEditForm = (item: WorkItem): void => {
  editingItem.value = item
  saveError.value = null
  formOpen.value = true
}

const closeForm = (): void => {
  formOpen.value = false
}

const onSave = async (payload: Omit<WorkItem, 'id' | '項次' | '已刪除'>): Promise<void> => {
  saving.value = true
  saveError.value = null
  try {
    if (editingItem.value) {
      await updateItem(editingItem.value.id, payload)
    } else {
      await createItem(payload)
    }
    await fetchByDate(selectedDate.value)
    formOpen.value = false
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '儲存時發生未知錯誤'
  } finally {
    saving.value = false
  }
}

const deleteTarget = ref<WorkItem | null>(null)
const deleting = ref(false)

const openDeleteConfirm = (item: WorkItem): void => {
  deleteTarget.value = item
}

const closeDeleteConfirm = (): void => {
  deleteTarget.value = null
}

const confirmDelete = async (): Promise<void> => {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await deleteItem(deleteTarget.value.id)
    await fetchByDate(selectedDate.value)
  } finally {
    deleting.value = false
    deleteTarget.value = null
  }
}
</script>

<template>
  <div class="manage-view">
    <header class="manage-view__header">
      <h1 class="manage-view__title">工作進度</h1>
      <button
        type="button"
        class="manage-view__theme-btn"
        title="深色模式（即將推出）"
        aria-label="深色模式（即將推出）"
        disabled
      >
        ☾
      </button>
      <div class="manage-view__account">
        <span class="manage-view__avatar">{{ userEmail.charAt(0).toUpperCase() }}</span>
        <span class="manage-view__email">已登入・{{ userEmail }}</span>
      </div>
    </header>

    <DateNav v-model="selectedDate" :total-hours="totalHours">
      <template #actions>
        <button type="button" class="manage-view__add-btn" @click="openCreateForm">＋ 新增</button>
      </template>
    </DateNav>

    <p v-if="loading" class="manage-view__status">載入中…</p>
    <p v-else-if="error" class="manage-view__status manage-view__status--error">{{ error }}</p>
    <WorkItemTable
      v-else
      :items="items"
      :today="toDateString(new Date())"
      editable
      @edit="openEditForm"
      @delete="openDeleteConfirm"
    />

    <Transition name="work-item-form">
      <WorkItemForm
        v-if="formOpen"
        :item="editingItem"
        :default-date="selectedDate"
        :saving="saving"
        @save="onSave"
        @cancel="closeForm"
      />
    </Transition>
    <p v-if="saveError" class="manage-view__save-error">{{ saveError }}</p>

    <ConfirmDialog
      v-if="deleteTarget"
      title="確定要刪除這筆紀錄嗎？"
      :message="`「${deleteTarget.專案名稱}」・${deleteTarget.工作內容}，${deleteTarget.工作日期}。刪除後不會馬上從 Google Sheet 消失（軟刪除），但列表會立刻看不到這筆。`"
      confirm-label="刪除"
      danger
      :busy="deleting"
      @confirm="confirmDelete"
      @cancel="closeDeleteConfirm"
    />
  </div>
</template>

<style scoped lang="scss">
.manage-view {
  padding: 16px;

  @media (min-width: 768px) {
    padding: 24px 32px;
  }
}

.manage-view__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.manage-view__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-ink);
  margin: 0;
}

.manage-view__theme-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-ink-muted);
  font-size: 13px;
  cursor: not-allowed;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.manage-view__account {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.manage-view__avatar {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--color-accent);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.manage-view__email {
  font-size: 12px;
  color: var(--color-ink-muted);
}

.manage-view__add-btn {
  border: none;
  background: var(--color-accent);
  color: #fff;
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.manage-view__status {
  color: var(--color-ink-muted);
  padding: 24px 0;
}

.manage-view__status--error {
  color: var(--color-danger);
}

.manage-view__save-error {
  color: var(--color-danger);
  font-size: 13px;
  padding: 8px 16px;

  @media (min-width: 768px) {
    padding: 8px 32px;
  }
}
</style>
