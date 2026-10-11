<script setup lang="ts">
import { NDropdown, type DropdownOption } from 'naive-ui';
import { computed, h, ref, toRaw, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppLoading from '@/components/AppLoading.vue';
import AppToast from '@/components/AppToast.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import CopyDayDialog from '@/components/CopyDayDialog.vue';
import DaySummaryModal from '@/components/DaySummaryModal.vue';
import DateNav from '@/components/DateNav.vue';
import ExportModal from '@/components/ExportModal.vue';
import OptionsManagerModal from '@/components/OptionsManagerModal.vue';
import WorkHoursSettingModal from '@/components/WorkHoursSettingModal.vue';
import WorkItemForm from '@/components/WorkItemForm.vue';
import WorkItemSearch from '@/components/WorkItemSearch.vue';
import WorkItemTable from '@/components/WorkItemTable.vue';
import { useGoogleAuth } from '@/composables/useGoogleAuth';
import { useOptions } from '@/composables/useOptions';
import { useTaiwanHolidays } from '@/composables/useTaiwanHolidays';
import { THEME_MODES, useTheme, type ThemeMode } from '@/composables/useTheme';
import { useToast } from '@/composables/useToast';
import { useToday } from '@/composables/useToday';
import {
  ApiError,
  fetchDaySummary,
  searchItems,
  useWorkItems,
  type SearchResult,
} from '@/composables/useWorkItems';
import type { WorkItem } from '@/types/work-item';
import { buildCopyPayload } from '@/utils/copy-work-item';
import { isValidDateString, todayString } from '@/utils/date';
import {
  SEARCH_FIELD_LABELS,
  SEARCH_FIELDS,
  SEARCH_KEYWORD_MAX,
  SEARCH_MAX_RESULTS,
  type SearchField,
  type SearchQuery,
} from '@/utils/search-work-items';
import { DAILY_HOURS_MAX, dailyHoursMessage } from '@/validation/work-item';

const {
  idToken,
  userEmail,
  isLoggedIn,
  isAuthorized,
  renderSignInButton,
  signOut,
  ensureFreshLogin,
} = useGoogleAuth();

const signInButtonEl = ref<HTMLElement | null>(null);

// 網址參數的規則見下方 syncUrl
const route = useRoute();
const router = useRouter();
const urlDate = (): string | null => {
  const value = route.query.date;
  return typeof value === 'string' && isValidDateString(value) ? value : null;
};

const selectedDate = ref(urlDate() ?? todayString());
const {
  items,
  loading,
  error,
  fetchByDate,
  createItem,
  batchCreateItems,
  updateItem,
  deleteItem,
  reorderItems,
} = useWorkItems();
const { getDayOffLabel } = useTaiwanHolidays();
const dayOffLabel = computed(() => getDayOffLabel(selectedDate.value));
const today = useToday();
const isViewingToday = computed(() => selectedDate.value === today.value);

watch(selectedDate, (date) => fetchByDate(date), { immediate: true });

const totalHours = computed(() =>
  loading.value ? undefined : items.value.reduce((sum, item) => sum + item.今日工時, 0),
);

/**
 * 搜尋（使用者決定）：搜尋欄按下搜尋（Enter、搜尋按鈕、點推薦）後到後端查全部資料，
 * 表格換成「搜尋結果」（跨日期，工作日期新的在前），點工作日期跳到那天並結束搜尋。
 * 結果列可以編輯、複製、刪除（存檔後重新搜尋一次），不能調整順序。
 * 連續搜尋只採用最後一次的結果；清空搜尋欄就回到單日表格
 */
const searchText = ref('');
const searchQuery = ref<SearchQuery | null>(null);
const searchResult = ref<SearchResult | null>(null);
const searchLoading = ref(false);
const searchError = ref<string | null>(null);
let searchSeq = 0;

const runSearch = async (query: SearchQuery): Promise<void> => {
  const seq = ++searchSeq;
  searchQuery.value = query;
  searchLoading.value = true;
  searchError.value = null;
  try {
    const result = await searchItems(query);
    if (seq !== searchSeq) return;
    searchResult.value = result;
  } catch (e) {
    if (seq !== searchSeq) return;
    searchResult.value = null;
    searchError.value = e instanceof Error ? e.message : '搜尋時發生未知錯誤';
  } finally {
    if (seq === searchSeq) searchLoading.value = false;
  }
};

const clearSearch = (): void => {
  searchSeq++;
  searchText.value = '';
  searchQuery.value = null;
  searchResult.value = null;
  searchError.value = null;
  searchLoading.value = false;
};

const goToDate = (date: string): void => {
  clearSearch();
  selectedDate.value = date;
};

/**
 * 網址參數（使用者決定）：重新整理、分享連結都會回到同一個畫面
 * - date=YYYY-MM-DD：開到那天；一開始沒帶就維持乾淨的網址，切過日期才寫進去
 * - q（關鍵字）＋ field（點推薦時的欄位，值同 API 的 field）：開頁面就直接搜尋，搜尋欄也填好；
 *   結束搜尋（清空、點工作日期跳到那天）就拿掉。搜尋中 date 照樣留著，結束搜尋回到那天
 * - 格式不對（日期不存在、關鍵字空白或超過 SEARCH_KEYWORD_MAX、field 不是 SEARCH_FIELDS）就不採用，從網址拿掉
 * 一律用 router.replace（不用 push），不會塞一堆瀏覽紀錄，按上一頁直接離開網站。
 * 網址只由 syncUrl 從畫面狀態整個算出來：日期和搜尋同時改（例如點工作日期）時，
 * 分開 replace 會拿到還沒更新的 route.query 互相蓋掉
 */
const URL_KEYS = ['date', 'q', 'field'];

const urlSearch = (): SearchQuery | null => {
  const { q, field } = route.query;
  if (typeof q !== 'string' || !q.trim() || q.length > SEARCH_KEYWORD_MAX) return null;
  if (field === undefined) return { keyword: q };
  return typeof field === 'string' && (SEARCH_FIELDS as readonly string[]).includes(field)
    ? { keyword: q, field: field as SearchField }
    : null;
};

let dateInUrl = urlDate() !== null;

const syncUrl = (): void => {
  const query = Object.fromEntries(
    Object.entries(route.query).filter(([key]) => !URL_KEYS.includes(key)),
  );
  if (dateInUrl) query.date = selectedDate.value;
  if (searchQuery.value) {
    query.q = searchQuery.value.keyword;
    if (searchQuery.value.field) query.field = searchQuery.value.field;
  }
  const same =
    Object.keys(query).length === Object.keys(route.query).length &&
    Object.entries(query).every(([key, value]) => route.query[key] === value);
  if (!same) void router.replace({ query });
};

const initialSearch = urlSearch();
if (initialSearch) {
  searchText.value = initialSearch.keyword;
  void runSearch(initialSearch);
}
syncUrl();

watch(selectedDate, () => {
  dateInUrl = true;
  syncUrl();
});
watch(searchQuery, syncUrl);
// 網址的 date 被程式改掉（例如之後加了連結）時跟著切過去
watch(
  () => route.query.date,
  () => {
    const date = urlDate();
    if (date && date !== selectedDate.value) selectedDate.value = date;
  },
);

// 搜尋摘要：點推薦時前面加欄位名稱，關鍵字本身粗體（template 裡用 strong）
const searchSummaryLabel = computed(() =>
  searchQuery.value?.field ? SEARCH_FIELD_LABELS[searchQuery.value.field] : '',
);

/** 新增、編輯、刪除後：重讀選到的那天；搜尋中也重新搜尋一次，結果才不會過時 */
const refreshAfterChange = async (): Promise<void> => {
  await Promise.all([
    fetchByDate(selectedDate.value),
    searchQuery.value ? runSearch(searchQuery.value) : Promise.resolve(),
  ]);
};

const optionsManagerOpen = ref(false);
const daySummaryOpen = ref(false);
const exportOpen = ref(false);
const workHoursOpen = ref(false);

// 樣式（深色模式）：自動（依日出日落）／淺色／深色，目前的選項前面打勾。
// 「工具」下拉選單的「樣式」子選單、右上角的月亮／太陽按鈕（未登入也能用）共用這份選項
const { mode: themeMode, isDark, setMode: setThemeMode } = useTheme();

// Google 登入按鈕跟著實際套用的主題（含「自動」算出來的結果）切換樣式：深色 filled_black、淺色 outline
watch([signInButtonEl, isDark], ([el, dark]) => {
  if (el) void renderSignInButton(el, dark);
});
const THEME_KEY_PREFIX = 'theme:';
const themeOptions = computed<DropdownOption[]>(() =>
  THEME_MODES.map(({ mode, label }) => ({
    label,
    key: `${THEME_KEY_PREFIX}${mode}`,
    icon: () =>
      h(
        'span',
        { class: 'home-view__theme-check', 'aria-hidden': 'true' },
        mode === themeMode.value ? '✓' : '',
      ),
  })),
);
const onThemeSelect = (key: string): void => {
  setThemeMode(key.slice(THEME_KEY_PREFIX.length) as ThemeMode);
};

// 「工具」下拉選單：選項清單（管理 Modal）、本日總結（整理當天工作進度文字的 Modal）、
// 匯出 Excel（選範圍下載 .xlsx 的 Modal）、工時設定（上下班、午休時間的 Modal）、樣式（子選單，切換深色模式）
type ToolKey = 'options' | 'daySummary' | 'export' | 'workHours';
const toolOptions = computed<DropdownOption[]>(() => [
  { label: '選項清單', key: 'options' },
  { label: '本日總結', key: 'daySummary' },
  { label: '匯出 Excel', key: 'export' },
  { label: '工時設定', key: 'workHours' },
  { label: '樣式', key: 'theme', children: themeOptions.value },
]);
const onToolSelect = (key: ToolKey | string): void => {
  if (key.startsWith(THEME_KEY_PREFIX)) onThemeSelect(key);
  else if (key === 'options') {
    if (requireFreshLogin()) optionsManagerOpen.value = true;
  } else if (key === 'daySummary') daySummaryOpen.value = true;
  else if (key === 'export') exportOpen.value = true;
  else if (key === 'workHours') {
    if (requireFreshLogin()) workHoursOpen.value = true;
  }
};

const formOpen = ref(false);
const editingItem = ref<WorkItem | null>(null);
// 新增時開的是請假表單還是工作紀錄表單；編輯時表單自己看紀錄的狀態判斷
const creatingLeave = ref(false);
// 複製：用這筆紀錄預填新增表單（存檔走新增，原紀錄不動）
const copySource = ref<WorkItem | null>(null);
const saving = ref(false);

const { showToast } = useToast();

/**
 * 開啟會寫入資料的表單／對話框前確認登入還有效：token 過期（分頁開著超過約一小時）就登出並提示，
 * 不讓使用者打完內容才在儲存時被退回
 */
const requireFreshLogin = (): boolean => {
  if (ensureFreshLogin()) return true;
  showToast('登入已過期，請重新登入');
  return false;
};

// 存檔成功後更新近期紀錄（表單的推薦與預填用），下次開表單不用重新讀選項清單
const { rememberItems } = useOptions();

const openCreateForm = (): void => {
  if (!requireFreshLogin()) return;
  editingItem.value = null;
  copySource.value = null;
  creatingLeave.value = false;
  formOpen.value = true;
};

const openLeaveForm = (): void => {
  if (!requireFreshLogin()) return;
  editingItem.value = null;
  copySource.value = null;
  creatingLeave.value = true;
  formOpen.value = true;
};

const openEditForm = (item: WorkItem): void => {
  if (!requireFreshLogin()) return;
  editingItem.value = item;
  copySource.value = null;
  formOpen.value = true;
};

const openCopyForm = (item: WorkItem): void => {
  if (!requireFreshLogin()) return;
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
      await updateItem(idToken.value, editingItem.value.id, payload);
    } else {
      await createItem(idToken.value, payload);
    }
    rememberItems([{ ...payload, id: editingItem.value?.id }]);
    await refreshAfterChange();
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
 * 欄位規則跟單項複製共用 buildCopyPayload。
 * - 目標日不能跟來源同一天
 * - 目標日已有紀錄：先跳警示確認，確認後用覆蓋模式（後端先把目標日原本的紀錄，含請假，搬到『已刪除紀錄』分頁再寫入），
 *   工時合計只算這批
 * - 目標日沒有紀錄：直接複製，工時合計算「既有紀錄＋這批」
 * 送出前前端先估算工時合計，超過上限就擋下、不送出；後端 batchCreate 也會整批檢查。
 * 成功後切到目標日期，並用 Toast 顯示複製了幾筆（使用者決定）
 */
const copyDayOpen = ref(false);
const copyingDay = ref(false);
const copyDayError = ref<string | null>(null);
// 目標日已有紀錄時等待使用者確認覆蓋
const copyDayReplaceTarget = ref<{ date: string; count: number } | null>(null);

const canCopyDay = computed(() => !loading.value && !error.value && items.value.length > 0);

const formatDisplayDate = (date: string): string => date.replaceAll('-', '/');

const copyDayPayloads = (targetDate: string) =>
  [...items.value]
    .sort((a, b) => a.項次 - b.項次)
    .map((item) => buildCopyPayload(item, targetDate));

const openCopyDay = (): void => {
  if (!requireFreshLogin()) return;
  copyDayError.value = null;
  copyDayOpen.value = true;
};

const closeCopyDay = (): void => {
  if (copyingDay.value) return;
  copyDayOpen.value = false;
};

const handleCopyDayUnauthorized = (message: string): void => {
  copyDayOpen.value = false;
  copyDayReplaceTarget.value = null;
  showToast(message);
  signOut();
};

const runCopyDay = async (targetDate: string, replace: boolean): Promise<void> => {
  if (!idToken.value) {
    handleCopyDayUnauthorized('尚未登入，無法複製');
    return;
  }
  const payloads = copyDayPayloads(targetDate);
  copyingDay.value = true;
  try {
    await batchCreateItems(idToken.value, payloads, replace);
    rememberItems(payloads);
    copyDayOpen.value = false;
    copyDayReplaceTarget.value = null;
    if (selectedDate.value === targetDate) {
      await fetchByDate(targetDate);
    } else {
      selectedDate.value = targetDate;
    }
    if (searchQuery.value) void runSearch(searchQuery.value);
    showToast(`已複製 ${payloads.length} 筆紀錄到 ${formatDisplayDate(targetDate)}`, 'success');
  } catch (e) {
    // 登入錯誤：關閉對話框並登出；其他錯誤（含後端整批退回）：複製對話框維持開啟，讓使用者換日期重試
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') {
      handleCopyDayUnauthorized(e.message);
      return;
    }
    copyDayReplaceTarget.value = null;
    showToast(e instanceof Error ? e.message : '複製時發生未知錯誤');
  } finally {
    copyingDay.value = false;
  }
};

