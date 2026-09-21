<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import DateNav from '@/components/DateNav.vue'
import WorkItemForm from '@/components/WorkItemForm.vue'
import WorkItemTable from '@/components/WorkItemTable.vue'
import { useGoogleAuth } from '@/composables/useGoogleAuth'
import { useTaiwanHolidays } from '@/composables/useTaiwanHolidays'
import { useWorkItems } from '@/composables/useWorkItems'
import type { WorkItem } from '@/types/work-item'

const toDateString = (d: Date): string => d.toISOString().slice(0, 10)

const { idToken, userEmail, isLoggedIn, isAuthorized, renderSignInButton, signOut } =
  useGoogleAuth()

const signInButtonEl = ref<HTMLElement | null>(null)
watch(signInButtonEl, (el) => {
  if (el) renderSignInButton(el)
})

const selectedDate = ref(toDateString(new Date()))
const { items, loading, error, fetchByDate, createItem, updateItem, deleteItem } = useWorkItems()
const { getDayOffLabel } = useTaiwanHolidays()
const dayOffLabel = computed(() => getDayOffLabel(selectedDate.value))

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
  if (!idToken.value) {
    saveError.value = '尚未登入，無法儲存'
    return
  }
  saving.value = true
  saveError.value = null
  try {
    if (editingItem.value) {
      await updateItem(idToken.value, editingItem.value.id, editingItem.value.工作日期, payload)
    } else {
      await createItem(idToken.value, payload)
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
  if (!deleteTarget.value || !idToken.value) return
  deleting.value = true
  try {
    await deleteItem(idToken.value, deleteTarget.value.id, deleteTarget.value.工作日期)
    await fetchByDate(selectedDate.value)
  } finally {
    deleting.value = false
    deleteTarget.value = null
  }
}
</script>

<template>
  <div class="home-view">
    <header class="home-view__header">
      <h1 class="home-view__title">工作進度</h1>
      <span v-if="!isAuthorized" class="home-view__badge">唯讀模式</span>
      <button
        type="button"
        class="home-view__theme-btn"
        title="深色模式（即將推出）"
        aria-label="深色模式（即將推出）"
        disabled
      >
        ☾
      </button>
      <div v-if="isAuthorized" class="home-view__account">
        <span class="home-view__avatar">{{ userEmail?.charAt(0).toUpperCase() }}</span>
        <span class="home-view__email">{{ userEmail }}</span>
        <button type="button" class="home-view__signout-btn" @click="signOut">登出</button>
      </div>
      <div v-else-if="isLoggedIn" class="home-view__unauthorized">
        <span>{{ userEmail }} 沒有管理權限</span>
        <button type="button" class="home-view__signout-btn" @click="signOut">登出</button>
      </div>
      <div v-else ref="signInButtonEl" class="home-view__signin"></div>
    </header>

    <DateNav v-model="selectedDate" :total-hours="totalHours">
      <template v-if="isAuthorized" #actions>
        <button type="button" class="home-view__add-btn" @click="openCreateForm">＋ 新增</button>
      </template>
    </DateNav>

    <div v-if="dayOffLabel" class="home-view__holiday-banner">
      <span class="home-view__holiday-icon" aria-hidden="true">🎉</span>
      <span>{{ selectedDate }} 是「{{ dayOffLabel }}」，非工作日</span>
    </div>

    <div v-if="loading" class="home-view__loading">
      <span class="home-view__spinner" aria-hidden="true"></span>
      <span>載入中…</span>
    </div>
    <div v-else-if="error" class="home-view__error">
      <span class="home-view__error-icon" aria-hidden="true">⚠</span>
      <span>{{ error }}</span>
    </div>
    <WorkItemTable
      v-else
      :items="items"
      :today="toDateString(new Date())"
      :editable="isAuthorized"
      @edit="openEditForm"
      @delete="openDeleteConfirm"
    />

    <Transition name="work-item-form">
      <WorkItemForm
        v-if="formOpen && isAuthorized"
        :item="editingItem"
        :saving="saving"
        @save="onSave"
        @cancel="closeForm"
      />
    </Transition>
    <p v-if="saveError" class="home-view__save-error">{{ saveError }}</p>

    <ConfirmDialog
      v-if="deleteTarget && isAuthorized"
      title="確定要刪除這筆紀錄嗎？"
      :message="`「${deleteTarget.專案名稱}」・${deleteTarget.工作目標}，${deleteTarget.工作日期}。刪除後不會馬上從 Google Sheet 消失（軟刪除），但列表會立刻看不到這筆。`"
      confirm-label="刪除"
      danger
      :busy="deleting"
      @confirm="confirmDelete"
      @cancel="closeDeleteConfirm"
    />
  </div>
</template>

<style scoped lang="scss">
.home-view__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
  @media (min-width: 768px) {
    padding: 24px 32px;
  }
}

.home-view__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-ink);
  word-break: keep-all;
  margin: 0;
}

.home-view__badge {
  font-size: 12px;
  color: var(--color-ink-muted);
  word-break: keep-all;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 2px 10px;
}

.home-view__theme-btn {
  width: 28px;
  height: 28px;
  aspect-ratio: 1/1;
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

.home-view__account,
.home-view__unauthorized {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.home-view__unauthorized {
  font-size: 12px;
  color: var(--color-danger);
}

.home-view__signin {
  margin-left: auto;
}

.home-view__signout-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-ink-muted);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
  cursor: pointer;
}

.home-view__avatar {
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

.home-view__email {
  display: none;
  font-size: 12px;
  color: var(--color-ink-muted);
  @media (min-width: 768px) {
    display: inline;
  }
}

.home-view__add-btn {
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

.home-view__holiday-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 16px 16px;
  padding: 10px 14px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-holiday) 10%, var(--color-bg));
  box-shadow: inset 3px 0 0 var(--color-holiday);
  color: var(--color-holiday);
  font-size: 13px;
  font-weight: 600;

  @media (min-width: 768px) {
    margin: 0 32px 16px;
  }
}

.home-view__holiday-icon {
  font-size: 15px;
}

.home-view__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--color-ink-muted);
  padding: 48px 0;
}

.home-view__spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: home-view-spin 0.7s linear infinite;
}

@keyframes home-view-spin {
  to {
    transform: rotate(360deg);
  }
}

.home-view__error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--color-danger);
  padding: 48px 16px;
  text-align: center;
}

.home-view__error-icon {
  font-size: 24px;
}

.home-view__save-error {
  color: var(--color-danger);
  font-size: 13px;
  padding: 8px 16px;

  @media (min-width: 768px) {
    padding: 8px 32px;
  }
}
</style>
