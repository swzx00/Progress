import { describe, expect, it } from 'vitest';

import {
  DAILY_HOURS_MAX,
  DAILY_HOURS_WARN,
  LEAVE_FIXED_VALUES,
  LEAVE_TYPES,
  dailyHoursMessage,
  dateInputRange,
  validateLeave,
  validateWorkItem,
  type WorkItemFormValues,
} from '@/validation/work-item';

/** 一筆全部欄位都合法的工作紀錄表單值 */
const valid = (overrides: Partial<WorkItemFormValues> = {}): WorkItemFormValues => ({
  工作日期: '2026-10-09',
  交辦單位: '資訊部',
  交辦人員: '王小明',
  專案名稱: '官網改版',
  專案Repo: [],
  工作目標: '首頁改版',
  處理內容: '',
  今日工時: 0,
  完成度: 0,
  預計期限: '',
  狀態: '待辦',
  ...overrides,
});

/** 一筆合法的請假表單值（請假只驗證工作日期、假別、請假時數、備註） */
const validLeave = (overrides: Partial<WorkItemFormValues> = {}): WorkItemFormValues =>
  valid({ ...LEAVE_FIXED_VALUES, 狀態: '休假', 工作目標: '特休', 今日工時: 8, ...overrides });

describe('validateWorkItem', () => {
  it('合法的紀錄沒有錯誤', () => {
    expect(validateWorkItem(valid())).toEqual({});
  });

  it('選填欄位都留空也合法（處理內容、預計期限、Repo、工時與完成度清空）', () => {
    expect(
      validateWorkItem(
        valid({ 處理內容: '', 預計期限: '', 專案Repo: [], 今日工時: '', 完成度: '' }),
      ),
    ).toEqual({});
  });

  describe('必填', () => {
    it.each<[keyof WorkItemFormValues, string]>([
      ['工作日期', '請選擇工作日期'],
      ['交辦單位', '請選擇交辦單位'],
      ['交辦人員', '請選擇交辦人員'],
      ['專案名稱', '請選擇專案名稱'],
      ['工作目標', '請填寫工作目標'],
      ['狀態', '請選擇狀態'],
    ])('%s', (field, message) => {
      expect(validateWorkItem(valid({ [field]: '' }))).toEqual({ [field]: message });
    });

    it('只有空白也算沒填', () => {
      expect(validateWorkItem(valid({ 工作目標: '   ' }))).toEqual({ 工作目標: '請填寫工作目標' });
    });

    it('一次回傳所有欄位的錯誤', () => {
      expect(Object.keys(validateWorkItem(valid({ 交辦單位: '', 工作目標: '' })))).toEqual([
        '交辦單位',
        '工作目標',
      ]);
    });
  });

  describe('字數上限（去前後空白後計算）', () => {
    it.each<[keyof WorkItemFormValues, number]>([
      ['交辦單位', 50],
      ['交辦人員', 50],
      ['專案名稱', 50],
      ['工作目標', 500],
      ['處理內容', 2000],
    ])('%s 上限 %i 字', (field, max) => {
      expect(validateWorkItem(valid({ [field]: 'a'.repeat(max) }))).toEqual({});
      expect(validateWorkItem(valid({ [field]: ` ${'a'.repeat(max)} ` }))).toEqual({});
      expect(validateWorkItem(valid({ [field]: 'a'.repeat(max + 1) }))[field]).toMatch(
        `不可超過 ${max} 字`,
      );
    });
  });

  describe('專案 Repo', () => {
    it('最多 10 個', () => {
      const repos = Array.from({ length: 10 }, (_, i) => `r${i}`);
      expect(validateWorkItem(valid({ 專案Repo: repos }))).toEqual({});
      expect(validateWorkItem(valid({ 專案Repo: [...repos, 'r10'] }))).toEqual({
        專案Repo: '專案 Repo 最多 10 個',
      });
    });

    it('空白的值不算數', () => {
      const repos = [...Array.from({ length: 10 }, (_, i) => `r${i}`), ' ', ''];
      expect(validateWorkItem(valid({ 專案Repo: repos }))).toEqual({});
    });

    it('每個上限 50 字', () => {
      expect(validateWorkItem(valid({ 專案Repo: ['a'.repeat(51)] }))).toEqual({
        專案Repo: '每個專案 Repo 不可超過 50 字',
      });
    });

    it('不可含逗號（Sheet 用逗號串成一格存）', () => {
      expect(validateWorkItem(valid({ 專案Repo: ['AAA,BBB'] }))).toEqual({
        專案Repo: '專案 Repo 不可包含「,」',
      });
    });
  });

  describe('今日工時（0–24、0.25 為單位）', () => {
    it.each([0, 0.25, 7.75, 24])('%d 合法', (hours) => {
      expect(validateWorkItem(valid({ 今日工時: hours }))).toEqual({});
    });

    it.each([
      [-0.25, '今日工時需介於 0–24'],
      [24.25, '今日工時需介於 0–24'],
      [0.1, '今日工時需為 0.25 的倍數'],
      [1.3, '今日工時需為 0.25 的倍數'],
      [Number.NaN, '今日工時需為數字'],
    ])('%d：%s', (hours, message) => {
      expect(validateWorkItem(valid({ 今日工時: hours }))).toEqual({ 今日工時: message });
    });
  });

  describe('完成度（0–100、0.25 為單位，可以是小數）', () => {
    it.each([0, 12.25, 12.5, 70, 99.75, 100])('%d 合法', (value) => {
      expect(validateWorkItem(valid({ 完成度: value }))).toEqual({});
    });

    it.each([
      [-1, '完成度需介於 0–100'],
      [100.25, '完成度需介於 0–100'],
      [12.3, '完成度需為 0.25 的倍數'],
    ])('%d：%s', (value, message) => {
      expect(validateWorkItem(valid({ 完成度: value }))).toEqual({ 完成度: message });
    });
  });

  describe('日期', () => {
    it.each(['2020-01-01', '2099-12-31'])('年份邊界 %s 合法', (date) => {
      expect(validateWorkItem(valid({ 工作日期: date, 預計期限: date }))).toEqual({});
    });

    it('年份超出 2020–2099', () => {
      expect(validateWorkItem(valid({ 工作日期: '2019-12-31', 預計期限: '2100-01-01' }))).toEqual({
        工作日期: '工作日期的年份需介於 2020–2099',
        預計期限: '預計期限的年份需介於 2020–2099',
      });
    });

    it.each([
      '2026-02-30',
      '2026-04-31',
      '2026-06-31',
      '2026-09-31',
      '2026-11-31',
      '2027-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-10-00',
      '2026-10-32',
    ])('不存在的日期 %s 算格式不正確', (date) => {
      expect(validateWorkItem(valid({ 工作日期: date, 預計期限: date }))).toEqual({
        工作日期: '工作日期格式不正確',
        預計期限: '預計期限格式不正確',
      });
    });

    it.each(['2028-02-29', '2026-02-28', '2026-04-30', '2026-12-31'])(
      '存在的日期 %s 合法',
      (date) => {
        expect(validateWorkItem(valid({ 工作日期: date, 預計期限: date }))).toEqual({});
      },
    );

    it('格式要是 YYYY-MM-DD（API 的 YYYY/MM/DD 不行）', () => {
      expect(validateWorkItem(valid({ 工作日期: '2026/10/09' }))).toEqual({
        工作日期: '工作日期格式不正確',
      });
    });
  });

  describe('狀態', () => {
    it.each(['進行中', '前端完成', '返修', '待辦', '確認上線', '暫緩'])('%s 合法', (status) => {
      expect(validateWorkItem(valid({ 狀態: status }))).toEqual({});
    });

    it('「休假」不能用在一般工作紀錄', () => {
      expect(validateWorkItem(valid({ 狀態: '休假' }))).toEqual({ 狀態: '請選擇狀態' });
    });

    it('清單外的值不行', () => {
      expect(validateWorkItem(valid({ 狀態: '完成' }))).toEqual({ 狀態: '請選擇狀態' });
    });
  });
});