const confirmCopyDay = async (targetDate: string): Promise<void> => {
  if (copyingDay.value) return;
  copyDayError.value = null;
  if (targetDate === selectedDate.value) {
    copyDayError.value = '目標日期不能跟來源同一天';
    return;
  }
  const batchHours = copyDayPayloads(targetDate).reduce((sum, item) => sum + item.今日工時, 0);

  copyingDay.value = true;
  let summary: { otherHours: number; itemCount: number };
  try {
    summary = await fetchDaySummary(targetDate);
  } catch {
    copyDayError.value = '無法確認目標日的紀錄，請稍後再試';
    return;
  } finally {
    copyingDay.value = false;
  }

  // 覆蓋時原本的紀錄會被刪掉，工時合計只算這批
  const otherHours = summary.itemCount > 0 ? 0 : summary.otherHours;
  if (otherHours + batchHours > DAILY_HOURS_MAX) {
    copyDayError.value = dailyHoursMessage(otherHours, batchHours);
    return;
  }
  if (summary.itemCount > 0) {
    copyDayReplaceTarget.value = { date: targetDate, count: summary.itemCount };
    return;
  }
  await runCopyDay(targetDate, false);
};

const confirmCopyDayReplace = async (): Promise<void> => {
  if (!copyDayReplaceTarget.value || copyingDay.value) return;
  await runCopyDay(copyDayReplaceTarget.value.date, true);
};

