import { ref } from 'vue';

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

const ensureYearLoaded = (year: string): Promise<void> => {
  if (entriesByYear.value[year]) return Promise.resolve();

  const existing = fetchingYears.get(year);
  if (existing) return existing;

  const promise = fetch(YEAR_DATA_URL(year))
    .then((res) => (res.ok ? (res.json() as Promise<HolidayEntry[]>) : []))
    .then((entries) => {
      const map: Record<string, HolidayEntry> = {};
      entries.forEach((entry) => {
        const iso = `${entry.date.slice(0, 4)}-${entry.date.slice(4, 6)}-${entry.date.slice(6, 8)}`;
        map[iso] = entry;
      });
      entriesByYear.value = { ...entriesByYear.value, [year]: map };
    })
    .catch(() => {
      // 查詢失敗就不顯示假日資訊、也視為工作日，不影響其他功能
    })
    .finally(() => {
      fetchingYears.delete(year);
    });

  fetchingYears.set(year, promise);
  return promise;
};

const WEEKDAY_LABELS = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

const weekdayLabel = (dateStr: string): string =>
  WEEKDAY_LABELS[new Date(`${dateStr}T00:00:00`).getDay()];

/** 資料還沒抓回來時的備援猜測（只能猜一般週末，猜不到補班日），資料到位後一律以官方資料為準 */
const isWeekendFallback = (dateStr: string): boolean => {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
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

const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * 從 fromDate 往指定方向（1 或 -1）找下一個工作日，跳過連續的假日／週末
 * （含補班日的例外情形）。maxSteps 避免官方資料異常時無限迴圈。
 *
 * 日期解析要跟專案裡其他地方（例如 DateNav.vue 的 shift()）用同一套慣例：
 * `new Date(fromDate)`（純日期字串，視為 UTC 午夜）搭配 setDate/getDate（本地時間）
 * 再用 toISOString() 轉回字串。這套組合對正 UTC 偏移的時區（例如台灣 UTC+8）剛好互相抵銷、
 * 結果正確；如果改成 `${fromDate}T00:00:00`（本地午夜）解析、卻仍用 toISOString() 轉字串，
 * 兩邊時區基準不一致，換算回來的日期會少一天。
 */
const findNextWorkday = async (
  fromDate: string,
  direction: 1 | -1,
  maxSteps = 60,
): Promise<string> => {
  const cursor = new Date(fromDate);
  for (let i = 0; i < maxSteps; i++) {
    cursor.setDate(cursor.getDate() + direction);
    const iso = toDateString(cursor);
    await ensureYearLoaded(iso.slice(0, 4));
    if (isWorkday(iso)) return iso;
  }
  return fromDate;
};

export function useTaiwanHolidays() {
  return { getDayOffLabel, isWorkday, ensureYearLoaded, findNextWorkday };
}
