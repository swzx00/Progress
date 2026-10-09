import { describe, expect, it } from 'vitest';

import schema from '../../shared/validation-schema.json';

import { STATUS_OPTIONS } from '@/types/work-item';
import { RECENT_DAYS } from '@/utils/recent-history';
import { EXPORT_MAX_DAYS } from '@/utils/export-excel';
import {
  SEARCH_FIELDS,
  SEARCH_KEYWORD_MAX,
  SEARCH_MAX_RESULTS,
  matchesSearch,
  type SearchQuery,
} from '@/utils/search-work-items';
import {
  WORK_HOURS_DAILY_STANDARD,
  validateWorkHoursSetting,
  type WorkHoursSetting,
} from '@/utils/work-hours';
import {
  DAILY_HOURS_MAX,
  dailyHoursMessage,
  validateLeave,
  validateWorkItem,
  type WorkItemFormValues,
} from '@/validation/work-item';

import { loadCodeGs } from './load-code-gs';

/**
 * 前後端一致性：Code.gs 有幾套規則是手動從前端同步過去的（CLAUDE.md 標「手動同步」的地方），
 * 這裡用同一組案例同時跑前端與 Code.gs 的版本，結果不同就代表有一邊忘了改
 */
const gs = loadCodeGs();

// 前端內部日期是 YYYY-MM-DD，送到後端前轉成 YYYY/MM/DD（useWorkItems.ts 的 toApiItem）
const toApi = (values: WorkItemFormValues): Record<string, unknown> => ({
  ...values,
  工作日期: values.工作日期.replaceAll('-', '/'),
  預計期限: values.預計期限.replaceAll('-', '/'),
});

const base: WorkItemFormValues = {
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
};

const leaveBase: WorkItemFormValues = {
  ...base,
  ...schema.leave.fixed,
  狀態: '休假',
  工作目標: '特休',
  今日工時: 8,
};

describe('常數與規則表', () => {
  it('欄位驗證規則（VALIDATION_RULES）跟 shared/validation-schema.json 一致', () => {
    expect(gs.VALIDATION_RULES).toEqual(schema.fields);
  });

  it('請假規則（LEAVE_RULES）跟 schema 的 leave 一致', () => {
    expect({ $comment: schema.leave.$comment, ...gs.LEAVE_RULES }).toEqual(schema.leave);
  });

  it('狀態選項', () => {
    expect(gs.STATUS_OPTIONS).toEqual([...STATUS_OPTIONS]);
  });

  it('每日工時上限、工時設定標準', () => {
    expect(gs.DAILY_HOURS_MAX).toBe(DAILY_HOURS_MAX);
    expect(gs.WORK_HOURS_DAILY_STANDARD).toBe(WORK_HOURS_DAILY_STANDARD);
  });

  it('近期紀錄天數、匯出天數上限', () => {
    expect(gs.RECENT_DAYS).toBe(RECENT_DAYS);
    expect(gs.RANGE_MAX_DAYS).toBe(EXPORT_MAX_DAYS);
  });

  it('搜尋欄位、關鍵字上限、結果上限', () => {
    expect(gs.SEARCH_FIELDS).toEqual([...SEARCH_FIELDS]);
    expect(gs.SEARCH_KEYWORD_MAX).toBe(SEARCH_KEYWORD_MAX);
    expect(gs.SEARCH_MAX_RESULTS).toBe(SEARCH_MAX_RESULTS);
  });
});

describe('工作紀錄驗證：validateWorkItem ↔ validateItem_', () => {
  const cases: [string, Partial<WorkItemFormValues>][] = [
    ['全部合法', {}],
    ['選填都留空', { 處理內容: '', 預計期限: '', 專案Repo: [], 今日工時: '', 完成度: '' }],
    [
      '必填全空',
      { 工作日期: '', 交辦單位: '', 交辦人員: '', 專案名稱: '', 工作目標: '', 狀態: '' },
    ],
    ['只有空白', { 交辦單位: '  ', 工作目標: '\n' }],
    [
      '字數剛好上限',
      { 交辦單位: 'a'.repeat(50), 工作目標: 'a'.repeat(500), 處理內容: 'a'.repeat(2000) },
    ],
    [
      '字數超過',
      { 交辦人員: 'a'.repeat(51), 工作目標: 'a'.repeat(501), 處理內容: 'a'.repeat(2001) },
    ],
    ['Repo 11 個', { 專案Repo: Array.from({ length: 11 }, (_, i) => `r${i}`) }],
    ['Repo 太長', { 專案Repo: ['a'.repeat(51)] }],
    ['Repo 含逗號', { 專案Repo: ['AAA,BBB'] }],
    ['工時邊界', { 今日工時: 24, 完成度: 100 }],
    ['工時超過', { 今日工時: 24.25 }],
    ['工時負數', { 今日工時: -0.25 }],
    ['工時非 0.25 倍數', { 今日工時: 1.3 }],
    ['工時 NaN', { 今日工時: Number.NaN }],
    ['完成度小數', { 完成度: 12.25 }],
    ['完成度非 0.25 倍數', { 完成度: 12.3 }],
    ['完成度超過', { 完成度: 101 }],
    ['日期年份邊界', { 工作日期: '2020-01-01', 預計期限: '2099-12-31' }],
    ['日期年份超出', { 工作日期: '2019-12-31', 預計期限: '2100-01-01' }],
    ['日期格式錯', { 工作日期: '2026-1-9' }],
    ['狀態清單外', { 狀態: '完成' }],
  ];

  it.each(cases)('%s', (_, overrides) => {
    const values = { ...base, ...overrides };
    expect([...gs.validateItem_(toApi(values))]).toEqual(Object.values(validateWorkItem(values)));
  });
});

