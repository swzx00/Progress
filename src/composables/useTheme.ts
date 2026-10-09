import { computed, ref } from 'vue';

import { isAfterSunset, nextSunEvent } from '@/utils/sun-times';

/**
 * 深色模式（使用者決定）：「工具 → 樣式」選 自動／淺色／深色，選擇用 localStorage 記住。
 * - 自動（預設）：依台北的日出日落時間切換，日落後到日出前是深色（src/utils/sun-times.ts）。
 *   用 setTimeout 排到下一次日出／日落再切換；分頁切回前景時也重算一次（背景分頁的計時器會被瀏覽器延後）
 * - 套用方式：<html data-theme="light|dark">，tokens.scss 在 [data-theme='dark'] 底下重新定義同一組色階；
 *   Naive UI 的主題由 App.vue 依 isDark 切換
 * - 模組層級共用狀態，main.ts 掛載前呼叫 initTheme()，第一個畫面就是正確的主題，不會先閃一下淺色
 */
export type ThemeMode = 'auto' | 'light' | 'dark';

export const THEME_MODES: { mode: ThemeMode; label: string }[] = [
  { mode: 'auto', label: '自動（依日出日落）' },
  { mode: 'light', label: '淺色' },
  { mode: 'dark', label: '深色' },
];

const STORAGE_KEY = 'theme-mode';

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

const isDark = computed(() => (mode.value === 'auto' ? sunDown.value : mode.value === 'dark'));

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
  if (mode.value !== 'auto') return;
  const delay = nextSunEvent(now).valueOf() - now.valueOf() + 1000;
  timer = setTimeout(refreshSun, delay);
};

const setMode = (next: ThemeMode): void => {
  mode.value = next;
  writeStoredMode(next);
  refreshSun();
};

let initialized = false;

export const initTheme = (): void => {
  if (initialized) return;
  initialized = true;
  mode.value = readStoredMode();
  refreshSun();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mode.value === 'auto') refreshSun();
  });
};

export function useTheme() {
  return { mode, isDark, setMode };
}
