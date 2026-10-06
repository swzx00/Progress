<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import AppLoading from '@/components/AppLoading.vue';
import AppToast from '@/components/AppToast.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import DateNav from '@/components/DateNav.vue';
import OptionsManagerModal from '@/components/OptionsManagerModal.vue';
import WorkItemForm from '@/components/WorkItemForm.vue';
import WorkItemTable from '@/components/WorkItemTable.vue';
import { useGoogleAuth } from '@/composables/useGoogleAuth';
import { useTaiwanHolidays } from '@/composables/useTaiwanHolidays';
import { useToast } from '@/composables/useToast';
import { ApiError, useWorkItems } from '@/composables/useWorkItems';
import type { WorkItem } from '@/types/work-item';

const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

const { idToken, userEmail, isLoggedIn, isAuthorized, renderSignInButton, signOut } =
  useGoogleAuth();

const signInButtonEl = ref<HTMLElement | null>(null);
watch(signInButtonEl, (el) => {
  if (el) renderSignInButton(el);
});

const selectedDate = ref(toDateString(new Date()));
const { items, loading, error, fetchByDate, createItem, updateItem, deleteItem } = useWorkItems();
const { getDayOffLabel } = useTaiwanHolidays();
const dayOffLabel = computed(() => getDayOffLabel(selectedDate.value));
const isViewingToday = computed(() => selectedDate.value === toDateString(new Date()));

watch(selectedDate, (date) => fetchByDate(date), { immediate: true });

const totalHours = computed(() =>
  loading.value ? undefined : items.value.reduce((sum, item) => sum + item.今日工時, 0),
);

const optionsManagerOpen = ref(false);

const formOpen = ref(false);
const editingItem = ref<WorkItem | null>(null);
const saving = ref(false);

const { showToast } = useToast();

const openCreateForm = (): void => {
  editingItem.value = null;
  formOpen.value = true;
};

const openEditForm = (item: WorkItem): void => {
  editingItem.value = item;
  formOpen.value = true;
};

const closeForm = (): void => {
  formOpen.value = false;
};

/**
 * 儲存失敗一律用 Toast 提示：
 * - 登入錯誤（沒有 token，或後端回 UNAUTHORIZED，例如 token 過期）：關閉表單並強制登出，回到唯讀模式
 * - 其他錯誤（欄位驗證、找不到紀錄、網路錯誤等）：表單維持開啟、保留已填內容，讓使用者修正後重送
 */
const handleSaveError = (message: string, unauthorized: boolean): void => {
  showToast(message);
  if (unauthorized) {
    formOpen.value = false;
    signOut();
  }
};

const onSave = async (payload: Omit<WorkItem, 'id' | '項次' | '已刪除'>): Promise<void> => {
  if (!idToken.value) {
    handleSaveError('尚未登入，無法儲存', true);
    return;
  }
  saving.value = true;
  try {
    if (editingItem.value) {
      await updateItem(idToken.value, editingItem.value.id, editingItem.value.工作日期, payload);
    } else {
      await createItem(idToken.value, payload);
    }
    await fetchByDate(selectedDate.value);
    formOpen.value = false;
  } catch (e) {
    handleSaveError(
      e instanceof Error ? e.message : '儲存時發生未知錯誤',
      e instanceof ApiError && e.code === 'UNAUTHORIZED',
    );
  } finally {
    saving.value = false;
  }
};

const deleteTarget = ref<WorkItem | null>(null);
const deleting = ref(false);

const openDeleteConfirm = (item: WorkItem): void => {
  deleteTarget.value = item;
};

const closeDeleteConfirm = (): void => {
  deleteTarget.value = null;
};

const confirmDelete = async (): Promise<void> => {
  if (!deleteTarget.value || !idToken.value) return;
  deleting.value = true;
  try {
    await deleteItem(idToken.value, deleteTarget.value.id, deleteTarget.value.工作日期);
    await fetchByDate(selectedDate.value);
  } finally {
    deleting.value = false;
    deleteTarget.value = null;
  }
};
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
        <button type="button" class="home-view__signout-btn" @click="optionsManagerOpen = true">
          選項清單
        </button>
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

    <AppLoading v-if="loading" class="home-view__loading" />
    <div v-else-if="error" class="home-view__error">
      <span class="home-view__error-icon" aria-hidden="true">⚠</span>
      <span>{{ error }}</span>
    </div>
    <WorkItemTable
      v-else
      :items="items"
      :today="toDateString(new Date())"
      :editable="isAuthorized"
      :viewing-today="isViewingToday"
      :day-off-label="dayOffLabel"
      @edit="openEditForm"
      @delete="openDeleteConfirm"
    />

    <Transition name="work-item-form">
      <WorkItemForm
        v-if="formOpen && isAuthorized"
        :item="editingItem"
        :saving="saving"
        :default-date="selectedDate"
        @save="onSave"
        @cancel="closeForm"
      />
    </Transition>

    <Transition name="confirm-dialog">
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
    </Transition>

    <Transition name="options-manager">
      <OptionsManagerModal
        v-if="optionsManagerOpen && isAuthorized && idToken"
        :id-token="idToken"
        @close="optionsManagerOpen = false"
      />
    </Transition>

    <AppToast />
  </div>
</template>

<style scoped lang="scss">
.home-view {
  display: flex;
  flex-direction: column;
  gap: 0;
  width: 100dvw;
  height: 100%;
  min-height: 100dvh;

  &__header {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 16px;
    background-color: var(--color-black-050);
    border-bottom: 1px solid var(--color-black-100);

    @media (min-width: 768px) {
      padding: 24px 32px;
    }
  }

  &__title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: var(--color-black-800);
    word-break: keep-all;
  }

  &__badge {
    padding: 2px 10px;
    font-size: 12px;
    color: var(--color-black-500);
    word-break: keep-all;
    border: 1px solid var(--color-black-100);
    border-radius: 999px;
  }

  &__theme-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    aspect-ratio: 1/1;
    padding: 0;
    font-size: 13px;
    color: var(--color-black-500);
    cursor: not-allowed;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-100);
    border-radius: 999px;
  }

  &__account,
  &__unauthorized {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-left: auto;
  }

  &__unauthorized {
    font-size: 12px;
    color: var(--color-red-600);
  }

  &__signin {
    margin-left: auto;
  }

  &__signout-btn {
    padding: 3px 8px;
    font-size: 12px;
    color: var(--color-black-500);
    cursor: pointer;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-100);
    border-radius: 6px;
  }

  &__avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    font-size: 11px;
    font-weight: 700;
    color: var(--color-black-000);
    background: var(--color-blue-500);
    border-radius: 999px;
  }

  &__email {
    display: none;
    font-size: 12px;
    color: var(--color-black-500);

    @media (min-width: 768px) {
      display: inline;
    }
  }

  &__add-btn {
    padding: 6px 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-black-000);
    white-space: nowrap;
    cursor: pointer;
    background: var(--color-blue-500);
    border: none;
    border-radius: 6px;
  }

  // 轉圈＋文字的樣式在 AppLoading 裡，這裡只管它在頁面上佔的空間
  &__loading {
    flex: 1 1 auto;
    padding: 48px 0;
  }

  &__error {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    padding: 48px 16px;
    color: var(--color-red-600);
    text-align: center;
  }

  &__error-icon {
    font-size: 24px;
  }
}
</style>
