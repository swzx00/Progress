import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  WORK_HOURS_DAILY_STANDARD,
  hoursToRange,
  parseTime,
  rangeToHours,
  roundToQuarter,
  validateWorkHoursSetting,
  workHoursTotal,
  type WorkHoursSetting,
} from '@/utils/work-hours';

import { loadCodeGs } from '../apps-script/load-code-gs';
import { timeString, toTime } from './arbitraries';

/**
 * 工時換算（src/utils/work-hours.ts）的隨機輸入測試：時段 ↔ 小時互換、四捨五入到 15 分鐘，
 * 以及工時設定驗證跟 Code.gs 的 validateWorkHours_ 在任意輸入下結果相同
 */
const gs = loadCodeGs();

/** 15 分鐘格線上的時間（分鐘數），範圍 [min, max] */
const quarter = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: Math.ceil(min / 15), max: Math.floor(max / 15) }).map((q) => q * 15);

/** 合法的工時設定：上班 < 午休開始 < 午休結束 < 下班，總時數不一定是 8 小時（換算本身不看這個） */
const validSetting = (): fc.Arbitrary<WorkHoursSetting> =>
  fc.tuple(quarter(0, 600), fc.boolean()).chain(([start, withBreak]) =>
    withBreak
      ? quarter(start + 15, 900).chain((breakStart) =>
          quarter(breakStart + 15, 960).chain((breakEnd) =>
            quarter(breakEnd + 15, 1425).map((end) => ({
              start: toTime(start),
              end: toTime(end),
              breakStart: toTime(breakStart),
              breakEnd: toTime(breakEnd),
            })),
          ),
        )
      : quarter(start + 15, 1425).map((end) => ({ start: toTime(start), end: toTime(end) })),
  );

/** 亂填的工時設定（包含格式不對、只填一邊的午休） */
const anySetting = (): fc.Arbitrary<WorkHoursSetting> =>
  fc.record(
    { start: timeString(), end: timeString(), breakStart: timeString(), breakEnd: timeString() },
    { requiredKeys: ['start', 'end'] },
  );

describe('roundToQuarter', () => {
  it('結果在 15 分鐘格線上、跟原本差不到 7.5 分鐘（最晚 23:45），再四捨五入一次不變', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1439 }), (minutes) => {
        const rounded = roundToQuarter(toTime(minutes));
        const value = parseTime(rounded)!;
        expect(value % 15).toBe(0);
        expect(value).toBeLessThanOrEqual(23 * 60 + 45);
        if (minutes <= 23 * 60 + 45) expect(Math.abs(value - minutes)).toBeLessThanOrEqual(7.5);
        expect(roundToQuarter(rounded)).toBe(rounded);
      }),
    );
  });

  it('格式不對原樣回傳', () => {
    fc.assert(
      fc.property(timeString(), (time) => {
        fc.pre(parseTime(time) === null);
        expect(roundToQuarter(time)).toBe(time);
      }),
    );
  });
});

describe('rangeToHours', () => {
  it('結束不晚於開始回 null；否則介於 0 到時段長度之間，是 0.25 的倍數', () => {
    fc.assert(
      fc.property(quarter(0, 1425), quarter(0, 1425), validSetting(), (from, to, setting) => {
        const hours = rangeToHours(toTime(from), toTime(to), setting);
        if (to <= from) {
          expect(hours).toBeNull();
          return;
        }
        expect(hours).not.toBeNull();
        expect(hours!).toBeGreaterThan(0);
        expect(hours!).toBeLessThanOrEqual((to - from) / 60);
        expect(Number.isInteger(hours! * 4)).toBe(true);
      }),
    );
  });

  it('上班到下班整段 = 設定的每日工時', () => {
    fc.assert(
      fc.property(validSetting(), (setting) => {
        expect(rangeToHours(setting.start, setting.end, setting)).toBe(workHoursTotal(setting));
      }),
    );
  });
});

describe('hoursToRange → rangeToHours', () => {
  it('反推出的時段換算回來等於原本的小時；開始不早於上班、不落在午休裡', () => {
    fc.assert(
      fc.property(
        validSetting(),
        fc.integer({ min: 0, max: 64 }).map((q) => q / 4),
        fc.integer({ min: 1, max: 64 }).map((q) => q / 4),
        (setting, offset, hours) => {
          const range = hoursToRange(offset, hours, setting);
          if (!range) return;
          expect(rangeToHours(range.start, range.end, setting)).toBe(hours);
          const start = parseTime(range.start)!;
          expect(start).toBeGreaterThanOrEqual(parseTime(setting.start)!);
          if (setting.breakStart) {
            const inBreak =
              start >= parseTime(setting.breakStart)! && start < parseTime(setting.breakEnd)!;
            expect(inBreak).toBe(false);
          }
        },
      ),
    );
  });

  it('只有結束超過 24:00 才回 null', () => {
    fc.assert(
      fc.property(
        validSetting(),
        fc.integer({ min: 0, max: 32 }).map((q) => q / 4),
        fc.integer({ min: 1, max: 32 }).map((q) => q / 4),
        (setting, offset, hours) => {
          const range = hoursToRange(offset, hours, setting);
          const lunch = setting.breakStart
            ? parseTime(setting.breakEnd)! - parseTime(setting.breakStart)!
            : 0;
          // 不管有沒有跨過午休，結束時間最晚是上班＋時數＋午休
          const latestEnd = parseTime(setting.start)! + (offset + hours) * 60 + lunch;
          if (latestEnd < 24 * 60) expect(range).not.toBeNull();
        },
      ),
    );
  });
});

describe('工時設定驗證：validateWorkHoursSetting ↔ validateWorkHours_', () => {
  it('任意輸入結果相同', () => {
    fc.assert(
      fc.property(fc.oneof(anySetting(), validSetting()), (setting) => {
        expect(gs.validateWorkHours_(setting)).toBe(validateWorkHoursSetting(setting));
      }),
      { numRuns: 1000 },
    );
  });

  it(`合法的順序、剛好 ${WORK_HOURS_DAILY_STANDARD} 小時才通過`, () => {
    fc.assert(
      fc.property(validSetting(), (setting) => {
        const ok = validateWorkHoursSetting(setting) === null;
        expect(ok).toBe(workHoursTotal(setting) === WORK_HOURS_DAILY_STANDARD);
      }),
    );
  });
});