describe('validateLeave', () => {
  it('合法的請假沒有錯誤', () => {
    expect(validateLeave(validLeave())).toEqual({});
  });

  it('只驗證請假用到的欄位（交辦單位等固定值不檢查）', () => {
    expect(validateLeave(validLeave({ 交辦單位: '', 狀態: '' }))).toEqual({});
  });

  it.each(LEAVE_TYPES)('假別「%s」合法', (type) => {
    expect(validateLeave(validLeave({ 工作目標: type }))).toEqual({});
  });

  it('假別要在選項內', () => {
    expect(validateLeave(validLeave({ 工作目標: '' }))).toEqual({ 工作目標: '請選擇假別' });
    expect(validateLeave(validLeave({ 工作目標: '公假' }))).toEqual({ 工作目標: '請選擇假別' });
  });

  it('請假時數必填、0.25–8', () => {
    expect(validateLeave(validLeave({ 今日工時: '' }))).toEqual({ 今日工時: '請填寫請假時數' });
    expect(validateLeave(validLeave({ 今日工時: 0 }))).toEqual({
      今日工時: '請假時數需介於 0.25–8',
    });
    expect(validateLeave(validLeave({ 今日工時: 8.25 }))).toEqual({
      今日工時: '請假時數需介於 0.25–8',
    });
    expect(validateLeave(validLeave({ 今日工時: 0.25 }))).toEqual({});
  });

  it('請假日期必填、錯誤訊息用「請假日期」', () => {
    expect(validateLeave(validLeave({ 工作日期: '' }))).toEqual({ 工作日期: '請選擇請假日期' });
  });

  it('請假日期不存在算格式不正確', () => {
    expect(validateLeave(validLeave({ 工作日期: '2026-04-31' }))).toEqual({
      工作日期: '請假日期格式不正確',
    });
  });

  it('備註上限 2000 字', () => {
    expect(validateLeave(validLeave({ 處理內容: 'a'.repeat(2001) }))).toEqual({
      處理內容: '備註不可超過 2000 字',
    });
  });
});

describe('每日工時合計', () => {
  it('超過 8 小時紅字、超過 24 小時不能存', () => {
    expect(DAILY_HOURS_WARN).toBe(8);
    expect(DAILY_HOURS_MAX).toBe(24);
  });

  it('錯誤訊息格式', () => {
    expect(dailyHoursMessage(20, 6)).toBe(
      '當天工時合計不可超過 24 小時（其他紀錄已 20 小時，已超出2小時）',
    );
  });

  it('四捨五入到小數兩位，避免浮點誤差', () => {
    expect(dailyHoursMessage(0.1 + 0.2 + 23.6, 0.25)).toBe(
      '當天工時合計不可超過 24 小時（其他紀錄已 23.9 小時，已超出0.15小時）',
    );
  });
});

describe('dateInputRange', () => {
  it('日期選擇器可選的範圍', () => {
    expect(dateInputRange('工作日期')).toEqual({ min: '2020-01-01', max: '2099-12-31' });
    expect(dateInputRange('預計期限')).toEqual({ min: '2020-01-01', max: '2099-12-31' });
  });
});

describe('請假固定值', () => {
  it('跟 CLAUDE.md 一致', () => {
    expect(LEAVE_FIXED_VALUES).toEqual({
      交辦單位: '人事室',
      交辦人員: '--',
      專案名稱: '休假',
      專案Repo: [],
      預計期限: '',
      完成度: 100,
    });
  });
});
