import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkItem } from '@/types/work-item';

import type { FakeSheet, FakeSpreadsheet } from './fake-spreadsheet';
import { loadCodeGsBackend, type CodeGsBackend } from './load-code-gs-backend';

/**
 * apps-script/LegacyImport.gs（一次性匯入舊版「工作進度-2026H1／H2」）：跟 Code.gs 一起載入，
 * 兩份舊表換成假的試算表。轉換規則看檔案開頭註解（分頁名稱→日期、Repo 拆行、狀態對應、請假判斷），
 * 匯入後用 doGet 讀回來，確認新系統讀得到、格式對
 */
let backend: CodeGsBackend;
let h1: FakeSpreadsheet;
let h2: FakeSpreadsheet;

const LEGACY_HEADERS = [
  '項次',
  '單位',
  '交辦人員',
  '專案名稱',
  '工作內容',
  '今日處理情形',
  '今日工時',
  '完成%',
  '預計完成期限',
  '完成回報',
];

type LegacyRow = Partial<Record<(typeof LEGACY_HEADERS)[number], unknown>>;

const legacyRow = (overrides: LegacyRow = {}): LegacyRow => ({
  項次: 1,
  單位: '資訊部',
  交辦人員: '王小明',
  專案名稱: '官網改版',
  工作內容: '首頁切版',
  今日處理情形: 'release_source\n完成 RWD 調整',
  今日工時: 4,
  '完成%': 50,
  預計完成期限: '',
  完成回報: '進行中',
  ...overrides,
});

/**
 * 在舊表加一個分頁（每天一個），rows 照 LEGACY_HEADERS 的順序寫入，值照 Sheet 規則轉型；
 * asText 時整張先設成純文字格式（舊表儲存格本來就是文字的情況）
 */
const addDay = (
  book: FakeSpreadsheet,
  name: string,
  rows: LegacyRow[],
  headers = LEGACY_HEADERS,
  asText = false,
): FakeSheet => {
  const sheet = book.insertSheet(name);
  if (asText) sheet.getRange(1, 1, rows.length + 1, headers.length).setNumberFormat('@');
  sheet.appendRow(headers);
  rows.forEach((row) => sheet.appendRow(headers.map((h) => row[h] ?? '')));
  return sheet;
};

type Fn = (...args: unknown[]) => unknown;
const fn = (name: string): Fn => backend.global[name] as Fn;
/** vm 環境回傳的物件換成這邊的普通物件，比對比較單純 */
const plain = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

interface Entry {
  item: WorkItem;
  source: string;
}
interface BuildResult {
  items: Entry[];
  options: Record<string, string[]>;
  summary: string[];
  skippedSheets: string[];
  log: string[];
}

const build = (): BuildResult => plain(fn('buildLegacyImport_')());
const convert = (rows: LegacyRow[], date = '2026/10/09') =>
  plain<{ entries: Entry[]; log: string[] }>(
    fn('convertLegacySheet_')(
      [LEGACY_HEADERS, ...rows.map((row) => LEGACY_HEADERS.map((h) => row[h] ?? ''))],
      date,
      '2026H2「1009」',
      'Asia/Taipei',
    ),
  );

const sheet = (name: string): FakeSheet | null => backend.spreadsheet.getSheetByName(name);
const dayItems = (date: string): WorkItem[] =>
  backend.doGet({ date }).items as unknown as WorkItem[];

beforeEach(() => {
  backend = loadCodeGsBackend({}, { extraFiles: ['LegacyImport.gs'] });
  const sources = backend.global.LEGACY_SOURCES as { id: string }[];
  h1 = backend.newSpreadsheet();
  h2 = backend.newSpreadsheet();
  backend.books.set(sources[0]!.id, h1);
  backend.books.set(sources[1]!.id, h2);
});

