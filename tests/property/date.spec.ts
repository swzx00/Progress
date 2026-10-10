import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { addDays, parseLocalDate, toLocalDateString } from '@/utils/date';

import { realDate } from './arbitraries';

/**
 * 日期字串（src/utils/date.ts）的隨機輸入測試：任意日期、任意天數都要成立的性質。
 * 測試時區固定台灣（vitest.global-setup.ts），跟使用者的環境一樣
 */
const DAY_MS = 24 * 60 * 60 * 1000;
/** 兩個 YYYY-MM-DD 差幾天（用 UTC 算，不受時區影響） */
const diffDays = (a: string, b: string): number => {
  const utc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(b) - utc(a)) / DAY_MS);
};

describe('toLocalDateString／parseLocalDate', () => {
  it('一天中任何時刻轉出來都是當天（本地時間），不會因為 UTC 差一天', () => {
    fc.assert(
      fc.property(realDate(), fc.integer({ min: 0, max: DAY_MS - 1 }), (date, ms) => {
        const moment = new Date(date.getTime() + ms);
        // 加上的毫秒數沒跨到隔天才比（realDate 從 1980 年開始，台灣之後沒有日光節約時間，一天固定 24 小時）
        fc.pre(moment.getDate() === date.getDate());
        expect(toLocalDateString(moment)).toBe(toLocalDateString(date));
      }),
    );
  });

  it('格式固定 YYYY-MM-DD，轉回來是當天本地午夜', () => {
    fc.assert(
      fc.property(realDate(), (date) => {
        const text = toLocalDateString(date);
        expect(text).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const parsed = parseLocalDate(text);
        expect(parsed.getTime()).toBe(date.getTime());
        expect([parsed.getHours(), parsed.getMinutes()]).toEqual([0, 0]);
      }),
    );
  });
});

describe('addDays', () => {
  it('結果剛好差 n 天（跨月、跨年、閏年都一樣）', () => {
    fc.assert(
      fc.property(realDate(), fc.integer({ min: -3000, max: 3000 }), (date, n) => {
        const from = toLocalDateString(date);
        expect(diffDays(from, addDays(from, n))).toBe(n);
      }),
    );
  });

  it('加 n 天再減 n 天回到原本那天；分兩次加等於一次加', () => {
    fc.assert(
      fc.property(
        realDate(),
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -500, max: 500 }),
        (date, a, b) => {
          const from = toLocalDateString(date);
          expect(addDays(addDays(from, a), -a)).toBe(from);
          expect(addDays(addDays(from, a), b)).toBe(addDays(from, a + b));
        },
      ),
    );
  });

  it('加 0 天不變，結果一定是存在的日期', () => {
    fc.assert(
      fc.property(realDate(), fc.integer({ min: -400, max: 400 }), (date, n) => {
        const from = toLocalDateString(date);
        expect(addDays(from, 0)).toBe(from);
        const result = addDays(from, n);
        expect(toLocalDateString(parseLocalDate(result))).toBe(result);
      }),
    );
  });
});
