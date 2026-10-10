import { ref } from 'vue';

import { addDays, parseLocalDate } from '@/utils/date';

interface HolidayEntry {
  date: string;
  week: string;
  isHoliday: boolean;
  description: string;
}

/**
 * 資料來源：https://github.com/ruyut/TaiwanCalendar，
 * 整理自政府資料開放平台「中華民國政府行政機關辦公日曆表」，透過 jsdelivr CDN 發布，
 * 支援 CORS，可直接在瀏覽器 fetch（見 CLAUDE.md）。
 */
const YEAR_DATA_URL = (year: string): string =>
  `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;

/**
 * 存整筆原始資料（不是只存假日名稱），因為「是否要上班」要看 isHoliday，
 * 這個欄位才正確涵蓋週末＋國定假日＋補班日（補班的週六 isHoliday 會是 false）。
 * 模組層級共用快取，同一年只 fetch 一次。
 */
const entriesByYear = ref<Record<string, Record<string, HolidayEntry>>>({});
const fetchingYears = new Map<string, Promise<void>>();

/**
 * 網路錯誤後多久才重新抓。失敗不記下來的話，離線時每次 isWorkday／getDayOffLabel 都會再打一次，
 * findNextWorkday 最多 60 圈每圈都要等一個失敗的請求，按鈕看起來像卡住
 */
export const HOLIDAY_RETRY_AFTER_MS = 5 * 60 * 1000;
const failedAt = new Map<string, number>();

const ensureYearLoaded = (year: string): Promise<void> => {
  if (entriesByYear.value[year]) return Promise.resolve();

  const lastFailure = failedAt.get(year);
  if (lastFailure !== undefined && Date.now() - lastFailure < HOLIDAY_RETRY_AFTER_MS) {
    return Promise.resolve();
  }

  const existing = fetchingYears.get(year);
  if (existing) return existing;

  const promise = fetch(YEAR_DATA_URL(year))
    .then((res) => {
      if (res.ok) return res.json() as Promise<HolidayEntry[]>;
      // 404 是那一年還沒有資料（記成空的，不再重抓）；其他錯誤（503、429…）當成暫時失敗，過一段時間再抓
      if (res.status === 404) return [];
      throw new Error(`HTTP ${res.status}`);
    })
    .then((entries) => {
      const map: Record<string, HolidayEntry> = {};
      entries.forEach((entry) => {
        const iso = `${entry.date.slice(0, 4)}-${entry.date.slice(4, 6)}-${entry.date.slice(6, 8)}`;
        map[iso] = entry;
      });
      entriesByYear.value = { ...entriesByYear.value, [year]: map };
      failedAt.delete(year);
    })
    .catch(() => {
      // 查詢失敗就不顯示假日資訊、也視為工作日，不影響其他功能；過 HOLIDAY_RETRY_AFTER_MS 才重抓
      failedAt.set(year, Date.now());
    })
    .finally(() => {
      fetchingYears.delete(year);
    });

  fetchingYears.set(year, promise);
  return promise;
};

const WEEKDAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

const weekdayLabel = (dateStr: string): string => WEEKDAY_LABELS[parseLocalDate(dateStr).getDay()];

/** 資料還沒抓回來時的備援猜測（只能猜一般週末，猜不到補班日），資料到位後一律以官方資料為準 */
const isWeekendFallback = (dateStr: string): boolean => {
  const day = parseLocalDate(dateStr).getDay();
  return day === 0 || day === 6;
};

/**
 * 回傳這天「放假的原因」：國定假日回傳假日名稱（例如「中秋節」），純週末沒有
 * description，回傳「週六」/「週日」這種通用標籤，一般工作日回傳 null。
 */
const getDayOffLabel = (dateStr: string): string | null => {
  const year = dateStr.slice(0, 4);
  void ensureYearLoaded(year);
  const entry = entriesByYear.value[year]?.[dateStr];
  if (entry) return entry.isHoliday ? entry.description || weekdayLabel(dateStr) : null;
  return isWeekendFallback(dateStr) ? weekdayLabel(dateStr) : null;
};

/** 是否為工作日（含補班日的正確判斷），用來給「上一個工作日／下一個工作日」按鈕的 disabled 狀態用 */
const isWorkday = (dateStr: string): boolean => {
  const year = dateStr.slice(0, 4);
  void ensureYearLoaded(year);
  const entry = entriesByYear.value[year]?.[dateStr];
  if (entry) return !entry.isHoliday;
  return !isWeekendFallback(dateStr);
};

/**
 * 從 fromDate 往指定方向（1 或 -1）找下一個工作日，跳過連續的假日／週末
 * （含補班日的例外情形）。maxSteps 避免官方資料異常時無限迴圈。
 * 日期加減一律用 utils/date.ts 的 addDays（本地時間解析與格式化）
 */
const findNextWorkday = async (
  fromDate: string,
  direction: 1 | -1,
  maxSteps = 60,
): Promise<string> => {
  let iso = fromDate;
  for (let i = 0; i < maxSteps; i++) {
    iso = addDays(iso, direction);
    await ensureYearLoaded(iso.slice(0, 4));
    if (isWorkday(iso)) return iso;
  }
  return fromDate;
};

export function useTaiwanHolidays() {
  return { getDayOffLabel, isWorkday, ensureYearLoaded, findNextWorkday };
}
