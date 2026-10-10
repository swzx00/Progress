import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import { FakeSpreadsheet } from './fake-spreadsheet';

/**
 * 在 Node 裡把 apps-script/Code.gs 當成真的後端跑：SpreadsheetApp 換成假的試算表（fake-spreadsheet.ts），
 * 其他 Apps Script 服務（指令碼屬性、UUID、日期格式化、登入驗證、回應輸出）也換成假的。
 * doGet／doPost 回傳解析好的 JSON，跟前端收到的一樣
 */
const CODE_GS = fileURLToPath(new URL('../../apps-script/Code.gs', import.meta.url));
const SOURCE = readFileSync(CODE_GS, 'utf-8');

export const OWNER_EMAIL = 'swzx00@gmail.com';
export const CLIENT_ID = 'test-client-id';

/** tokeninfo 的假回應：idToken 是 JSON 字串時直接當成 payload，'token' 是擁有者本人 */
const tokenPayload = (idToken: string): Record<string, unknown> | null => {
  if (idToken === 'token') return { email: OWNER_EMAIL, email_verified: 'true', aud: CLIENT_ID };
  try {
    return JSON.parse(idToken) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** Utilities.formatDate：測試時區固定台灣，所以直接用本地時間的年月日時分秒 */
const formatDate = (date: Date, _tz: string, format: string): string =>
  format
    .replace('yyyy', String(date.getFullYear()))
    .replace('MM', pad(date.getMonth() + 1))
    .replace('dd', pad(date.getDate()))
    .replace('HH', pad(date.getHours()))
    .replace('mm', pad(date.getMinutes()))
    .replace('ss', pad(date.getSeconds()));

export interface CodeGsBackend {
  spreadsheet: FakeSpreadsheet;
  doGet: (params: Record<string, string>) => Record<string, unknown>;
  doPost: (body: Record<string, unknown>) => Record<string, unknown>;
  /** Code.gs 的全域（常數、函式，例如一次性整理函式 compactOptionsSheet） */
  global: Record<string, unknown>;
}

export const loadCodeGsBackend = (properties: Record<string, string> = {}): CodeGsBackend => {
  const props: Record<string, string> = {
    SHEET_ID: 'sheet-id',
    GOOGLE_CLIENT_ID: CLIENT_ID,
    ...properties,
  };
  let uuid = 0;
  const context = createContext({});
  // 試算表裡的日期要用 Code.gs 那個環境的 Date 建立，Code.gs 的 instanceof Date 才認得
  const VmDate = runInContext('Date', context) as DateConstructor;
  const spreadsheet = new FakeSpreadsheet(VmDate);

  Object.assign(context, {
    SpreadsheetApp: {
      openById: (id: string) => {
        if (id !== props.SHEET_ID) throw new Error(`找不到試算表 ${id}`);
        return spreadsheet;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key: string) => props[key] ?? null }),
    },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      formatDate,
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    UrlFetchApp: {
      fetch: (url: string) => {
        const idToken = decodeURIComponent(new URL(url).searchParams.get('id_token') ?? '');
        const payload = tokenPayload(idToken);
        return {
          getResponseCode: () => (payload ? 200 : 400),
          getContentText: () => JSON.stringify(payload ?? { error: 'invalid_token' }),
        };
      },
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({
        content: text,
        setMimeType() {
          return this;
        },
      }),
    },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => undefined },
    Logger: { log: () => undefined },
  });
  runInContext(SOURCE, context, { filename: 'Code.gs' });

  const global = context as unknown as Record<string, unknown>;
  const parse = (output: { content: string }): Record<string, unknown> =>
    JSON.parse(output.content) as Record<string, unknown>;

  return {
    spreadsheet,
    global,
    doGet: (params) =>
      parse((global.doGet as (e: unknown) => { content: string })({ parameter: params })),
    doPost: (body) =>
      parse(
        (global.doPost as (e: unknown) => { content: string })({
          postData: { contents: JSON.stringify(body) },
        }),
      ),
  };
};
