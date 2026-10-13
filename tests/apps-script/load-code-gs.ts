import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

/**
 * 在 Node 裡載入 apps-script/Code.gs（＋同一個專案的 AutoFill.gs），取出不碰 Sheet 的純函式與常數，跟前端的同一套規則比對。
 * Code.gs 的頂層只有 var 與 function 宣告，載入時不會呼叫 SpreadsheetApp 等 Apps Script 服務；
 * 這裡只測不需要那些服務的函式，所以不用 mock
 */
const SCRIPTS = ['Code.gs', 'AutoFill.gs'];
const scriptPath = (name: string): string =>
  fileURLToPath(new URL(`../../apps-script/${name}`, import.meta.url));

// 只列出測試用到的部分，型別刻意寫寬，Code.gs 本身沒有型別
export interface CodeGs {
  VALIDATION_RULES: Record<string, Record<string, unknown>>;
  LEAVE_RULES: {
    status: string;
    fixed: Record<string, unknown>;
    types: string[];
    fields: Record<string, Record<string, unknown>>;
  };
  STATUS_OPTIONS: string[];
  DAILY_HOURS_MAX: number;
  WORK_HOURS_DAILY_STANDARD: number;
  RECENT_DAYS: number;
  RANGE_MAX_DAYS: number;
  THEME_MODE_VALUES: string[];
  SEARCH_FIELDS: string[];
  SEARCH_KEYWORD_MAX: number;
  SEARCH_MAX_RESULTS: number;
  validateItem_: (item: Record<string, unknown>) => string[];
  validateWorkHours_: (setting: unknown) => string | null;
  validateOptionValue_: (category: string, value: string) => string | null;
  dailyHoursError_: (otherHours: number, hours: number) => string;
  matchesSearch_: (item: Record<string, unknown>, keyword: string, field?: string) => boolean;
  normalizeSearch_: (value: unknown) => string;
  getNextDailyIndex_: (dayRows: { item: { 項次: number } }[]) => number;
  apiDateToUtc_: (value: string) => number;
  AUTO_FILL_NAME_MAX: number;
  AUTO_FILL_TEXT_MAX: number;
  validateAutoFill_: (setting: unknown) => string | null;
  /** AutoFill.gs 的 AUTO_FILL_URL_PATTERN.source（RegExp 經過下面的 JSON 轉換會變成空物件，另外取） */
  autoFillUrlPatternSource: () => string;
  buildDaySummary_: (items: unknown[]) => string;
  leaveStartTime_: (leaveHours: number, workHours: unknown) => string | null;
}

export const loadCodeGs = (): CodeGs => {
  const context = createContext({});
  SCRIPTS.forEach((name) =>
    runInContext(readFileSync(scriptPath(name), 'utf-8'), context, { filename: name }),
  );
  // vm 裡的陣列、物件來自另一個 realm，轉成 JSON 再解析，toEqual 比對時才不會因為原型不同而失敗
  return new Proxy(context as unknown as CodeGs, {
    get: (target, key: string) => {
      if (key === 'autoFillUrlPatternSource') {
        return () => runInContext('AUTO_FILL_URL_PATTERN.source', context) as string;
      }
      const value = (target as unknown as Record<string, unknown>)[key];
      return typeof value === 'function' || value === undefined
        ? value
        : (JSON.parse(JSON.stringify(value)) as unknown);
    },
  });
};
