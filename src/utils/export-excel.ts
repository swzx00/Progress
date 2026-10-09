import type { Borders, Fill, Font, Worksheet } from 'exceljs';

import { isLeaveItem, type WorkItem } from '@/types/work-item';

/**
 * 匯出 Excel 的規則（使用者決定）：匯出範圍、檔名、分頁分組、欄位、樣式都集中在這裡，
 * ExportModal 只負責畫面。ExcelJS 很大，用動態 import() 只在真的要匯出時才載入
 */

/** 匯出方式：年份／季度／月份／指定天數 */
export type ExportMode = 'year' | 'quarter' | 'month' | 'range';

/** 匯出範圍：from／to 是 YYYY-MM-DD（含頭尾） */
export interface ExportPeriod {
  mode: ExportMode;
  from: string;
  to: string;
}

/** 後端 type=range 一次最多可讀的天數（含頭尾），跟 Code.gs 的 RANGE_MAX_DAYS 一致 */
export const EXPORT_MAX_DAYS = 366;

const pad2 = (n: number): string => String(n).padStart(2, '0');

const toIsoDate = (year: number, month: number, day: number): string =>
  `${year}-${pad2(month)}-${pad2(day)}`;

// 某年某月的最後一天（month 1–12）：下個月的第 0 天
const lastDayOfMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

export const yearPeriod = (year: number): ExportPeriod => ({
  mode: 'year',
  from: toIsoDate(year, 1, 1),
  to: toIsoDate(year, 12, 31),
});

/** quarter 1–4 */
export const quarterPeriod = (year: number, quarter: number): ExportPeriod => {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  return {
    mode: 'quarter',
    from: toIsoDate(year, startMonth, 1),
    to: toIsoDate(year, endMonth, lastDayOfMonth(year, endMonth)),
  };
};

/** month 1–12 */
export const monthPeriod = (year: number, month: number): ExportPeriod => ({
  mode: 'month',
  from: toIsoDate(year, month, 1),
  to: toIsoDate(year, month, lastDayOfMonth(year, month)),
});

export const rangePeriod = (from: string, to: string): ExportPeriod => ({
  mode: 'range',
  from,
  to,
});

const isoToUtc = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
};

/** 範圍跨幾天（含頭尾） */
export const periodDays = (period: ExportPeriod): number =>
  Math.round((isoToUtc(period.to) - isoToUtc(period.from)) / 86400000) + 1;

/**
 * 檔名：工作進度_2026.xlsx／工作進度_2026Q4.xlsx／工作進度_2026-10.xlsx／
 * 工作進度_2026-10-01_2026-10-15.xlsx
 */
export const exportFileName = (period: ExportPeriod): string => {
  const year = period.from.slice(0, 4);
  const month = Number(period.from.slice(5, 7));
  const suffix = {
    year: year,
    quarter: `${year}Q${Math.ceil(month / 3)}`,
    month: period.from.slice(0, 7),
    range: `${period.from}_${period.to}`,
  }[period.mode];
  return `工作進度_${suffix}.xlsx`;
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// YYYY-MM-DD 的星期幾，用 UTC 算避免時區影響
const weekdayOf = (date: string): string => WEEKDAYS[new Date(isoToUtc(date)).getUTCDay()] ?? '';

/** 2026/10/09 (五) */
const displayDateWithWeekday = (date: string): string =>
  `${date.replaceAll('-', '/')} (${weekdayOf(date)})`;

/**
 * 分頁的分組方式：
 * - 年份、季度 → 每月一個「月份分頁」（2026-10）
 * - 月份、指定天數 → 每天一個「日期分頁」（10-01 (三)），指定天數跨年時改用 2026-12-31 (四) 避免同名
 * 沒有紀錄的月份／日子不建分頁
 */
const sheetKind = (mode: ExportMode): 'month' | 'day' =>
  mode === 'year' || mode === 'quarter' ? 'month' : 'day';

interface SheetGroup {
  name: string;
  items: WorkItem[];
}

const groupItems = (period: ExportPeriod, items: WorkItem[]): SheetGroup[] => {
  const kind = sheetKind(period.mode);
  const crossYear = period.from.slice(0, 4) !== period.to.slice(0, 4);
  const sorted = [...items].sort((a, b) => a.工作日期.localeCompare(b.工作日期) || a.項次 - b.項次);

  const groups = new Map<string, WorkItem[]>();
  sorted.forEach((item) => {
    const date = item.工作日期;
    const name =
      kind === 'month'
        ? date.slice(0, 7)
        : `${crossYear ? date : date.slice(5)} (${weekdayOf(date)})`;
    const group = groups.get(name);
    if (group) group.push(item);
    else groups.set(name, [item]);
  });
  return [...groups].map(([name, groupItems]) => ({ name, items: groupItems }));
};

// ===== 欄位 =====

interface ColumnDef {
  header: string;
  width: number;
  /** 自動換行（工作目標、處理內容） */
  wrap?: boolean;
  numFmt?: string;
  value: (item: WorkItem) => string | number | Date | null;
}

// 預計期限存成日期儲存格。ExcelJS 用 UTC 換算日期序號，所以用 UTC 午夜建 Date，不會差一天
const toExcelDate = (date: string): Date | null => (date ? new Date(isoToUtc(date)) : null);

/*
 * 完成度用「General"%"」：照實際值顯示、不補多餘的 0（70%、12.5%、12.25%，同畫面規則）。
 * 不用 0.##"%"：整數時 Excel 會多一個小數點（70.%）
 */
const PERCENT_FORMAT = 'General"%"';

const COMMON_COLUMNS: ColumnDef[] = [
  { header: '交辦單位', width: 14, value: (i) => i.交辦單位 },
  { header: '交辦人員', width: 12, value: (i) => i.交辦人員 },
  { header: '專案名稱', width: 20, value: (i) => i.專案名稱 },
  { header: '專案Repo', width: 20, value: (i) => i.專案Repo.join(',') },
  { header: '工作目標', width: 40, wrap: true, value: (i) => i.工作目標 },
  { header: '處理內容', width: 50, wrap: true, value: (i) => i.處理內容 },
  { header: '今日工時', width: 10, value: (i) => Number(i.今日工時) || 0 },
  { header: '預計期限', width: 12, numFmt: 'yyyy/mm/dd', value: (i) => toExcelDate(i.預計期限) },
  { header: '完成度', width: 10, numFmt: PERCENT_FORMAT, value: (i) => Number(i.完成度) || 0 },
  { header: '狀態', width: 10, value: (i) => i.狀態 },
];

const MONTH_SHEET_COLUMNS: ColumnDef[] = [
  { header: '工作日期', width: 16, value: (i) => displayDateWithWeekday(i.工作日期) },
  ...COMMON_COLUMNS,
];

const DAY_SHEET_COLUMNS: ColumnDef[] = [
  { header: '項次', width: 6, value: (i) => i.項次 },
  ...COMMON_COLUMNS,
];

// ===== 樣式（色值取自 src/styles/tokens.scss，ExcelJS 吃 ARGB，前面的 FF 是不透明度） =====

const COLOR = {
  white: 'FFFFFFFF', // black-000
  gray050: 'FFF8F9FA', // black-050
  gray100: 'FFE9ECEF', // black-100
  text: 'FF212529', // black-800
  headerBg: 'FF0F47B8', // blue-700
  leaveBg: 'FFDCF5FA', // teal-050
  leaveText: 'FF005C75', // teal-800
} as const;

const solidFill = (argb: string): Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});

