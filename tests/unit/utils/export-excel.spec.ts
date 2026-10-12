import { describe, expect, it } from 'vitest';

import {
  EXPORT_MAX_DAYS,
  exportFileName,
  monthPeriod,
  periodDays,
  quarterPeriod,
  rangePeriod,
  yearPeriod,
} from '@/utils/export-excel';

describe('匯出範圍', () => {
  it('年份', () => {
    expect(yearPeriod(2026)).toEqual({ mode: 'year', from: '2026-01-01', to: '2026-12-31' });
  });

  it.each([
    [1, '2026-01-01', '2026-03-31'],
    [2, '2026-04-01', '2026-06-30'],
    [3, '2026-07-01', '2026-09-30'],
    [4, '2026-10-01', '2026-12-31'],
  ])('第 %i 季', (quarter, from, to) => {
    expect(quarterPeriod(2026, quarter)).toEqual({ mode: 'quarter', from, to });
  });

  it.each([
    [2026, 2, '2026-02-28'],
    [2028, 2, '2028-02-29'],
    [2026, 4, '2026-04-30'],
    [2026, 12, '2026-12-31'],
  ])('%i 年 %i 月最後一天是 %s', (year, month, to) => {
    expect(monthPeriod(year, month).to).toBe(to);
  });
});

describe('periodDays', () => {
  it('含頭尾', () => {
    expect(periodDays(rangePeriod('2026-10-09', '2026-10-09'))).toBe(1);
    expect(periodDays(rangePeriod('2026-10-01', '2026-10-15'))).toBe(15);
  });

  it('平年 365 天、閏年 366 天（剛好是上限）', () => {
    expect(periodDays(yearPeriod(2026))).toBe(365);
    expect(periodDays(yearPeriod(2028))).toBe(EXPORT_MAX_DAYS);
  });

  it('跨夏令時間不受影響（用 UTC 算）', () => {
    expect(periodDays(rangePeriod('2026-03-01', '2026-03-31'))).toBe(31);
  });
});

describe('exportFileName', () => {
  it.each([
    [yearPeriod(2026), '工作進度_2026.xlsx'],
    [quarterPeriod(2026, 4), '工作進度_2026Q4.xlsx'],
    [quarterPeriod(2026, 1), '工作進度_2026Q1.xlsx'],
    [monthPeriod(2026, 10), '工作進度_2026-10.xlsx'],
    [rangePeriod('2026-10-01', '2026-10-15'), '工作進度_2026-10-01_2026-10-15.xlsx'],
  ])('%o → %s', (period, name) => {
    expect(exportFileName(period)).toBe(name);
  });
});
