import { computed, ref } from 'vue';

import { isAfterSunset, nextSunEvent } from '@/utils/sun-times';

/**
 * 深色模式（使用者決定）：「工具 → 樣式」選 自動／淺色／深色，選擇用 localStorage 記住。
 * - 自動（預設）：依台北的日出日落時間切換，日落後到日出前是深色（src/utils/sun-times.ts）。
 *   用 setTimeout 排到下一次日出／日落再切換；分頁切回前景時也重算一次（背景分頁的計時器會被瀏覽器延後）
 * - 套用方式：<html data-theme="light|dark">，tokens.scss 在 [data-theme='dark'] 底下重新定義同一組色階；
 *   Naive UI 的主題由 App.vue 依 isDark 切換
 * - 模組層級共用狀態，main.ts 掛載前呼叫 initTheme()，第一個畫面就是正確的主題，不會先閃一下淺色
 * - 「自動」只有登入（isAuthorized）才能用（使用者決定）：未登入時選單只有淺色、深色。記住的是「自動」時，
 *   未登入用「登出當下看到的顏色」（FALLBACK_KEY，晚上登出就維持深色、白天就維持淺色，之後不再跟著日出日落變）；
 *   從沒登入過的新訪客用淺色。記住的設定不改，登入後恢復「自動」。是否允許由 HomeView 呼叫 setAutoAllowed 設定；
 *   一開始先看「這個瀏覽器登入過」的標記（自動登入還沒完成前先照自動套用，晚上重新整理才不會先閃一下淺色）
 */
export type ThemeMode = 'auto' | 'light' | 'dark';

export const THEME_MODES: { mode: ThemeMode; label: string }[] = [
  { mode: 'auto', label: '自動（依日出日落）' },
  { mode: 'light', label: '淺色' },
  { mode: 'dark', label: '深色' },
];

const STORAGE_KEY = 'theme-mode';
/** 「自動」不能用時（未登入）實際套用的顏色：登出當下看到的顏色 */
const FALLBACK_KEY = 'theme-auto-fallback';

const readFallback = (): 'light' | 'dark' => {
  try {
    return localStorage.getItem(FALLBACK_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const writeFallback = (value: 'light' | 'dark'): void => {
  try {
    localStorage.setItem(FALLBACK_KEY, value);
  } catch {
    // 存不了就只在這次瀏覽有效
  }
};
/** useGoogleAuth 的「這個瀏覽器登入過、沒按登出」標記（不是憑證），只用來決定一開始要不要先照自動套用 */
const AUTO_LOGIN_HINT_KEY = 'progress:auto-login';

const readAutoLoginHint = (): boolean => {
  try {
    return localStorage.getItem(AUTO_LOGIN_HINT_KEY) === '1';
  } catch {
    return false;
  }
};

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === 'auto' || value === 'light' || value === 'dark';

// localStorage 在無痕視窗、封鎖網站資料時可能讀寫失敗，失敗就當作沒存過（自動）
const readStoredMode = (): ThemeMode => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isThemeMode(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
};

const writeStoredMode = (mode: ThemeMode): void => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // 存不了就只在這次瀏覽有效
  }
};

const mode = ref<ThemeMode>('auto');
// 「自動」模式下現在是不是天黑；每次日出／日落由計時器更新
const sunDown = ref(false);
// 能不能用「自動」：登入才可以（HomeView 依 isAuthorized 設定）
const autoAllowed = ref(false);
// 「自動」不能用時的顏色（登出當下看到的顏色）
const autoFallback = ref<'light' | 'dark'>('light');

/** 實際套用的模式：記住的是「自動」但現在不能用（未登入）時，用登出當下看到的顏色 */
const effectiveMode = computed<ThemeMode>(() =>
  mode.value === 'auto' && !autoAllowed.value ? autoFallback.value : mode.value,
);

const isDark = computed(() =>
  effectiveMode.value === 'auto' ? sunDown.value : effectiveMode.value === 'dark',
);

let timer: ReturnType<typeof setTimeout> | undefined;

const apply = (): void => {
  document.documentElement.dataset.theme = isDark.value ? 'dark' : 'light';
};

// 重算現在是否天黑，並排下一次日出／日落的切換（多等 1 秒，避免剛好卡在切換點前一刻）
const refreshSun = (): void => {
  clearTimeout(timer);
  const now = new Date();
  sunDown.value = isAfterSunset(now);
  apply();
  if (effectiveMode.value !== 'auto') return;
  const delay = nextSunEvent(now).valueOf() - now.valueOf() + 1000;
  timer = setTimeout(refreshSun, delay);
};

const setMode = (next: ThemeMode): void => {
  mode.value = next;
  writeStoredMode(next);
  refreshSun();
};

/** 登入狀態改變時呼叫：未登入不能用「自動」 */
const setAutoAllowed = (allowed: boolean): void => {
  if (autoAllowed.value === allowed) return;
  // 登出（含自動登入失敗）時正在用「自動」：記下當下看到的顏色，之後未登入就維持這個顏色
  if (!allowed && mode.value === 'auto') {
    // 先重算一次是否天黑（背景分頁的計時器可能被延後，sunDown 不一定是現在的狀態）
    if (autoAllowed.value) sunDown.value = isAfterSunset(new Date());
    autoFallback.value = isDark.value ? 'dark' : 'light';
    writeFallback(autoFallback.value);
  }
  autoAllowed.value = allowed;
  refreshSun();
};

let initialized = false;

export const initTheme = (): void => {
  if (initialized) return;
  initialized = true;
  mode.value = readStoredMode();
  autoAllowed.value = readAutoLoginHint();
  autoFallback.value = readFallback();
  refreshSun();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && effectiveMode.value === 'auto') refreshSun();
  });
};

export function useTheme() {
  return { mode, effectiveMode, autoAllowed, isDark, setMode, setAutoAllowed };
}
