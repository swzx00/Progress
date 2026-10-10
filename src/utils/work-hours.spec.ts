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
} from './work-hours';

// CLAUDE.md「工時設定」範例用的設定
const SETTING: WorkHoursSetting = {
  start: '08:30',
  end: '18:00',
  breakStart: '12:00',
  breakEnd: '13:30',
};
const NO_BREAK: WorkHoursSetting = { start: '09:00', end: '17:00' };

describe('parseTime', () => {
  it('HH:mm 轉成分鐘', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('08:30')).toBe(510);
    expect(parseTime('23:59')).toBe(1439);
  });

  it.each(['', undefined, '8:30', '24:00', '12:60', 'abc'])('格式不對（%s）回 null', (value) => {
    expect(parseTime(value)).toBeNull();
  });
});

describe('roundToQuarter', () => {
  it.each([
    ['08:07', '08:00'],
    ['08:08', '08:15'],
    ['08:52', '08:45'],
    ['08:53', '09:00'],
    ['10:15', '10:15'],
    ['23:50', '23:45'],
    ['23:59', '23:45'],
  ])('%s → %s', (time, expected) => {
    expect(roundToQuarter(time)).toBe(expected);
  });

  it('空白或格式不對原樣回傳', () => {
    expect(roundToQuarter('')).toBe('');
    expect(roundToQuarter('abc')).toBe('abc');
  });
});

describe('rangeToHours', () => {
  // CLAUDE.md 列的範例（08:30–18:00、午休 12:00–13:30）
  it.each([
    ['11:00', '14:00', 1.5, '跨過整段午休，扣掉 1.5 小時'],
    ['12:15', '13:00', 0.75, '整段在午休內，照算'],
    ['11:00', '13:00', 2, '結束落在午休內，不扣'],
    ['12:00', '14:00', 2, '開始剛好等於午休開始，不扣'],
    ['11:00', '13:30', 2.5, '結束剛好等於午休結束，不扣'],
    ['07:00', '08:30', 1.5, '上班時間前照算'],
    ['17:00', '20:00', 3, '下班時間後照算'],
  ])('%s–%s 得 %d（%s）', (start, end, hours) => {
    expect(rangeToHours(start, end, SETTING)).toBe(hours);
  });

  it('沒填午休不扣', () => {
    expect(rangeToHours('11:00', '14:00', NO_BREAK)).toBe(3);
  });

  it('只填一邊午休當作沒有午休', () => {
    expect(rangeToHours('11:00', '14:00', { ...NO_BREAK, breakStart: '12:00' })).toBe(3);
  });

  it('結束早於或等於開始回 null（不支援跨午夜）', () => {
    expect(rangeToHours('14:00', '11:00', SETTING)).toBeNull();
    expect(rangeToHours('14:00', '14:00', SETTING)).toBeNull();
    expect(rangeToHours('22:00', '02:00', SETTING)).toBeNull();
  });

  it('格式不對回 null', () => {
    expect(rangeToHours('', '14:00', SETTING)).toBeNull();
    expect(rangeToHours('11:00', '25:00', SETTING)).toBeNull();
  });
});

