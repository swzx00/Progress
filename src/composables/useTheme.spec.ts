// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSunTimes } from '@/utils/sun-times';

/**
 * 深色模式：自動依台北日出日落切換、淺色／深色固定、選擇記在 localStorage、讀寫失敗當作自動。
 * 時間用假的計時器控制（時區固定台灣）；狀態在模組層級，每個測試重新載入
 */
// 2026/06/21（夏至）台北日落約 18:47、隔天日出約 05:05
const DAY = new Date('2026-06-21T12:00:00');
const NIGHT = new Date('2026-06-21T22:00:00');

const theme = (): string | undefined => document.documentElement.dataset.theme;

const load = () => import('./useTheme');

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('自動（預設）', () => {
  it('白天淺色、晚上深色', async () => {
    vi.setSystemTime(DAY);
    const { initTheme, useTheme } = await load();
    initTheme();
    expect(useTheme().mode.value).toBe('auto');
    expect(useTheme().isDark.value).toBe(false);
    expect(theme()).toBe('light');

    vi.resetModules();
    vi.setSystemTime(NIGHT);
    const reloaded = await load();
    reloaded.initTheme();
    expect(reloaded.useTheme().isDark.value).toBe(true);
    expect(theme()).toBe('dark');
  });

  it('到日落時自動切成深色，到日出切回淺色', async () => {
    vi.setSystemTime(DAY);
    const { initTheme } = await load();
    initTheme();
    const { sunset } = getSunTimes(DAY);
    vi.advanceTimersByTime(sunset.valueOf() - DAY.valueOf() + 2000);
    expect(theme()).toBe('dark');

    const { sunrise } = getSunTimes(new Date('2026-06-22T12:00:00'));
    vi.advanceTimersByTime(sunrise.valueOf() - Date.now() + 2000);
    expect(theme()).toBe('light');
  });

  it('分頁切回前景時重新判斷（背景分頁的計時器會被延後）', async () => {
    vi.setSystemTime(DAY);
    const { initTheme } = await load();
    initTheme();
    vi.clearAllTimers();
    vi.setSystemTime(NIGHT);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(theme()).toBe('dark');
  });
});

describe('淺色／深色', () => {
  it('選了之後立即套用並記住，重新載入還是同一個', async () => {
    vi.setSystemTime(DAY);
    const { initTheme, useTheme } = await load();
    initTheme();
    useTheme().setMode('dark');
    expect(theme()).toBe('dark');
    expect(localStorage.getItem('theme-mode')).toBe('dark');

    vi.resetModules();
    const reloaded = await load();
    reloaded.initTheme();
    expect(reloaded.useTheme().mode.value).toBe('dark');
    expect(theme()).toBe('dark');
  });

  it('固定模式不受日落影響', async () => {
    vi.setSystemTime(DAY);
    const { initTheme, useTheme } = await load();
    initTheme();
    useTheme().setMode('light');
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    expect(theme()).toBe('light');
  });

  it('從固定改回自動，依現在時間決定', async () => {
    vi.setSystemTime(NIGHT);
    const { initTheme, useTheme } = await load();
    initTheme();
    useTheme().setMode('light');
    expect(theme()).toBe('light');
    useTheme().setMode('auto');
    expect(theme()).toBe('dark');
  });
});

describe('localStorage', () => {
  it('存的值不合法：當作自動', async () => {
    localStorage.setItem('theme-mode', 'purple');
    vi.setSystemTime(DAY);
    const { initTheme, useTheme } = await load();
    initTheme();
    expect(useTheme().mode.value).toBe('auto');
  });

  it('讀寫失敗（無痕、封鎖網站資料）：當作自動，切換照常有效', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.setSystemTime(DAY);
    const { initTheme, useTheme } = await load();
    expect(() => initTheme()).not.toThrow();
    expect(useTheme().mode.value).toBe('auto');
    expect(() => useTheme().setMode('dark')).not.toThrow();
    expect(theme()).toBe('dark');
  });
});
