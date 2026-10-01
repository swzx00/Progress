<script setup lang="ts">
import { ref } from 'vue';

import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useOptions } from '@/composables/useOptions';
import type { WorkItemOptions } from '@/types/work-item';

const props = defineProps<{
  idToken: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const CATEGORIES: (keyof WorkItemOptions)[] = ['交辦單位', '交辦人員', '專案名稱', '專案Repo'];

const { options, loading, error, fetchOptions, addOption, renameOption, deleteOption } =
  useOptions();
void fetchOptions();

// 第一層：選母項；第二層：selectedCategory 有值時，改顯示該分類的內容管理畫面
const selectedCategory = ref<keyof WorkItemOptions | null>(null);

const busy = ref(false);
const actionError = ref<string | null>(null);

const newValueDrafts = ref<Record<keyof WorkItemOptions, string>>({
  交辦單位: '',
  交辦人員: '',
  專案名稱: '',
  專案Repo: '',
});

const editingValue = ref<string | null>(null);
const editingDraft = ref('');

const openCategory = (category: keyof WorkItemOptions): void => {
  selectedCategory.value = category;
  actionError.value = null;
};

const backToCategoryList = (): void => {
  selectedCategory.value = null;
  editingValue.value = null;
  editingDraft.value = '';
  actionError.value = null;
};

const startEdit = (value: string): void => {
  editingValue.value = value;
  editingDraft.value = value;
};

const cancelEdit = (): void => {
  editingValue.value = null;
  editingDraft.value = '';
};

const submitEdit = async (oldValue: string): Promise<void> => {
  if (!selectedCategory.value) return;
  const newValue = editingDraft.value.trim();
  if (!newValue || newValue === oldValue) {
    cancelEdit();
    return;
  }
  busy.value = true;
  actionError.value = null;
  try {
    await renameOption(props.idToken, selectedCategory.value, oldValue, newValue);
    cancelEdit();
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '重新命名失敗';
  } finally {
    busy.value = false;
  }
};

const submitAdd = async (): Promise<void> => {
  if (!selectedCategory.value) return;
  const category = selectedCategory.value;
  const value = newValueDrafts.value[category].trim();
  if (!value) return;
  busy.value = true;
  actionError.value = null;
  try {
    await addOption(props.idToken, category, value);
    newValueDrafts.value[category] = '';
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '新增失敗';
  } finally {
    busy.value = false;
  }
};

const deleteTarget = ref<string | null>(null);

const openDeleteConfirm = (value: string): void => {
  deleteTarget.value = value;
};

const confirmDelete = async (): Promise<void> => {
  if (!deleteTarget.value || !selectedCategory.value) return;
  busy.value = true;
  actionError.value = null;
  try {
    await deleteOption(props.idToken, selectedCategory.value, deleteTarget.value);
    deleteTarget.value = null;
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '刪除失敗';
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <div class="options-manager">
    <div class="options-manager__backdrop" @click="emit('close')" />

    <Transition name="options-manager-layer" mode="out-in">
      <!-- 第一層：選母項 -->
      <div
        v-if="!selectedCategory"
        key="list"
        class="options-manager__panel"
        role="dialog"
        aria-modal="true"
      >
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
              <span class="options-manager__category-btn-count"
                >{{ options[category].length }} 筆</span
              >
              <span class="options-manager__category-btn-arrow" aria-hidden="true">›</span>
            </button>
          </li>
        </ul>
      </div>

      <!-- 第二層：調整選定母項的內容 -->
      <div v-else key="editor" class="options-manager__panel" role="dialog" aria-modal="true">
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

        <div v-if="options" class="options-manager__table">
          <div class="options-manager__table-head">
            <span class="options-manager__table-head-value">{{ selectedCategory }}</span>
            <span class="options-manager__table-head-actions">操作</span>
          </div>
          <ul class="options-manager__list">
            <li
              v-for="value in options[selectedCategory]"
              :key="value"
              class="options-manager__item"
            >
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
        </div>

        <div class="options-manager__add-row">
          <input
            v-model="newValueDrafts[selectedCategory]"
            class="options-manager__add-input"
            :placeholder="`新增${selectedCategory}`"
            @keyup.enter="submitAdd"
          />
          <button
            type="button"
            class="options-manager__mini-btn"
            :disabled="busy"
            @click="submitAdd"
          >
            新增
          </button>
        </div>

        <p v-if="actionError" class="options-manager__status options-manager__status--error">
          {{ actionError }}
        </p>
      </div>
    </Transition>

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
// 手機：滿版全螢幕，跟 WorkItemForm 的 Drawer 手機行為一致（無背景遮罩、面板貼齊整個螢幕）
// 桌面（≥768px）：維持置中的 Modal 卡片，見各 class 內的 @media 覆寫
.options-manager {
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

.options-manager__backdrop {
  position: absolute;
  inset: 0;
  display: none;
  background: rgb(27 31 39 / 40%);

  @media (min-width: 768px) {
    display: block;
  }
}

.options-manager__panel {
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
    max-width: 420px;
    max-height: min(80vh, 640px);
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
  }
}

.options-manager__header {
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

.options-manager__title {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-black-800);
}

.options-manager__back-btn {
  padding: 4px 4px 4px 0;
  font-size: 13px;
  color: var(--color-blue-500);
  cursor: pointer;
  background: transparent;
  border: none;
}

.options-manager__close-btn {
  padding: 4px;
  font-size: 16px;
  line-height: 1;
  color: var(--color-black-500);
  cursor: pointer;
  background: transparent;
  border: none;
}

.options-manager__notice {
  padding: 10px 12px;
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-black-500);
  background: var(--color-black-050);
  border-radius: 8px;
}

.options-manager__status {
  padding: 16px 0;
  color: var(--color-black-500);

  &--error {
    padding: 0;
    margin-top: 12px;
    color: var(--color-red-600);
  }
}

.options-manager__category-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  list-style: none;
}

.options-manager__category-btn {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 8px;

  &:hover {
    border-color: var(--color-blue-500);
  }
}

.options-manager__category-btn-name {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-black-800);
}

