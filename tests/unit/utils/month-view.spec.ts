import { describe, expect, it } from 'vitest';

import {
  formatMonthDayLabel,
  isSameMonth,
  monthRange,
  shiftMonth,
  sortByDateAndIndex,
} from '@/utils/month-view';

describe('monthRange', () => {
  it('月初到月底（含大小月、閏年二月）', () => {
    expect(monthRange('2026-10-12')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2026-11-30')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(monthRange('2026-02-01')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02-15')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('isSameMonth', () => {
  it('年月相同才算同一個月', () => {
    expect(isSameMonth('2026-10-01', '2026-10-31')).toBe(true);
    expect(isSameMonth('2026-10-31', '2026-11-01')).toBe(false);
    expect(isSameMonth('2025-10-12', '2026-10-12')).toBe(false);
  });
});

describe('shiftMonth', () => {
  it('日保留，跨年會進位', () => {
    expect(shiftMonth('2026-10-12', 1)).toBe('2026-11-12');
    expect(shiftMonth('2026-12-05', 1)).toBe('2027-01-05');
    expect(shiftMonth('2026-01-05', -1)).toBe('2025-12-05');
  });

  it('目標月份沒有那一天時改成月底', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonth('2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftMonth('2026-10-31', 1)).toBe('2026-11-30');
  });
});

describe('formatMonthDayLabel', () => {
  it('月/日（星期）', () => {
    expect(formatMonthDayLabel('2026-10-12')).toBe('10/12（一）');
    expect(formatMonthDayLabel('2026-10-11')).toBe('10/11（日）');
    expect(formatMonthDayLabel('2026-01-03')).toBe('01/03（六）');
  });
});

describe('sortByDateAndIndex', () => {
  it('工作日期舊的在前，同一天照項次，不改原陣列', () => {
    const items = [
      { 工作日期: '2026-10-12', 項次: 2 },
      { 工作日期: '2026-10-01', 項次: 1 },
      { 工作日期: '2026-10-12', 項次: 1 },
    ];
    expect(sortByDateAndIndex(items)).toEqual([
      { 工作日期: '2026-10-01', 項次: 1 },
      { 工作日期: '2026-10-12', 項次: 1 },
      { 工作日期: '2026-10-12', 項次: 2 },
    ]);
    expect(items[0]).toEqual({ 工作日期: '2026-10-12', 項次: 2 });
  });
});
