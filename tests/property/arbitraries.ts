import fc from 'fast-check';

/**
 * 隨機輸入測試共用的產生器（fast-check）：刻意混進邊界值與不合法的值，
 * 讓同一個屬性在「合法」「差一點」「完全亂填」之間都被試到
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** HH:mm：多數落在 15 分鐘格線上，也混進任意分鐘與格式不對的字串 */
export const timeString = (): fc.Arbitrary<string> =>
  fc.oneof(
    { weight: 6, arbitrary: fc.integer({ min: 0, max: 95 }).map((q) => toTime(q * 15)) },
    { weight: 2, arbitrary: fc.integer({ min: 0, max: 1439 }).map(toTime) },
    {
      weight: 1,
      arbitrary: fc.constantFrom('', '9:00', '24:00', '12:60', '12', 'ab:cd', ' 09:00', '09:00 '),
    },
  );

export const toTime = (minutes: number): string =>
  `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

/** YYYY-MM-DD：年份含 schema 邊界（2020–2099）外一點，月日含 0、13、2/29、4/31 這類不存在的日期 */
export const isoDateLike = (): fc.Arbitrary<string> =>
  fc.oneof(
    {
      weight: 8,
      arbitrary: fc
        .tuple(
          fc.integer({ min: 2018, max: 2101 }),
          fc.integer({ min: 0, max: 13 }),
          fc.integer({ min: 0, max: 32 }),
        )
        .map(([y, m, d]) => `${y}-${pad2(m)}-${pad2(d)}`),
    },
    // 前端日期不會出現斜線（原生日期欄位只給 YYYY-MM-DD），所以不放 2026/10/09
    { weight: 1, arbitrary: fc.constantFrom('', '2026-1-9', '2026.10.09', '20261009', 'abc') },
  );

/** 真的存在的日期（本地時間），1970–2200 */
export const realDate = (): fc.Arbitrary<Date> =>
  fc
    .tuple(
      fc.integer({ min: 1970, max: 2200 }),
      fc.integer({ min: 0, max: 11 }),
      fc.integer({ min: 1, max: 31 }),
    )
    .map(([y, m, d]) => new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate())));

/** 工時、完成度這類數字欄位：0.25 的倍數為主，混進小數、負數、超出範圍與空白 */
export const numberField = (max: number): fc.Arbitrary<number | ''> =>
  fc.oneof(
    { weight: 5, arbitrary: fc.integer({ min: -4, max: max * 4 + 4 }).map((q) => q / 4) },
    { weight: 2, arbitrary: fc.double({ min: -10, max: max + 10, noNaN: true }) },
    { weight: 1, arbitrary: fc.constant('' as const) },
  );

/** 文字欄位：空白、只有空白、一般文字、剛好在字數上限附近（前後可能多一個空白） */
export const textField = (maxLength: number): fc.Arbitrary<string> =>
  fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom('', '  ', '\n') },
    { weight: 4, arbitrary: fc.string({ maxLength: 20 }) },
    {
      weight: 2,
      arbitrary: fc
        .tuple(fc.integer({ min: maxLength - 2, max: maxLength + 2 }), fc.constantFrom('', ' '))
        .map(([n, pad]) => `${pad}${'a'.repeat(n)}${pad}`),
    },
  );
