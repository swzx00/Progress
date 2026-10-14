import { ref } from 'vue';

import type { WorkItem } from '@/types/work-item';
import type { SearchQuery } from '@/utils/search-work-items';

interface DoGetResponse {
  items: WorkItem[];
  /** 搜尋（type=search）才有：全部符合的筆數（items 最多只回傳 SEARCH_MAX_RESULTS 筆） */
  total?: number;
  error?: string;
}

export interface DoPostResponse {
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
export const toApiDate = (date: string): string => date.replaceAll('-', '/');
export const fromApiDate = (date: string): string => date.replaceAll('/', '-');

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
 * 打 doPost，回傳整個回應內容（useOptions.ts 也用這支，選項清單、工時設定的回應會帶回最新資料）。
 * Apps Script 網頁應用程式的回應一律是 HTTP 200（平台限制，沒辦法自訂 status code），
 * 所以不能靠 res.ok 判斷成功/失敗，錯誤訊息一律看回應內容裡的 error 欄位。
 */
export const postApi = async <T extends DoPostResponse>(
  idToken: string,
  payload: object,
): Promise<T> => {
  const res = await fetch(API_BASE_URL, {
    method: 'POST',
    // 刻意用 text/plain：application/json 會讓瀏覽器跨網域時先送 OPTIONS 預檢，
    // Apps Script 不回應預檢，正式站（github.io）的寫入會全部被 CORS 擋下。
    // 後端 doPost 用 JSON.parse(e.postData.contents)，不看 Content-Type。
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ idToken, ...payload }),
  });
  const data = (await res.json()) as T;
  if (data.error) {
    throw new ApiError(data.error, data.code);
  }
  return data;
};

const postAction = async (idToken: string, payload: object): Promise<void> => {
  await postApi(idToken, payload);
};

/**
 * 打 doGet，回傳整個回應內容（useOptions.ts 讀選項清單也用這支）。
 * 跟 postApi 一樣看回應的 error 欄位判斷失敗，失敗直接丟錯，由呼叫端決定怎麼處理
 */
