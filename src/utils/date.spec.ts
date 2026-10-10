import { afterEach, describe, expect, it, vi } from 'vitest';

import { addDays, isValidDateString, parseLocalDate, toLocalDateString, todayString } from './date';

describe('測試環境', () => {
  it('時區固定在台灣（UTC+8）', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-480);
  });
});

describe('toLocalDateString', () => {
  it('用本地年月日、補零', () => {
    expect(toLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('台灣凌晨（UTC 還是前一天）不會少一天', () => {
    // 台灣 2026/10/10 00:30 = UTC 2026/10/09 16:30
    const d = new Date('2026-10-09T16:30:00Z');
    expect(d.toISOString().slice(0, 10)).toBe('2026-10-09');
    expect(toLocalDateString(d)).toBe('2026-10-10');
  });
});

describe('todayString', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('台灣凌晨 0:00–7:59 仍是當天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T16:00:00Z')); // 台灣 10/10 00:00
    expect(todayString()).toBe('2026-10-10');
    vi.setSystemTime(new Date('2026-10-09T23:59:00Z')); // 台灣 10/10 07:59
    expect(todayString()).toBe('2026-10-10');
  });

  it('台灣晚上 23:59 不會跳到隔天', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-10T15:59:00Z')); // 台灣 10/10 23:59
    expect(todayString()).toBe('2026-10-10');
  });
});

describe('parseLocalDate', () => {
  it('解析成本地午夜（不是 UTC 午夜）', () => {
    const d = parseLocalDate('2026-09-23');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 23, 0]);
  });

  it('跟 toLocalDateString 互轉後不變', () => {
    expect(toLocalDateString(parseLocalDate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('addDays', () => {
  it.each([
    ['2026-09-24', 1, '2026-09-25'],
    ['2026-09-30', 1, '2026-10-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2027-02-28', 1, '2027-03-01'],
    ['2026-10-10', 0, '2026-10-10'],
    ['2026-10-10', -10, '2026-09-30'],
  ])('%s 加 %i 天是 %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe('isValidDateString', () => {
  it.each(['2026-10-10', '2028-02-29', '2026-12-31', '2026-01-01'])('%s 是正確的日期', (v) => {
    expect(isValidDateString(v)).toBe(true);
  });

  it.each([
    '2026/10/10',
    '2026-1-1',
    '2026-02-30',
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-10-10T00:00',
    ' 2026-10-10',
    '',
  ])('%s 不是正確的日期', (v) => {
    expect(isValidDateString(v)).toBe(false);
  });
});
