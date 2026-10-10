// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Google 登入：ID Token 解析出 email、允許清單決定要不要顯示管理功能、token 存在 sessionStorage、
 * 載入 Google 登入腳本與按鈕、登出。登入狀態是模組層級的，每個案例 resetModules 後重新 import。
 * 前端判斷只是體驗層，真正把關在 Code.gs 的 verifyIdToken_（tests/apps-script 測）
 */
type GoogleAuth = ReturnType<(typeof import('./useGoogleAuth'))['useGoogleAuth']>;

const STORAGE_KEY = 'google_id_token';

/** 假的 ID Token：header.payload.signature，payload 用 base64url（含中文要先轉 UTF-8） */
const makeToken = (payload: Record<string, unknown>): string => {
  const encode = (value: object): string =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
};

const OWNER_TOKEN = makeToken({ email: 'swzx00@gmail.com', name: '程' });

const load = async (): Promise<GoogleAuth> => {
  vi.resetModules();
  const { useGoogleAuth } = await import('./useGoogleAuth');
  return useGoogleAuth();
};

const gis = {
  initialize: vi.fn(),
  renderButton: vi.fn(),
  disableAutoSelect: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
  window.google = { accounts: { id: gis } };
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.google;
  vi.restoreAllMocks();
});

describe('登入狀態', () => {
  it('沒有 token：未登入', async () => {
    const auth = await load();
    expect(auth.isLoggedIn.value).toBe(false);
    expect(auth.isAuthorized.value).toBe(false);
    expect(auth.userEmail.value).toBeNull();
  });

  it('sessionStorage 有擁有者的 token：重新整理後維持登入、可以管理（payload 含中文也解得開）', async () => {
    sessionStorage.setItem(STORAGE_KEY, OWNER_TOKEN);
    const auth = await load();
    expect(auth.userEmail.value).toBe('swzx00@gmail.com');
    expect(auth.isAuthorized.value).toBe(true);
    expect(auth.idToken.value).toBe(OWNER_TOKEN);
  });

  it('別人的帳號：已登入但不能管理', async () => {
    sessionStorage.setItem(STORAGE_KEY, makeToken({ email: 'someone@gmail.com' }));
    const auth = await load();
    expect(auth.isLoggedIn.value).toBe(true);
    expect(auth.isAuthorized.value).toBe(false);
  });

  it.each([
    ['格式壞掉', 'not-a-jwt'],
    ['payload 不是 JSON', 'a.bm90LWpzb24.c'],
    ['沒有 email', makeToken({ sub: '123' })],
  ])('token %s：沒有 email，不能管理', async (_, token) => {
    sessionStorage.setItem(STORAGE_KEY, token);
    const auth = await load();
    expect(auth.userEmail.value).toBeNull();
    expect(auth.isAuthorized.value).toBe(false);
  });
});

describe('登入按鈕', () => {
  it('用 .env 的 Client ID 初始化一次；登入成功後存 token，變成可以管理', async () => {
    const auth = await load();
    const el = document.createElement('div');
    await auth.renderSignInButton(el);
    await auth.renderSignInButton(el, true);
    expect(gis.initialize).toHaveBeenCalledTimes(1);
    const config = gis.initialize.mock.calls[0]![0] as {
      client_id: string;
      callback: (r: { credential: string }) => void;
    };
    expect(config.client_id).toBe('client-id');

    config.callback({ credential: OWNER_TOKEN });
    expect(auth.isAuthorized.value).toBe(true);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(OWNER_TOKEN);
  });

  it('淺色用 outline、深色用 filled_black；重畫前先清空容器', async () => {
    const auth = await load();
    const el = document.createElement('div');
    el.appendChild(document.createElement('span'));
    await auth.renderSignInButton(el);
    expect(el.children).toHaveLength(0);
    await auth.renderSignInButton(el, true);
    expect(gis.renderButton.mock.calls.map((call) => (call[1] as { theme: string }).theme)).toEqual(
      ['outline', 'filled_black'],
    );
  });

  it('Google 腳本還沒載入：加上 script 標籤，載入後才畫按鈕；載入失敗回錯誤', async () => {
    // 攔下 script 標籤不真的載入（happy-dom 不執行外部腳本），由測試觸發 onload／onerror
    const scripts: HTMLScriptElement[] = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
      scripts.push(node as unknown as HTMLScriptElement);
      return node;
    });

    delete window.google;
    const auth = await load();
    const pending = auth.renderSignInButton(document.createElement('div'));
    expect(scripts[0]!.src).toBe('https://accounts.google.com/gsi/client');
    window.google = { accounts: { id: gis } };
    scripts[0]!.onload!(new Event('load'));
    await pending;
    expect(gis.renderButton).toHaveBeenCalledTimes(1);

    delete window.google;
    const failing = await load();
    const result = failing.renderSignInButton(document.createElement('div'));
    scripts[1]!.onerror!(new Event('error'));
    await expect(result).rejects.toThrow('無法載入 Google 登入腳本');
  });
});

it('登出：清掉 token 與 sessionStorage，取消自動登入', async () => {
  sessionStorage.setItem(STORAGE_KEY, OWNER_TOKEN);
  const auth = await load();
  auth.signOut();
  expect(auth.isLoggedIn.value).toBe(false);
  expect(auth.isAuthorized.value).toBe(false);
  expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(gis.disableAutoSelect).toHaveBeenCalled();
});
