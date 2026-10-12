// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeItem } from '@/testing/fixtures';
import type { WorkItem } from '@/types/work-item';

/**
 * API 邊界：日期格式只在這裡轉換（前端 YYYY-MM-DD ↔ API YYYY/MM/DD），
 * 回應一律 HTTP 200，成功／失敗只看 error，登入錯誤要丟帶 code 的 ApiError。
 * fetch 換成假的，不打真的 API；API 網址在模組載入時決定，所以每個測試重新載入模組
 */
const API_URL = 'https://script.example.test/exec';

const fetchMock = vi.fn();

/** 讓 fetch 回傳指定的 JSON（HTTP 一律 200，跟 Apps Script 一樣） */
const respond = (body: unknown): void => {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
};

/** 第 n 次 fetch 送出的 POST body */
const postBody = (n = 0): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[n]![1] as RequestInit).body as string);

/** 第 n 次 fetch 的 GET 查詢參數 */
const getParams = (n = 0): Record<string, string> =>
  Object.fromEntries(new URL(fetchMock.mock.calls[n]![0] as string).searchParams);

/** API 傳回來的紀錄（日期是 YYYY/MM/DD） */
const apiItem = (overrides: Partial<WorkItem> = {}): WorkItem =>
  makeItem({ 工作日期: '2026/10/09', 預計期限: '', ...overrides });

/** 新增用的資料（不含 id、項次、已刪除，這三個由後端決定） */
type CreateInput = Omit<WorkItem, 'id' | '項次' | '已刪除'>;
const makeInput = (overrides: Partial<WorkItem> = {}): CreateInput => {
  const item: Partial<WorkItem> = makeItem(overrides);
  delete item.id;
  delete item.項次;
  delete item.已刪除;
  return item as CreateInput;
};

const load = () => import('@/composables/useWorkItems');

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_APPS_SCRIPT_URL', API_URL);
  vi.stubEnv('VITE_ENABLE_MSW', '');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('寫入：日期轉成 API 格式', () => {
  it('create 把工作日期、預計期限轉成 YYYY/MM/DD，其他欄位不動，帶上 idToken', async () => {
    const { useWorkItems } = await load();
    respond({});
    const input = makeInput({
      工作日期: '2026-10-09',
      預計期限: '2026-10-31',
      處理內容: '2026-10-01 討論',
    });
    await useWorkItems().createItem('token', input);

    expect(fetchMock.mock.calls[0]![0]).toBe(API_URL);
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    expect(postBody()).toEqual({
      idToken: 'token',
      action: 'create',
      item: { ...input, 工作日期: '2026/10/09', 預計期限: '2026/10/31' },
    });
  });

  it('預計期限空白維持空白', async () => {
    const { useWorkItems } = await load();
    respond({});
    const input = makeInput({ 預計期限: '' });
    await useWorkItems().createItem('token', input);
    expect((postBody().item as WorkItem).預計期限).toBe('');
  });

  it('update 只送有改的欄位，沒帶日期就不會多出日期欄位', async () => {
    const { useWorkItems } = await load();
    respond({});
    await useWorkItems().updateItem('token', 'id-9', { 處理內容: '修正' });
    expect(postBody()).toEqual({
      idToken: 'token',
      action: 'update',
      id: 'id-9',
      item: { 處理內容: '修正' },
    });
  });

  it('update 改到別天時日期一樣轉換', async () => {
    const { useWorkItems } = await load();
    respond({});
    await useWorkItems().updateItem('token', 'id-9', { 工作日期: '2026-11-02' });
    expect(postBody().item).toEqual({ 工作日期: '2026/11/02' });
  });

  it('batchCreate 每一筆都轉換日期，並帶上 replace', async () => {
    const { useWorkItems } = await load();
    respond({});
    const first = makeInput({ 工作日期: '2026-10-12' });
    const second = makeInput({
      工作日期: '2026-10-12',
      預計期限: '2026-10-20',
    });
    await useWorkItems().batchCreateItems('token', [first, second], true);

    const body = postBody();
    expect(body.action).toBe('batchCreate');
    expect(body.replace).toBe(true);
    expect((body.items as WorkItem[]).map((item) => [item.工作日期, item.預計期限])).toEqual([
      ['2026/10/12', ''],
      ['2026/10/12', '2026/10/20'],
    ]);
  });

  it('batchCreate 預設 replace 是 false', async () => {
    const { useWorkItems } = await load();
    respond({});
    await useWorkItems().batchCreateItems('token', []);
    expect(postBody().replace).toBe(false);
  });

  it('reorder 的日期轉成 API 格式，ids 照順序送出', async () => {
    const { useWorkItems } = await load();
    respond({});
    await useWorkItems().reorderItems('token', '2026-10-09', ['b', 'a', 'c']);
    expect(postBody()).toEqual({
      idToken: 'token',
      action: 'reorder',
      date: '2026/10/09',
      ids: ['b', 'a', 'c'],
    });
  });

  it('delete 只送 id', async () => {
    const { useWorkItems } = await load();
    respond({});
    await useWorkItems().deleteItem('token', 'id-3');
    expect(postBody()).toEqual({ idToken: 'token', action: 'delete', id: 'id-3' });
  });
});

