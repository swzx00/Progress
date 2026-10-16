import { computed, ref } from 'vue';

import { ApiError } from '@/composables/useWorkItems';

const ALLOWED_EMAILS = ['swzx00@gmail.com'];

interface GoogleCredentialResponse {
  credential: string;
}

/** google.accounts.id.prompt() 的狀態通知；FedCM 底下部分方法可能不存在，一律用可選呼叫 */
interface PromptMomentNotification {
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  isNotDisplayed?: () => boolean;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
            auto_select?: boolean;
            use_fedcm_for_prompt?: boolean;
            itp_support?: boolean;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
          prompt?: (listener?: (notification: PromptMomentNotification) => void) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

/**
 * 登入憑證（Google ID Token）只放在記憶體，不存 localStorage／sessionStorage（使用者決定：存在瀏覽器儲存空間
 * 有被網頁程式讀走的風險，且 swzx00.github.io 底下的其他網站共用同一份）。重新整理、重開分頁後靠 Google
 * 自動登入（auto_select）拿新的 token；「長期記住登入」由 Google 自己用 accounts.google.com 的 HttpOnly
 * Cookie 保管，這邊只拿一小時就失效的 token。
 *
 * localStorage 只記一個「這個瀏覽器登入過、沒按登出」的標記（AUTO_LOGIN_HINT_KEY，值只有 '1'，不是憑證），
 * 有這個標記才在載入時嘗試自動登入；沒有的話（路過看唯讀畫面的人、按過登出）不跳 Google 的登入提示。
 *
 * 同一個瀏覽器開好幾個分頁時，用 BroadcastChannel 在分頁之間傳 token（一樣只在記憶體）：一個分頁拿到新 token
 * 就傳給其他分頁，續期時先跟其他分頁要，要不到才呼叫 prompt()。Google 自動登入兩次至少隔 10 分鐘，
 * 每個分頁各自 prompt() 很容易撞到，撞到時右上角會跳出帳號選擇
 */
const AUTO_LOGIN_HINT_KEY = 'progress:auto-login';
/** 舊版存在 sessionStorage 的 token 與時鐘差，載入時清掉 */
const LEGACY_SESSION_KEYS = ['google_id_token', 'google_id_token_skew'];

/** 瀏覽器封鎖網站資料時存取 storage 會丟錯，讀寫一律包 try/catch：讀不到當作沒有，寫不進去就算了 */
const readHint = (): boolean => {
  try {
    return localStorage.getItem(AUTO_LOGIN_HINT_KEY) === '1';
  } catch {
    return false;
  }
};

const writeHint = (on: boolean): void => {
  try {
    if (on) localStorage.setItem(AUTO_LOGIN_HINT_KEY, '1');
    else localStorage.removeItem(AUTO_LOGIN_HINT_KEY);
  } catch {
    // 存不進去只是下次不會自動登入
  }
};

try {
  for (const key of LEGACY_SESSION_KEYS) sessionStorage.removeItem(key);
} catch {
  // 讀不到就沒有東西要清
}

const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64)
      .split('')
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
  return JSON.parse(json) as Record<string, unknown>;
};

/** 提早一點視為過期，避免剛好在送出途中過期 */
const EXPIRY_MARGIN_MS = 60 * 1000;
/** 續期等多久沒拿到新 token 就算失敗（Google 沒回應、被瀏覽器擋下） */
const REFRESH_TIMEOUT_MS = 15 * 1000;
/** 續期時先跟其他分頁要 token，等多久沒回應才呼叫 prompt() */
const PEER_WAIT_MS = 300;

/**
 * 本機時鐘跟 Google 的時間差（毫秒，Google 減本機）。拿到 token 時用 iat（核發時間）算，
 * 判斷過期時用「本機時間＋時間差」比 exp，本機時鐘不準時才不會把剛拿到的 token 當成過期
 */
let clockSkewMs = 0;

const measureClockSkew = (token: string): number => {
  try {
    const { iat } = decodeJwtPayload(token);
    return typeof iat === 'number' ? iat * 1000 - Date.now() : 0;
  } catch {
    return 0;
  }
};

