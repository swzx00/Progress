import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

import { FakeSpreadsheet } from './fake-spreadsheet';

/**
 * 在 Node 裡把 apps-script/Code.gs 當成真的後端跑：SpreadsheetApp 換成假的試算表（fake-spreadsheet.ts），
 * 其他 Apps Script 服務（指令碼屬性、UUID、日期格式化、登入驗證、回應輸出）也換成假的。
 * doGet／doPost 回傳解析好的 JSON，跟前端收到的一樣
 */
const readScript = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../apps-script/${name}`, import.meta.url)), 'utf-8');
const SOURCE = readScript('Code.gs');

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

/**
 * Utilities.formatDate：測試時區固定台灣，所以直接用本地時間的年月日時分秒。
 * 試算表時區是 Asia/Taipei、指令碼時區刻意設成別的（Session.getScriptTimeZone），
 * 傳進來的不是試算表時區就丟錯：日期要用試算表時區格式化，不然兩邊設定不同時會差一天
 */
const SHEET_TIME_ZONE = 'Asia/Taipei';
const formatDate = (date: Date, tz: string, format: string): string => {
  if (tz !== SHEET_TIME_ZONE) throw new Error(`formatDate 用了試算表以外的時區：${tz}`);
  return format
    .replace('yyyy', String(date.getFullYear()))
    .replace('MM', pad(date.getMonth() + 1))
    .replace('dd', pad(date.getDate()))
    .replace('HH', pad(date.getHours()))
    .replace('mm', pad(date.getMinutes()))
    .replace('ss', pad(date.getSeconds()));
};

export interface CodeGsBackend {
  spreadsheet: FakeSpreadsheet;
  doGet: (params: Record<string, string>) => Record<string, unknown>;
  doPost: (body: Record<string, unknown>) => Record<string, unknown>;
  /** Code.gs 的全域（常數、函式，例如一次性整理函式 compactOptionsSheet） */
  global: Record<string, unknown>;
  /** 其他試算表（SpreadsheetApp.openById 用 ID 找），例如 LegacyImport.gs 讀的舊表 */
  books: Map<string, FakeSpreadsheet>;
  /** 建一份空的試算表（日期用 Code.gs 那個環境的 Date） */
  newSpreadsheet: () => FakeSpreadsheet;
  /** Code.gs 那個環境的 Date，測試要放日期儲存格時用 */
  VmDate: DateConstructor;
  /** Logger.log 寫過的內容 */
  logs: string[];
  /** LockService 的拿鎖（'lock'）、放鎖（'release'）紀錄 */
  lockCalls: string[];
  /** 打到 LINE push API 的請求（含失敗的） */
  linePushes: { token: string; to: string; text: string }[];
  /** MailApp.sendEmail 寄過的信 */
  mails: { to: string; subject: string; body: string }[];
  /** ScriptApp.newTrigger 建立的觸發器設定、deleteTrigger 刪掉的觸發器 */
  triggers: { created: Record<string, unknown>[]; deleted: string[] };
}

export interface LoadOptions {
  /** 跟 Code.gs 一起載入的其他指令碼檔案（同一個 Apps Script 專案共用全域），例如 'LegacyImport.gs' */
  extraFiles?: string[];
  /** false：LockService 拿不到鎖（模擬其他寫入一直沒結束） */
  lockAvailable?: boolean;
  /**
   * 台灣辦公日曆（UrlFetchApp 抓 cdn.jsdelivr.net 的 {年}.json）：年份 → 那一年的資料，
   * 數字代表回應的 HTTP 狀態碼（例如 503），沒列到的年份回 404
   */
  holidays?: Record<string, { date: string; isHoliday: boolean }[] | number>;
  /** 已經存在的觸發器（ScriptApp.getProjectTriggers）的函式名稱 */
  existingTriggers?: string[];
  /** LINE push API 的回應：HTTP 狀態碼（預設 200），'throw' 模擬連線失敗 */
  lineResponse?: number | 'throw';
}

export const loadCodeGsBackend = (
  properties: Record<string, string> = {},
  {
    extraFiles = [],
    lockAvailable = true,
    holidays = {},
    existingTriggers = [],
    lineResponse = 200,
  }: LoadOptions = {},
): CodeGsBackend => {
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
  const books = new Map<string, FakeSpreadsheet>();
  const logs: string[] = [];
  const lockCalls: string[] = [];
  const mails: CodeGsBackend['mails'] = [];
  const linePushes: CodeGsBackend['linePushes'] = [];
  const triggers: CodeGsBackend['triggers'] = { created: [], deleted: [] };
  const projectTriggers = existingTriggers.map((handler) => ({
    getHandlerFunction: () => handler,
  }));

  Object.assign(context, {
    SpreadsheetApp: {
      openById: (id: string) => {
        if (id && id === props.SHEET_ID) return spreadsheet;
        const book = books.get(id);
        if (!book) throw new Error(`找不到試算表 ${id}`);
        return book;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (key: string) => props[key] ?? null }),
    },
    Utilities: {
      getUuid: () => `uuid-${++uuid}`,
      formatDate,
    },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    // lockCalls 記錄拿鎖、放鎖，確認 doPost 有加鎖
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          lockCalls.push('lock');
          return lockAvailable;
        },
        releaseLock: () => void lockCalls.push('release'),
      }),
    },
    UrlFetchApp: {
      fetch: (url: string, params?: { headers?: Record<string, string>; payload?: string }) => {
        if (url === 'https://api.line.me/v2/bot/message/push') {
          const body = JSON.parse(params?.payload ?? '{}') as {
            to: string;
            messages: { type: string; text: string }[];
          };
          linePushes.push({
            token: (params?.headers?.Authorization ?? '').replace(/^Bearer /, ''),
            to: body.to,
            text: body.messages[0]!.text,
          });
          if (lineResponse === 'throw') throw new Error('Address unavailable');
          return {
            getResponseCode: () => lineResponse,
            getContentText: () =>
              lineResponse === 200 ? '{}' : '{"message":"Authentication failed"}',
          };
        }
        const holiday = /\/TaiwanCalendar\/data\/(\d{4})\.json$/.exec(url);
        if (holiday) {
          const data = holidays[holiday[1]!] ?? 404;
          return {
            getResponseCode: () => (typeof data === 'number' ? data : 200),
            getContentText: () => (typeof data === 'number' ? '' : JSON.stringify(data)),
          };
        }
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
    MailApp: {
      sendEmail: (to: string, subject: string, body: string) =>
        void mails.push({ to, subject, body }),
    },
    ScriptApp: {
      getProjectTriggers: () => [...projectTriggers],
      deleteTrigger: (trigger: { getHandlerFunction: () => string }) => {
        triggers.deleted.push(trigger.getHandlerFunction());
        projectTriggers.splice(projectTriggers.indexOf(trigger), 1);
      },
      // 鏈式建立觸發器：每個設定方法把參數記下來，create() 時存進 triggers.created
      newTrigger: (handler: string) => {
        const config: Record<string, unknown> = { handler };
        const builder: Record<string, (...args: unknown[]) => unknown> = {};
        ['timeBased', 'everyDays', 'atHour', 'inTimezone', 'nearMinute'].forEach((method) => {
          builder[method] = (...args: unknown[]) => {
            config[method] = args.length > 0 ? args[0] : true;
            return builder;
          };
        });
        builder.create = () => void triggers.created.push(config);
        return builder;
      },
    },
    Logger: { log: (message: unknown) => void logs.push(String(message)) },
  });
  runInContext(SOURCE, context, { filename: 'Code.gs' });
  extraFiles.forEach((name) => runInContext(readScript(name), context, { filename: name }));

  const global = context as unknown as Record<string, unknown>;
  const parse = (output: { content: string }): Record<string, unknown> =>
    JSON.parse(output.content) as Record<string, unknown>;

  return {
    spreadsheet,
    global,
    books,
    newSpreadsheet: () => new FakeSpreadsheet(VmDate),
    VmDate,
    logs,
    lockCalls,
    mails,
    linePushes,
    triggers,
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
