import { ref } from 'vue';

import type { WorkItemOptions } from '@/types/work-item';

interface DoGetOptionsResponse {
  options: WorkItemOptions;
  error?: string;
}

interface DoPostOptionsResponse {
  options?: WorkItemOptions;
  error?: string;
}

// 跟 useWorkItems.ts 同一套規則：本機關掉 MSW 時走 dev server proxy 繞開 CORS，
// 而且 Apps Script 回應一律 HTTP 200，成功/失敗要看回應內容的 error 欄位，不能看 res.ok。
const shouldUseDevProxy = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === 'false';
const API_BASE_URL = shouldUseDevProxy
  ? '/apps-script-proxy'
  : import.meta.env.VITE_APPS_SCRIPT_URL;

const options = ref<WorkItemOptions | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
let fetchPromise: Promise<void> | null = null;

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
    throw new Error(data.error ?? '選項清單更新失敗');
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
  return { options, loading, error, fetchOptions, addOption, renameOption, deleteOption };
}
