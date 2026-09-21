import { ref } from 'vue'

interface HolidayEntry {
  date: string
  week: string
  isHoliday: boolean
  description: string
}

/**
 * 資料來源：https://github.com/ruyut/TaiwanCalendar，
 * 整理自政府資料開放平台「中華民國政府行政機關辦公日曆表」，透過 jsdelivr CDN 發布，
 * 支援 CORS，可直接在瀏覽器 fetch（見 CLAUDE.md）。只取 isHoliday 且有 description 的項目，
 * 排除純週末（isHoliday 為 true 但 description 是空字串的一般週六日）。
 */
const YEAR_DATA_URL = (year: string): string =>
  `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`

/**
 * 模組層級共用快取（不是每個元件各自一份），DateNav 的月曆格子跟 HomeView 的提示列
 * 讀的是同一份資料，同一年只會 fetch 一次；用 ref 包住讓讀取它的 computed/render
 * 在資料回來後能重新算一次。
 */
const holidaysByYear = ref<Record<string, Record<string, string>>>({})
const fetchingYears = new Set<string>()

const ensureYearLoaded = (year: string): void => {
  if (holidaysByYear.value[year] || fetchingYears.has(year)) return
  fetchingYears.add(year)
  fetch(YEAR_DATA_URL(year))
    .then((res) => (res.ok ? (res.json() as Promise<HolidayEntry[]>) : []))
    .then((entries) => {
      const map: Record<string, string> = {}
      entries.forEach((entry) => {
        if (entry.isHoliday && entry.description) {
          const iso = `${entry.date.slice(0, 4)}-${entry.date.slice(4, 6)}-${entry.date.slice(6, 8)}`
          map[iso] = entry.description
        }
      })
      holidaysByYear.value = { ...holidaysByYear.value, [year]: map }
    })
    .catch(() => {
      // 查詢失敗就不顯示假日資訊，不影響其他功能
    })
    .finally(() => {
      fetchingYears.delete(year)
    })
}

const getHolidayName = (dateStr: string): string | null => {
  const year = dateStr.slice(0, 4)
  ensureYearLoaded(year)
  return holidaysByYear.value[year]?.[dateStr] ?? null
}

export function useTaiwanHolidays() {
  return { getHolidayName, ensureYearLoaded }
}
