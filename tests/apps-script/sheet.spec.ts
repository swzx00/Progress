import { beforeEach, describe, expect, it } from 'vitest';

import { addDays, todayString } from '@/utils/date';
import type { WorkItem } from '@/types/work-item';

import { DAY, OTHER_DAY, input, leaveInput } from '../backend/contract';

import type { CellValue, FakeSheet } from './fake-spreadsheet';
import {
  CLIENT_ID,
  OWNER_EMAIL,
  loadCodeGsBackend,
  type CodeGsBackend,
} from './load-code-gs-backend';

/**
 * Code.gs 怎麼讀寫試算表本身（共同規格看不到的部分）：自動建分頁、儲存格型別與格式、排序、
 * 補列、已刪除紀錄分頁、選項清單的文字比對與連續、工時設定、登入驗證、近期紀錄、搜尋、匯出範圍
 */
let backend: CodeGsBackend;

beforeEach(() => {
  backend = loadCodeGsBackend();
});

const post = (body: Record<string, unknown>) => backend.doPost({ idToken: 'token', ...body });
const get = (params: Record<string, string>) => backend.doGet(params);

const create = (overrides: Partial<WorkItem> = {}): WorkItem =>
  post({ action: 'create', item: input(overrides) }).item as WorkItem;

const sheet = (name: string): FakeSheet => backend.spreadsheet.getSheetByName(name)!;
const dataSheet = (): FakeSheet => sheet('工作紀錄');
const optionsSheet = (): FakeSheet => sheet('選項清單');
const deletedSheet = (): FakeSheet => sheet('已刪除紀錄');

const DATA_HEADERS = [
  'ID',
  '工作日期',
  '項次',
  '交辦單位',
  '交辦人員',
  '專案名稱',
  '專案Repo',
  '工作目標',
  '處理內容',
  '今日工時',
  '預計期限',
  '完成度',
  '狀態',
  '已刪除',
];

/** API 格式（YYYY/MM/DD）的日期，離今天 offset 天 */
const apiDay = (offset: number): string => addDays(todayString(), offset).replaceAll('-', '/');

/** 直接在工作紀錄分頁寫一列（模擬手動編輯 Sheet），值照 Sheet 規則轉型 */
const appendItem = (overrides: Partial<WorkItem> & { id: string }): void => {
  const item: Record<string, unknown> = { ...input(), 項次: 1, 已刪除: false, ...overrides };
  dataSheet().appendRow(
    DATA_HEADERS.map((header) => {
      const value = item[header === 'ID' ? 'id' : header];
      if (Array.isArray(value)) return value.join(',');
      if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
      return value;
    }),
  );
};

/** 試算表裡的日期是 Code.gs 那個 vm 環境的 Date，instanceof 認不得，改看物件型別 */
const isDate = (value: unknown): value is Date =>
  Object.prototype.toString.call(value) === '[object Date]';

const dateCell = (value: CellValue): string => {
  expect(isDate(value)).toBe(true);
  const date = value as Date;
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
};