describe('分頁名稱 → 工作日期', () => {
  it.each([
    ['1009', '2026/10/09'],
    ['109', '2026/01/09'],
    ['10/09', '2026/10/09'],
    ['10-9', '2026/10/09'],
    ['10.9', '2026/10/09'],
    ['10月9日', '2026/10/09'],
    ['10/09(四)', '2026/10/09'],
    ['10/09（四）', '2026/10/09'],
    [' 10 / 09 ', '2026/10/09'],
    ['2025/12/31', '2025/12/31'],
    ['2026年1月2日', '2026/01/02'],
    ['20261009', '2026/10/09'],
    ['1151009', '2026/10/09'],
  ])('%s → %s', (name, expected) => {
    expect(fn('parseLegacySheetDate_')(name, 2026)).toBe(expected);
  });

  it.each([
    ['2/30'],
    ['4/31'],
    ['2/29'],
    ['13/01'],
    ['0/10'],
    ['10/00'],
    ['工作表1'],
    ['1009 備份'],
  ])('%s：不是日期，回傳空字串', (name) => {
    expect(fn('parseLegacySheetDate_')(name, 2026)).toBe('');
  });

  it('閏年的 2/29 可以', () => {
    expect(fn('parseLegacySheetDate_')('2/29', 2028)).toBe('2028/02/29');
  });

  it('年份超出 2020–2099 不算', () => {
    expect(fn('parseLegacySheetDate_')('2019/10/09', 2026)).toBe('');
    expect(fn('parseLegacySheetDate_')('21001009', 2026)).toBe('');
  });
});

describe('預計完成期限', () => {
  const deadline = (raw: unknown, workDate = '2026/10/09'): unknown =>
    fn('parseLegacyDeadline_')(raw, workDate, 'Asia/Taipei');

  it('日期儲存格：轉成 YYYY/MM/DD', () => {
    expect(deadline(new backend.VmDate(2026, 10, 3))).toBe('2026/11/03');
    expect(deadline(new backend.VmDate(NaN))).toBe('');
  });

  it('文字：有年份照寫，只有月日用工作日期那年', () => {
    expect(deadline('2027/1/5')).toBe('2027/01/05');
    expect(deadline('10/15')).toBe('2026/10/15');
    expect(deadline('3月1日', '2025/12/30')).toBe('2025/03/01');
    expect(deadline('10/15(三)')).toBe('2026/10/15');
  });

  it('不是日期：空字串', () => {
    expect(deadline('')).toBe('');
    expect(deadline('下週')).toBe('');
    expect(deadline('2/30')).toBe('');
    expect(deadline(20261015)).toBe('');
  });
});

describe('今日處理情形 → 專案Repo＋處理內容', () => {
  const split = (notes: string) =>
    plain<{ repos: string[]; rest: string }>(fn('splitLegacyRepo_')(notes));

  it('第一行只有英數字與 - _ / . 才算 Repo', () => {
    expect(split('release_source\n完成 RWD\n修正 bug')).toEqual({
      repos: ['release_source'],
      rest: '完成 RWD\n修正 bug',
    });
    expect(split('group/web-app.v2')).toEqual({ repos: ['group/web-app.v2'], rest: '' });
  });

  it('第一行有中文、空白、只有數字：不算 Repo，整段是處理內容', () => {
    expect(split('完成 RWD\n修正')).toEqual({ repos: [], rest: '完成 RWD\n修正' });
    expect(split('web app\n修正')).toEqual({ repos: [], rest: 'web app\n修正' });
    expect(split('12345\n修正')).toEqual({ repos: [], rest: '12345\n修正' });
    expect(split('')).toEqual({ repos: [], rest: '' });
  });
});

