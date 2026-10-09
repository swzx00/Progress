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

const idToken = ref<string | null>(sessionStorage.getItem(TOKEN_STORAGE_KEY));

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
  sessionStorage.setItem(TOKEN_STORAGE_KEY, response.credential);
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
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  window.google?.accounts.id.disableAutoSelect();
};

export function useGoogleAuth() {
  return { idToken, userEmail, isLoggedIn, isAuthorized, renderSignInButton, signOut };
}
