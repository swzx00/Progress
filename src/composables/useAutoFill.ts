import { ref } from 'vue';

import { postApi, toApiDate, type DoPostResponse } from '@/composables/useWorkItems';
import type { AutoFillSetting } from '@/utils/auto-fill';

interface DoPostAutoFillResponse extends DoPostResponse {
  autoFill?: AutoFillSetting;
}

interface DoPostAutoFillNowResponse extends DoPostResponse {
  status?: AutoFillNowStatus;
}

/** 「填入」的結果：written 已寫入、unchanged 對方的格子已經是一樣的內容 */
export type AutoFillNowStatus = 'written' | 'unchanged';

/**
 * 後端存的自動填入設定（模組層級快取，重開本日總結不用再讀一次），還沒讀過是 null。
 * 網址是別人的試算表，後端只在登入後用 doPost 回傳（不放進公開的 doGet），所以每個呼叫都要帶 idToken；
 * 失敗丟帶 code 的 ApiError，呼叫端才分得出登入錯誤
 */
const setting = ref<AutoFillSetting | null>(null);

const fetchAutoFillSetting = async (idToken: string): Promise<void> => {
  const data = await postApi<DoPostAutoFillResponse>(idToken, { action: 'getAutoFillSetting' });
  setting.value = data.autoFill ?? null;
};

/** 儲存設定，回應帶回存好的值，直接覆寫快取 */
const saveAutoFillSetting = async (idToken: string, value: AutoFillSetting): Promise<void> => {
  const data = await postApi<DoPostAutoFillResponse>(idToken, {
    action: 'saveAutoFillSetting',
    autoFill: { enabled: value.enabled, url: value.url.trim(), name: value.name.trim() },
  });
  setting.value = data.autoFill ?? null;
};

/** 把 text 填進對方試算表 date（YYYY-MM-DD）那天的格子；格子已經有不同的內容時後端不覆蓋、回錯誤 */
const fillAutoFill = async (
  idToken: string,
  date: string,
  text: string,
): Promise<AutoFillNowStatus> => {
  const data = await postApi<DoPostAutoFillNowResponse>(idToken, {
    action: 'autoFillNow',
    date: toApiDate(date),
    text,
  });
  return data.status ?? 'written';
};

export function useAutoFill() {
  return { setting, fetchAutoFillSetting, saveAutoFillSetting, fillAutoFill };
}
