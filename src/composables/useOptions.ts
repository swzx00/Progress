import { ref } from 'vue';

import { ApiError, type ApiErrorCode } from '@/composables/useWorkItems';
import type { RecentPair, RecentPairs, WorkItem, WorkItemOptions } from '@/types/work-item';
import { applyRecentPair, emptyRecentPairs } from '@/utils/recent-pairing';

interface DoGetOptionsResponse {
  options: WorkItemOptions;
  /** 舊版後端沒有這個欄位，沒有就當作沒有推薦 */
  recentPairs?: RecentPairs;
  error?: string;
}

interface DoPostOptionsResponse {
  options?: WorkItemOptions;
  error?: string;
  code?: ApiErrorCode;
}

// 跟 useWorkItems.ts 同一套規則：本機關掉 MSW 時走 dev server proxy 繞開 CORS，
// 而且 Apps Script 回應一律 HTTP 200，成功/失敗要看回應內容的 error 欄位，不能看 res.ok。
const shouldUseDevProxy = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === 'false';
const API_BASE_URL = shouldUseDevProxy
  ? '/apps-script-proxy'
  : import.meta.env.VITE_APPS_SCRIPT_URL;

const options = ref<WorkItemOptions | null>(null);
/** 交辦單位 ↔ 交辦人員的最近搭配（下拉選單推薦用），日期轉成前端內部的 YYYY-MM-DD */
const recentPairs = ref<RecentPairs>(emptyRecentPairs());
const loading = ref(false);
const error = ref<string | null>(null);
let fetchPromise: Promise<void> | null = null;

// API 的日期是 YYYY/MM/DD，前端內部一律 YYYY-MM-DD（跟 useWorkItems.ts 的 fromApiDate 相同）
const toIsoRecentPairs = (pairs: RecentPairs | undefined): RecentPairs => {
  if (!pairs) return emptyRecentPairs();
  const convert = (map: Record<string, RecentPair>): Record<string, RecentPair> =>
    Object.fromEntries(
      Object.entries(map).map(([key, pair]) => [
        key,
        { ...pair, date: pair.date.replaceAll('/', '-') },
      ]),
    );
  return { 交辦單位: convert(pairs.交辦單位), 交辦人員: convert(pairs.交辦人員) };
};

/** 存檔成功後用剛存的紀錄更新本地推薦（比現有的新才覆蓋），不用重新讀選項清單 */
const rememberPairs = (
  items: Pick<WorkItem, '工作日期' | '交辦單位' | '交辦人員' | '狀態'>[],
): void => {
  recentPairs.value = items.reduce(applyRecentPair, recentPairs.value);
};

const fetchOptions = async (): Promise<void> => {
  if (options.value) return;
  if (fetchPromise) return fetchPromise;

  loading.value = true;
  error.value = null;
  fetchPromise = (async () => {
    try {
      const url = new URL(API_BASE_URL, window.location.origin);
      url.searchParams.set('type', 'options');
      const res = await fetch(url.toString());
      const data = (await res.json()) as DoGetOptionsResponse;
      if (data.error) {
        throw new Error(data.error);
      }
      options.value = data.options;
      recentPairs.value = toIsoRecentPairs(data.recentPairs);
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
  const res = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, ...payload }),
  });
  const data = (await res.json()) as DoPostOptionsResponse;
  if (data.error || !data.options) {
    // 跟 useWorkItems.ts 的 postAction 一樣丟帶 code 的 ApiError，呼叫端才分得出登入錯誤
    throw new ApiError(data.error ?? '選項清單更新失敗', data.code);
  }
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

export function useOptions() {
  return {
    options,
    recentPairs,
    loading,
    error,
    fetchOptions,
    rememberPairs,
    addOption,
    renameOption,
    deleteOption,
  };
}
