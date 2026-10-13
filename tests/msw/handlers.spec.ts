import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeBackendContract, type BackendClient } from '../backend/contract';

/**
 * MSW 假後端（npm run dev 預設打它）要跟 Code.gs 同一套規則：用 msw/node 直接對 handlers 發請求，
 * 跑後端共同規格（tests/backend/contract.ts）。假資料在模組層級，每個測試重新載入一份乾淨的
 */
const URL_BASE = 'http://mock.test/exec';

let server: { close: () => void };

beforeEach(async () => {
  vi.resetModules();
  const { setupServer } = await import('msw/node');
  const { handlers } = await import('@/mocks/handlers');
  const instance = setupServer(...handlers);
  instance.listen({ onUnhandledRequest: 'error' });
  server = instance;
});

afterEach(() => {
  server.close();
});

const client: BackendClient = {
  post: async (body) => {
    const res = await fetch(URL_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    // Apps Script 的回應一律 200，MSW 也要一樣
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  },
  get: async (params) => {
    const url = new URL(URL_BASE);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const res = await fetch(url);
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  },
};

describe('MSW 假後端', () => {
  describeBackendContract(() => client);
});

/**
 * 自動填入（AutoFill.gs）：共同規格之外另外測，因為真後端儲存啟用的設定時會去開對方的試算表，
 * MSW 沒有對方的試算表；Code.gs 那邊的行為在 tests/apps-script/auto-fill.spec.ts
 */
describe('MSW 假後端：自動填入', () => {
  const URL = 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit';
  const post = (body: Record<string, unknown>) => client.post({ idToken: 'token', ...body });
  const enable = () =>
    post({ action: 'saveAutoFillSetting', autoFill: { enabled: true, url: URL, name: '林家丞' } });
  const fillNow = (text: string, date = '2026/10/13') =>
    post({ action: 'autoFillNow', date, text });

  it('設定：預設停用，存好讀得回來，不放進 doGet', async () => {
    expect((await post({ action: 'getAutoFillSetting' })).autoFill).toEqual({
      enabled: false,
      url: '',
      name: '',
    });
    expect((await enable()).autoFill).toEqual({ enabled: true, url: URL, name: '林家丞' });
    expect((await post({ action: 'getAutoFillSetting' })).autoFill).toEqual({
      enabled: true,
      url: URL,
      name: '林家丞',
    });
    expect(await client.get({ type: 'options' })).not.toHaveProperty('autoFill');
  });

  it('設定的驗證', async () => {
    const save = (autoFill: unknown) => post({ action: 'saveAutoFillSetting', autoFill });
    expect((await save({ enabled: 'yes' })).error).toBe('自動填入設定格式不正確');
    expect((await save({ enabled: true, url: '', name: '林家丞' })).error).toBe('請填寫試算表網址');
    expect((await save({ enabled: true, url: URL, name: '' })).error).toBe('請填寫姓名');
  });

  it('填入：沒啟用回錯誤；空的格子寫入、一樣的內容不動、不同的內容不覆蓋', async () => {
    expect((await fillNow('內容')).error).toBe('自動填入沒有啟用');
    await enable();
    expect(await fillNow(' 內容 ')).toEqual({ status: 'written' });
    expect(await fillNow('內容')).toEqual({ status: 'unchanged' });
    expect((await fillNow('別的內容')).error).toBe(
      '對方試算表的格子已經有內容，為了不覆蓋別人的紀錄，這次沒有寫入',
    );
    expect(await fillNow('別天的內容', '2026/10/14')).toEqual({ status: 'written' });
  });

  it('填入的驗證', async () => {
    await enable();
    expect((await fillNow('內容', '2026-10-13')).error).toBe('日期格式不正確');
    expect((await fillNow('  ')).error).toBe('沒有可以填入的內容');
    expect((await fillNow('字'.repeat(5001))).error).toBe('填入內容不可超過 5000 個字');
  });
});
