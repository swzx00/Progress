<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import AppLoading from '@/components/AppLoading.vue';
import AppToast from '@/components/AppToast.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import CopyDayDialog from '@/components/CopyDayDialog.vue';
import DateNav from '@/components/DateNav.vue';
import OptionsManagerModal from '@/components/OptionsManagerModal.vue';
import WorkItemForm from '@/components/WorkItemForm.vue';
import WorkItemTable from '@/components/WorkItemTable.vue';
import { useGoogleAuth } from '@/composables/useGoogleAuth';
import { useTaiwanHolidays } from '@/composables/useTaiwanHolidays';
import { useToast } from '@/composables/useToast';
import { ApiError, fetchDaySummary, useWorkItems } from '@/composables/useWorkItems';
import type { WorkItem } from '@/types/work-item';
import { buildCopyPayload } from '@/utils/copy-work-item';
import { DAILY_HOURS_MAX, dailyHoursMessage } from '@/validation/work-item';

const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

const { idToken, userEmail, isLoggedIn, isAuthorized, renderSignInButton, signOut } =
  useGoogleAuth();

const signInButtonEl = ref<HTMLElement | null>(null);
watch(signInButtonEl, (el) => {
  if (el) renderSignInButton(el);
});

const selectedDate = ref(toDateString(new Date()));
const { items, loading, error, fetchByDate, createItem, batchCreateItems, updateItem, deleteItem } =
  useWorkItems();
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
// 新增時開的是請假表單還是工作紀錄表單；編輯時表單自己看紀錄的狀態判斷
const creatingLeave = ref(false);
// 複製：用這筆紀錄預填新增表單（存檔走新增，原紀錄不動）
const copySource = ref<WorkItem | null>(null);
const saving = ref(false);

const { showToast } = useToast();

const openCreateForm = (): void => {
  editingItem.value = null;
  copySource.value = null;
  creatingLeave.value = false;
  formOpen.value = true;
};

const openLeaveForm = (): void => {
  editingItem.value = null;
  copySource.value = null;
  creatingLeave.value = true;
  formOpen.value = true;
};

const openEditForm = (item: WorkItem): void => {
  editingItem.value = item;
  copySource.value = null;
  formOpen.value = true;
};

const openCopyForm = (item: WorkItem): void => {
  editingItem.value = null;
  copySource.value = item;
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

/**
 * 複製本日：把目前選到那天的全部紀錄（含請假）依原本項次順序，一次複製到目標日期。
 * 欄位規則跟單項複製共用 buildCopyPayload。送出前前端先估算目標日的工時合計
 * （既有紀錄＋這批），超過上限就擋下、不送出；後端 batchCreate 也會整批檢查。
 * 成功後切到目標日期，並用 Toast 顯示複製了幾筆
 */
const copyDayOpen = ref(false);
const copyingDay = ref(false);
const copyDayError = ref<string | null>(null);

const canCopyDay = computed(() => !loading.value && !error.value && items.value.length > 0);

const openCopyDay = (): void => {
  copyDayError.value = null;
  copyDayOpen.value = true;
};

const closeCopyDay = (): void => {
  if (copyingDay.value) return;
  copyDayOpen.value = false;
};

const confirmCopyDay = async (targetDate: string): Promise<void> => {
  if (copyingDay.value) return;
  if (!idToken.value) {
    copyDayOpen.value = false;
    showToast('尚未登入，無法複製');
    signOut();
    return;
  }
  const payloads = [...items.value]
    .sort((a, b) => a.項次 - b.項次)
    .map((item) => buildCopyPayload(item, targetDate));
  const batchHours = payloads.reduce((sum, item) => sum + item.今日工時, 0);

  copyingDay.value = true;
  copyDayError.value = null;
  try {
    let otherHours: number;
    try {
      ({ otherHours } = await fetchDaySummary(targetDate));
    } catch {
      copyDayError.value = '無法確認目標日的工時合計，請稍後再試';
      return;
    }
    if (otherHours + batchHours > DAILY_HOURS_MAX) {
      copyDayError.value = dailyHoursMessage(otherHours, batchHours);
      return;
    }
    await batchCreateItems(idToken.value, payloads);
    copyDayOpen.value = false;
    if (selectedDate.value === targetDate) {
      await fetchByDate(targetDate);
    } else {
      selectedDate.value = targetDate;
    }
    showToast(`已複製 ${payloads.length} 筆紀錄到 ${targetDate.replaceAll('-', '/')}`, 'success');
  } catch (e) {
    // 登入錯誤：關閉對話框並登出；其他錯誤（含後端整批退回）：對話框維持開啟，讓使用者換日期重試
    const unauthorized = e instanceof ApiError && e.code === 'UNAUTHORIZED';
    showToast(e instanceof Error ? e.message : '複製時發生未知錯誤');
    if (unauthorized) {
      copyDayOpen.value = false;
      signOut();
    }
  } finally {
    copyingDay.value = false;
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
        <button
          v-if="canCopyDay"
          type="button"
          class="home-view__add-btn home-view__add-btn--copy-day"
          @click="openCopyDay"
        >
          複製本日
        </button>
        <button
          type="button"
          class="home-view__add-btn home-view__add-btn--leave"
          @click="openLeaveForm"
        >
          <!-- 圖示：Lucide coffee（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0 -->
          <svg
            class="home-view__add-btn-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M10 2v2" />
            <path d="M14 2v2" />
            <path
              d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"
            />
            <path d="M6 2v2" />
          </svg>
          請假
        </button>
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
      @copy="openCopyForm"
      @delete="openDeleteConfirm"
    />

    <Transition name="work-item-form">
      <WorkItemForm
        v-if="formOpen && isAuthorized"
        :item="editingItem"
        :saving="saving"
        :default-date="selectedDate"
        :leave="creatingLeave"
        :copy-source="copySource"
        @save="onSave"
        @cancel="closeForm"
      />
    </Transition>

    <Transition name="copy-day-dialog">
      <CopyDayDialog
        v-if="copyDayOpen && isAuthorized"
        :source-date="selectedDate"
        :count="items.length"
        :busy="copyingDay"
        :error="copyDayError"
        @confirm="confirmCopyDay"
        @cancel="closeCopyDay"
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
    display: inline-flex;
    gap: 4px;
    align-items: center;
    padding: 6px 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-black-000);
    white-space: nowrap;
    cursor: pointer;
    background: var(--color-blue-500);

    // 基底也留 1px 框線（跟底色同色），「＋ 新增」才會跟有框線的請假按鈕一樣高
    border: 1px solid var(--color-blue-500);
    border-radius: 6px;

    // 請假是次要入口：白底＋框線，跟主要的「＋ 新增」做出主次區別。色系用 teal，跟表格請假列一致；
    // 14px 文字在白底要 4.5:1 對比，teal-500／600 不夠，用 teal-700（使用者決定）
    &--leave {
      color: var(--color-teal-700);
      background: var(--color-black-000);
      border-color: var(--color-teal-700);
    }

    // 複製本日：中性灰的次要按鈕，跟表格操作欄的「複製」同一組顏色
    &--copy-day {
      color: var(--color-black-600);
      background: var(--color-black-000);
      border-color: var(--color-black-300);
    }

    &-icon {
      flex: 0 0 auto;
      width: 16px;
      height: 16px;
    }
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
