// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeRecent } from '@/testing/fixtures';
import type { WorkItemOptions } from '@/types/work-item';

/**
 * 選項清單、近期紀錄、工時設定的讀寫。狀態放在模組層級（整個工作階段共用一份），
 * 所以每個測試重新載入模組；fetch 換成假的，不打真的 API
 */
const API_URL = 'https://script.example.test/exec';

const fetchMock = vi.fn();

const respond = (body: unknown): void => {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
};

const postBody = (n = 0): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[n]![1] as RequestInit).body as string);

const OPTIONS: WorkItemOptions = {
  交辦單位: ['資訊部'],
  交辦人員: ['王小明'],
  專案名稱: ['官網改版'],
  專案Repo: ['web'],
};

const load = async () => (await import('@/composables/useOptions')).useOptions();

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

describe('fetchOptions', () => {
  it('讀 type=options，存下選項、近期紀錄（日期轉成 YYYY-MM-DD）、工時設定', async () => {
    const store = await load();
    const workHours = { start: '08:30', end: '17:30', breakStart: '12:00', breakEnd: '13:00' };
    respond({
      options: OPTIONS,
      recentItems: [makeRecent({ 工作日期: '2026/10/09', 預計期限: '2026/10/31' })],
      workHours,
    });
    await store.fetchOptions();

    expect(new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get('type')).toBe('options');
    expect(store.options.value).toEqual(OPTIONS);
    expect(store.recentItems.value[0]).toMatchObject({
      工作日期: '2026-10-09',
      預計期限: '2026-10-31',
    });
    expect(store.workHours.value).toEqual(workHours);
    expect(store.loading.value).toBe(false);
    expect(store.error.value).toBeNull();
  });

  it('舊版後端沒有 recentItems、workHours：當作沒有推薦、沒有工時設定', async () => {
    const store = await load();
    respond({ options: OPTIONS });
    await store.fetchOptions();
    expect(store.recentItems.value).toEqual([]);
    expect(store.workHours.value).toBeNull();
  });

  it('一個工作階段只讀一次', async () => {
    const store = await load();
    respond({ options: OPTIONS });
    await store.fetchOptions();
    await store.fetchOptions();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('同時呼叫多次共用同一個請求', async () => {
    const store = await load();
    respond({ options: OPTIONS });
    await Promise.all([store.fetchOptions(), store.fetchOptions(), store.fetchOptions()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('失敗時 error 有訊息、不往外丟，之後可以重新讀取', async () => {
    const store = await load();
    respond({ error: '找不到選項清單分頁' });
    await expect(store.fetchOptions()).resolves.toBeUndefined();
    expect(store.error.value).toBe('找不到選項清單分頁');
    expect(store.options.value).toBeNull();

    respond({ options: OPTIONS });
    await store.fetchOptions();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.error.value).toBeNull();
    expect(store.options.value).toEqual(OPTIONS);
  });

  it('網路錯誤也記在 error', async () => {
    const store = await load();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await store.fetchOptions();
    expect(store.error.value).toBe('Failed to fetch');
  });
});

describe('管理選項清單（addOption／renameOption／deleteOption）', () => {
  const updated: WorkItemOptions = { ...OPTIONS, 交辦單位: ['資訊部', '人事室'] };

  it('送出內容正確，回應的 options 直接覆寫本地快取，不再重新讀取', async () => {
    const store = await load();
    respond({ options: updated });
    await store.addOption('token', '交辦單位', '人事室');
    expect(postBody()).toEqual({
      idToken: 'token',
      action: 'addOption',
      category: '交辦單位',
      value: '人事室',
    });
    expect(store.options.value).toEqual(updated);
  });

  it('renameOption 帶舊值與新值', async () => {
    const store = await load();
    respond({ options: updated });
    await store.renameOption('token', '交辦單位', '資訊部', '資訊處');
    expect(postBody()).toMatchObject({
      action: 'renameOption',
      category: '交辦單位',
      oldValue: '資訊部',
      newValue: '資訊處',
    });
  });

  it('deleteOption 帶值', async () => {
    const store = await load();
    respond({ options: updated });
    await store.deleteOption('token', '專案Repo', 'web');
    expect(postBody()).toMatchObject({
      action: 'deleteOption',
      category: '專案Repo',
      value: 'web',
    });
  });

  it('登入錯誤丟帶 UNAUTHORIZED 的 ApiError，本地快取不動', async () => {
    const { ApiError } = await import('@/composables/useWorkItems');
    const store = await load();
    respond({ options: OPTIONS });
    await store.fetchOptions();

    respond({ error: '請重新登入', code: 'UNAUTHORIZED' });
    const promise = store.addOption('token', '交辦單位', '人事室');
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(store.options.value).toEqual(OPTIONS);
  });

  it('回應沒有 error 也沒有 options，當作失敗', async () => {
    const store = await load();
    respond({});
    await expect(store.deleteOption('token', '交辦單位', '資訊部')).rejects.toThrow(
      '選項清單更新失敗',
    );
  });
});

describe('saveWorkHours', () => {
  const setting = { start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' };

  it('送出設定，回應的 workHours 覆寫本地', async () => {
    const store = await load();
    respond({ workHours: setting });
    await store.saveWorkHours('token', setting);
    expect(postBody()).toEqual({ idToken: 'token', action: 'saveWorkHours', workHours: setting });
    expect(store.workHours.value).toEqual(setting);
  });

  it('清除設定送 null，本地變回 null', async () => {
    const store = await load();
    respond({ workHours: setting });
    await store.saveWorkHours('token', setting);
    respond({ workHours: null });
    await store.saveWorkHours('token', null);
    expect(postBody(1).workHours).toBeNull();
    expect(store.workHours.value).toBeNull();
  });

  it('驗證失敗丟 ApiError（沒有 code），本地設定不動', async () => {
    const store = await load();
    respond({ workHours: setting });
    await store.saveWorkHours('token', setting);
    respond({ error: '每日工時需剛好 8 小時（目前 9 小時）' });
    await expect(
      store.saveWorkHours('token', { start: '08:00', end: '17:00' }),
    ).rejects.toMatchObject({ message: '每日工時需剛好 8 小時（目前 9 小時）', code: undefined });
    expect(store.workHours.value).toEqual(setting);
  });

  it('登入錯誤帶 UNAUTHORIZED', async () => {
    const store = await load();
    respond({ error: '請重新登入', code: 'UNAUTHORIZED' });
    await expect(store.saveWorkHours('token', setting)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});

describe('rememberItems（存檔後更新近期紀錄）', () => {
  it('編輯帶 id 取代原本那筆，新增沒有 id 直接加入', async () => {
    const store = await load();
    respond({ options: OPTIONS, recentItems: [makeRecent({ id: 'a', 工作目標: '舊目標' })] });
    await store.fetchOptions();

    store.rememberItems([makeRecent({ id: 'a', 工作目標: '新目標' })]);
    store.rememberItems([makeRecent({ id: '', 工作目標: '剛新增' })]);
    expect(store.recentItems.value.map((item) => item.工作目標).sort()).toEqual(
      ['剛新增', '新目標'].sort(),
    );
  });
});