const cancelCopyDayReplace = (): void => {
  if (copyingDay.value) return;
  copyDayReplaceTarget.value = null;
};

/**
 * 項次調整（上移／下移、拖曳）：每次移動立即存檔。先在畫面上套用新順序（項次改成 1、2、3…），
 * 失敗就還原成移動前的資料並用 Toast 顯示錯誤；登入錯誤時登出（使用者決定）。
 * 送出期間切到別天（或切走再切回來）時，items 已經換成重新讀到的資料，就不還原
 */
const reordering = ref(false);

const onReorder = async (ids: string[]): Promise<void> => {
  if (reordering.value) return;
  if (!idToken.value) {
    showToast('尚未登入，無法調整順序');
    signOut();
    return;
  }
  const before = items.value;
  if (!requireFreshLogin()) {
    // 拖曳時表格已經先改了自己的順序，重新指定一次讓表格同步回原本的順序
    items.value = [...before];
    return;
  }
  const byId = new Map(before.map((item) => [item.id, item]));
  const reordered = ids.flatMap((id, index) => {
    const item = byId.get(id);
    return item ? [{ ...item, 項次: index + 1 }] : [];
  });
  items.value = reordered;
  reordering.value = true;
  try {
    await reorderItems(idToken.value, selectedDate.value, ids);
  } catch (e) {
    // items 還是這次套用的順序才還原；切過日期的話已經是重新讀到的資料，不能用快照蓋掉
    if (toRaw(items.value) === reordered) items.value = before;
    showToast(e instanceof Error ? e.message : '調整順序時發生未知錯誤');
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') signOut();
  } finally {
    reordering.value = false;
  }
};