describe('工作紀錄分頁', () => {
  it('讀取時分頁還沒建立：回空資料，不會建立分頁', () => {
    expect(get({ date: DAY })).toEqual({ items: [] });
    expect(get({ type: 'range', from: DAY, to: DAY })).toEqual({ items: [] });
    expect(get({ type: 'search', q: '官網' })).toEqual({ items: [], total: 0 });
    expect(get({ type: 'options' })).toMatchObject({ recentItems: [], workHours: null });
    expect(backend.spreadsheet.getSheets()).toHaveLength(0);
  });

  it('第一次寫入時建立：表頭、凍結第一列、工作日期與預計期限整欄是 yyyy/mm/dd', () => {
    create();
    const data = dataSheet();
    expect(data.dump()[0]).toEqual(DATA_HEADERS);
    expect(data.frozenRows).toBe(1);
    const col = (header: string) => DATA_HEADERS.indexOf(header) + 1;
    expect(data.getRange(2, col('工作日期')).getNumberFormat()).toBe('yyyy/mm/dd');
    expect(data.getRange(1000, col('預計期限')).getNumberFormat()).toBe('yyyy/mm/dd');
    expect(data.getRange(2, col('狀態')).getNumberFormat()).toBe('');
  });

  it('儲存格型別：日期是日期、數字是數字、已刪除是布林、專案 Repo 逗號串；API 讀回原本的格式', () => {
    const created = create({
      專案Repo: ['AAA', 'BBBB'],
      今日工時: 2.5,
      預計期限: '2099/01/31',
      完成度: 12.25,
    });
    const data = dataSheet();
    expect(dateCell(data.column('工作日期')[0]!)).toBe('2099/1/5');
    expect(dateCell(data.column('預計期限')[0]!)).toBe('2099/1/31');
    expect(data.column('項次')).toEqual([1]);
    expect(data.column('今日工時')).toEqual([2.5]);
    expect(data.column('完成度')).toEqual([12.25]);
    expect(data.column('已刪除')).toEqual([false]);
    expect(data.column('專案Repo')).toEqual(['AAA,BBBB']);
    expect(get({ date: DAY }).items).toEqual([created]);
  });

  it('文字欄位維持原樣：像數字、時間、日期、布林的內容不會被 Sheet 轉型', () => {
    const texts = {
      交辦單位: '0123',
      交辦人員: 'TRUE',
      專案名稱: '12:30',
      專案Repo: ['007'],
      工作目標: '2026/10/01',
      處理內容: '1e3',
    };
    const created = create(texts);
    expect(created).toMatchObject(texts);
    expect(get({ date: DAY }).items).toEqual([created]);
    const updated = post({ action: 'update', id: created.id, item: { 工作目標: '0800' } });
    expect(get({ date: DAY }).items).toEqual([updated.item]);
    expect(dataSheet().column('工作目標')).toEqual(['0800']);
    post({ action: 'batchCreate', items: [input({ 處理內容: '00:30' })] });
    expect(dataSheet().column('處理內容')).toEqual(['1e3', '00:30']);
  });

  it('每次寫入後照工作日期 → 項次排序（新增、改日期、調整順序）', () => {
    create({ 工作日期: OTHER_DAY, 工作目標: 'X' });
    const a = create({ 工作目標: 'A' });
    const b = create({ 工作目標: 'B' });
    expect(dataSheet().column('工作目標')).toEqual(['A', 'B', 'X']);

    post({ action: 'reorder', date: DAY, ids: [b.id, a.id] });
    expect(dataSheet().column('工作目標')).toEqual(['B', 'A', 'X']);

    post({ action: 'update', id: b.id, item: { 工作日期: OTHER_DAY } });
    expect(dataSheet().column('工作目標')).toEqual(['A', 'X', 'B']);
    expect(dataSheet().column('項次')).toEqual([2, 1, 2]);
  });

  it('超過預設 1000 列時自動補列，補的列沿用日期格式', () => {
    create({ 工作日期: '2099/01/01' });
    const data = dataSheet();
    const filler = data.dump()[1]!;
    const rows = Array.from({ length: 998 }, (_, i) => [`filler-${i}`, ...filler.slice(1)]);
    data.getRange(3, 1, rows.length, filler.length).setValues(rows);
    expect(data.getLastRow()).toBe(data.getMaxRows());

    const created = create();
    expect(data.getMaxRows()).toBe(1001);
    post({ action: 'batchCreate', items: [input({ 工作目標: 'B' }), input({ 工作目標: 'C' })] });
    expect(data.getMaxRows()).toBe(1003);
    expect(data.getRange(1003, 2).getNumberFormat()).toBe('yyyy/mm/dd');
    expect((get({ date: DAY }).items as WorkItem[]).map((item) => item.項次)).toEqual([1, 2, 3]);
    expect(dataSheet().column('ID').at(-3)).toBe(created.id);
  });

  it('手動編輯過、順序亂掉的分頁照樣讀得到，已刪除＝TRUE 的列略過', () => {
    create({ 工作目標: 'A' });
    appendItem({ id: 'manual-other', 工作日期: OTHER_DAY, 工作目標: 'X' });
    appendItem({ id: 'manual-day', 工作目標: 'B', 項次: 2 });
    appendItem({ id: 'manual-deleted', 工作目標: 'C', 項次: 3, 已刪除: true });
    const items = get({ date: DAY }).items as WorkItem[];
    expect(items.map((item) => item.工作目標)).toEqual(['A', 'B']);
    expect(create({ 工作目標: 'D' }).項次).toBe(3);
  });

  it('沒帶 date 參數回錯誤', () => {
    expect(get({}).error).toBe('缺少 date 參數');
  });

  it('沒設定指令碼屬性 SHEET_ID：回錯誤，不會丟例外', () => {
    backend = loadCodeGsBackend({ SHEET_ID: '' });
    expect(get({ date: DAY }).error).toBe('Error: 尚未設定指令碼屬性 SHEET_ID');
    expect(post({ action: 'create', item: input() }).error).toBe(
      'Error: 尚未設定指令碼屬性 SHEET_ID',
    );
  });
});