export const getApi = async <T extends { error?: string }>(
  params: Record<string, string>,
): Promise<T> => {
  const url = new URL(API_BASE_URL, window.location.origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const res = await fetch(url.toString());
  const data = (await res.json()) as T;
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
};

/** 讀取未刪除的紀錄，日期轉回 ISO */
const requestGet = async (params: Record<string, string>): Promise<DoGetResponse> => {
  const data = await getApi<DoGetResponse>(params);
  return {
    ...data,
    items: data.items
      .filter((item) => !item.已刪除)
      .map((item) => ({
        ...item,
        工作日期: fromApiDate(item.工作日期),
        預計期限: fromApiDate(item.預計期限),
      })),
  };
};

const requestItems = async (params: Record<string, string>): Promise<WorkItem[]> =>
  (await requestGet(params)).items;

/** 讀取某一天未刪除的紀錄 */
const requestItemsByDate = (date: string): Promise<WorkItem[]> =>
  requestItems({ date: toApiDate(date) });

/**
 * 讀取 from～to（YYYY-MM-DD，含頭尾）未刪除的紀錄（含請假），「匯出 Excel」用，
 * 不會動到 useWorkItems() 的 items 狀態。後端限制跨度最多 366 天，超過會回錯誤
 */
export const fetchByRange = (from: string, to: string): Promise<WorkItem[]> =>
  requestItems({ type: 'range', from: toApiDate(from), to: toApiDate(to) });

export interface SearchResult {
  /** 符合的紀錄（工作日期新的在前、同一天照項次），最多 SEARCH_MAX_RESULTS 筆 */
  items: WorkItem[];
  /** 全部符合的筆數，大於 items.length 代表結果被截掉了 */
  total: number;
}

/**
 * 搜尋欄：到後端查全部資料（doGet type=search，比對規則見 utils/search-work-items.ts），
 * 不會動到 useWorkItems() 的 items 狀態。field 有值時只搜那個欄位（點推薦）
 */
export const searchItems = async (query: SearchQuery): Promise<SearchResult> => {
  const data = await requestGet({
    type: 'search',
    q: query.keyword.trim(),
    ...(query.field && { field: query.field }),
  });
  return { items: data.items, total: data.total ?? data.items.length };
};

export interface DaySummary {
  /** 預計項次 */
  nextIndex: number;
  /** 當天其他紀錄（排除 excludeId）的今日工時合計 */
  otherHours: number;
  /** 當天未刪除的紀錄筆數（「複製本日」判斷目標日是否已有紀錄） */
  itemCount: number;
  /** 當天未刪除的紀錄（含請假）的 id、項次、今日工時，表單依項次推算工作時段用 */
  entries: Pick<WorkItem, 'id' | '項次' | '今日工時'>[];
}

/**
 * 表單用的當天摘要，一次查詢算出兩個值（不會動到 useWorkItems() 的 items 狀態）：
 * - 預計項次：當天未刪除紀錄的最大項次 + 1，跟 Code.gs 的 getNextDailyIndex_ 同一套規則。
 *   只是給表單顯示的參考值，實際項次由後端寫入當下決定
 * - 其他紀錄工時合計：排除 excludeId（編輯時是自己），跟 Code.gs 的 getDayHoursExcluding_
 *   同一套規則，給表單檢查每日工時上限
 * 改其中一邊要一起改。另外附上當天各紀錄的項次與工時（entries），表單依項次推算工作時段用。
 */
export const fetchDaySummary = async (date: string, excludeId?: string): Promise<DaySummary> => {
  const dayItems = await requestItemsByDate(date);
  return {
    nextIndex: Math.max(0, ...dayItems.map((item) => item.項次)) + 1,
    otherHours: dayItems
      .filter((item) => item.id !== excludeId)
      .reduce((sum, item) => sum + (Number(item.今日工時) || 0), 0),
    itemCount: dayItems.length,
    entries: dayItems.map(({ id, 項次, 今日工時 }) => ({ id, 項次, 今日工時 })),
  };
};

/**
 * 讀過的單日／月份資料快取（模組層級、只放記憶體，重新整理就清掉；使用者決定，2026-10-14：讀一次要 2～3 秒）。
 * 切回看過的日期先顯示快取、背景再讀一次，有變動才更新畫面；HomeView 另外預先讀前後一天／前後一個工作日／前後一個月。
 * 任何寫入（新增、編輯、刪除、複製本日、調整順序）都清空整份快取，避免顯示寫入前的資料。
 * 只用在畫面顯示：表單的 fetchDaySummary（工時上限、預計項次）、搜尋、匯出一律直接讀後端，不吃快取
 */
const ITEMS_CACHE_MAX = 60;
const itemsCache = new Map<string, WorkItem[]>();
const inflight = new Map<string, Promise<WorkItem[]>>();
/** 每次清空快取就加一：清空前發出、清空後才回來的請求不能寫回快取（那是寫入前的資料） */
let cacheGeneration = 0;

const dateCacheKey = (date: string): string => `date:${date}`;
const rangeCacheKey = (from: string, to: string): string => `range:${from}:${to}`;

/** 存進快取（超過上限丟掉最舊的一筆；Map 依加入順序，重新存的移到最後） */
const rememberItems = (key: string, value: WorkItem[]): void => {
  itemsCache.delete(key);
  itemsCache.set(key, value);
  if (itemsCache.size > ITEMS_CACHE_MAX) itemsCache.delete(itemsCache.keys().next().value!);
};

/** 讀後端並更新快取；同一個 key 還在讀就共用同一個請求（預先讀取跟正式讀取不會重複打 API） */
const requestCached = (key: string, request: () => Promise<WorkItem[]>): Promise<WorkItem[]> => {
  const pending = inflight.get(key);
  if (pending) return pending;
  const generation = cacheGeneration;
  const promise = request()
    .then((result) => {
      if (generation === cacheGeneration) rememberItems(key, result);
      return result;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
};

/** 清空快取（寫入後呼叫） */
export const clearItemsCache = (): void => {
  cacheGeneration += 1;
  itemsCache.clear();
  inflight.clear();
};

/** 背景預先讀某一天（已經有快取或正在讀就略過，失敗不處理：真的切過去時會再讀一次） */
export const prefetchByDate = (date: string): void => {
  const key = dateCacheKey(date);
  if (itemsCache.has(key) || inflight.has(key)) return;
  requestCached(key, () => requestItemsByDate(date)).catch(() => undefined);
};

/** 背景預先讀 from～to（月份檢視的前後一個月） */
export const prefetchRange = (from: string, to: string): void => {
  const key = rangeCacheKey(from, to);
  if (itemsCache.has(key) || inflight.has(key)) return;
  requestCached(key, () => fetchByRange(from, to)).catch(() => undefined);
};

/** 寫入：不論成功失敗都清空快取（失敗時不確定後端寫了多少，保守起見） */
const postWrite = async (idToken: string, payload: object): Promise<void> => {
  try {
    await postAction(idToken, payload);
  } finally {
    clearItemsCache();
  }
};

export function useWorkItems() {
  const items = ref<WorkItem[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** 連續切換日期（或日／月檢視）時只採用最後一次的結果，避免晚回來的舊資料蓋掉目前的畫面 */
  let latestFetch = 0;

  /**
   * 有快取：先顯示快取（不顯示載入中），背景再讀一次，內容不同才更新；背景讀取失敗就維持快取的內容。
   * 沒有快取：照原本顯示載入中、讀完顯示，失敗顯示錯誤
   */
  const load = async (key: string, request: () => Promise<WorkItem[]>): Promise<void> => {
    const seq = ++latestFetch;
    const cached = itemsCache.get(key);
    error.value = null;
    if (cached) {
      items.value = cached;
      loading.value = false;
    } else {
      loading.value = true;
    }
    try {
      const result = await requestCached(key, request);
      if (seq !== latestFetch) return;
      if (!cached || JSON.stringify(result) !== JSON.stringify(cached)) items.value = result;
    } catch (e) {
      if (seq !== latestFetch || cached) return;
      error.value = e instanceof Error ? e.message : '讀取資料時發生未知錯誤';
      items.value = [];
    } finally {
      if (seq === latestFetch) loading.value = false;
    }
  };

  const fetchByDate = (date: string): Promise<void> =>
    load(dateCacheKey(date), () => requestItemsByDate(date));

  /** 月份檢視：讀 from～to（YYYY-MM-DD，含頭尾）的紀錄放進 items，跟 fetchByDate 共用「只採用最後一次」 */
  const fetchRange = (from: string, to: string): Promise<void> =>
    load(rangeCacheKey(from, to), () => fetchByRange(from, to));

  const createItem = (idToken: string, item: CreateInput): Promise<void> =>
    postWrite(idToken, { action: 'create', item: toApiItem(item) });

  /**
   * 一次新增多筆（「複製本日」用）：後端全部驗證通過才寫入，任何一筆不合格或當天工時合計
   * 超過上限就整批退回、不寫入任何一筆。項次由後端依陣列順序照每日編號規則接續。
   * replace 為 true 時（覆蓋目標日）：後端先把目標日原本的紀錄（含請假）搬到『已刪除紀錄』分頁再寫入，工時合計只算這批
   */
  const batchCreateItems = (
    idToken: string,
    items: CreateInput[],
    replace = false,
  ): Promise<void> =>
    postWrite(idToken, { action: 'batchCreate', items: items.map(toApiItem), replace });

  /**
   * 後端用 id 找到那一列；item.工作日期 可以改到別天（含別的月份），後端會在新的那天重新編項次。
   */
  const updateItem = (idToken: string, id: string, item: UpdateInput): Promise<void> =>
    postWrite(idToken, { action: 'update', id, item: toApiItem(item) });

  const deleteItem = (idToken: string, id: string): Promise<void> =>
    postWrite(idToken, { action: 'delete', id });

  /**
   * 調整某一天的項次順序：ids 是那天所有未刪除紀錄（含請假）依新順序排列的 id，
   * 後端依順序把項次改成 1、2、3…；跟 Sheet 上的紀錄對不上時整批退回
   */
  const reorderItems = (idToken: string, date: string, ids: string[]): Promise<void> =>
    postWrite(idToken, { action: 'reorder', date: toApiDate(date), ids });

  return {
    items,
    loading,
    error,
    fetchByDate,
    fetchRange,
    createItem,
    batchCreateItems,
    updateItem,
    deleteItem,
    reorderItems,
  };
}