const deleteTarget = ref<WorkItem | null>(null);
const deleting = ref(false);

const openDeleteConfirm = (item: WorkItem): void => {
  if (!requireFreshLogin()) return;
  deleteTarget.value = item;
};

const closeDeleteConfirm = (): void => {
  deleteTarget.value = null;
};

/**
 * 刪除失敗比照儲存，一律用 Toast 提示：
 * - 登入錯誤（沒有 token，或後端回 UNAUTHORIZED）：關閉確認對話框並強制登出，回到唯讀模式
 * - 其他錯誤（找不到紀錄、網路錯誤等）：確認對話框維持開啟，讓使用者直接重試或取消
 */
const handleDeleteUnauthorized = (message: string): void => {
  deleteTarget.value = null;
  showToast(message);
  signOut();
};

const confirmDelete = async (): Promise<void> => {
  if (!deleteTarget.value) return;
  if (!idToken.value) {
    handleDeleteUnauthorized('尚未登入，無法刪除');
    return;
  }
  deleting.value = true;
  try {
    await deleteItem(idToken.value, deleteTarget.value.id);
    deleteTarget.value = null;
    await refreshAfterChange();
  } catch (e) {
    if (e instanceof ApiError && e.code === 'UNAUTHORIZED') {
      handleDeleteUnauthorized(e.message);
      return;
    }
    showToast(e instanceof Error ? e.message : '刪除時發生未知錯誤');
  } finally {
    deleting.value = false;
  }
};

