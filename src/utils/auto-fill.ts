/**
 * 自動填入（本日總結 → 別人的試算表，規則見 docs/auto-fill.md）的設定與驗證。
 * 設定存在後端（選項清單分頁的「自動填入設定」欄），驗證規則與訊息跟 AutoFill.gs 的 validateAutoFill_ 手動同步
 */
export interface AutoFillSetting {
  /** 啟用：停用時網址、姓名保留原本的值，觸發器不寫入、「填入」按鈕 disabled */
  enabled: boolean;
  /** 對方試算表的網址 */
  url: string;
  /** 自己在對方試算表上的姓名（用來找自己那一列） */
  name: string;
}

/** 姓名字數上限（AutoFill.gs 的 AUTO_FILL_NAME_MAX） */
export const AUTO_FILL_NAME_MAX = 20;

/** 「填入」一次最多幾個字（AutoFill.gs 的 AUTO_FILL_TEXT_MAX） */
export const AUTO_FILL_TEXT_MAX = 5000;

/** Google 試算表網址（AutoFill.gs 的 AUTO_FILL_URL_PATTERN） */
export const AUTO_FILL_URL_PATTERN =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#]|$)/;

/**
 * 回傳第一個錯誤訊息，沒有錯誤回 null。啟用時網址、姓名必填；停用時可以留空，有填照樣檢查格式
 */
export const validateAutoFillSetting = (setting: AutoFillSetting): string | null => {
  const url = setting.url.trim();
  const name = setting.name.trim();
  if (setting.enabled && !url) return '請填寫試算表網址';
  if (url && !AUTO_FILL_URL_PATTERN.test(url)) {
    return '試算表網址格式不正確，請貼上 Google 試算表的網址';
  }
  if (setting.enabled && !name) return '請填寫姓名';
  if (name.length > AUTO_FILL_NAME_MAX) return `姓名不可超過 ${AUTO_FILL_NAME_MAX} 個字`;
  return null;
};

/** 兩份設定是否相同（網址、姓名去頭尾空白後比對），用來判斷有沒有未儲存的修改 */
export const isSameAutoFillSetting = (a: AutoFillSetting, b: AutoFillSetting): boolean =>
  a.enabled === b.enabled && a.url.trim() === b.url.trim() && a.name.trim() === b.name.trim();