/** token 的到期時間（毫秒，Google 的時間）；解不開或沒有 exp 回傳 null，交給後端判斷 */
const expiresAt = (token: string): number | null => {
  try {
    const { exp } = decodeJwtPayload(token);
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
};

/** 現在（換算成 Google 的時間）距離到期還有多久；沒有 exp 回傳 Infinity */
const msUntilExpiry = (token: string): number => {
  const exp = expiresAt(token);
  return exp === null ? Infinity : exp - (Date.now() + clockSkewMs);
};

const isTokenExpired = (token: string): boolean => msUntilExpiry(token) <= EXPIRY_MARGIN_MS;

const idToken = ref<string | null>(null);

const userEmail = computed<string | null>(() => {
  if (!idToken.value) return null;
  try {
    const payload = decodeJwtPayload(idToken.value);
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
});

const isLoggedIn = computed(() => idToken.value !== null);
const isAuthorized = computed(
  () => isLoggedIn.value && !!userEmail.value && ALLOWED_EMAILS.includes(userEmail.value),
);

let scriptLoadPromise: Promise<void> | null = null;

const loadGisScript = (): Promise<void> => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('無法載入 Google 登入腳本'));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
};

/** 等待中的續期：拿到新 token（handleCredential）時一起 resolve(true) */
let pendingRefresh: { promise: Promise<boolean>; resolve: (ok: boolean) => void } | null = null;

const settleRefresh = (ok: boolean): void => {
  pendingRefresh?.resolve(ok);
  pendingRefresh = null;
};

/** 分頁之間傳的訊息：request 跟其他分頁要 token、token 送出 token（附時鐘差）、signout 使用者按了登出 */
type AuthMessage =
  { type: 'request' } | { type: 'token'; token: string; skewMs: number } | { type: 'signout' };

/** 不支援 BroadcastChannel 的瀏覽器就不共用，每個分頁自己續期 */
const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('progress:auth');

const postToPeers = (message: AuthMessage): void => {
  channel?.postMessage(message);
};

const handleCredential = (response: GoogleCredentialResponse): void => {
  idToken.value = response.credential;
  clockSkewMs = measureClockSkew(response.credential);
  writeHint(true);
  settleRefresh(true);
  postToPeers({ type: 'token', token: response.credential, skewMs: clockSkewMs });
};

/**
 * 收到其他分頁的 token：比手上的晚到期才換上（舊的不蓋新的），已經過期的不收。
 * 時鐘差用對方算好的（同一台電腦），不能用 iat 重算：token 可能是對方幾十分鐘前拿到的
 */
const adoptPeerToken = (token: string, skewMs: number): void => {
  const exp = expiresAt(token);
  if (exp === null || exp - (Date.now() + skewMs) <= EXPIRY_MARGIN_MS) return;
  const currentExp = idToken.value ? expiresAt(idToken.value) : null;
  if (currentExp !== null && exp <= currentExp) return;
  idToken.value = token;
  clockSkewMs = skewMs;
  writeHint(true);
  settleRefresh(true);
};

let initialized = false;

/** 跟其他分頁要 token：拿到（adoptPeerToken 結束了續期）或等了 PEER_WAIT_MS 就繼續 */
const askPeers = (settled: Promise<boolean>): Promise<void> => {
  if (!channel) return Promise.resolve();
  postToPeers({ type: 'request' });
  return Promise.race([
    settled.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, PEER_WAIT_MS)),
  ]);
};

const ensureInitialized = async (): Promise<void> => {
  await loadGisScript();
  if (initialized) return;
  window.google?.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: handleCredential,
    // 之前同意過、瀏覽器只登入一個 Google 帳號時，prompt() 直接給 token，不用點（自動登入）
    auto_select: true,
    // Chrome 的自動登入走 FedCM（兩次自動登入至少間隔 10 分鐘，Google 的規定）
    use_fedcm_for_prompt: true,
    itp_support: true,
  });
  initialized = true;
};

/**
 * 換一張新的 token，回傳是否拿到。先跟其他分頁要，要不到才跟 Google 要（google.accounts.id.prompt，auto_select）。
 * 只在真的需要時呼叫（重新整理、開表單前 token 過期、寫入被退回），不在背景定時續期：Google 不能自動登入時
 * （例如 10 分鐘冷卻）prompt() 會在右上角跳出帳號選擇，背景續期會讓它在沒操作時莫名跳出來。
 * 同時有多個呼叫只發一次；Google 登入腳本還沒載入就直接回傳 false（不在這裡等腳本，避免卡住畫面）；
 * 被略過、被關掉、或 REFRESH_TIMEOUT_MS 內沒回應都算失敗。失敗時不會登出，交給呼叫端決定
 */
