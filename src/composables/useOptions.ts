import { ref } from 'vue';

import {
  ApiError,
  type DoPostResponse,
  fromApiDate,
  getApi,
  postApi,
} from '@/composables/useWorkItems';
import type { ThemeMode } from '@/composables/useTheme';
import type { RecentItem, WorkItemOptions } from '@/types/work-item';
import { upsertRecentItems } from '@/utils/recent-history';
import type { WorkHoursSetting } from '@/utils/work-hours';

interface DoGetOptionsResponse {
  options: WorkItemOptions;
  /** 近期紀錄（推薦與預填用）；舊版後端沒有這個欄位，沒有就當作沒有推薦、不預填 */
  recentItems?: RecentItem[];
  /** 工時設定，沒設定時是 null；舊版後端沒有這個欄位，當作沒設定（表單不顯示工作時段） */
  workHours?: WorkHoursSetting | null;
  /** 擁有者的樣式設定（跨裝置同步），沒設定時是 null；舊版後端沒有這個欄位，當作沒設定 */
  themeMode?: ThemeMode | null;
  error?: string;
}

interface DoPostOptionsResponse extends DoPostResponse {
  options?: WorkItemOptions;
}

interface DoPostThemeModeResponse extends DoPostResponse {
  themeMode?: ThemeMode | null;
}

interface DoPostWorkHoursResponse extends DoPostResponse {
  workHours?: WorkHoursSetting | null;
}

const options = ref<WorkItemOptions | null>(null);
/** 近期紀錄（表單下拉推薦、填完工作目標後預填用），日期轉成前端內部的 YYYY-MM-DD */
const recentItems = ref<RecentItem[]>([]);
/** 工時設定（表單的工作時段換算用），沒設定時是 null */
const workHours = ref<WorkHoursSetting | null>(null);
/** 擁有者存在 Sheet 的樣式設定（跨裝置同步，使用者決定），沒設定時是 null */
const themeMode = ref<ThemeMode | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let fetchPromise: Promise<void> | null = null;

// API 的日期是 YYYY/MM/DD，前端內部一律 YYYY-MM-DD（轉換用 useWorkItems.ts 的 fromApiDate）
const toIsoRecentItems = (items: RecentItem[] | undefined): RecentItem[] =>
  (items ?? []).map((item) => ({
    ...item,
    工作日期: fromApiDate(item.工作日期),
    預計期限: fromApiDate(item.預計期限),
  }));

/**
 * 存檔成功後用剛存的紀錄更新本地近期紀錄，不用重新讀選項清單：
 * 編輯帶 id（取代原本那筆），新增、複製本日沒有 id（直接加入）
 */
const rememberItems = (saved: RecentItem[]): void => {
  recentItems.value = upsertRecentItems(recentItems.value, saved);
};

const fetchOptions = async (): Promise<void> => {
  if (options.value) return;
  if (fetchPromise) return fetchPromise;

  loading.value = true;
  error.value = null;
  fetchPromise = (async () => {
    try {
      const data = await getApi<DoGetOptionsResponse>({ type: 'options' });
      options.value = data.options;
      recentItems.value = toIsoRecentItems(data.recentItems);
      workHours.value = data.workHours ?? null;
      themeMode.value = data.themeMode ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '讀取選項清單時發生未知錯誤';
    } finally {
      loading.value = false;
      fetchPromise = null;
    }
  })();

  return fetchPromise;
};

/**
 * 新增/重新命名/刪除都是打同一支 doPost，回應帶回最新的完整 options，
 * 直接覆寫本地快取，不用再額外 fetchOptions() 一次。
 */
const postOptionAction = async (idToken: string, payload: object): Promise<WorkItemOptions> => {
  // 失敗時 postApi 丟帶 code 的 ApiError，呼叫端才分得出登入錯誤
  const data = await postApi<DoPostOptionsResponse>(idToken, payload);
  if (!data.options) throw new ApiError('選項清單更新失敗');
  return data.options;
};

const addOption = async (
  idToken: string,
  category: keyof WorkItemOptions,
  value: string,
): Promise<void> => {
  options.value = await postOptionAction(idToken, { action: 'addOption', category, value });
};

const renameOption = async (
  idToken: string,
  category: keyof WorkItemOptions,
  oldValue: string,
  newValue: string,
): Promise<void> => {
  options.value = await postOptionAction(idToken, {
    action: 'renameOption',
    category,
    oldValue,
    newValue,
  });
};

const deleteOption = async (
  idToken: string,
  category: keyof WorkItemOptions,
  value: string,
): Promise<void> => {
  options.value = await postOptionAction(idToken, { action: 'deleteOption', category, value });
};

/**
 * 儲存工時設定（setting 為 null 代表清除），回應帶回最新的工時設定，直接覆寫本地快取。
 * 失敗丟帶 code 的 ApiError，呼叫端才分得出登入錯誤
 */
const saveWorkHours = async (idToken: string, setting: WorkHoursSetting | null): Promise<void> => {
  const data = await postApi<DoPostWorkHoursResponse>(idToken, {
    action: 'saveWorkHours',
    workHours: setting,
  });
  workHours.value = data.workHours ?? null;
};

/**
 * 儲存樣式設定（只有擁有者能寫），回應帶回存好的值。失敗丟帶 code 的 ApiError，呼叫端才分得出登入錯誤
 */
const saveThemeMode = async (idToken: string, mode: ThemeMode): Promise<void> => {
  const data = await postApi<DoPostThemeModeResponse>(idToken, {
    action: 'saveThemeMode',
    themeMode: mode,
  });
  themeMode.value = data.themeMode ?? null;
};

export function useOptions() {
  return {
    options,
    recentItems,
    workHours,
    themeMode,
    loading,
    error,
    fetchOptions,
    rememberItems,
    addOption,
    renameOption,
    deleteOption,
    saveWorkHours,
    saveThemeMode,
  };
}
