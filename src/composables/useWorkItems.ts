import { ref } from 'vue';

import type { WorkItem } from '@/types/work-item';

interface DoGetResponse {
  items: WorkItem[];
  error?: string;
}

interface DoPostResponse {
  error?: string;
  code?: ApiErrorCode;
}

/** 後端錯誤代碼，目前只有登入驗證失敗會帶，其他錯誤沒有 code */
export type ApiErrorCode = 'UNAUTHORIZED';

/** 帶後端錯誤代碼的錯誤，呼叫端用 code 判斷錯誤類型，不要比對 message 文字 */
export class ApiError extends Error {
  readonly code?: ApiErrorCode;

  constructor(message: string, code?: ApiErrorCode) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

type CreateInput = Omit<WorkItem, 'id' | '項次' | '已刪除'>;
type UpdateInput = Partial<Omit<WorkItem, 'id'>>;

/**
 * 前端內部（表單、DateNav、逾期比對）一律用 ISO 的 YYYY-MM-DD，因為
 * <input type="date"> 規格就是吃這個格式；Apps Script／Google Sheet 那端存的
 * 是 YYYY/MM/DD。轉換集中在這裡，其他地方不用知道 API 實際傳輸格式是什麼。
 */
const toApiDate = (date: string): string => date.replaceAll('-', '/');
const fromApiDate = (date: string): string => date.replaceAll('/', '-');

const toApiItem = <T extends Partial<Pick<WorkItem, '工作日期' | '預計期限'>>>(item: T): T => ({
  ...item,
  ...(item.工作日期 !== undefined && { 工作日期: toApiDate(item.工作日期) }),
  ...(item.預計期限 !== undefined && { 預計期限: toApiDate(item.預計期限) }),
});

/**
 * 本機開發、且關掉 MSW（VITE_ENABLE_MSW=false）時，改打 /apps-script-proxy，
 * 由 vite.config.ts 的 dev server proxy 轉發，繞開 Apps Script 對 localhost 來源的
 * CORS 限制（見 CLAUDE.md）。MSW 開著時維持原本網址，讓 MSW 的「結尾 exec」攔截規則正常比對。
 */
const shouldUseDevProxy = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === 'false';
const API_BASE_URL = shouldUseDevProxy
  ? '/apps-script-proxy'
  : import.meta.env.VITE_APPS_SCRIPT_URL;

/**
 * Apps Script 網頁應用程式的回應一律是 HTTP 200（平台限制，沒辦法自訂 status code），
 * 所以不能靠 res.ok 判斷成功/失敗，錯誤訊息一律看回應內容裡的 error 欄位。
 */
const postAction = async (idToken: string, payload: object): Promise<void> => {
  const res = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, ...payload }),
  });
  const data = (await res.json()) as DoPostResponse;
  if (data.error) {
    throw new ApiError(data.error, data.code);
  }
};

/** 讀取某一天未刪除的紀錄，日期轉回 ISO；失敗直接丟錯，由呼叫端決定怎麼處理 */
const requestItemsByDate = async (date: string): Promise<WorkItem[]> => {
  const url = new URL(API_BASE_URL, window.location.origin);
  url.searchParams.set('date', toApiDate(date));
  const res = await fetch(url.toString());
  const data = (await res.json()) as DoGetResponse;
  if (data.error) {
    throw new Error(data.error);
  }
  return data.items
    .filter((item) => !item.已刪除)
    .map((item) => ({
      ...item,
      工作日期: fromApiDate(item.工作日期),
      預計期限: fromApiDate(item.預計期限),
    }));
};

export interface DaySummary {
  /** 預計項次 */
  nextIndex: number;
  /** 當天其他紀錄（排除 excludeId）的今日工時合計 */
  otherHours: number;
  /** 當天未刪除的紀錄筆數（「複製本日」判斷目標日是否已有紀錄） */
  itemCount: number;
}

/**
 * 表單用的當天摘要，一次查詢算出兩個值（不會動到 useWorkItems() 的 items 狀態）：
 * - 預計項次：當天未刪除紀錄的最大項次 + 1，跟 Code.gs 的 getNextDailyIndex_ 同一套規則。
 *   只是給表單顯示的參考值，實際項次由後端寫入當下決定
 * - 其他紀錄工時合計：排除 excludeId（編輯時是自己），跟 Code.gs 的 getDayHoursExcluding_
 *   同一套規則，給表單檢查每日工時上限
 * 改其中一邊要一起改。
 */
export const fetchDaySummary = async (date: string, excludeId?: string): Promise<DaySummary> => {
  const dayItems = await requestItemsByDate(date);
  return {
    nextIndex: Math.max(0, ...dayItems.map((item) => item.項次)) + 1,
    otherHours: dayItems
      .filter((item) => item.id !== excludeId)
      .reduce((sum, item) => sum + (Number(item.今日工時) || 0), 0),
    itemCount: dayItems.length,
  };
};

export function useWorkItems() {
  const items = ref<WorkItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const fetchByDate = async (date: string): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      items.value = await requestItemsByDate(date);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '讀取資料時發生未知錯誤';
      items.value = [];
    } finally {
      loading.value = false;
    }
  };

  const createItem = (idToken: string, item: CreateInput): Promise<void> =>
    postAction(idToken, { action: 'create', item: toApiItem(item) });

  /**
   * 一次新增多筆（「複製本日」用）：後端全部驗證通過才寫入，任何一筆不合格或當天工時合計
   * 超過上限就整批退回、不寫入任何一筆。項次由後端依陣列順序照每日編號規則接續。
   * replace 為 true 時（覆蓋目標日）：後端先軟刪除目標日原本的紀錄（含請假）再寫入，工時合計只算這批
   */
  const batchCreateItems = (
    idToken: string,
    items: CreateInput[],
    replace = false,
  ): Promise<void> =>
    postAction(idToken, { action: 'batchCreate', items: items.map(toApiItem), replace });

  /**
   * originalDate：這筆紀錄「修改前」的工作日期，用來換算它原本在哪個月份分頁，
   * 後端才找得到列。item.工作日期 可能跟 originalDate 不同（使用者把工作日期改到別的月份），
   * 這種情況後端會從舊分頁刪除、在新分頁新增。
   */
  const updateItem = (
    idToken: string,
    id: string,
    originalDate: string,
    item: UpdateInput,
  ): Promise<void> =>
    postAction(idToken, {
      action: 'update',
      id,
      originalDate: toApiDate(originalDate),
      item: toApiItem(item),
    });

  const deleteItem = (idToken: string, id: string, originalDate: string): Promise<void> =>
    postAction(idToken, { action: 'delete', id, originalDate: toApiDate(originalDate) });

  /**
   * 調整某一天的項次順序：ids 是那天所有未刪除紀錄（含請假）依新順序排列的 id，
   * 後端依順序把項次改成 1、2、3…；跟 Sheet 上的紀錄對不上時整批退回
   */
  const reorderItems = (idToken: string, date: string, ids: string[]): Promise<void> =>
    postAction(idToken, { action: 'reorder', date: toApiDate(date), ids });

  return {
    items,
    loading,
    error,
    fetchByDate,
    createItem,
    batchCreateItems,
    updateItem,
    deleteItem,
    reorderItems,
  };
}
