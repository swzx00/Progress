import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import schema from '../../shared/validation-schema.json';

import { STATUS_OPTIONS } from '@/types/work-item';
import { SEARCH_FIELDS, matchesSearch, type SearchQuery } from '@/utils/search-work-items';
import {
  LEAVE_TYPES,
  dailyHoursMessage,
  validateLeave,
  validateWorkItem,
  type WorkItemFormValues,
} from '@/validation/work-item';

import { loadCodeGs } from '../apps-script/load-code-gs';
import { isoDateLike, numberField, textField } from './arbitraries';

/**
 * 前後端手動同步的規則，用隨機輸入比對前端與 Code.gs：結果不同就代表有一邊漏改。
 * tests/apps-script/consistency.spec.ts 是挑過的案例，這裡補上沒想到的組合。
 * 送到後端的值先 JSON 來回一次，跟真的打 API 一樣
 */
const gs = loadCodeGs();

const toApi = (values: WorkItemFormValues): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify({
      ...values,
      工作日期: values.工作日期.replaceAll('-', '/'),
      預計期限: values.預計期限.replaceAll('-', '/'),
    }),
  ) as Record<string, unknown>;

const repoName = (): fc.Arbitrary<string> =>
  fc.oneof(
    fc.constantFrom('AAA', 'web-app', 'a,b', ' ', 'x'.repeat(51)),
    fc.string({ maxLength: 12 }),
  );

const formValues = (): fc.Arbitrary<WorkItemFormValues> =>
  fc.record({
    工作日期: isoDateLike(),
    交辦單位: textField(50),
    交辦人員: textField(50),
    專案名稱: textField(50),
    專案Repo: fc.array(repoName(), { maxLength: 12 }),
    工作目標: textField(500),
    處理內容: textField(2000),
    今日工時: numberField(24),
    完成度: numberField(100),
    預計期限: isoDateLike(),
    狀態: fc.oneof(fc.constantFrom(...STATUS_OPTIONS, '', '完成', '休 假')),
  });

describe('工作紀錄驗證：validateWorkItem ↔ validateItem_', () => {
  it('任意輸入，錯誤訊息與順序相同', () => {
    fc.assert(
      fc.property(formValues(), (values) => {
        fc.pre(values.狀態 !== schema.leave.status);
        expect([...gs.validateItem_(toApi(values))]).toEqual(
          Object.values(validateWorkItem(values)),
        );
      }),
      { numRuns: 2000 },
    );
  });
});

describe('請假驗證：validateLeave ↔ validateItem_（狀態＝休假）', () => {
  it('任意輸入，錯誤訊息與順序相同（固定欄位亂填也不影響）', () => {
    fc.assert(
      fc.property(
        formValues(),
        fc.oneof(fc.constantFrom(...LEAVE_TYPES), textField(10)),
        numberField(8),
        (values, leaveType, hours) => {
          const leave = {
            ...values,
            狀態: schema.leave.status,
            工作目標: leaveType,
            今日工時: hours,
          };
          expect([...gs.validateItem_(toApi(leave))]).toEqual(Object.values(validateLeave(leave)));
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('每日工時合計訊息：dailyHoursMessage ↔ dailyHoursError_', () => {
  it('任意 0.25 倍數的時數（含浮點誤差累加出來的值）訊息相同', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.integer({ min: 0, max: 96 }).map((q) => q / 4),
          { maxLength: 8 },
        ),
        fc.integer({ min: 0, max: 96 }).map((q) => q / 4),
        (others, hours) => {
          // 跟畫面一樣一筆一筆加起來（0.1 + 0.2 這種誤差也要一致）
          const other = others.reduce((sum, h) => sum + h, 0);
          expect(gs.dailyHoursError_(other, hours)).toBe(dailyHoursMessage(other, hours));
        },
      ),
    );
  });
});

describe('搜尋比對：matchesSearch ↔ matchesSearch_', () => {
  // 字元刻意從小集合挑，關鍵字才常常真的對得到（大小寫、全形、# 號、空白、換行）
  const chars = fc.constantFrom(...'aAbB官網Ｂ#-_ \n1'.split(''));
  const word = fc.string({ unit: chars, maxLength: 6 });
  const item = fc.record({
    交辦單位: word,
    交辦人員: word,
    專案名稱: word,
    專案Repo: fc.array(word, { maxLength: 3 }),
    工作目標: word,
    處理內容: word,
    狀態: fc.constantFrom(...STATUS_OPTIONS, '休假'),
  });
  const query: fc.Arbitrary<SearchQuery> = fc.record(
    { keyword: word, field: fc.constantFrom(...SEARCH_FIELDS) },
    { requiredKeys: ['keyword'] },
  );

  it('任意紀錄與關鍵字，比對結果相同', () => {
    fc.assert(
      fc.property(item, query, (record, q) => {
        // 後端 handleSearch_ 先 normalizeSearch_，空白關鍵字直接回錯誤、不會比對
        fc.pre(gs.normalizeSearch_(q.keyword) !== '');
        const back = gs.matchesSearch_(record, gs.normalizeSearch_(q.keyword), q.field);
        expect(back).toBe(matchesSearch(record, q));
      }),
      { numRuns: 3000 },
    );
  });
});