describe('寫入：成功／失敗只看回應的 error', () => {
  it('回應有 error 就丟 ApiError，訊息是 error 的內容', async () => {
    const { useWorkItems, ApiError } = await load();
    respond({ error: '找不到這筆紀錄' });
    const promise = useWorkItems().deleteItem('token', 'id-3');
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ message: '找不到這筆紀錄', code: undefined });
  });

  it('登入錯誤帶 code UNAUTHORIZED', async () => {
    const { useWorkItems } = await load();
    respond({ error: '登入已過期', code: 'UNAUTHORIZED' });
    await expect(useWorkItems().deleteItem('token', 'id-3')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('沒有 error 就是成功（不看 res.ok）', async () => {
    const { useWorkItems } = await load();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(useWorkItems().deleteItem('token', 'id-3')).resolves.toBeUndefined();
  });

  it('網路錯誤照樣往外丟', async () => {
    const { useWorkItems } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(useWorkItems().deleteItem('token', 'id-3')).rejects.toThrow('Failed to fetch');
  });

  it('POST 用 text/plain，不觸發跨網域預檢（Apps Script 不回應 OPTIONS）', async () => {
    const { useWorkItems } = await load();
    respond({});
    await useWorkItems().deleteItem('token', 'id-3');

    const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);
    // 簡單請求只允許 Content-Type 這個 header，值也只能是 text/plain 等三種
    expect([...headers.keys()].map((key) => key.toLowerCase())).toEqual(['content-type']);
    expect(headers.get('content-type')).toMatch(/^text\/plain(;|$)/);
  });
});