describe('hoursToRange', () => {
  it('第一筆從上班時間開始', () => {
    expect(hoursToRange(0, 2, SETTING)).toEqual({ start: '08:30', end: '10:30' });
  });

  it('剛好累計到午休開始時，結束時間顯示午休開始', () => {
    expect(hoursToRange(2.5, 1, SETTING)).toEqual({ start: '11:00', end: '12:00' });
  });

  it('開始剛好落在午休開始，移到午休結束', () => {
    expect(hoursToRange(3.5, 1, SETTING)).toEqual({ start: '13:30', end: '14:30' });
  });

  it('跨過午休時跳過午休（CLAUDE.md 範例：11:00 起 1.25 小時 → 11:00–13:45）', () => {
    expect(hoursToRange(2.5, 1.25, SETTING)).toEqual({ start: '11:00', end: '13:45' });
  });

  it('累計超過下班時間直接往後延', () => {
    expect(hoursToRange(8, 1, SETTING)).toEqual({ start: '18:00', end: '19:00' });
  });

  it('沒填午休就連續累計', () => {
    expect(hoursToRange(3, 2, NO_BREAK)).toEqual({ start: '12:00', end: '14:00' });
  });

  it('工時 0 不顯示時段', () => {
    expect(hoursToRange(0, 0, SETTING)).toBeNull();
  });

  it('結束到 24:00 以後不顯示時段', () => {
    expect(hoursToRange(12.5, 1, SETTING)).toEqual({ start: '22:30', end: '23:30' });
    expect(hoursToRange(0, 14, SETTING)).toBeNull(); // 08:30 起 14 小時（跳過午休）剛好到 24:00
  });

  it('上班時間沒設定、時數不合法回 null', () => {
    expect(hoursToRange(0, 1, { start: '', end: '' })).toBeNull();
    expect(hoursToRange(-1, 1, SETTING)).toBeNull();
    expect(hoursToRange(0, Number.NaN, SETTING)).toBeNull();
  });

  // 反推出的時段換算回小時一定等於原本小時
  it.each([
    [0, 0.25],
    [0, 3.5],
    [0, 8],
    [1.75, 2],
    [2.5, 1.25],
    [3.5, 0.5],
    [4, 4],
    [7.5, 2.75],
  ])('起點 %d 小時、%d 小時：換算回來相同', (offset, hours) => {
    const range = hoursToRange(offset, hours, SETTING);
    expect(range).not.toBeNull();
    expect(rangeToHours(range!.start, range!.end, SETTING)).toBe(hours);
  });
});

describe('workHoursTotal', () => {
  it('下班 − 上班 − 午休', () => {
    expect(workHoursTotal(SETTING)).toBe(8);
  });

  it('沒填午休就是下班 − 上班', () => {
    expect(workHoursTotal(NO_BREAK)).toBe(8);
  });

  it('上下班沒填或順序不對回 null', () => {
    expect(workHoursTotal({ start: '', end: '18:00' })).toBeNull();
    expect(workHoursTotal({ start: '18:00', end: '09:00' })).toBeNull();
  });
});

describe('validateWorkHoursSetting', () => {
  it('每日工時標準是 8 小時', () => {
    expect(WORK_HOURS_DAILY_STANDARD).toBe(8);
  });

  it('合法設定回 null', () => {
    expect(validateWorkHoursSetting(SETTING)).toBeNull();
    expect(validateWorkHoursSetting(NO_BREAK)).toBeNull();
  });

  it.each<[string, WorkHoursSetting, string]>([
    ['上班必填', { start: '', end: '18:00' }, '請填寫上班時間'],
    ['下班必填', { start: '09:00', end: '' }, '請填寫下班時間'],
    ['上班格式', { start: '9:00', end: '17:00' }, '上班時間格式不正確'],
    ['下班格式', { start: '09:00', end: '17:60' }, '下班時間格式不正確'],
    ['午休只填一邊', { ...SETTING, breakEnd: undefined }, '午休時間需填寫開始與結束'],
    ['午休格式', { ...SETTING, breakStart: '12' }, '午休時間格式不正確'],
    [
      '午休在上班前',
      { ...SETTING, breakStart: '08:00', breakEnd: '09:00' },
      '時間順序需為：上班時間 → 午休開始 → 午休結束 → 下班時間',
    ],
    [
      '午休開始晚於結束',
      { ...SETTING, breakStart: '13:30', breakEnd: '12:00' },
      '時間順序需為：上班時間 → 午休開始 → 午休結束 → 下班時間',
    ],
    ['沒午休、下班早於上班', { start: '17:00', end: '09:00' }, '下班時間需晚於上班時間'],
    ['工時不是 8 小時', { start: '09:00', end: '18:00' }, '每日工時需剛好 8 小時（目前 9 小時）'],
    ['扣午休後不是 8 小時', { ...SETTING, end: '17:30' }, '每日工時需剛好 8 小時（目前 7.5 小時）'],
  ])('%s', (_, setting, message) => {
    expect(validateWorkHoursSetting(setting)).toBe(message);
  });
});
