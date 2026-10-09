import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

/**
 * 在 Node 裡載入 apps-script/Code.gs，取出不碰 Sheet 的純函式與常數，跟前端的同一套規則比對。
 * Code.gs 的頂層只有 var 與 function 宣告，載入時不會呼叫 SpreadsheetApp 等 Apps Script 服務；
 * 這裡只測不需要那些服務的函式，所以不用 mock
 */
const CODE_GS = fileURLToPath(new URL('../../apps-script/Code.gs', import.meta.url));

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
  SEARCH_FIELDS: string[];
  SEARCH_KEYWORD_MAX: number;
  SEARCH_MAX_RESULTS: number;
  validateItem_: (item: Record<string, unknown>) => string[];
  validateWorkHours_: (setting: unknown) => string | null;
  dailyHoursError_: (otherHours: number, hours: number) => string;
  matchesSearch_: (item: Record<string, unknown>, keyword: string, field?: string) => boolean;
  normalizeSearch_: (value: unknown) => string;
  getNextDailyIndex_: (dayRows: { item: { 項次: number } }[]) => number;
  apiDateToUtc_: (value: string) => number;
}

export const loadCodeGs = (): CodeGs => {
  const context = createContext({});
  runInContext(readFileSync(CODE_GS, 'utf-8'), context, { filename: 'Code.gs' });
  // vm 裡的陣列、物件來自另一個 realm，轉成 JSON 再解析，toEqual 比對時才不會因為原型不同而失敗
  return new Proxy(context as unknown as CodeGs, {
    get: (target, key: string) => {
      const value = (target as unknown as Record<string, unknown>)[key];
      return typeof value === 'function' || value === undefined
        ? value
        : (JSON.parse(JSON.stringify(value)) as unknown);
    },
  });
};
