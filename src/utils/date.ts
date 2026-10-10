/**
 * 前端內部的日期字串一律是本地時間的 YYYY-MM-DD（<input type="date"> 吃這個格式），都用這裡產生。
 * 不要用 toISOString()：它會先換成 UTC，台灣（UTC+8）凌晨 0:00–7:59 會算成前一天
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Date 轉成本地時間的 YYYY-MM-DD */
export const toLocalDateString = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 今天（本地時間）的 YYYY-MM-DD */
export const todayString = (): string => toLocalDateString(new Date());

/** YYYY-MM-DD 轉成本地午夜的 Date（new Date('YYYY-MM-DD') 會被當成 UTC 午夜，不能直接用） */
export const parseLocalDate = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
};

/** YYYY-MM-DD 往後（負數往前）加 days 天，跨月、跨年都會自動進位 */
export const addDays = (date: string, days: number): string => {
  const d = parseLocalDate(date);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
};

/** 是不是存在的 YYYY-MM-DD（格式對、日期也真的存在，2026-02-30 這種會被 Date 進位的不算） */
export const isValidDateString = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && toLocalDateString(parseLocalDate(value)) === value;