/** 選項清單管理遇到登入錯誤：關閉 Modal 並強制登出（錯誤訊息已由 Modal 用 Toast 顯示） */
const onOptionsUnauthorized = (): void => {
  optionsManagerOpen.value = false;
  signOut();
};

/** 工時設定遇到登入錯誤：比照選項清單管理，關閉 Modal 並強制登出 */
const onWorkHoursUnauthorized = (): void => {
  workHoursOpen.value = false;
  signOut();
};
</script>

<template>
  <div class="home-view">
    <header class="home-view__header">
      <h1 class="home-view__title">工作進度</h1>
      <span v-if="!isAuthorized" class="home-view__badge">唯讀模式</span>
      <NDropdown trigger="click" :options="themeOptions" @select="onThemeSelect">
        <button
          type="button"
          class="home-view__theme-btn"
          :title="isDark ? '樣式：目前是深色' : '樣式：目前是淺色'"
          :aria-label="isDark ? '樣式：目前是深色' : '樣式：目前是淺色'"
        >
          <!-- 圖示：Lucide moon／sun（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0 -->
          <svg
            class="home-view__theme-icon"
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
            <template v-if="isDark">
              <path
                d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
              />
            </template>
            <template v-else>
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </template>
          </svg>
        </button>
      </NDropdown>
      <div v-if="isAuthorized" class="home-view__account">
        <span class="home-view__avatar">{{ userEmail?.charAt(0).toUpperCase() }}</span>
        <span class="home-view__email">{{ userEmail }}</span>
        <NDropdown trigger="click" :options="toolOptions" @select="onToolSelect">
          <button type="button" class="home-view__signout-btn home-view__tools-btn">
            工具
            <!-- 下拉箭頭：Naive UI 下拉選單（NSelect）內建的 ChevronDown 圖示，MIT 授權 -->
            <svg
              class="home-view__tools-arrow"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M3.14645 5.64645C3.34171 5.45118 3.65829 5.45118 3.85355 5.64645L8 9.79289L12.1464 5.64645C12.3417 5.45118 12.6583 5.45118 12.8536 5.64645C13.0488 5.84171 13.0488 6.15829 12.8536 6.35355L8.35355 10.8536C8.15829 11.0488 7.84171 11.0488 7.64645 10.8536L3.14645 6.35355C2.95118 6.15829 2.95118 5.84171 3.14645 5.64645Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </NDropdown>
        <button type="button" class="home-view__signout-btn" @click="signOut">登出</button>
      </div>
      <div v-else-if="isLoggedIn" class="home-view__unauthorized">
        <span>{{ userEmail }} 沒有管理權限</span>
        <button type="button" class="home-view__signout-btn" @click="signOut">登出</button>
      </div>
      <div v-else ref="signInButtonEl" class="home-view__signin"></div>
    </header>

    <DateNav
      v-model="selectedDate"
      :total-hours="totalHours"
      :has-items="items.length > 0"
      :searching="searchQuery !== null"
    >
      <template #search>
        <WorkItemSearch v-model="searchText" @search="runSearch" @clear="clearSearch" />
      </template>
      <template v-if="isAuthorized" #actions>
        <button
          v-if="canCopyDay"
          type="button"
          class="home-view__add-btn home-view__add-btn--copy-day"
          title="複製本日"
          aria-label="複製本日"
          @click="openCopyDay"
        >
          <!-- 圖示：Lucide files（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0 -->
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
            <path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8" />
            <path
              d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"
            />
            <path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1" />
          </svg>
          複製本日
        </button>
        <button
          type="button"
          class="home-view__add-btn home-view__add-btn--leave"
          title="請假"
          aria-label="請假"
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
        <button
          type="button"
          class="home-view__add-btn"
          title="新增"
          aria-label="新增"
          @click="openCreateForm"
        >
          <!-- 圖示：Lucide plus（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0 -->
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
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          新增
        </button>
      </template>
    </DateNav>

    <!-- 搜尋結果：載入中、錯誤（可重新搜尋）、結果（含沒有符合的空狀態） -->
    <template v-if="searchQuery">
      <AppLoading v-if="searchLoading" label="搜尋中…" class="home-view__loading" />
      <div v-else-if="searchError" class="home-view__error">
        <span class="home-view__error-icon" aria-hidden="true">⚠</span>
        <span>{{ searchError }}</span>
        <button type="button" class="home-view__retry-btn" @click="runSearch(searchQuery)">
          重新載入
        </button>
      </div>
      <template v-else-if="searchResult">
        <div class="home-view__search-summary" role="status">
          <span>
            搜尋結果：{{ searchSummaryLabel }}「<strong class="home-view__search-keyword">{{
              searchQuery.keyword
            }}</strong
            >」，共 {{ searchResult.total }} 筆<template
              v-if="searchResult.total > searchResult.items.length"
              >，只顯示最新的 {{ SEARCH_MAX_RESULTS }} 筆</template
            >
          </span>
          <button type="button" class="home-view__signout-btn" @click="clearSearch">
            結束搜尋
          </button>
        </div>
        <WorkItemTable
          :items="searchResult.items"
          :today="today"
          :editable="isAuthorized"
          search-mode
          :search-keyword="searchQuery.keyword"
          :search-field="searchQuery.field"
          @edit="openEditForm"
          @copy="openCopyForm"
          @delete="openDeleteConfirm"
          @go-to-date="goToDate"
        />
      </template>
    </template>

    <AppLoading v-else-if="loading" class="home-view__loading" />
    <div v-else-if="error" class="home-view__error">
      <span class="home-view__error-icon" aria-hidden="true">⚠</span>
      <span>{{ error }}</span>
    </div>
    <WorkItemTable
      v-else
      :items="items"
      :today="today"
      :editable="isAuthorized"
      :viewing-today="isViewingToday"
      :day-off-label="dayOffLabel"
      @edit="openEditForm"
      :reordering="reordering"
      @copy="openCopyForm"
      @reorder="onReorder"
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
        v-if="copyDayReplaceTarget && isAuthorized"
        title="目標日已有紀錄"
        :message="`${formatDisplayDate(copyDayReplaceTarget.date)} 已經有 ${copyDayReplaceTarget.count} 筆紀錄，複製後會先刪除這 ${copyDayReplaceTarget.count} 筆，再寫入 ${items.length} 筆複製的紀錄。`"
        confirm-label="刪除並複製"
        danger
        :busy="copyingDay"
        @confirm="confirmCopyDayReplace"
        @cancel="cancelCopyDayReplace"
      />
    </Transition>

    <Transition name="confirm-dialog">
      <ConfirmDialog
        v-if="deleteTarget && isAuthorized"
        title="確定要刪除這筆紀錄嗎？"
        :message="`「${deleteTarget.專案名稱}」・${deleteTarget.工作目標}，${deleteTarget.工作日期}。刪除後會移到 Sheet 的『已刪除紀錄』分頁。`"
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
        @unauthorized="onOptionsUnauthorized"
      />
    </Transition>

    <Transition name="day-summary">
      <DaySummaryModal
        v-if="daySummaryOpen && isAuthorized"
        :date="formatDisplayDate(selectedDate)"
        :items="items"
        @close="daySummaryOpen = false"
      />
    </Transition>

    <Transition name="export-modal">
      <ExportModal
        v-if="exportOpen && isAuthorized"
        :default-date="selectedDate"
        @close="exportOpen = false"
      />
    </Transition>

    <Transition name="work-hours-setting">
      <WorkHoursSettingModal
        v-if="workHoursOpen && isAuthorized && idToken"
        :id-token="idToken"
        @close="workHoursOpen = false"
        @unauthorized="onWorkHoursUnauthorized"
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

  // 不用 100dvw／100vw：它們包含垂直捲軸的寬度，內容變高出現垂直捲軸時會多出捲軸那一條、冒出 X 軸捲軸
  width: 100%;
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
    color: var(--color-black-500);
    cursor: pointer;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-100);
    border-radius: 999px;

    &:hover {
      color: var(--color-black-800);
      background: var(--color-black-050);
    }
  }

  &__theme-icon {
    width: 14px;
    height: 14px;
  }

  // 樣式選項前面的打勾（下拉選單 teleport 到 body，不吃 scoped 樣式，用 :global）
  :global(.home-view__theme-check) {
    display: inline-block;
    width: 1em;
    text-align: center;
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

  // Google 個人化登入按鈕是 iframe，內頁沒宣告 color-scheme（淺色）；深色模式時外層繼承 dark，
  // 兩邊不一致瀏覽器會把 iframe 背景畫成不透明白底，圓角按鈕外露出白邊，所以這裡固定 light
  &__signin {
    margin-left: auto;
    color-scheme: light;
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

  &__tools-btn {
    display: inline-flex;
    gap: 2px;
    align-items: center;
  }

  &__tools-arrow {
    width: 14px;
    height: 14px;
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

  // 三顆動作按鈕一律圖示＋文字（使用者決定）：手機三顆平均分配整列寬度，平板、桌面寬度隨內容
  &__add-btn {
    display: inline-flex;
    flex: 1 1 0;
    gap: 4px;
    align-items: center;
    justify-content: center;
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

    // hover（使用者決定）：實心底的「＋ 新增」變深；請假、複製本日這類框線按鈕改成淡色底＋深一階的文字與框線
    &:hover {
      background: var(--color-blue-700);
      border-color: var(--color-blue-700);
    }

    // 請假是次要入口：白底＋框線，跟主要的「＋ 新增」做出主次區別。色系用 teal，跟表格請假列一致；
    // 14px 文字在白底要 4.5:1 對比，teal-500／600 不夠，用 teal-700（使用者決定）
    &--leave {
      color: var(--color-teal-700);
      background: var(--color-black-000);
      border-color: var(--color-teal-700);

      &:hover {
        color: var(--color-teal-800);
        background: var(--color-teal-050);
        border-color: var(--color-teal-800);
      }
    }

    // 複製本日：中性灰的次要按鈕，跟表格操作欄的「複製」同一組顏色
    &--copy-day {
      color: var(--color-black-600);
      background: var(--color-black-000);
      border-color: var(--color-black-300);

      &:hover {
        color: var(--color-black-700);
        background: var(--color-black-050);
        border-color: var(--color-black-700);
      }
    }

    &-icon {
      flex: 0 0 auto;
      width: 16px;
      height: 16px;
    }

    @media (min-width: 768px) {
      flex: none;
    }
  }

  // 搜尋結果上方的摘要（關鍵字、筆數）＋結束搜尋；左右內距跟 DateNav 對齊，文字色系跟搜尋結果表格一樣用 purple，不加底色（使用者決定）
  &__search-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px 12px;
    font-size: 13px;
    color: var(--color-purple-700);

    @media (min-width: 768px) {
      padding: 0 32px 12px;
    }
  }

  &__search-keyword {
    font-weight: 700;
  }

  &__retry-btn {
    padding: 6px 12px;
    font-size: 14px;
    color: var(--color-black-600);
    cursor: pointer;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-300);
    border-radius: 6px;

    &:hover {
      color: var(--color-black-700);
      background: var(--color-black-050);
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
