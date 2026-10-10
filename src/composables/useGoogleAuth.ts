import { computed, ref } from 'vue';

const ALLOWED_EMAILS = ['swzx00@gmail.com'];

const TOKEN_STORAGE_KEY = 'google_id_token';

interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

/**
 * sessionStorage 在瀏覽器封鎖網站資料時存取會丟 SecurityError，模組載入時丟錯會讓整個 App 白畫面，
 * 所以讀寫都包 try/catch：讀不到就當作沒登入，寫不進去只是重新整理後要重新登入
 */
const readStoredToken = (): string | null => {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStoredToken = (token: string | null): void => {
  try {
    if (token === null) sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    else sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // 存不進去不影響這次登入
  }
};

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

/** ID Token 是否已過期（看 JWT 的 exp，單位秒）；解不開或沒有 exp 時交給後端判斷，不當作過期 */
const isTokenExpired = (token: string): boolean => {
  try {
    const { exp } = decodeJwtPayload(token);
    return typeof exp === 'number' && exp * 1000 - EXPIRY_MARGIN_MS <= Date.now();
  } catch {
    return false;
  }
};

const initialToken = readStoredToken();
// 重新整理時 sessionStorage 裡的 token 已經過期（約一小時），直接當作沒登入，不顯示管理功能
const idToken = ref<string | null>(
  initialToken && !isTokenExpired(initialToken) ? initialToken : null,
);
if (initialToken && !idToken.value) writeStoredToken(null);

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

const handleCredential = (response: GoogleCredentialResponse): void => {
  idToken.value = response.credential;
  writeStoredToken(response.credential);
};

let initialized = false;

const ensureInitialized = async (): Promise<void> => {
  await loadGisScript();
  if (initialized) return;
  window.google?.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: handleCredential,
  });
  initialized = true;
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

const signOut = (): void => {
  idToken.value = null;
  writeStoredToken(null);
  window.google?.accounts.id.disableAutoSelect();
};

/**
 * 開始編輯前確認登入還有效：token 過期就登出並回傳 false。
 * 分頁開著超過一小時，token 會過期但畫面還是管理模式；在開表單／對話框前先擋下，
 * 避免使用者打完一大段內容按儲存才被後端退回、表單關閉。真正把關仍在後端
 */
const ensureFreshLogin = (): boolean => {
  if (!idToken.value) return false;
  if (!isTokenExpired(idToken.value)) return true;
  signOut();
  return false;
};

export function useGoogleAuth() {
  return {
    idToken,
    userEmail,
    isLoggedIn,
    isAuthorized,
    renderSignInButton,
    signOut,
    ensureFreshLogin,
  };
}
