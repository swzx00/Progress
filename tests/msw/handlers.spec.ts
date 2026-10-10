import { afterEach, beforeEach, describe, expect, vi } from 'vitest';

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