describe('讀取單日（fetchByDate）', () => {
  it('查詢參數 date 是 YYYY/MM/DD', async () => {
    const { useWorkItems } = await load();
    respond({ items: [] });
    await useWorkItems().fetchByDate('2026-10-09');
    expect(getParams()).toEqual({ date: '2026/10/09' });
  });

  it('工作日期、預計期限轉回 YYYY-MM-DD，已刪除的濾掉', async () => {
    const { useWorkItems } = await load();
    respond({
      items: [
        apiItem({ id: 'a', 預計期限: '2026/10/31' }),
        apiItem({ id: 'b', 已刪除: true }),
        apiItem({ id: 'c' }),
      ],
    });
    const { items, fetchByDate } = useWorkItems();
    await fetchByDate('2026-10-09');
    expect(items.value.map((item) => [item.id, item.工作日期, item.預計期限])).toEqual([
      ['a', '2026-10-09', '2026-10-31'],
      ['c', '2026-10-09', ''],
    ]);
  });

  it('讀取中 loading 是 true，結束變回 false', async () => {
    const { useWorkItems } = await load();
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { loading, fetchByDate } = useWorkItems();
    const promise = fetchByDate('2026-10-09');
    expect(loading.value).toBe(true);
    resolve({ ok: true, json: async () => ({ items: [] }) });
    await promise;
    expect(loading.value).toBe(false);
  });

  it('失敗時 error 是訊息、items 清空，不往外丟', async () => {
    const { useWorkItems } = await load();
    respond({ items: [apiItem()] });
    const { items, error, fetchByDate } = useWorkItems();
    await fetchByDate('2026-10-09');
    expect(items.value).toHaveLength(1);

    respond({ error: '缺少 date 參數' });
    await expect(fetchByDate('2026-10-10')).resolves.toBeUndefined();
    expect(error.value).toBe('缺少 date 參數');
    expect(items.value).toEqual([]);
  });

  it('連續切換日期：先送出的比較晚回來，不會蓋掉後面那天的結果', async () => {
    const { useWorkItems } = await load();
    let resolveFirst!: (value: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    respond({ items: [apiItem({ id: 'later', 工作日期: '2026/10/10' })] });
    const { items, loading, fetchByDate } = useWorkItems();
    const first = fetchByDate('2026-10-09');
    await fetchByDate('2026-10-10');
    expect(loading.value).toBe(false);

    resolveFirst({ ok: true, json: async () => ({ items: [apiItem({ id: 'earlier' })] }) });
    await first;
    expect(items.value.map((item) => item.id)).toEqual(['later']);
    expect(loading.value).toBe(false);
  });

  it('下一次讀取成功會清掉上一次的錯誤', async () => {
    const { useWorkItems } = await load();
    respond({ error: '壞掉了' });
    const { error, fetchByDate } = useWorkItems();
    await fetchByDate('2026-10-09');
    respond({ items: [] });
    await fetchByDate('2026-10-09');
    expect(error.value).toBeNull();
  });
});

describe('讀取範圍與搜尋', () => {
  it('fetchByRange 的 from／to 轉成 API 格式，回應日期轉回來', async () => {
    const { fetchByRange } = await load();
    respond({ items: [apiItem({ 工作日期: '2026/10/01' })] });
    const items = await fetchByRange('2026-10-01', '2026-10-31');
    expect(getParams()).toEqual({ type: 'range', from: '2026/10/01', to: '2026/10/31' });
    expect(items[0]!.工作日期).toBe('2026-10-01');
  });

  it('fetchByRange 失敗丟一般 Error（不是 ApiError）', async () => {
    const { fetchByRange, ApiError } = await load();
    respond({ error: '跨度不可超過 366 天' });
    const promise = fetchByRange('2025-01-01', '2026-12-31');
    await expect(promise).rejects.toThrow('跨度不可超過 366 天');
    await expect(promise).rejects.not.toBeInstanceOf(ApiError);
  });

  it('searchItems 關鍵字去前後空白，沒指定欄位就不帶 field', async () => {
    const { searchItems } = await load();
    respond({ items: [], total: 0 });
    await searchItems({ keyword: '  官網 改版 ' });
    expect(getParams()).toEqual({ type: 'search', q: '官網 改版' });
  });

  it('searchItems 指定欄位時帶 field', async () => {
    const { searchItems } = await load();
    respond({ items: [], total: 0 });
    await searchItems({ keyword: '官網改版', field: '專案名稱' });
    expect(getParams()).toEqual({ type: 'search', q: '官網改版', field: '專案名稱' });
  });

  it('searchItems 回傳 total（超過 200 筆時大於 items 筆數）', async () => {
    const { searchItems } = await load();
    respond({ items: [apiItem()], total: 350 });
    const result = await searchItems({ keyword: '官網' });
    expect(result.total).toBe(350);
    expect(result.items[0]!.工作日期).toBe('2026-10-09');
  });

  it('searchItems 回應沒有 total 時用筆數代替', async () => {
    const { searchItems } = await load();
    respond({ items: [apiItem({ id: 'a' }), apiItem({ id: 'b' })] });
    expect((await searchItems({ keyword: '官網' })).total).toBe(2);
  });
});

describe('fetchDaySummary（表單的預計項次與工時合計）', () => {
  it('當天沒有紀錄：預計項次是 1，合計 0', async () => {
    const { fetchDaySummary } = await load();
    respond({ items: [] });
    expect(await fetchDaySummary('2026-10-09')).toEqual({
      nextIndex: 1,
      otherHours: 0,
      itemCount: 0,
      entries: [],
    });
    expect(getParams()).toEqual({ date: '2026/10/09' });
  });

  it('預計項次是最大項次＋1，中間刪掉一筆也不會撞號', async () => {
    const { fetchDaySummary } = await load();
    respond({ items: [apiItem({ id: 'a', 項次: 1 }), apiItem({ id: 'c', 項次: 3 })] });
    expect((await fetchDaySummary('2026-10-09')).nextIndex).toBe(4);
  });

  it('已刪除的紀錄不佔號、不算工時', async () => {
    const { fetchDaySummary } = await load();
    respond({
      items: [
        apiItem({ id: 'a', 項次: 1, 今日工時: 2 }),
        apiItem({ id: 'b', 項次: 2, 今日工時: 5, 已刪除: true }),
      ],
    });
    const summary = await fetchDaySummary('2026-10-09');
    expect(summary.nextIndex).toBe(2);
    expect(summary.otherHours).toBe(2);
    expect(summary.itemCount).toBe(1);
  });

  it('編輯時排除自己的工時（excludeId），筆數與 entries 仍含自己', async () => {
    const { fetchDaySummary } = await load();
    respond({
      items: [
        apiItem({ id: 'a', 項次: 1, 今日工時: 3 }),
        apiItem({ id: 'self', 項次: 2, 今日工時: 4 }),
        apiItem({ id: 'leave', 項次: 3, 今日工時: 8, 狀態: '休假' }),
      ],
    });
    const summary = await fetchDaySummary('2026-10-09', 'self');
    expect(summary.otherHours).toBe(11);
    expect(summary.itemCount).toBe(3);
    expect(summary.entries).toEqual([
      { id: 'a', 項次: 1, 今日工時: 3 },
      { id: 'self', 項次: 2, 今日工時: 4 },
      { id: 'leave', 項次: 3, 今日工時: 8 },
    ]);
  });

  it('今日工時空白（舊資料）當作 0', async () => {
    const { fetchDaySummary } = await load();
    respond({
      items: [
        apiItem({ id: 'a', 今日工時: '' as unknown as number }),
        apiItem({ id: 'b', 今日工時: 1.5 }),
      ],
    });
    expect((await fetchDaySummary('2026-10-09')).otherHours).toBe(1.5);
  });

  it('查詢失敗往外丟，由表單決定怎麼提示', async () => {
    const { fetchDaySummary } = await load();
    respond({ error: '讀取失敗' });
    await expect(fetchDaySummary('2026-10-09')).rejects.toThrow('讀取失敗');
  });
});
