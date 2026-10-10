import { addDays } from '@/utils/date';

/** ruyut/TaiwanCalendar 的一筆資料（date 是 YYYYMMDD） */
export interface CalendarEntry {
  date: string;
  week: string;
  isHoliday: boolean;
  description: string;
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 測試用的假行事曆：產生一整年的資料，週末預設放假（description 空白，跟官方資料一樣），
 * holidays 是國定假日（日期 → 名稱），workdays 是補班日（週六但要上班）
 */
export const makeCalendar = (
  year: number,
  holidays: Record<string, string> = {},
  workdays: string[] = [],
): CalendarEntry[] => {
  const entries: CalendarEntry[] = [];
  for (let iso = `${year}-01-01`; iso.startsWith(String(year)); iso = addDays(iso, 1)) {
    const day = new Date(`${iso}T00:00:00`).getDay();
    const holiday = holidays[iso];
    const makeup = workdays.includes(iso);
    entries.push({
      date: iso.replaceAll('-', ''),
      week: WEEK[day]!,
      isHoliday: makeup ? false : holiday !== undefined || day === 0 || day === 6,
      description: makeup ? '補行上班' : (holiday ?? ''),
    });
  }
  return entries;
};
