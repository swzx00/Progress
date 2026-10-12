/**
 * 月份檢視（使用者決定）：以月份為單位顯示工作紀錄，日期字串一律是 YYYY-MM-DD（見 utils/date.ts）
 */
import { parseLocalDate, toLocalDateString } from '@/utils/date';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** date 所在月份的第一天與最後一天（YYYY-MM-DD，含頭尾） */
export const monthRange = (date: string): { from: string; to: string } => {
  const d = parseLocalDate(date);
  return {
    from: toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: toLocalDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
};

/** 兩個日期是不是同一個月 */
export const isSameMonth = (a: string, b: string): boolean => a.slice(0, 7) === b.slice(0, 7);

/**
 * 往後（負數往前）切 months 個月，日保留；目標月份沒有那一天時改成月底（01/31 → 02/28），
 * 切回單日檢視時才會回到差不多的位置
 */
export const shiftMonth = (date: string, months: number): string => {
  const d = parseLocalDate(date);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + months + 1, 0).getDate();
  return toLocalDateString(
    new Date(d.getFullYear(), d.getMonth() + months, Math.min(d.getDate(), lastDay)),
  );
};

/** 月份檢視的日期欄：10/12（一） */
export const formatMonthDayLabel = (date: string): string =>
  `${date.slice(5).replace('-', '/')}（${WEEKDAYS[parseLocalDate(date).getDay()]}）`;

/** 照「工作日期 → 項次」排序（月初在上面），不改原陣列 */
export const sortByDateAndIndex = <T extends { 工作日期: string; 項次: number }>(items: T[]): T[] =>
  [...items].sort((a, b) =>
    a.工作日期 === b.工作日期 ? a.項次 - b.項次 : a.工作日期 < b.工作日期 ? -1 : 1,
  );