.options-manager__category-btn-count {
  font-size: 12px;
  color: var(--color-black-500);
}

.options-manager__category-btn-arrow {
  font-size: 16px;
  color: var(--color-black-500);
}

// 仿表格：整份清單一個外框＋表頭，列跟列之間用底線分隔，不是每個值各自一張獨立卡片
.options-manager__table {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  margin-bottom: 12px;
  overflow: hidden;
  border: 1px solid var(--color-black-100);
  border-radius: 8px;
}

.options-manager__table-head {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
  align-items: center;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  color: var(--color-black-500);
  background: var(--color-black-050);
  border-bottom: 1px solid var(--color-black-100);
}

.options-manager__table-head-value {
  flex: 1;
}

.options-manager__list {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  margin: 0;
  overflow-y: auto;
  list-style: none;
}

.options-manager__item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-black-100);

  &:last-child {
    border-bottom: none;
  }
}

.options-manager__item-value {
  flex: 1;
  font-size: 13px;
  color: var(--color-black-800);
  word-break: break-all;
}

.options-manager__empty {
  padding: 10px;
  font-size: 12px;
  color: var(--color-black-500);
}

.options-manager__edit-input,
.options-manager__add-input {
  flex: 1;
  padding: 5px 8px;
  font-size: 13px;
  color: var(--color-black-800);
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 6px;
}

.options-manager__add-row {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.options-manager__mini-btn {
  flex-shrink: 0;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--color-black-800);
  white-space: nowrap;
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 6px;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  &--danger {
    color: var(--color-red-600);
    border-color: var(--color-red-600);
  }
}

/*
 * 開關動畫：手機（滿版）從畫面下方滑入/滑出，跟 WorkItemForm 的 Drawer 手機行為一致；
 * 桌面（置中卡片）改用淡入＋輕微縮放，比較符合「卡片式 Modal」而非「側邊抽屜」的觀感。
 * 根元素（.options-manager）自己也要宣告 transition-duration：Vue 判斷動畫時長是看
 * Transition 套用 class 的那個元素（元件根節點）身上的 transition-duration，不會往子元素找，
 * 沒有這條，離場動畫會被瞬間拔掉 DOM，子元素的動畫來不及播放（WorkItemForm 也踩過這個坑）。
 */
.options-manager-enter-active,
.options-manager-leave-active {
  transition: transform 0.2s ease;
}

.options-manager-enter-active .options-manager__panel,
.options-manager-leave-active .options-manager__panel {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.options-manager-enter-active .options-manager__backdrop,
.options-manager-leave-active .options-manager__backdrop {
  transition: opacity 0.2s ease;
}

.options-manager-enter-from .options-manager__panel,
.options-manager-leave-to .options-manager__panel {
  transform: translateY(100%);

  @media (min-width: 768px) {
    opacity: 0;
    transform: scale(0.95);
  }
}

.options-manager-enter-from .options-manager__backdrop,
.options-manager-leave-to .options-manager__backdrop {
  opacity: 0;
}

/*
 * 第一層（選母項）↔ 第二層（調整內容）切換也要有動畫，不能瞬間跳。用 mode="out-in"
 * 讓舊畫面先淡出/位移出去、新畫面才淡入/位移進來，不會兩層同時疊在畫面上。
 * .options-manager__panel 在這裡就是 Transition 的直接子節點，transition-duration
 * 直接宣告在它自己身上即可，不用再額外處理根節點（跟外層 .options-manager 那組動畫的情況不同）。
 */
.options-manager-layer-enter-active,
.options-manager-layer-leave-active {
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
}

.options-manager-layer-enter-from {
  opacity: 0;
  transform: translateX(16px);
}

.options-manager-layer-leave-to {
  opacity: 0;
  transform: translateX(-16px);
}
</style>
