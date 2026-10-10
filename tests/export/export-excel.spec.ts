import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { makeItem } from '@/testing/fixtures';
import type { WorkItem } from '@/types/work-item';
import {
  buildExportWorkbook,
  monthPeriod,
  quarterPeriod,
  rangePeriod,
  type ExportPeriod,
} from '@/utils/export-excel';

/**
 * 匯出 Excel 的檔案內容：真的產生 .xlsx 再用 ExcelJS 讀回來，檢查分頁分組、欄位、
 * 日期儲存格（UTC，不會差一天）、完成度格式、工時合計列、樣式；顏色要跟 tokens.scss 的淺色模式一致
 */
const build = async (period: ExportPeriod, items: WorkItem[]): Promise<ExcelJS.Workbook> => {
  const blob = await buildExportWorkbook(period, items);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  return workbook;
};

const sheetNames = (workbook: ExcelJS.Workbook): string[] =>
  workbook.worksheets.map((sheet) => sheet.name);

const rowValues = (sheet: ExcelJS.Worksheet, rowNumber: number): unknown[] =>
  (sheet.getRow(rowNumber).values as unknown[]).slice(1);

const headers = (sheet: ExcelJS.Worksheet): unknown[] => rowValues(sheet, 1);

const columnOf = (sheet: ExcelJS.Worksheet, header: string): number =>
  headers(sheet).indexOf(header) + 1;

