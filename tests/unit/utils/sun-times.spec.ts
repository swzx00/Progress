import { describe, expect, it } from 'vitest';

import { getSunTimes, isAfterSunset, nextSunEvent } from '@/utils/sun-times';

/** 台灣時間 HH:mm（測試環境時區固定台灣） */
const hhmm = (d: Date): string =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** 跟預期時間差幾分鐘 */
const diffMinutes = (d: Date, expected: string): number => {
  const [h, m] = expected.split(':').map(Number) as [number, number];
  return Math.abs(d.getHours() * 60 + d.getMinutes() - (h * 60 + m));
};

// 參考值：中央氣象署台北日出日落，只做大致檢查（±5 分鐘）
describe('getSunTimes（台北）', () => {
  it.each([
    ['夏至', new Date(2026, 5, 21, 12), '05:04', '18:47'],
    ['冬至', new Date(2026, 11, 22, 12), '06:34', '17:09'],
  ])('%s', (_, date, sunrise, sunset) => {
    const times = getSunTimes(date);
    expect(diffMinutes(times.sunrise, sunrise), hhmm(times.sunrise)).toBeLessThanOrEqual(5);
    expect(diffMinutes(times.sunset, sunset), hhmm(times.sunset)).toBeLessThanOrEqual(5);
  });

  it('台灣凌晨（UTC 還是前一天）也對到台灣當天', () => {
    const times = getSunTimes(new Date(2026, 9, 10, 0, 30));
    expect(times.sunrise.getDate()).toBe(10);
    expect(times.sunset.getDate()).toBe(10);
  });
});

describe('isAfterSunset', () => {
  it('中午是白天、晚上和凌晨是天黑', () => {
    expect(isAfterSunset(new Date(2026, 9, 10, 12))).toBe(false);
    expect(isAfterSunset(new Date(2026, 9, 10, 21))).toBe(true);
    expect(isAfterSunset(new Date(2026, 9, 10, 3))).toBe(true);
  });
});

describe('nextSunEvent', () => {
  it('凌晨 → 當天日出；中午 → 當天日落；晚上 → 隔天日出', () => {
    const dawn = nextSunEvent(new Date(2026, 9, 10, 3));
    const noon = nextSunEvent(new Date(2026, 9, 10, 12));
    const night = nextSunEvent(new Date(2026, 9, 10, 21));
    expect([dawn.getDate(), dawn.getHours()]).toEqual([10, 5]);
    expect([noon.getDate(), noon.getHours()]).toEqual([10, 17]);
    expect([night.getDate(), night.getHours()]).toEqual([11, 5]);
  });
});