describe('已刪除紀錄分頁', () => {
  const DELETED_HEADERS = [...DATA_HEADERS.filter((h) => h !== '已刪除'), '刪除時間'];

  it('刪除：整列搬過去（日期維持日期、多一欄刪除時間），工作紀錄分頁那列刪掉', () => {
    const a = create({ 工作目標: 'A', 專案Repo: ['AAA'], 今日工時: 2 });
    create({ 工作目標: 'B' });
    const before = Date.now();
    expect(post({ action: 'delete', id: a.id })).toEqual({ ok: true });

    expect(dataSheet().column('工作目標')).toEqual(['B']);
    const [headers, row] = deletedSheet().dump();
    expect(headers).toEqual(DELETED_HEADERS);
    expect(deletedSheet().frozenRows).toBe(1);
    const record = Object.fromEntries(headers!.map((h, i) => [h, row![i]]));
    expect(record).toMatchObject({
      ID: a.id,
      工作目標: 'A',
      專案Repo: 'AAA',
      今日工時: 2,
      項次: 1,
    });
    expect(dateCell(record.工作日期!)).toBe('2099/1/5');
    expect((record.刪除時間 as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
    const deletedAtCol = DELETED_HEADERS.indexOf('刪除時間') + 1;
    expect(deletedSheet().getRange(2, deletedAtCol).getNumberFormat()).toBe('yyyy/mm/dd hh:mm:ss');
  });

  it('覆蓋（replace）：目標日原本的紀錄（含請假）全部搬過去，別天不動', () => {
    create({ 工作目標: 'A' });
    post({ action: 'create', item: leaveInput() });
    create({ 工作日期: OTHER_DAY, 工作目標: 'X' });
    const data = post({ action: 'batchCreate', replace: true, items: [input({ 工作目標: 'N' })] });
    expect(data.replaced).toBe(2);
    expect(deletedSheet().column('工作目標')).toEqual(['A', '特休']);
    expect(dataSheet().column('工作目標')).toEqual(['N', 'X']);
  });

  it('搬過去的文字欄位一樣維持原樣', () => {
    const a = create({ 專案名稱: '0123' });
    post({ action: 'delete', id: a.id });
    expect(deletedSheet().column('專案名稱')).toEqual(['0123']);
  });
});

describe('選項清單分頁', () => {
  const addOption = (category: string, value: string) =>
    post({ action: 'addOption', category, value });

  it('新增紀錄時建立分頁，新值寫回各分類欄位（純文字格式）；請假的固定值不寫回', () => {
    create({ 專案Repo: ['AAA', 'BBBB'] });
    post({ action: 'create', item: leaveInput() });
    expect(optionsSheet().dump()).toEqual([
      ['交辦單位', '交辦人員', '專案名稱', '專案Repo'],
      ['資訊部', '王小明', '官網改版', 'AAA'],
      ['', '', '', 'BBBB'],
    ]);
    expect(optionsSheet().getRange(2, 1).getNumberFormat()).toBe('@');
  });

  it('純數字的值（11111）存成文字，不會重複新增，刪除、重新命名都找得到', () => {
    create({ 專案名稱: '11111' });
    create({ 專案名稱: '11111' });
    addOption('專案名稱', '11111');
    expect(optionsSheet().column('專案名稱')).toEqual(['11111']);
    expect(
      post({ action: 'renameOption', category: '專案名稱', oldValue: '11111', newValue: '22222' })
        .error,
    ).toBeUndefined();
    expect(
      post({ action: 'deleteOption', category: '專案名稱', value: '22222' }).error,
    ).toBeUndefined();
    expect(optionsSheet().column('專案名稱')).toEqual(['']);
  });

  it('手動輸入被 Sheet 轉成數字的值也認得', () => {
    addOption('交辦單位', '資訊部');
    optionsSheet().getRange(3, 1).setValue('11111');
    expect(optionsSheet().column('交辦單位')).toEqual(['資訊部', 11111]);
    addOption('交辦單位', '11111');
    expect((get({ type: 'options' }).options as Record<string, string[]>).交辦單位).toEqual([
      '資訊部',
      '11111',
    ]);
    expect(
      post({ action: 'deleteOption', category: '交辦單位', value: '11111' }).error,
    ).toBeUndefined();
    expect(optionsSheet().getRange(2, 1, 2, 1).getValues()).toEqual([['資訊部'], ['']]);
  });

  it('刪除時下面的值往上補，只動那一欄', () => {
    ['A', 'B', 'C'].forEach((value) => addOption('交辦單位', value));
    ['甲', '乙'].forEach((value) => addOption('交辦人員', value));
    post({ action: 'deleteOption', category: '交辦單位', value: 'A' });
    expect(optionsSheet().dump().slice(1)).toEqual([
      ['B', '甲', '', ''],
      ['C', '乙', '', ''],
    ]);
    expect(optionsSheet().getRange(4, 1).getValues()).toEqual([['']]);
  });

  it('compactOptionsSheet：每欄往上補齊、去掉重複，順序與其他欄不變；重複執行結果一樣', () => {
    addOption('交辦單位', '資訊部');
    const options = optionsSheet();
    options.appendRow(['', '王小明']);
    options.appendRow(['11111', '']);
    options.appendRow(['資訊部', '王小明']);
    options.appendRow(['業務部', '陳大華']);

    const compact = backend.global.compactOptionsSheet as () => void;
    compact();
    const expected = [
      ['交辦單位', '交辦人員', '專案名稱', '專案Repo'],
      ['資訊部', '王小明', '', ''],
      ['11111', '陳大華', '', ''],
      ['業務部', '', '', ''],
    ];
    expect(options.dump()).toEqual(expected);
    compact();
    expect(options.dump()).toEqual(expected);
  });
});

describe('工時設定', () => {
  const SETTING = { start: '08:30', end: '17:30', breakStart: '12:00', breakEnd: '13:00' };

  it('寫在選項清單最後面的「工時設定」欄（純文字），讀回同樣的值', () => {
    addOptionThenSave();
    const options = optionsSheet();
    expect(options.dump()[0]).toEqual(['交辦單位', '交辦人員', '專案名稱', '專案Repo', '工時設定']);
    expect(options.column('工時設定').slice(0, 4)).toEqual(['08:30', '17:30', '12:00', '13:00']);
    expect(options.getRange(2, 5).getNumberFormat()).toBe('@');
    expect(get({ type: 'options' }).workHours).toEqual(SETTING);
  });

  it('手動輸入被轉成時間值的儲存格，讀回 HH:mm', () => {
    addOptionThenSave();
    const options = optionsSheet();
    options.getRange(2, 5, 4, 1).setNumberFormat('');
    options.getRange(2, 5, 4, 1).setValues([['08:30'], ['17:30'], ['12:00'], ['13:00']]);
    expect(isDate(options.getRange(2, 5).getValues()[0]![0])).toBe(true);
    expect(get({ type: 'options' }).workHours).toEqual(SETTING);
  });

  it('清除：儲存格清空，讀回 null；Sheet 上的設定不合法也當成沒有設定', () => {
    addOptionThenSave();
    expect(post({ action: 'saveWorkHours', workHours: null })).toEqual({ workHours: null });
    expect(optionsSheet().getRange(2, 5, 4, 1).getValues()).toEqual([[''], [''], [''], ['']]);
    addOptionThenSave();
    optionsSheet().getRange(3, 5).setValue('18:30');
    expect(get({ type: 'options' }).workHours).toBeNull();
  });

  it('還沒有選項清單分頁時一起建立', () => {
    expect(post({ action: 'saveWorkHours', workHours: SETTING })).toEqual({ workHours: SETTING });
    expect(optionsSheet().dump()[0]).toEqual([
      '交辦單位',
      '交辦人員',
      '專案名稱',
      '專案Repo',
      '工時設定',
    ]);
  });

  function addOptionThenSave(): void {
    post({ action: 'addOption', category: '交辦單位', value: '資訊部' });
    post({ action: 'saveWorkHours', workHours: SETTING });
  }
});

describe('登入驗證（verifyIdToken_）', () => {
  const token = (payload: Record<string, unknown>): string =>
    JSON.stringify({ email: OWNER_EMAIL, email_verified: 'true', aud: CLIENT_ID, ...payload });

  it.each([
    ['別人的 email', token({ email: 'someone@gmail.com' })],
    ['email 沒驗證', token({ email_verified: 'false' })],
    ['別的 Client ID 發的', token({ aud: 'other-client' })],
    ['tokeninfo 驗證失敗', 'not-a-token'],
  ])('%s：UNAUTHORIZED，不寫入', (_, idToken) => {
    const data = backend.doPost({ idToken, action: 'create', item: input() });
    expect(data).toEqual({ error: '未登入或無權限', code: 'UNAUTHORIZED' });
    expect(backend.spreadsheet.getSheets()).toHaveLength(0);
  });

  it('沒設定指令碼屬性 GOOGLE_CLIENT_ID：一律 UNAUTHORIZED', () => {
    backend = loadCodeGsBackend({ GOOGLE_CLIENT_ID: '' });
    const data = backend.doPost({ idToken: 'token', action: 'create', item: input() });
    expect(data).toEqual({ error: '未登入或無權限', code: 'UNAUTHORIZED' });
    expect(backend.spreadsheet.getSheets()).toHaveLength(0);
  });

  it('email_verified 是布林 true 也可以', () => {
    const data = backend.doPost({
      idToken: token({ email_verified: true }),
      action: 'create',
      item: input(),
    });
    expect(data.error).toBeUndefined();
  });
});

describe('近期紀錄（type=options 的 recentItems）', () => {
  it('近 30 天（含第 30 天）、排除請假與已刪除，只帶推薦用的欄位', () => {
    create({ 工作日期: apiDay(-31), 工作目標: '太舊' });
    create({ 工作日期: apiDay(-30), 工作目標: '第 30 天' });
    const deleted = create({ 工作日期: apiDay(-1), 工作目標: '刪掉' });
    post({ action: 'delete', id: deleted.id });
    post({ action: 'create', item: leaveInput({ 工作日期: apiDay(0) }) });
    create({ 工作日期: apiDay(0), 工作目標: '今天', 處理內容: '不用帶' });

    const recent = get({ type: 'options' }).recentItems as Record<string, unknown>[];
    expect(recent.map((item) => item.工作目標)).toEqual(['第 30 天', '今天']);
    expect(Object.keys(recent[0]!).sort()).toEqual(
      [
        'id',
        '工作日期',
        '項次',
        '交辦單位',
        '交辦人員',
        '專案名稱',
        '專案Repo',
        '工作目標',
        '預計期限',
        '完成度',
        '狀態',
      ].sort(),
    );
  });
});

describe('搜尋與匯出範圍', () => {
  it('搜尋：新的日期在前、同一天照項次，最多 200 筆，total 是全部符合的筆數', () => {
    create({ 工作目標: '官網 A' });
    create({ 工作目標: '官網 B' });
    create({ 工作日期: OTHER_DAY, 工作目標: '官網 C' });
    for (let i = 0; i < 200; i++) {
      appendItem({ id: `old-${i}`, 工作日期: '2098/01/01', 工作目標: '官網舊', 項次: i + 1 });
    }
    const deleted = create({ 工作目標: '官網刪掉' });
    post({ action: 'delete', id: deleted.id });

    const data = get({ type: 'search', q: '官網' });
    const items = data.items as WorkItem[];
    expect(data.total).toBe(203);
    expect(items).toHaveLength(200);
    expect(items.slice(0, 4).map((item) => item.工作目標)).toEqual([
      '官網 C',
      '官網 A',
      '官網 B',
      '官網舊',
    ]);
    expect(items[3]!.工作日期).toBe('2098/01/01');
  });

  it('範圍：含頭尾兩天，含請假、不含已刪除', () => {
    create({ 工作日期: '2099/01/04', 工作目標: '前一天' });
    create({ 工作目標: '頭' });
    post({ action: 'create', item: leaveInput({ 工作日期: OTHER_DAY }) });
    const deleted = create({ 工作日期: OTHER_DAY, 工作目標: '刪掉' });
    post({ action: 'delete', id: deleted.id });
    create({ 工作日期: '2099/01/07', 工作目標: '後一天' });

    const items = get({ type: 'range', from: DAY, to: OTHER_DAY }).items as WorkItem[];
    expect(items.map((item) => item.工作目標)).toEqual(['頭', '特休']);
  });
});