const refreshLogin = (): Promise<boolean> => {
  if (pendingRefresh) return pendingRefresh.promise;
  const gis = window.google?.accounts?.id;
  if (!gis?.prompt) return Promise.resolve(false);

  let resolve!: (ok: boolean) => void;
  const promise = new Promise<boolean>((r) => {
    resolve = r;
  });
  pendingRefresh = { promise, resolve };
  const timeout = setTimeout(() => settleRefresh(false), REFRESH_TIMEOUT_MS);
  void promise.then(() => clearTimeout(timeout));

  void askPeers(promise)
    .then(async () => {
      // 其他分頁給了 token，續期已經結束
      if (pendingRefresh?.promise !== promise) return;
      await ensureInitialized();
      gis.prompt?.((notification) => {
        if (
          notification.isNotDisplayed?.() ||
          notification.isSkippedMoment?.() ||
          notification.isDismissedMoment?.()
        ) {
          settleRefresh(false);
        }
      });
    })
    .catch(() => settleRefresh(false));
  return promise;
};

/**
 * 重新整理、重開分頁時自動登入：只有這個瀏覽器登入過、沒按登出（有 AUTO_LOGIN_HINT_KEY）才嘗試，
 * 這時才載入 Google 登入腳本，先跟其他分頁要 token，要不到才呼叫 prompt()。
 * 拿不到（被 10 分鐘冷卻擋下、無痕模式、沒登入 Google）就維持唯讀畫面，右上角照常有登入按鈕，不顯示錯誤
 */
const tryAutoLogin = async (): Promise<boolean> => {
  if (idToken.value || !readHint()) return false;
  try {
    await ensureInitialized();
  } catch {
    return false;
  }
  return refreshLogin();
};

/**
 * 顯示 Google 官方登入按鈕。dark 為 true 時用深色樣式（filled_black），淺色用 outline。
 * 切換主題時直接再呼叫一次：先清空容器再重新產生按鈕，不會重新初始化 GIS，也不影響登入狀態
 */
const renderSignInButton = async (el: HTMLElement, dark = false): Promise<void> => {
  await ensureInitialized();
  // 清空放在 await 之後：連續切換主題時，只留最後一次產生的按鈕
  el.replaceChildren();
  window.google?.accounts.id.renderButton(el, {
    theme: dark ? 'filled_black' : 'outline',
    size: 'medium',
    text: 'signin',
    shape: 'rectangular',
  });
};

/**
 * 登入失效（續期失敗、後端回 UNAUTHORIZED）：清掉 token 回到唯讀畫面，但保留自動登入，
 * 下次重新整理還能自動登入回來（不是使用者自己要登出）
 */
const clearLogin = (): void => {
  settleRefresh(false);
  idToken.value = null;
};

/** 使用者按「登出」：清掉 token，關掉自動登入（之後要自己點登入才會再登入），其他分頁也一起登出 */
const signOut = (): void => {
  clearLogin();
  writeHint(false);
  window.google?.accounts.id.disableAutoSelect();
  postToPeers({ type: 'signout' });
};

/**
 * 開始編輯前確認登入還有效：還沒過期直接通過；過期了先在背景續期，拿到新 token 就通過，
 * 拿不到才登出（clearLogin）並回傳 false。在開表單／對話框前先檢查，避免打完內容才在儲存時被退回。
 * 真正把關仍在後端
 */
const ensureFreshLogin = async (): Promise<boolean> => {
  if (!idToken.value) return false;
  if (!isTokenExpired(idToken.value)) return true;
  if (await refreshLogin()) return true;
  clearLogin();
  return false;
};

/**
 * 寫入資料時被後端以 UNAUTHORIZED 退回（例如 token 剛好過期）：先續期，拿到新 token 就用它重送一次。
 * 後端是先驗證登入才寫入，被退回的請求一定還沒寫進去，重送不會重複寫入。
 * 續期失敗或其他錯誤照原樣丟出，呼叫端照原本的方式處理（UNAUTHORIZED 就關畫面、clearLogin）
 */
const withLoginRetry = async <T>(token: string, run: (token: string) => Promise<T>): Promise<T> => {
  try {
    return await run(token);
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 'UNAUTHORIZED')) throw e;
    if (!(await refreshLogin()) || !idToken.value) throw e;
    return run(idToken.value);
  }
};

if (channel) {
  channel.onmessage = ({ data }: MessageEvent<AuthMessage>) => {
    if (data.type === 'request') {
      // 手上的還沒過期才給，讓對方不用呼叫 prompt()
      if (idToken.value && !isTokenExpired(idToken.value)) {
        postToPeers({ type: 'token', token: idToken.value, skewMs: clockSkewMs });
      }
    } else if (data.type === 'token') {
      adoptPeerToken(data.token, data.skewMs);
    } else {
      clearLogin();
    }
  };
}

export function useGoogleAuth() {
  return {
    idToken,
    userEmail,
    isLoggedIn,
    isAuthorized,
    renderSignInButton,
    tryAutoLogin,
    refreshLogin,
    clearLogin,
    signOut,
    ensureFreshLogin,
    withLoginRetry,
  };
}