describe('單一分頁的轉換', () => {
  it('欄位對應：Repo 從處理情形拆出來，完成% 去掉百分號', () => {
    const { entries, log } = convert([
      legacyRow({ '完成%': '50%', 預計完成期限: '10/31', 完成回報: '完成' }),
    ]);
    expect(entries).toEqual([
      {
        source: '2026H2「1009」 第 2 列',
        item: {
          工作日期: '2026/10/09',
          項次: 1,
          交辦單位: '資訊部',
          交辦人員: '王小明',
          專案名稱: '官網改版',
          專案Repo: ['release_source'],
          工作目標: '首頁切版',
          處理內容: '完成 RWD 調整',
          今日工時: 4,
          預計期限: '2026/10/31',
          完成度: 50,
          狀態: '前端完成',
          已刪除: false,
        },
      },
    ]);
    expect(log).toEqual([]);
  });

  it.each([
    ['進行中', '進行中'],
    ['完成', '前端完成'],
    ['修改', '返修'],
    ['待辦', '待辦'],
    ['結案', '確認上線'],
    ['暫緩', '暫緩'],
    [' 結案 ', '確認上線'],
  ])('完成回報「%s」→ %s', (raw, status) => {
    expect(convert([legacyRow({ 完成回報: raw })]).entries[0]!.item.狀態).toBe(status);
  });

  it('完成回報對不上：填待辦並記下來', () => {
    const { entries, log } = convert([legacyRow({ 完成回報: '做一半' })]);
    expect(entries[0]!.item.狀態).toBe('待辦');
    expect(log).toEqual(['2026H2「1009」 第 2 列：完成回報「做一半」對不上，改填待辦']);
  });

  it('預計完成期限不是日期：留空並記下來', () => {
    const { entries, log } = convert([legacyRow({ 預計完成期限: '下週' })]);
    expect(entries[0]!.item.預計期限).toBe('');
    expect(log).toEqual(['2026H2「1009」 第 2 列：預計完成期限「下週」不是日期，留空']);
  });

  it('工時、完成度：文字轉數字，四捨五入到 0.25，超出範圍夾回 0–24、0–100', () => {
    const items = convert([
      legacyRow({ 今日工時: '2.1', '完成%': '130%' }),
      legacyRow({ 今日工時: 30, '完成%': -5 }),
      legacyRow({ 今日工時: '一小時', '完成%': '' }),
      legacyRow({ 今日工時: 1.13, '完成%': '33.3 ％' }),
    ]).entries.map((e) => [e.item.今日工時, e.item.完成度]);
    expect(items).toEqual([
      [2, 100],
      [24, 0],
      [0, 0],
      [1.25, 33.25],
    ]);
  });

  it('工作內容空白的列略過；文字的換行統一成 \\n、去掉前後空白', () => {
    const { entries } = convert([
      legacyRow({ 工作內容: '' }),
      legacyRow({ 工作內容: '  首頁切版\r\n第二行 ', 今日處理情形: '修正\r樣式' }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.item.工作目標).toBe('首頁切版\n第二行');
    expect(entries[0]!.item.處理內容).toBe('修正\n樣式');
    expect(entries[0]!.source).toBe('2026H2「1009」 第 3 列');
  });

  it('少了某些欄：當成空白', () => {
    const values = [
      ['工作內容', '完成回報'],
      ['首頁切版', '進行中'],
    ];
    const { entries } = plain<{ entries: Entry[] }>(
      fn('convertLegacySheet_')(values, '2026/10/09', 'x', 'Asia/Taipei'),
    );
    expect(entries[0]!.item).toMatchObject({
      項次: 0,
      交辦單位: '',
      專案Repo: [],
      處理內容: '',
      今日工時: 0,
      狀態: '進行中',
    });
  });

  describe('請假', () => {
    it.each([
      ['特休', '', '特休'],
      ['病假', '', '病假'],
      ['事假', '', '事假'],
      ['請假', '', '其他'],
      ['休假一天', '', '其他'],
      ['首頁切版', '下午請特休', '特休'],
    ])('工作內容「%s」／處理情形「%s」→ 假別 %s', (target, notes, type) => {
      const { entries } = convert([legacyRow({ 工作內容: target, 今日處理情形: notes })]);
      expect(entries[0]!.item).toMatchObject({ 工作目標: type, 狀態: '休假' });
    });

    it('固定欄位照請假規則覆蓋，備註是工作內容＋處理情形', () => {
      const { entries, log } = convert([
        legacyRow({ 工作內容: '特休', 今日處理情形: '家庭旅遊', 今日工時: 4 }),
      ]);
      expect(entries[0]!.item).toEqual({
        工作日期: '2026/10/09',
        項次: 1,
        交辦單位: '人事室',
        交辦人員: '--',
        專案名稱: '休假',
        專案Repo: [],
        工作目標: '特休',
        處理內容: '特休\n家庭旅遊',
        今日工時: 4,
        預計期限: '',
        完成度: 100,
        狀態: '休假',
        已刪除: false,
      });
      expect(log).toEqual(['2026H2「1009」 第 2 列：判定為請假（特休 4hr）：特休']);
    });

    it.each([
      [0, 8],
      ['', 8],
      [4.1, 4],
      [12, 8],
    ])('時數 %s → %s（沒填是 8，最多 8）', (hours, expected) => {
      const { entries } = convert([legacyRow({ 工作內容: '病假', 今日工時: hours })]);
      expect(entries[0]!.item.今日工時).toBe(expected);
    });
  });
});

describe('讀兩份舊表（buildLegacyImport_）', () => {
  it('略過的分頁：項目欄／待辦事項不提，沒有工作內容欄、名稱不是日期的列出來', () => {
    addDay(h1, '項目欄', [legacyRow()]);
    addDay(h1, ' 待辦事項 ', [legacyRow()]);
    addDay(h1, '說明', [], ['備註']);
    h1.insertSheet('空白');
    addDay(h1, '工作表1', [legacyRow()]);
    addDay(h1, '0105', [legacyRow()]);
    const result = build();
    expect(result.skippedSheets).toEqual([
      '2026H1「說明」：沒有「工作內容」欄',
      '2026H1「空白」：沒有「工作內容」欄',
      '2026H1「工作表1」：分頁名稱解析不出日期',
    ]);
    expect(result.items.map((e) => e.item.工作日期)).toEqual(['2026/01/05']);
  });

  it('月份不在那份表的範圍、兩份表日期重複：照常匯入，記下來', () => {
    addDay(h1, '0701', [legacyRow()]);
    addDay(h2, '07/01', [legacyRow({ 項次: 2 })]);
    const result = build();
    expect(result.items).toHaveLength(2);
    expect(result.log).toEqual([
      '2026H1「0701」：日期 2026/07/01 不在 2026H1 的月份範圍內（仍照常匯入）',
      '2026H2「07/01」：日期 2026/07/01 跟 2026H1「0701」 重複（兩邊都匯入）',
    ]);
  });

  it('依日期、項次排序；項次空白的接在當天最大項次後面；每筆有新的 ID', () => {
    addDay(h2, '1009', [
      legacyRow({ 項次: '', 工作內容: 'C' }),
      legacyRow({ 項次: 3, 工作內容: 'B' }),
      legacyRow({ 項次: 1, 工作內容: 'A' }),
      legacyRow({ 項次: '', 工作內容: 'D' }),
    ]);
    addDay(h2, '1008', [legacyRow({ 項次: '', 工作內容: 'X' })]);
    const items = build().items.map((e) => e.item);
    expect(items.map((i) => [i.工作日期, i.項次, i.工作目標])).toEqual([
      ['2026/10/08', 1, 'X'],
      ['2026/10/09', 1, 'A'],
      ['2026/10/09', 3, 'B'],
      ['2026/10/09', 4, 'C'],
      ['2026/10/09', 5, 'D'],
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(5);
  });

  it('不符合新增規則、當天工時超過 24 小時：不擋，記下來', () => {
    addDay(h2, '1009', [
      legacyRow({ 單位: '', 今日工時: 20 }),
      legacyRow({ 項次: 2, 今日工時: 8 }),
    ]);
    const result = build();
    expect(result.items).toHaveLength(2);
    expect(result.log).toEqual([
      expect.stringMatching(/^2026H2「1009」 第 2 列：.*交辦單位/),
      '2026/10/09：當天工時合計 28 小時，超過 24 小時',
    ]);
  });

  it('選項清單：只放用到的值（請假不算），次數多的在前，同次數照出現順序', () => {
    addDay(h2, '1008', [
      legacyRow({ 單位: '行銷部', 專案名稱: 'B 專案', 今日處理情形: 'repo-b\n' }),
      legacyRow({ 項次: 2, 工作內容: '特休' }),
    ]);
    addDay(h2, '1009', [
      legacyRow({ 專案名稱: 'A 專案', 今日處理情形: '修正' }),
      legacyRow({ 項次: 2, 專案名稱: 'A 專案' }),
      legacyRow({ 項次: 3, 單位: '行銷部', 專案名稱: 'C 專案' }),
    ]);
    const result = build();
    expect(result.options).toEqual({
      交辦單位: ['行銷部', '資訊部'],
      交辦人員: ['王小明'],
      專案名稱: ['A 專案', 'B 專案', 'C 專案'],
      專案Repo: ['release_source', 'repo-b'],
    });
    expect(result.summary).toEqual([
      '紀錄：5 筆（其中請假 1 筆），共 2 天',
      '選項清單：交辦單位 2 個、交辦人員 1 個、專案名稱 3 個、專案Repo 2 個',
      '略過的分頁：0 個',
      '需要留意：1 則',
    ]);
  });
});

describe('預覽（previewLegacyImport）', () => {
  it('只寫匯入預覽與匯入紀錄分頁，不動工作紀錄', () => {
    backend.doPost({
      idToken: 'token',
      action: 'create',
      item: { ...legacyRow(), 工作日期: '2026/10/01' },
    });
    const before = sheet('工作紀錄')?.dump();
    addDay(h2, '1009', [legacyRow(), legacyRow({ 項次: 2, 完成回報: '??' })]);
    fn('previewLegacyImport')();

    expect(sheet('工作紀錄')?.dump()).toEqual(before);
    const preview = sheet('匯入預覽')!;
    const [headers, ...rows] = preview.dump();
    expect(headers!.at(-1)).toBe('來源');
    expect(rows.map((row) => row.at(-1))).toEqual([
      '2026H2「1009」 第 2 列',
      '2026H2「1009」 第 3 列',
    ]);
    expect(preview.frozenRows).toBe(1);
    expect(
      sheet('匯入紀錄')!
        .dump()
        .map((row) => row[0]),
    ).toEqual([
      '摘要',
      '紀錄：2 筆（其中請假 0 筆），共 1 天',
      '選項清單：交辦單位 1 個、交辦人員 1 個、專案名稱 1 個、專案Repo 1 個',
      '略過的分頁：0 個',
      '需要留意：1 則',
      '',
      '略過的分頁',
      '',
      '需要留意',
      '2026H2「1009」 第 3 列：完成回報「??」對不上，改填待辦',
    ]);
    expect(backend.logs.at(-1)).toContain('紀錄：2 筆');
  });

  it('重新預覽：整張改寫，不殘留上一次的列', () => {
    addDay(h2, '1009', [legacyRow(), legacyRow({ 項次: 2 }), legacyRow({ 項次: 3 })]);
    fn('previewLegacyImport')();
    h2.deleteSheet(h2.getSheetByName('1009')!);
    addDay(h2, '1010', [legacyRow()]);
    fn('previewLegacyImport')();
    expect(sheet('匯入預覽')!.dump()).toHaveLength(2);
  });
});

describe('正式匯入（runLegacyImport）', () => {
  /** 匯入前新系統已經有的資料：一筆工作紀錄、一筆刪掉的、選項清單 */
  const seedExisting = (): void => {
    const post = (body: Record<string, unknown>) => backend.doPost({ idToken: 'token', ...body });
    const created = post({
      action: 'create',
      item: {
        工作日期: '2026/10/01',
        交辦單位: '舊單位',
        交辦人員: '舊人員',
        專案名稱: '舊專案',
        專案Repo: ['old-repo'],
        工作目標: '舊的',
        處理內容: '',
        今日工時: 1,
        預計期限: '',
        完成度: 0,
        狀態: '進行中',
      },
    }).item as WorkItem;
    post({ action: 'create', item: { ...created, 工作目標: '要刪的' } });
    const toDelete = (backend.doGet({ date: '2026/10/01' }).items as WorkItem[])[1]!;
    post({ action: 'delete', id: toDelete.id });
    ['A1', 'A2', 'A3'].forEach((value) =>
      post({ action: 'addOption', category: '交辦單位', value }),
    );
  };

  it('覆蓋工作紀錄、選項清單，清空已刪除紀錄，刪掉預覽分頁；新系統讀得到', () => {
    seedExisting();
    addDay(h2, '1009', [
      legacyRow({ 預計完成期限: '10/31' }),
      legacyRow({ 項次: 2, 工作內容: '特休', 今日工時: 4 }),
    ]);
    addDay(h2, '1008', [legacyRow({ 單位: '行銷部' })]);
    fn('previewLegacyImport')();
    fn('runLegacyImport')();

    expect(backend.doGet({ date: '2026/10/01' }).items).toEqual([]);
    const items = dayItems('2026/10/09');
    expect(items.map((i) => [i.項次, i.工作目標, i.狀態])).toEqual([
      [1, '首頁切版', '進行中'],
      [2, '特休', '休假'],
    ]);
    expect(items[0]).toMatchObject({
      工作日期: '2026/10/09',
      專案Repo: ['release_source'],
      處理內容: '完成 RWD 調整',
      預計期限: '2026/10/31',
      完成度: 50,
      已刪除: false,
    });
    expect(dayItems('2026/10/08')).toHaveLength(1);

    // 選項清單：整欄換掉（次數相同照日期先後），原本比較長的欄位不殘留舊值
    const options = backend.doGet({ type: 'options' }).options as Record<string, string[]>;
    expect(options).toEqual({
      交辦單位: ['行銷部', '資訊部'],
      交辦人員: ['王小明'],
      專案名稱: ['官網改版'],
      專案Repo: ['release_source'],
    });

    expect(sheet('已刪除紀錄')!.getLastRow()).toBe(1);
    expect(sheet('匯入預覽')).toBeNull();
    expect(sheet('匯入紀錄')!.dump()[1]![0]).toBe('紀錄：3 筆（其中請假 1 筆），共 2 天');
    expect(backend.logs.at(-1)).toMatch(/^已匯入\n紀錄：3 筆/);
  });

  it('匯入後可以照常新增，項次接在後面', () => {
    addDay(h2, '1009', [legacyRow(), legacyRow({ 項次: 5 })]);
    fn('runLegacyImport')();
    const created = backend.doPost({
      idToken: 'token',
      action: 'create',
      item: { ...dayItems('2026/10/09')[0], id: undefined, 今日工時: 1 },
    }).item as WorkItem;
    expect(created.項次).toBe(6);
  });

  it('文字欄位的值像數字、日期、TRUE：預覽與匯入都照原樣存成文字', () => {
    addDay(
      h2,
      '1009',
      [
        legacyRow({
          單位: '11111',
          交辦人員: 'TRUE',
          專案名稱: '2026/10/09',
          工作內容: '0123',
          今日處理情形: '12:30',
        }),
      ],
      LEGACY_HEADERS,
      true,
    );
    fn('previewLegacyImport')();
    const [headers, row] = sheet('匯入預覽')!.dump();
    expect(row![headers!.indexOf('工作目標')]).toBe('0123');
    expect(row![headers!.indexOf('專案名稱')]).toBe('2026/10/09');

    fn('runLegacyImport')();
    expect(dayItems('2026/10/09')[0]).toMatchObject({
      交辦單位: '11111',
      交辦人員: 'TRUE',
      專案名稱: '2026/10/09',
      工作目標: '0123',
      處理內容: '12:30',
    });
    const options = backend.doGet({ type: 'options' }).options as Record<string, string[]>;
    expect(options.交辦單位).toEqual(['11111']);
  });

  it('沒有讀到任何紀錄：丟錯取消，現有資料不動', () => {
    seedExisting();
    const before = sheet('工作紀錄')!.dump();
    addDay(h2, '工作表1', [legacyRow()]);
    expect(() => fn('runLegacyImport')()).toThrow('沒有讀到任何紀錄');
    expect(sheet('工作紀錄')!.dump()).toEqual(before);
    expect(sheet('已刪除紀錄')!.getLastRow()).toBe(2);
  });
});
