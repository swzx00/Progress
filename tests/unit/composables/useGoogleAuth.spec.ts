// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Google 登入：ID Token 解析出 email、允許清單決定要不要顯示管理功能、token 只放記憶體（不存 storage）、
 * 重新整理時自動登入、需要時才續期（不在背景續期）、續期失敗的處理、寫入被退回時續期重送、
 * 分頁之間共用 token、登入按鈕、兩種登出。
 * 登入狀態是模組層級的，每個案例 resetModules 後重新 import；再 load() 一次就是另開一個分頁。
 * Google 登入腳本（GIS）換成假的，由測試呼叫 initialize 收到的 callback 模擬 Google 給 token。
 * 前端判斷只是體驗層，真正把關在 Code.gs 的 verifyIdToken_（tests/apps-script 測）
 */
type GoogleAuth = ReturnType<(typeof import('@/composables/useGoogleAuth'))['useGoogleAuth']>;

const HINT_KEY = 'progress:auto-login';

/** 假的 ID Token：header.payload.signature，payload 用 base64url（含中文要先轉 UTF-8） */
const makeToken = (payload: Record<string, unknown>): string => {
  const encode = (value: object): string =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`;
};

const nowSec = (): number => Math.floor(Date.now() / 1000);
/** 擁有者的 token，exp 是現在起算幾秒後到期 */
const ownerToken = (expiresIn = 3600, extra: Record<string, unknown> = {}): string =>
  makeToken({
    email: 'swzx00@gmail.com',
    name: '程',
    iat: nowSec(),
    exp: nowSec() + expiresIn,
    ...extra,
  });

type PromptListener = (notification: Record<string, () => boolean>) => void;

const gis = {
  initialize: vi.fn(),
  renderButton: vi.fn(),
  disableAutoSelect: vi.fn(),
  prompt: vi.fn<(listener?: PromptListener) => void>(),
};

/**
 * 假的 BroadcastChannel：同一個 bus 上的其他實例收得到（不含自己），跟瀏覽器一樣非同步送達。
 * 每個案例換新的 bus，前面案例載入的模組（舊分頁）收不到也送不過來
 */
let bus: Set<FakeChannel>;

class FakeChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  private readonly peers = bus;

  constructor(readonly name: string) {
    this.peers.add(this);
  }

  postMessage(data: unknown): void {
    for (const peer of this.peers) {
      if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data: structuredClone(data) }));
    }
  }
}

/** 等分頁之間的訊息送達、處理完 */
const flushMessages = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

let auth: GoogleAuth;
let apiError: (typeof import('@/composables/useWorkItems'))['ApiError'];

const load = async (): Promise<GoogleAuth> => {
  vi.resetModules();
  const { useGoogleAuth } = await import('@/composables/useGoogleAuth');
  apiError = (await import('@/composables/useWorkItems')).ApiError;
  return useGoogleAuth();
};

/** 初始化 GIS 後，模擬 Google 給 token（使用者點登入按鈕或自動登入成功） */
const giveCredential = async (credential: string): Promise<void> => {
  await auth.renderSignInButton(document.createElement('div'));
  const config = gis.initialize.mock.calls[0]![0] as {
    callback: (r: { credential: string }) => void;
  };
  config.callback({ credential });
};

/** 某個分頁第一次初始化 GIS 後，模擬 Google 給那個分頁 token（initialize 最後一次收到的 callback） */
const giveCredentialTo = async (tab: GoogleAuth, credential: string): Promise<void> => {
  await tab.renderSignInButton(document.createElement('div'));
  const config = gis.initialize.mock.calls.at(-1)![0] as {
    callback: (r: { credential: string }) => void;
  };
  config.callback({ credential });
};

/** 最近一次 prompt() 傳進來的通知 listener */
const lastPromptListener = (): PromptListener => gis.prompt.mock.calls.at(-1)![0]!;

beforeEach(async () => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id');
  window.google = { accounts: { id: gis } };
  bus = new Set();
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  auth = await load();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.google;
  vi.restoreAllMocks();
});

describe('登入狀態', () => {
  it('還沒登入：未登入、不能管理', () => {
    expect(auth.isLoggedIn.value).toBe(false);
    expect(auth.isAuthorized.value).toBe(false);
    expect(auth.userEmail.value).toBeNull();
  });

  it('Google 給了擁有者的 token：可以管理（payload 含中文也解得開）', async () => {
    const token = ownerToken();
    await giveCredential(token);
    expect(auth.userEmail.value).toBe('swzx00@gmail.com');
    expect(auth.isAuthorized.value).toBe(true);
    expect(auth.idToken.value).toBe(token);
  });

  it('別人的帳號：已登入但不能管理', async () => {
    await giveCredential(makeToken({ email: 'someone@gmail.com' }));
    expect(auth.isLoggedIn.value).toBe(true);
    expect(auth.isAuthorized.value).toBe(false);
  });

  it.each([
    ['格式壞掉', 'not-a-jwt'],
    ['payload 不是 JSON', 'a.bm90LWpzb24.c'],
    ['沒有 email', makeToken({ sub: '123' })],
  ])('token %s：沒有 email，不能管理', async (_, token) => {
    await giveCredential(token);
    expect(auth.userEmail.value).toBeNull();
    expect(auth.isAuthorized.value).toBe(false);
  });
});

describe('token 只放記憶體', () => {
  it('登入後 localStorage／sessionStorage 都沒有 token，只有「登入過」的標記', async () => {
    const token = ownerToken();
    await giveCredential(token);
    const stored = [
      ...Object.values({ ...localStorage }),
      ...Object.values({ ...sessionStorage }),
    ].join('\n');
    expect(stored).not.toContain(token);
    expect(localStorage.getItem(HINT_KEY)).toBe('1');
  });

  it('重新整理（重新載入模組）：token 不見了，要靠自動登入', async () => {
    await giveCredential(ownerToken());
    const reloaded = await load();
    expect(reloaded.isLoggedIn.value).toBe(false);
  });

  it('舊版存在 sessionStorage 的 token 載入時清掉，不再拿來用', async () => {
    sessionStorage.setItem('google_id_token', ownerToken());
    sessionStorage.setItem('google_id_token_skew', '0');
    const reloaded = await load();
    expect(reloaded.isLoggedIn.value).toBe(false);
    expect(sessionStorage.getItem('google_id_token')).toBeNull();
    expect(sessionStorage.getItem('google_id_token_skew')).toBeNull();
  });
});

describe('重新整理時自動登入（tryAutoLogin）', () => {
  it('這個瀏覽器沒登入過（沒有標記）：不呼叫 prompt，不跳 Google 的登入提示', async () => {
    expect(await auth.tryAutoLogin()).toBe(false);
    expect(gis.prompt).not.toHaveBeenCalled();
  });

  it('登入過：用 auto_select 初始化並呼叫 prompt，Google 給 token 就登入', async () => {
    localStorage.setItem(HINT_KEY, '1');
    const pending = auth.tryAutoLogin();
    await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalledTimes(1));
    const config = gis.initialize.mock.calls[0]![0] as {
      auto_select: boolean;
      client_id: string;
      callback: (r: { credential: string }) => void;
    };
    expect(config.auto_select).toBe(true);
    expect(config.client_id).toBe('client-id');

    config.callback({ credential: ownerToken() });
    expect(await pending).toBe(true);
    expect(auth.isAuthorized.value).toBe(true);
  });

  it.each(['isNotDisplayed', 'isSkippedMoment', 'isDismissedMoment'])(
    'Google 沒給（%s，例如 10 分鐘冷卻、無痕模式）：維持未登入，不丟錯',
    async (moment) => {
      localStorage.setItem(HINT_KEY, '1');
      const pending = auth.tryAutoLogin();
      await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalled());
      lastPromptListener()({ [moment]: () => true });
      expect(await pending).toBe(false);
      expect(auth.isLoggedIn.value).toBe(false);
    },
  );

  it('已經登入：不再自動登入', async () => {
    await giveCredential(ownerToken());
    localStorage.setItem(HINT_KEY, '1');
    expect(await auth.tryAutoLogin()).toBe(false);
    expect(gis.prompt).not.toHaveBeenCalled();
  });
});

describe('續期（refreshLogin）', () => {
  it('不在背景續期：token 過期、分頁切回來都不呼叫 prompt（避免沒操作時跳出帳號選擇）', async () => {
    vi.useFakeTimers();
    await giveCredential(ownerToken(3600));
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(gis.prompt).not.toHaveBeenCalled();
    expect(auth.isLoggedIn.value).toBe(true);
  });

  it('同時有好幾個續期：只呼叫一次 prompt，一起拿到結果', async () => {
    await giveCredential(ownerToken());
    const a = auth.refreshLogin();
    const b = auth.refreshLogin();
    await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalledTimes(1));
    lastPromptListener()({ isSkippedMoment: () => true });
    expect(await Promise.all([a, b])).toEqual([false, false]);
  });

  it('15 秒內 Google 沒回應：算續期失敗', async () => {
    vi.useFakeTimers();
    await giveCredential(ownerToken());
    const pending = auth.refreshLogin();
    await vi.advanceTimersByTimeAsync(15 * 1000);
    expect(await pending).toBe(false);
  });

  it('Google 登入腳本還沒載入：直接回傳失敗，不會卡住', async () => {
    delete window.google;
    expect(await auth.refreshLogin()).toBe(false);
  });
});

describe('分頁之間共用 token', () => {
  it('另一個分頁已經登入：新分頁自動登入直接拿它的 token，不呼叫 prompt', async () => {
    const token = ownerToken();
    await giveCredential(token);
    const tab = await load();
    expect(await tab.tryAutoLogin()).toBe(true);
    expect(tab.idToken.value).toBe(token);
    expect(tab.isAuthorized.value).toBe(true);
    expect(gis.prompt).not.toHaveBeenCalled();
  });

  it('一個分頁拿到新 token：其他分頁跟著換上', async () => {
    await giveCredential(ownerToken(1800));
    const tab = await load();
    const next = ownerToken(3600, { jti: 'next' });
    await giveCredentialTo(tab, next);
    await flushMessages();
    expect(auth.idToken.value).toBe(next);
  });

  it('收到比手上早到期的 token：不換（舊的不蓋新的）', async () => {
    const newer = ownerToken(3600);
    await giveCredential(newer);
    const tab = await load();
    await giveCredentialTo(tab, ownerToken(1800, { jti: 'older' }));
    await flushMessages();
    expect(auth.idToken.value).toBe(newer);
  });

  it('開表單前 token 過期：先跟其他分頁要，拿到就不呼叫 prompt', async () => {
    const fresh = ownerToken(3600);
    await giveCredential(fresh);
    const tab = await load();
    // 快過期的 token 傳過來，原本的分頁不收
    await giveCredentialTo(tab, ownerToken(30, { jti: 'stale' }));
    await flushMessages();
    expect(auth.idToken.value).toBe(fresh);

    expect(await tab.ensureFreshLogin()).toBe(true);
    expect(tab.idToken.value).toBe(fresh);
    expect(gis.prompt).not.toHaveBeenCalled();
  });

  it('其他分頁的 token 也過期了：不收，照常呼叫 prompt', async () => {
    await giveCredential(ownerToken(30));
    const tab = await load();
    localStorage.setItem(HINT_KEY, '1');
    const pending = tab.tryAutoLogin();
    await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalledTimes(1));
    lastPromptListener()({ isSkippedMoment: () => true });
    expect(await pending).toBe(false);
    expect(tab.isLoggedIn.value).toBe(false);
  });

  it('使用者在一個分頁按登出：其他分頁也一起登出', async () => {
    await giveCredential(ownerToken());
    const tab = await load();
    expect(await tab.tryAutoLogin()).toBe(true);
    tab.signOut();
    await flushMessages();
    expect(auth.isLoggedIn.value).toBe(false);
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
  });

  it('一個分頁登入失效（clearLogin）：只影響自己，其他分頁維持登入', async () => {
    await giveCredential(ownerToken());
    const tab = await load();
    expect(await tab.tryAutoLogin()).toBe(true);
    tab.clearLogin();
    await flushMessages();
    expect(auth.isLoggedIn.value).toBe(true);
  });

  it('瀏覽器不支援 BroadcastChannel：照常自己呼叫 prompt', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const tab = await load();
    localStorage.setItem(HINT_KEY, '1');
    const pending = tab.tryAutoLogin();
    await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalledTimes(1));
    (
      gis.initialize.mock.calls.at(-1)![0] as { callback: (r: { credential: string }) => void }
    ).callback({ credential: ownerToken() });
    expect(await pending).toBe(true);
  });
});

describe('ensureFreshLogin', () => {
  it('還沒過期：直接通過，不續期', async () => {
    await giveCredential(ownerToken());
    expect(await auth.ensureFreshLogin()).toBe(true);
    expect(gis.prompt).not.toHaveBeenCalled();
  });

  it('過期了但續期成功：通過，換成新 token', async () => {
    await giveCredential(ownerToken(3600));
    vi.spyOn(Date, 'now').mockReturnValue((nowSec() + 3600) * 1000);
    const pending = auth.ensureFreshLogin();
    await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalled());
    const next = makeToken({ email: 'swzx00@gmail.com', exp: nowSec() + 3600 });
    (
      gis.initialize.mock.calls[0]![0] as { callback: (r: { credential: string }) => void }
    ).callback({ credential: next });
    expect(await pending).toBe(true);
    expect(auth.idToken.value).toBe(next);
  });

  it('過期了而且續期失敗：回到未登入，但保留自動登入（不是使用者自己登出）', async () => {
    await giveCredential(ownerToken(3600));
    vi.spyOn(Date, 'now').mockReturnValue((nowSec() + 3600) * 1000);
    const pending = auth.ensureFreshLogin();
    await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalled());
    lastPromptListener()({ isSkippedMoment: () => true });
    expect(await pending).toBe(false);
    expect(auth.isLoggedIn.value).toBe(false);
    expect(localStorage.getItem(HINT_KEY)).toBe('1');
    expect(gis.disableAutoSelect).not.toHaveBeenCalled();
  });

  it('本機時鐘快了兩小時：用 iat 校正，剛拿到的 token 不會被當成過期', async () => {
    const realNow = Date.now();
    const token = makeToken({
      email: 'swzx00@gmail.com',
      iat: Math.floor(realNow / 1000),
      exp: Math.floor(realNow / 1000) + 3600,
    });
    vi.spyOn(Date, 'now').mockReturnValue(realNow + 2 * 60 * 60 * 1000);
    await giveCredential(token);
    expect(await auth.ensureFreshLogin()).toBe(true);
  });

  it('沒有 exp：交給後端判斷，不當作過期', async () => {
    await giveCredential(makeToken({ email: 'swzx00@gmail.com' }));
    expect(await auth.ensureFreshLogin()).toBe(true);
  });

  it('沒登入：回傳 false', async () => {
    expect(await auth.ensureFreshLogin()).toBe(false);
  });
});

describe('寫入被後端退回時續期重送（withLoginRetry）', () => {
  it('UNAUTHORIZED：續期拿到新 token 後用新 token 重送一次', async () => {
    await giveCredential(ownerToken());
    const next = ownerToken(3600, { jti: 'next' });
    const run = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(new apiError('登入已過期', 'UNAUTHORIZED'))
      .mockResolvedValueOnce('ok');
    const pending = auth.withLoginRetry('old-token', run);
    await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalled());
    (
      gis.initialize.mock.calls[0]![0] as { callback: (r: { credential: string }) => void }
    ).callback({ credential: next });
    expect(await pending).toBe('ok');
    expect(run.mock.calls.map(([token]) => token)).toEqual(['old-token', next]);
  });

  it('續期失敗：丟出原本的 UNAUTHORIZED，不重送', async () => {
    await giveCredential(ownerToken());
    const error = new apiError('登入已過期', 'UNAUTHORIZED');
    const run = vi.fn<(token: string) => Promise<void>>().mockRejectedValue(error);
    const pending = auth.withLoginRetry('token', run);
    await vi.waitFor(() => expect(gis.prompt).toHaveBeenCalled());
    lastPromptListener()({ isSkippedMoment: () => true });
    await expect(pending).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('其他錯誤：直接丟出，不續期也不重送', async () => {
    const error = new Error('欄位錯誤');
    const run = vi.fn<(token: string) => Promise<void>>().mockRejectedValue(error);
    await expect(auth.withLoginRetry('token', run)).rejects.toBe(error);
    expect(gis.prompt).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('登出', () => {
  it('使用者按登出：清掉 token、拿掉「登入過」的標記、關掉自動登入，之後不會自動登入回來', async () => {
    await giveCredential(ownerToken());
    auth.signOut();
    expect(auth.isLoggedIn.value).toBe(false);
    expect(localStorage.getItem(HINT_KEY)).toBeNull();
    expect(gis.disableAutoSelect).toHaveBeenCalled();
    expect(await auth.tryAutoLogin()).toBe(false);
    expect(gis.prompt).not.toHaveBeenCalled();
  });

  it('登入失效（clearLogin）：回到未登入，但保留自動登入', async () => {
    await giveCredential(ownerToken());
    auth.clearLogin();
    expect(auth.isLoggedIn.value).toBe(false);
    expect(localStorage.getItem(HINT_KEY)).toBe('1');
    expect(gis.disableAutoSelect).not.toHaveBeenCalled();
  });
});

describe('瀏覽器封鎖網站資料', () => {
  it('storage 讀寫丟錯也不會讓模組載入失敗；登入、自動登入、登出照常', async () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError');
      });
    }
    auth = await load();
    expect(auth.isLoggedIn.value).toBe(false);
    await giveCredential(ownerToken());
    expect(auth.isAuthorized.value).toBe(true);
    expect(await auth.tryAutoLogin()).toBe(false);
    expect(() => auth.signOut()).not.toThrow();
  });
});

describe('登入按鈕', () => {
  it('用 .env 的 Client ID 初始化一次', async () => {
    const el = document.createElement('div');
    await auth.renderSignInButton(el);
    await auth.renderSignInButton(el, true);
    expect(gis.initialize).toHaveBeenCalledTimes(1);
    expect((gis.initialize.mock.calls[0]![0] as { client_id: string }).client_id).toBe('client-id');
  });

  it('淺色用 outline、深色用 filled_black；重畫前先清空容器', async () => {
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
    auth = await load();
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
