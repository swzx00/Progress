<script setup lang="ts">
import { ref } from 'vue'

import ConfirmDialog from '@/components/ConfirmDialog.vue'
import { useOptions } from '@/composables/useOptions'
import type { WorkItemOptions } from '@/types/work-item'

const props = defineProps<{
  idToken: string
}>()

const emit = defineEmits<{
  close: []
}>()

const CATEGORIES: (keyof WorkItemOptions)[] = ['交辦單位', '交辦人員', '專案名稱', '專案Repo']

const { options, loading, error, fetchOptions, addOption, renameOption, deleteOption } =
  useOptions()
void fetchOptions()

// 第一層：選母項；第二層：selectedCategory 有值時，改顯示該分類的內容管理畫面
const selectedCategory = ref<keyof WorkItemOptions | null>(null)

const busy = ref(false)
const actionError = ref<string | null>(null)

const newValueDrafts = ref<Record<keyof WorkItemOptions, string>>({
  交辦單位: '',
  交辦人員: '',
  專案名稱: '',
  專案Repo: '',
})

const editingValue = ref<string | null>(null)
const editingDraft = ref('')

const openCategory = (category: keyof WorkItemOptions): void => {
  selectedCategory.value = category
  actionError.value = null
}

const backToCategoryList = (): void => {
  selectedCategory.value = null
  editingValue.value = null
  editingDraft.value = ''
  actionError.value = null
}

const startEdit = (value: string): void => {
  editingValue.value = value
  editingDraft.value = value
}

const cancelEdit = (): void => {
  editingValue.value = null
  editingDraft.value = ''
}

const submitEdit = async (oldValue: string): Promise<void> => {
  if (!selectedCategory.value) return
  const newValue = editingDraft.value.trim()
  if (!newValue || newValue === oldValue) {
    cancelEdit()
    return
  }
  busy.value = true
  actionError.value = null
  try {
    await renameOption(props.idToken, selectedCategory.value, oldValue, newValue)
    cancelEdit()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '重新命名失敗'
  } finally {
    busy.value = false
  }
}

const submitAdd = async (): Promise<void> => {
  if (!selectedCategory.value) return
  const category = selectedCategory.value
  const value = newValueDrafts.value[category].trim()
  if (!value) return
  busy.value = true
  actionError.value = null
  try {
    await addOption(props.idToken, category, value)
    newValueDrafts.value[category] = ''
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '新增失敗'
  } finally {
    busy.value = false
  }
}

const deleteTarget = ref<string | null>(null)

const openDeleteConfirm = (value: string): void => {
  deleteTarget.value = value
}