describe('請假驗證：validateLeave ↔ validateItem_（狀態＝休假）', () => {
  const cases: [string, Partial<WorkItemFormValues>][] = [
    ['全部合法', {}],
    ['假別空白', { 工作目標: '' }],
    ['假別清單外', { 工作目標: '公假' }],
    ['請假時數空白', { 今日工時: '' }],
    ['請假時數 0', { 今日工時: 0 }],
    ['請假時數 0.25', { 今日工時: 0.25 }],
    ['請假時數 8.25', { 今日工時: 8.25 }],
    ['請假時數非 0.25 倍數', { 今日工時: 1.1 }],
    ['請假日期空白', { 工作日期: '' }],
    ['備註太長', { 處理內容: 'a'.repeat(2001) }],
    ['固定欄位亂填不影響', { 交辦單位: '', 專案名稱: 'x'.repeat(100), 完成度: 5 }],
  ];

  it.each(cases)('%s', (_, overrides) => {
    const values = { ...leaveBase, ...overrides };
    expect([...gs.validateItem_(toApi(values))]).toEqual(Object.values(validateLeave(values)));
  });
});

describe('每日工時合計訊息：dailyHoursMessage ↔ dailyHoursError_', () => {
  it.each([
    [20, 6],
    [23.75, 0.5],
    [0.1 + 0.2 + 23.6, 0.25],
    [0, 24.25],
  ])('其他 %d 小時＋本筆 %d 小時', (other, hours) => {
    expect(gs.dailyHoursError_(other, hours)).toBe(dailyHoursMessage(other, hours));
  });
});

describe('工時設定驗證：validateWorkHoursSetting ↔ validateWorkHours_', () => {
  const cases: [string, WorkHoursSetting][] = [
    ['合法（有午休）', { start: '08:30', end: '18:00', breakStart: '12:00', breakEnd: '13:30' }],
    ['合法（沒午休）', { start: '09:00', end: '17:00' }],
    ['上班空白', { start: '', end: '17:00' }],
    ['下班空白', { start: '09:00', end: '' }],
    ['上班格式錯', { start: '9:00', end: '17:00' }],
    ['下班格式錯', { start: '09:00', end: '24:00' }],
    ['午休只填開始', { start: '08:30', end: '18:00', breakStart: '12:00' }],
    ['午休只填結束', { start: '08:30', end: '18:00', breakEnd: '13:30' }],
    ['午休格式錯', { start: '08:30', end: '18:00', breakStart: '12', breakEnd: '13:30' }],
    ['午休順序錯', { start: '08:30', end: '18:00', breakStart: '13:30', breakEnd: '12:00' }],
    ['午休在上班前', { start: '08:30', end: '18:00', breakStart: '07:00', breakEnd: '08:00' }],
    ['沒午休、下班早於上班', { start: '17:00', end: '09:00' }],
    ['不是 8 小時', { start: '09:00', end: '18:00' }],
    [
      '扣午休後不是 8 小時',
      { start: '08:30', end: '17:30', breakStart: '12:00', breakEnd: '13:30' },
    ],
    ['15 分鐘單位', { start: '08:45', end: '17:45', breakStart: '12:15', breakEnd: '13:15' }],
  ];

  it.each(cases)('%s', (_, setting) => {
    expect(gs.validateWorkHours_(setting)).toBe(validateWorkHoursSetting(setting));
  });
});

describe('搜尋比對：matchesSearch ↔ matchesSearch_', () => {
  const items = [
    {
      交辦單位: '資訊部',
      交辦人員: '王小明',
      專案名稱: '官網改版',
      專案Repo: ['Web-App', 'api'],
      工作目標: '#12345 登入頁 Bug',
      處理內容: '修正 Safari 版面\n第二行',
      狀態: '進行中',
    },
    {
      交辦單位: '人事室',
      交辦人員: '--',
      專案名稱: '休假',
      專案Repo: [],
      工作目標: '特休',
      處理內容: '',
      狀態: '休假',
    },
  ];

  const queries: SearchQuery[] = [
    { keyword: '資訊部' },
    { keyword: 'SAFARI' },
    { keyword: '#web-app' },
    { keyword: 'web-app' },
    { keyword: '#api 官網' },
    { keyword: '官網 找不到' },
    { keyword: '資訊部王' },
    { keyword: '  登入頁   bug ' },
    { keyword: '休假' },
    { keyword: '第二行' },
    { keyword: '資訊部', field: '交辦單位' },
    { keyword: '資訊', field: '交辦單位' },
    { keyword: '王小明', field: '交辦人員' },
    { keyword: '官網改版', field: '專案名稱' },
    { keyword: 'WEB-APP', field: '專案Repo' },
    { keyword: 'web', field: '專案Repo' },
    { keyword: '登入頁', field: '工作目標' },
    { keyword: '特休', field: '工作目標' },
  ];

  it.each(queries)('%o', (query) => {
    items.forEach((item) => {
      // 後端 handleSearch_ 先 normalizeSearch_ 再比對
      const back = gs.matchesSearch_(item, gs.normalizeSearch_(query.keyword), query.field);
      expect(back).toBe(matchesSearch(item, query));
    });
  });
});