const thinBorder = { style: 'thin', color: { argb: COLOR.gray100 } } as const;
const BORDER: Partial<Borders> = {
  top: thinBorder,
  left: thinBorder,
  bottom: thinBorder,
  right: thinBorder,
};

const styleRow = (sheet: Worksheet, rowNumber: number, fill: Fill, font: Partial<Font>): void => {
  sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = fill;
    cell.font = font;
    cell.border = BORDER;
  });
};

const fillSheet = (
  sheet: Worksheet,
  columns: ColumnDef[],
  items: WorkItem[],
  withTotal: boolean,
) => {
  sheet.columns = columns.map((col) => ({
    header: col.header,
    width: col.width,
    style: {
      ...(col.numFmt && { numFmt: col.numFmt }),
      alignment: { vertical: 'top', wrapText: col.wrap ?? false },
    },
  }));
  styleRow(sheet, 1, solidFill(COLOR.headerBg), { bold: true, color: { argb: COLOR.white } });

  items.forEach((item, index) => {
    const row = sheet.addRow(columns.map((col) => col.value(item)));
    // 請假列整列 teal，蓋過斑馬紋；斑馬紋第 1、3、5…筆較深
    if (isLeaveItem(item)) {
      styleRow(sheet, row.number, solidFill(COLOR.leaveBg), { color: { argb: COLOR.leaveText } });
    } else {
      const bg = index % 2 === 0 ? COLOR.gray050 : COLOR.white;
      styleRow(sheet, row.number, solidFill(bg), { color: { argb: COLOR.text } });
    }
  });

  // 表頭凍結，自動篩選只涵蓋表頭＋資料列（不含工時合計列）
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: items.length + 1, column: columns.length },
  };

  if (withTotal) {
    // 工時合計含請假，跟畫面上 DateNav 的今日工時合計同一套算法
    const total = items.reduce((sum, item) => sum + (Number(item.今日工時) || 0), 0);
    const values: (string | number | null)[] = columns.map(() => null);
    values[0] = '工時合計';
    values[columns.findIndex((col) => col.header === '今日工時')] = total;
    const row = sheet.addRow(values);
    styleRow(sheet, row.number, solidFill(COLOR.gray100), {
      bold: true,
      color: { argb: COLOR.text },
    });
  }
};

/**
 * 產生 Excel 檔案內容。items 是 fetchByRange 讀回來的紀錄（含請假），沒有紀錄時不要呼叫
 */
export const buildExportWorkbook = async (
  period: ExportPeriod,
  items: WorkItem[],
): Promise<Blob> => {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const kind = sheetKind(period.mode);

  groupItems(period, items).forEach((group) => {
    const sheet = workbook.addWorksheet(group.name);
    if (kind === 'month') fillSheet(sheet, MONTH_SHEET_COLUMNS, group.items, false);
    else fillSheet(sheet, DAY_SHEET_COLUMNS, group.items, true);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
};

/** 讓瀏覽器下載 Blob */
export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // 立刻釋放有些瀏覽器會中斷下載，等這一輪事件結束再釋放
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