const fillOf = (cell: ExcelJS.Cell): string | undefined =>
  (cell.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb;

/** tokens.scss 淺色模式（:root，深色模式之前）的色值轉成 ExcelJS 的 ARGB */
const TOKENS = readFileSync(
  fileURLToPath(new URL('../../src/styles/tokens.scss', import.meta.url)),
  'utf-8',
).split("[data-theme='dark']")[0]!;
const tokenArgb = (name: string): string => {
  const hex = new RegExp(`--color-${name}:\\s*#([0-9a-f]{3,6});`, 'i').exec(TOKENS)![1]!;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  return `FF${full.toUpperCase()}`;
};

const items = (): WorkItem[] => [
  makeItem({ id: 'b', 工作日期: '2026-10-09', 項次: 2, 工作目標: '第二筆', 今日工時: 3 }),
  makeItem({
    id: 'a',
    工作日期: '2026-10-09',
    項次: 1,
    工作目標: '第一筆\n第二行',
    專案Repo: ['AAA', 'BBBB'],
    今日工時: 2.5,
    預計期限: '2026-10-31',
    完成度: 12.25,
    狀態: '進行中',
  }),
  makeItem({
    id: 'leave',
    工作日期: '2026-10-09',
    項次: 3,
    狀態: '休假',
    工作目標: '特休',
    今日工時: 4,
  }),
  makeItem({ id: 'c', 工作日期: '2026-10-01', 項次: 1, 工作目標: '十月一日' }),
  makeItem({ id: 'd', 工作日期: '2026-11-02', 項次: 1, 工作目標: '十一月' }),
];

describe('分頁', () => {
  it('季度：每月一個分頁，沒有紀錄的月份不建', async () => {
    const workbook = await build(quarterPeriod(2026, 4), items());
    expect(sheetNames(workbook)).toEqual(['2026-10', '2026-11']);
  });

  it('月份：每天一個分頁，名稱帶星期，照日期排', async () => {
    const workbook = await build(
      monthPeriod(2026, 10),
      items().filter((i) => i.工作日期 < '2026-11'),
    );
    expect(sheetNames(workbook)).toEqual(['10-01 (四)', '10-09 (五)']);
  });

  it('指定天數跨年：日期分頁改用完整日期', async () => {
    const workbook = await build(rangePeriod('2026-12-31', '2027-01-04'), [
      makeItem({ id: 'x', 工作日期: '2027-01-04' }),
      makeItem({ id: 'y', 工作日期: '2026-12-31' }),
    ]);
    expect(sheetNames(workbook)).toEqual(['2026-12-31 (四)', '2027-01-04 (一)']);
  });
});

describe('月份分頁（年份、季度）', () => {
  it('欄位：工作日期（含星期）開頭、沒有項次，照工作日期 → 項次排序，沒有工時合計列', async () => {
    const sheet = (await build(quarterPeriod(2026, 4), items())).getWorksheet('2026-10')!;
    expect(headers(sheet)).toEqual([
      '工作日期',
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
    ]);
    const dates = [2, 3, 4, 5].map((r) => sheet.getRow(r).getCell(1).value);
    expect(dates).toEqual([
      '2026/10/01 (四)',
      '2026/10/09 (五)',
      '2026/10/09 (五)',
      '2026/10/09 (五)',
    ]);
    expect(sheet.getRow(3).getCell(columnOf(sheet, '工作目標')).value).toBe('第一筆\n第二行');
    expect(sheet.rowCount).toBe(5);
  });
});

describe('日期分頁（月份、指定天數）', () => {
  const daySheet = async (): Promise<ExcelJS.Worksheet> =>
    (await build(monthPeriod(2026, 10), items())).getWorksheet('10-09 (五)')!;

  it('項次開頭，照項次排序，最下面是工時合計（含請假）', async () => {
    const sheet = await daySheet();
    expect(headers(sheet)[0]).toBe('項次');
    expect([2, 3, 4].map((r) => sheet.getRow(r).getCell(1).value)).toEqual([1, 2, 3]);
    const total = sheet.getRow(5);
    expect(total.getCell(1).value).toBe('工時合計');
    expect(total.getCell(columnOf(sheet, '今日工時')).value).toBe(9.5);
    expect(total.getCell(1).font?.bold).toBe(true);
  });

  it('專案 Repo 用逗號串、完成度是數字配 General"%"、今日工時是數字', async () => {
    const sheet = await daySheet();
    const first = sheet.getRow(2);
    expect(first.getCell(columnOf(sheet, '專案Repo')).value).toBe('AAA,BBBB');
    const progress = first.getCell(columnOf(sheet, '完成度'));
    expect(progress.value).toBe(12.25);
    expect(progress.numFmt).toBe('General"%"');
    expect(first.getCell(columnOf(sheet, '今日工時')).value).toBe(2.5);
  });

  it('預計期限是日期儲存格（UTC 午夜，不會差一天），空值留白', async () => {
    const sheet = await daySheet();
    const col = columnOf(sheet, '預計期限');
    const due = sheet.getRow(2).getCell(col);
    expect(due.value).toBeInstanceOf(Date);
    expect((due.value as Date).toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(due.numFmt).toBe('yyyy/mm/dd');
    expect(sheet.getRow(3).getCell(col).value).toBeNull();
  });

  it('表頭凍結；自動篩選只含表頭與資料列，不含工時合計', async () => {
    const sheet = await daySheet();
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBe('A1:K4');
  });

  it('工作目標、處理內容自動換行，所有儲存格靠上', async () => {
    const sheet = await daySheet();
    const target = sheet.getRow(2).getCell(columnOf(sheet, '工作目標'));
    expect(target.alignment).toMatchObject({ vertical: 'top', wrapText: true });
    const status = sheet.getRow(2).getCell(columnOf(sheet, '狀態'));
    expect(status.alignment).toMatchObject({ vertical: 'top' });
    expect(status.alignment?.wrapText).toBeFalsy();
  });
});

describe('樣式（跟 tokens.scss 淺色模式一致）', () => {
  it('表頭 blue-700 底、black-000 粗體字', async () => {
    const sheet = (await build(monthPeriod(2026, 10), items())).getWorksheet('10-09 (五)')!;
    const header = sheet.getRow(1).getCell(1);
    expect(fillOf(header)).toBe(tokenArgb('blue-700'));
    expect(header.font).toMatchObject({ bold: true, color: { argb: tokenArgb('black-000') } });
  });

  it('斑馬紋第 1 筆 black-050、第 2 筆 black-000；請假列 teal-050 底、teal-800 字；合計列 black-100', async () => {
    const sheet = (await build(monthPeriod(2026, 10), items())).getWorksheet('10-09 (五)')!;
    expect(fillOf(sheet.getRow(2).getCell(1))).toBe(tokenArgb('black-050'));
    expect(sheet.getRow(2).getCell(1).font?.color?.argb).toBe(tokenArgb('black-800'));
    expect(fillOf(sheet.getRow(3).getCell(1))).toBe(tokenArgb('black-000'));
    expect(fillOf(sheet.getRow(4).getCell(1))).toBe(tokenArgb('teal-050'));
    expect(sheet.getRow(4).getCell(1).font?.color?.argb).toBe(tokenArgb('teal-800'));
    expect(fillOf(sheet.getRow(5).getCell(1))).toBe(tokenArgb('black-100'));
  });

  it('格線 black-100 細線', async () => {
    const sheet = (await build(monthPeriod(2026, 10), items())).getWorksheet('10-09 (五)')!;
    expect(sheet.getRow(2).getCell(3).border?.top).toMatchObject({
      style: 'thin',
      color: { argb: tokenArgb('black-100') },
    });
  });
});