const confirmDelete = async (): Promise<void> => {
  if (!deleteTarget.value || !selectedCategory.value) return
  busy.value = true
  actionError.value = null
  try {
    await deleteOption(props.idToken, selectedCategory.value, deleteTarget.value)
    deleteTarget.value = null
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '刪除失敗'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="options-manager">
    <div class="options-manager__backdrop" @click="emit('close')" />

    <!-- 第一層：選母項 -->
    <div v-if="!selectedCategory" class="options-manager__panel" role="dialog" aria-modal="true">
      <div class="options-manager__header">
        <h2 class="options-manager__title">管理選項清單</h2>
        <button
          type="button"
          class="options-manager__close-btn"
          aria-label="關閉"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <p class="options-manager__notice">
        重新命名或刪除只會影響「之後」新增/編輯紀錄時能選的清單，不會回頭更新已經寫入的歷史紀錄——歷史紀錄裡存的是純文字，不是跟這份清單連動的關聯資料。
      </p>

      <p v-if="loading" class="options-manager__status">載入中…</p>
      <p v-else-if="error" class="options-manager__status options-manager__status--error">
        {{ error }}
      </p>
      <ul v-else-if="options" class="options-manager__category-list">
        <li v-for="category in CATEGORIES" :key="category">
          <button
            type="button"
            class="options-manager__category-btn"
            @click="openCategory(category)"
          >
            <span class="options-manager__category-btn-name">{{ category }}</span>
            <span class="options-manager__category-btn-count">{{ options[category].length }} 筆</span>
            <span class="options-manager__category-btn-arrow" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>
    </div>

    <!-- 第二層：調整選定母項的內容 -->
    <div v-else class="options-manager__panel" role="dialog" aria-modal="true">
      <div class="options-manager__header">
        <button type="button" class="options-manager__back-btn" @click="backToCategoryList">
          ‹ 返回
        </button>
        <h2 class="options-manager__title">{{ selectedCategory }}</h2>
        <button
          type="button"
          class="options-manager__close-btn"
          aria-label="關閉"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <ul v-if="options" class="options-manager__list">
        <li v-for="value in options[selectedCategory]" :key="value" class="options-manager__item">
          <template v-if="editingValue === value">
            <input
              v-model="editingDraft"
              class="options-manager__edit-input"
              @keyup.enter="submitEdit(value)"
              @keyup.esc="cancelEdit"
            />
            <button
              type="button"
              class="options-manager__mini-btn"
              :disabled="busy"
              @click="submitEdit(value)"
            >
              儲存
            </button>
            <button
              type="button"
              class="options-manager__mini-btn"
              :disabled="busy"
              @click="cancelEdit"
            >
              取消
            </button>
          </template>
          <template v-else>
            <span class="options-manager__item-value">{{ value }}</span>
            <button
              type="button"
              class="options-manager__mini-btn"
              :disabled="busy"
              @click="startEdit(value)"
            >
              重新命名
            </button>
            <button
              type="button"
              class="options-manager__mini-btn options-manager__mini-btn--danger"
              :disabled="busy"
              @click="openDeleteConfirm(value)"
            >
              刪除
            </button>
          </template>
        </li>
        <li v-if="options[selectedCategory].length === 0" class="options-manager__empty">
          尚無資料
        </li>
      </ul>

      <div class="options-manager__add-row">
        <input
          v-model="newValueDrafts[selectedCategory]"
          class="options-manager__add-input"
          :placeholder="`新增${selectedCategory}`"
          @keyup.enter="submitAdd"
        />
        <button type="button" class="options-manager__mini-btn" :disabled="busy" @click="submitAdd">
          新增
        </button>
      </div>

      <p v-if="actionError" class="options-manager__status options-manager__status--error">
        {{ actionError }}
      </p>
    </div>

    <ConfirmDialog
      v-if="deleteTarget"
      title="確定要刪除這個選項嗎？"
      :message="`「${deleteTarget}」會從「${selectedCategory}」清單移除，不會影響已經寫入的歷史紀錄。`"
      confirm-label="刪除"
      danger
      :busy="busy"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />
  </div>
</template>

<style scoped lang="scss">
.options-manager {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.options-manager__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(27, 31, 39, 0.4);
}

.options-manager__panel {
  position: relative;
  width: 100%;
  max-width: 420px;
  max-height: min(80vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.options-manager__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.options-manager__title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-ink);
}

.options-manager__back-btn {
  border: none;
  background: transparent;
  color: var(--color-accent);
  font-size: 13px;
  cursor: pointer;
  padding: 4px 4px 4px 0;
}

.options-manager__close-btn {
  border: none;
  background: transparent;
  color: var(--color-ink-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.options-manager__notice {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-ink-muted);
  font-size: 12px;
  line-height: 1.6;
}

.options-manager__status {
  color: var(--color-ink-muted);
  padding: 16px 0;

  &--error {
    color: var(--color-danger);
    margin-top: 12px;
    padding: 0;
  }
}

.options-manager__category-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.options-manager__category-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  text-align: left;

  &:hover {
    border-color: var(--color-accent);
  }
}

.options-manager__category-btn-name {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-ink);
}

.options-manager__category-btn-count {
  font-size: 12px;
  color: var(--color-ink-muted);
}

.options-manager__category-btn-arrow {
  color: var(--color-ink-muted);
  font-size: 16px;
}

.options-manager__list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.options-manager__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
}

.options-manager__item-value {
  flex: 1;
  font-size: 13px;
  color: var(--color-ink);
  word-break: break-all;
}

.options-manager__empty {
  font-size: 12px;
  color: var(--color-ink-muted);
  padding: 4px 0;
}

.options-manager__edit-input,
.options-manager__add-input {
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 13px;
  color: var(--color-ink);
  background: var(--color-bg);
}

.options-manager__add-row {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.options-manager__mini-btn {
  flex-shrink: 0;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-ink);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &--danger {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }
}
</style>
