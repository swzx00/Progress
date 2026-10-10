// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 響應式的「今天」：頁面開著跨過午夜時要跟著換（午夜觸發計時器、分頁切回來時立刻檢查）。
 * 狀態是模組層級的，每個案例 resetModules 後重新 import
 */
const load = async () => (await import('./useToday')).useToday;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 10, 23, 59, 30));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useToday', () => {
  it('跨過午夜就換成新的一天，隔天午夜再換一次', async () => {
    const today = (await load())();
    expect(today.value).toBe('2026-10-10');
    vi.advanceTimersByTime(29 * 1000);
    expect(today.value).toBe('2026-10-10');
    vi.advanceTimersByTime(2 * 1000);
    expect(today.value).toBe('2026-10-11');
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(today.value).toBe('2026-10-12');
  });

  it('分頁切回來時立刻更新', async () => {
    const today = (await load())();
    vi.setSystemTime(new Date(2026, 9, 11, 8, 0, 0));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(today.value).toBe('2026-10-11');
  });

  it('refreshToday：睡眠喚醒後計時器還沒觸發，按「回到今天」時立刻換成新的一天', async () => {
    const mod = await import('./useToday');
    const today = mod.useToday();
    vi.setSystemTime(new Date(2026, 9, 11, 8, 0, 0));
    expect(today.value).toBe('2026-10-10');
    mod.refreshToday();
    expect(today.value).toBe('2026-10-11');
  });

  it('每次呼叫都先對一次時間（測試或系統時間調整後不會沿用舊值）', async () => {
    const useToday = await load();
    useToday();
    vi.setSystemTime(new Date(2026, 9, 12, 9, 0, 0));
    expect(useToday().value).toBe('2026-10-12');
  });
});
