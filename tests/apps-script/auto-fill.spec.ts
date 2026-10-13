import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkItem } from '@/types/work-item';

import { DAY, input, leaveInput } from '../backend/contract';

import type { FakeSheet, FakeSpreadsheet } from './fake-spreadsheet';
import {
  OWNER_EMAIL,
  loadCodeGsBackend,
  type CodeGsBackend,
  type LoadOptions,
} from './load-code-gs-backend';

/**
 * 自動填入（使用者決定）：每個工作日把本日總結填進別人的試算表（每月一個「年＋月」分頁、
 * 第 2 列是日期、B 欄是姓名、一人一天一格），沒問題就寫、有問題寄信；本日總結的「填入」按鈕共用同一套找格子規則。
 * DAY（2099/01/05）是星期一，2099 年沒有辦公日曆資料時退回只看週末
 */
const TARGET_ID = 'target-sheet-id-1234567890';
const TARGET_URL = `https://docs.google.com/spreadsheets/d/${TARGET_ID}/edit?gid=0#gid=0`;
const NAME = '林家丞';
// 對方的月份分頁實際上是「2026/10」這種寫法（下載成 .xlsx 時「/」會被拿掉，變成 202610）
const SHEET_NAME = '2099/1';
const WORK_HOURS = { start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' };

let backend: CodeGsBackend;
let target: FakeSpreadsheet;

const post = (body: Record<string, unknown>) => backend.doPost({ idToken: 'token', ...body });
/** 新增一筆紀錄，預設 8 小時（自動執行要工時合計滿 8 小時才寫入） */
const create = (overrides: Partial<WorkItem> = {}): void => {
  const data = post({ action: 'create', item: input({ 今日工時: 8, ...overrides }) });
  expect(data.error).toBeUndefined();
};

/** 對方的月份分頁：第 2 列 E 欄起是工作日（1/5、1/6），第 3 列表頭，第 4 列起一人一列 */
const buildTarget = (name = SHEET_NAME): FakeSheet => {
  const sheet = target.insertSheet(name);
  const { VmDate } = backend;
  sheet
    .getRange(2, 1, 1, 6)
    .setValues([['主管', '', '', '', new VmDate(2099, 0, 5), new VmDate(2099, 0, 6)]]);
  sheet
    .getRange(3, 1, 1, 6)
    .setValues([['序', '姓名', '職稱', '座位', '每日工作進度', '每日工作進度']]);
  sheet.getRange(4, 1, 1, 4).setValues([[1, '王小明', '工程師', '9樓']]);
  sheet.getRange(5, 1, 1, 4).setValues([[2, NAME, '前端工程師', '9樓']]);
  return sheet;
};

// 通知用的 LINE 設定（指令碼屬性）；預設有設定，通知都走 LINE，Email 備援另外測
const LINE_PROPS = { LINE_CHANNEL_ACCESS_TOKEN: 'line-token', LINE_USER_ID: 'U0123456789abcdef' };

const setup = (
  options: LoadOptions = {},
  properties: Record<string, string> = LINE_PROPS,
): void => {
  backend = loadCodeGsBackend(properties, { ...options, extraFiles: ['AutoFill.gs'] });
  target = backend.newSpreadsheet();
  backend.books.set(TARGET_ID, target);
};

const enable = (overrides: Record<string, unknown> = {}) =>
  post({
    action: 'saveAutoFillSetting',
    autoFill: { enabled: true, url: TARGET_URL, name: NAME, ...overrides },
  });

const run = (date = new Date(2099, 0, 5, 16, 20)) =>
  (backend.global.runAutoFill_ as (now: Date) => { status: string })(date);

/** 自己那一格（1/5 是 E 欄、1/6 是 F 欄） */
const myCell = (col = 5) => target.getSheetByName(SHEET_NAME)!.getRange(5, col).getValues()[0]![0];

/** 推出去的 LINE 通知：第一行是標題，空一行後是內容 */
const notices = () =>
  backend.linePushes.map(({ text }) => {
    const [title = '', ...rest] = text.split('\n\n');
    return { title, body: rest.join('\n\n') };
  });

beforeEach(() => {
  setup();
  buildTarget();
  post({ action: 'saveWorkHours', workHours: WORK_HOURS });
});

describe('自動填入設定', () => {
  it('沒有設定時回傳停用、空白；不從公開的 doGet 回傳', () => {
    expect(post({ action: 'getAutoFillSetting' }).autoFill).toEqual({
      enabled: false,
      url: '',
      name: '',
    });
    expect(backend.doGet({ type: 'options' })).not.toHaveProperty('autoFill');
  });

  it('儲存後讀得回來，存在選項清單的「自動填入設定」欄（純文字）', () => {
    expect(enable().autoFill).toEqual({ enabled: true, url: TARGET_URL, name: NAME });
    expect(post({ action: 'getAutoFillSetting' }).autoFill).toEqual({
      enabled: true,
      url: TARGET_URL,
      name: NAME,
    });
    const sheet = backend.spreadsheet.getSheetByName('選項清單')!;
    expect(sheet.column('自動填入設定').slice(0, 3)).toEqual(['TRUE', TARGET_URL, NAME]);
  });

  it('要登入', () => {
    const data = backend.doPost({ idToken: '', action: 'getAutoFillSetting' });
    expect(data.code).toBe('UNAUTHORIZED');
  });

  it('停用時網址、姓名可以留空，也不檢查對方試算表', () => {
    backend.books.delete(TARGET_ID);
    expect(
      post({ action: 'saveAutoFillSetting', autoFill: { enabled: false, url: '', name: '' } })
        .autoFill,
    ).toEqual({
      enabled: false,
      url: '',
      name: '',
    });
    expect(
      post({
        action: 'saveAutoFillSetting',
        autoFill: { enabled: false, url: TARGET_URL, name: NAME },
      }).autoFill,
    ).toEqual({ enabled: false, url: TARGET_URL, name: NAME });
  });

  it.each([
    [{ enabled: 'yes', url: TARGET_URL, name: NAME }, '自動填入設定格式不正確'],
    [{ enabled: true, url: '', name: NAME }, '請填寫試算表網址'],
    [
      { enabled: true, url: 'https://example.com/x', name: NAME },
      '試算表網址格式不正確，請貼上 Google 試算表的網址',
    ],
    [
      { enabled: false, url: 'not a url', name: '' },
      '試算表網址格式不正確，請貼上 Google 試算表的網址',
    ],
    [{ enabled: true, url: TARGET_URL, name: ' ' }, '請填寫姓名'],
    [{ enabled: true, url: TARGET_URL, name: '名'.repeat(21) }, '姓名不可超過 20 個字'],
  ])('驗證 %j', (autoFill, error) => {
    expect(post({ action: 'saveAutoFillSetting', autoFill }).error).toBe(error);
  });

  it('啟用時先確認打得開、找得到姓名', () => {
    expect(enable({ name: '查無此人' }).error).toBe(
      '在試算表裡找不到「查無此人」，請確認姓名跟試算表上的寫法一樣',
    );
    backend.books.delete(TARGET_ID);
    expect(enable().error).toBe('打不開這份試算表，請確認網址正確，而且你的帳號有編輯權限');
    expect(post({ action: 'getAutoFillSetting' }).autoFill).toEqual({
      enabled: false,
      url: '',
      name: '',
    });
  });
});

describe('填入的文字', () => {
  const text = (items: Partial<WorkItem>[]): string =>
    (backend.global.buildAutoFillText_ as (items: unknown[], workHours: unknown) => string)(
      items.map((item) => ({ ...input(), 項次: 1, ...item })),
      WORK_HOURS,
    );

  it('沒有請假：本日總結', () => {
    expect(
      text([{ 專案Repo: ['release_source'], 工作目標: '#7829 調整', 處理內容: '調整 margin' }]),
    ).toBe('1.release_source #7829\n- 調整 margin');
  });

  it('只有請假：「請假」', () => {
    expect(text([leaveInput({ 今日工時: 2 })])).toBe('請假');
  });

  it('有工作也有請假：最後空一行加「HH:MM 請假」（下班時間往前扣請假時數，跨午休要跳過）', () => {
    const work = { 專案名稱: '官網', 處理內容: '' };
    expect(text([work, { ...leaveInput({ 今日工時: 2 }), 項次: 2 }])).toBe('1.官網\n\n16:00 請假');
    expect(text([work, { ...leaveInput({ 今日工時: 5 }), 項次: 2 }])).toBe('1.官網\n\n13:00 請假');
    expect(text([work, { ...leaveInput({ 今日工時: 6 }), 項次: 2 }])).toBe('1.官網\n\n11:00 請假');
  });

  it('沒有工時設定：只寫「請假」', () => {
    const build = backend.global.buildAutoFillText_ as (
      items: unknown[],
      workHours: unknown,
    ) => string;
    expect(
      build(
        [
          { ...input({ 專案名稱: '官網' }), 項次: 1 },
          { ...leaveInput({ 今日工時: 2 }), 項次: 2 },
        ],
        null,
      ),
    ).toBe('1.官網\n\n請假');
  });
});

describe('自動執行（觸發器）', () => {
  it('沒啟用：什麼都不做', () => {
    create({ 專案名稱: '官網' });
    expect(run().status).toBe('disabled');
    expect(myCell()).toBe('');
    expect(notices()).toEqual([]);
  });

  describe('啟用後', () => {
    beforeEach(() => {
      expect(enable().error).toBeUndefined();
    });

    it('格子是空的：寫入當天的本日總結，LINE 通知已填入（附分頁與內容）', () => {
      create({ 專案Repo: ['release_source'], 工作目標: 'T12346 埋 JS', 處理內容: '新增 oplog.js' });
      expect(run().status).toBe('written');
      expect(myCell()).toBe('1.release_source T12346\n- 新增 oplog.js');
      expect(myCell(6)).toBe('');
      expect(notices()).toEqual([
        {
          title: '【工作進度】2099/01/05 已自動填入',
          body: '已填進對方試算表的「2099/1」分頁。\n\n填入的內容：\n1.release_source T12346\n- 新增 oplog.js',
        },
      ]);
      expect(backend.mails).toEqual([]);
    });

    it('格子已經是一樣的內容：不重複寫入，通知已經是一樣的內容', () => {
      create({ 專案名稱: '官網' });
      run();
      expect(run().status).toBe('unchanged');
      expect(notices()).toHaveLength(2);
      expect(notices()[1]!.title).toBe('【工作進度】2099/01/05 對方的試算表已經是一樣的內容');
    });

    it('格子已經有不同的內容：不覆蓋，通知附上兩邊的內容', () => {
      create({ 專案名稱: '官網' });
      target.getSheetByName(SHEET_NAME)!.getRange(5, 5).setValue('手動寫的');
      expect(run().status).toBe('conflict');
      expect(myCell()).toBe('手動寫的');
      expect(notices()).toHaveLength(1);
      expect(backend.linePushes[0]!.to).toBe(LINE_PROPS.LINE_USER_ID);
      expect(backend.linePushes[0]!.token).toBe(LINE_PROPS.LINE_CHANNEL_ACCESS_TOKEN);
      expect(notices()[0]!.title).toContain('已經有內容');
      expect(notices()[0]!.body).toContain('手動寫的');
      expect(notices()[0]!.body).toContain('1.官網');
    });

    it('工時合計（含請假）未滿 8 小時：不寫入，通知附上要填的內容', () => {
      create({ 專案名稱: '官網', 今日工時: 5.75 });
      expect(run().status).toBe('insufficient');
      expect(myCell()).toBe('');
      expect(notices()[0]!.title).toContain('工時合計未滿 8 小時');
      expect(notices()[0]!.body).toContain('目前工時合計 5.75 小時');
      expect(notices()[0]!.body).toContain('1.官網');
    });

    it('工作加請假剛好 8 小時：寫入，最後加請假時間', () => {
      create({ 專案名稱: '官網', 今日工時: 6 });
      post({ action: 'create', item: leaveInput({ 今日工時: 2 }) });
      expect(run().status).toBe('written');
      expect(myCell()).toBe('1.官網\n\n16:00 請假');
      expect(notices().map(({ title }) => title)).toEqual(['【工作進度】2099/01/05 已自動填入']);
    });

    it('當天沒有紀錄：通知提醒', () => {
      expect(run().status).toBe('empty');
      expect(notices()[0]!.title).toContain('沒有可以填入的工作紀錄');
    });

    it('週末不執行', () => {
      create({ 工作日期: '2099/01/03', 專案名稱: '官網' });
      expect(run(new Date(2099, 0, 3, 16)).status).toBe('holiday');
      expect(notices()).toEqual([]);
    });

    it('找不到這個月的分頁、日期、姓名：通知，不寫入', () => {
      create({ 工作日期: '2099/01/07', 專案名稱: '官網' });
      expect(run(new Date(2099, 0, 7, 16))).toEqual({ status: 'error' });
      expect(notices().at(-1)!.title).toContain('找不到 2099/01/07 這一欄');

      create({ 工作日期: '2099/02/02', 專案名稱: '官網' });
      run(new Date(2099, 1, 2, 16));
      expect(notices().at(-1)!.title).toContain('找不到 2099 年 2 月的分頁');

      target.getSheetByName(SHEET_NAME)!.getRange(5, 2).setValue('改名了');
      create({ 專案名稱: '官網' });
      run();
      expect(notices().at(-1)!.title).toContain('找不到「林家丞」');
      expect(notices().at(-1)!.body).toContain('1.官網');
    });

    it('其他月份的分頁不會被當成這個月（2099/11、209911、2099/10 都不是 1 月）', () => {
      setup();
      ['2099/11', '209911', '2099/10', '2098/1'].forEach((name) => buildTarget(name));
      expect(enable().error).toBeUndefined();
      create({ 專案名稱: '官網' });
      expect(run().status).toBe('error');
      expect(notices().at(-1)!.title).toContain('找不到 2099 年 1 月的分頁');
    });

    it('打不開對方的試算表：通知', () => {
      create({ 專案名稱: '官網' });
      backend.books.delete(TARGET_ID);
      expect(run().status).toBe('error');
      expect(notices()[0]!.title).toContain('打不開對方的試算表');
    });
  });

  it('照台灣辦公日曆：國定假日不執行、補班日照常執行', () => {
    setup({
      holidays: {
        '2099': [
          { date: '20990105', isHoliday: true },
          { date: '20990103', isHoliday: false },
        ],
      },
    });
    const sheet = buildTarget();
    sheet.getRange(2, 7).setValue(new backend.VmDate(2099, 0, 3));
    expect(enable().error).toBeUndefined();
    create({ 專案名稱: '官網' });
    expect(run().status).toBe('holiday');
    create({ 工作日期: '2099/01/03', 專案名稱: '補班' });
    expect(run(new Date(2099, 0, 3, 16)).status).toBe('written');
  });

  it('辦公日曆抓不到（503）：退回只看週末', () => {
    setup({ holidays: { '2099': 503 } });
    buildTarget();
    expect(enable().error).toBeUndefined();
    create({ 專案名稱: '官網' });
    expect(run().status).toBe('written');
  });

  it('runAutoFill 拿鎖執行，發生錯誤時通知', () => {
    expect(enable().error).toBeUndefined();
    (backend.global.runAutoFill as () => void)();
    expect(backend.lockCalls.slice(-2)).toEqual(['lock', 'release']);

    setup({ lockAvailable: false });
    buildTarget();
    (backend.global.runAutoFill as () => void)();
    expect(notices().at(-1)!.title).toContain('執行時發生錯誤');
  });
});

describe('本日總結的「填入」按鈕（autoFillNow）', () => {
  const fillNow = (text: string, date = DAY) => post({ action: 'autoFillNow', date, text });

  it('沒啟用：回錯誤', () => {
    expect(fillNow('內容').error).toBe('自動填入沒有啟用');
  });

  describe('啟用後', () => {
    beforeEach(() => {
      expect(enable().error).toBeUndefined();
    });

    it('填入畫面上的文字（可能手動改過），不管工作日、工時合計（未滿 8 小時也照樣寫），不通知', () => {
      create({ 專案名稱: '官網', 今日工時: 1 });
      expect(fillNow('  手動整理的內容\n- 第二行  ')).toEqual({ status: 'written' });
      expect(myCell()).toBe('手動整理的內容\n- 第二行');
      expect(fillNow('手動整理的內容\n- 第二行')).toEqual({ status: 'unchanged' });
      expect(notices()).toEqual([]);
      expect(backend.mails).toEqual([]);
    });

    it('格子已經有不同的內容：不覆蓋，回錯誤', () => {
      fillNow('第一次');
      expect(fillNow('第二次').error).toBe(
        '對方試算表的格子已經有內容，為了不覆蓋別人的紀錄，這次沒有寫入',
      );
      expect(myCell()).toBe('第一次');
    });

    it('驗證日期、內容；找不到格子回錯誤原因', () => {
      expect(fillNow('內容', '2099-01-05').error).toBe('日期格式不正確');
      expect(fillNow('  ').error).toBe('沒有可以填入的內容');
      expect(fillNow('字'.repeat(5001)).error).toBe('填入內容不可超過 5000 個字');
      expect(fillNow('內容', '2099/01/07').error).toBe('「2099/1」分頁裡找不到 2099/01/07 這一欄');
    });
  });
});

describe('installAutoFillTrigger', () => {
  it('先刪掉舊的 runAutoFill 觸發器，再建一個每天 16 點（台灣時間）的', () => {
    setup({ existingTriggers: ['runAutoFill', 'otherJob'] });
    (backend.global.installAutoFillTrigger as () => void)();
    expect(backend.triggers.deleted).toEqual(['runAutoFill']);
    expect(backend.triggers.created).toEqual([
      {
        handler: 'runAutoFill',
        timeBased: true,
        everyDays: 1,
        atHour: 16,
        inTimezone: 'Asia/Taipei',
      },
    ]);
  });
});

describe('月份分頁的名稱', () => {
  it.each([
    '20991',
    '209901',
    '2099/1',
    '2099/01',
    '2099-1',
    '2099-01',
    '2099.01',
    '2099年1月',
    ' 2099 / 01 ',
  ])('「%s」都找得到', (name) => {
    setup();
    buildTarget(name);
    expect(enable().error).toBeUndefined();
    create({ 專案名稱: '官網' });
    expect(run().status).toBe('written');
    expect(target.getSheetByName(name)!.getRange(5, 5).getValues()[0]![0]).toBe('1.官網');
  });
});

describe('findAutoFillSheet_：比對分頁名稱的年、月', () => {
  const find = (names: string[], date: string): string | null => {
    const book = backend.newSpreadsheet();
    names.forEach((name) => book.insertSheet(name));
    const found = (
      backend.global.findAutoFillSheet_ as (book: unknown, date: string) => FakeSheet | null
    )(book, date);
    return found ? found.getName() : null;
  };

  it.each(['202609', '2026/09', '2026-09', '20269', '2026/9', '2026-9', '2026.09', '2026年9月'])(
    '9 月：「%s」',
    (name) => {
      expect(find(['202610', '2026/8', name], '2026/09/15')).toBe(name);
    },
  );

  it('10～12 月不會跟 1 月搞混', () => {
    expect(find(['202610', '202611', '202612'], '2026/01/05')).toBeNull();
    expect(find(['20261', '202611'], '2026/11/02')).toBe('202611');
    expect(find(['202611', '20261'], '2026/01/05')).toBe('20261');
  });

  it('不是月份的分頁名稱略過', () => {
    expect(
      find(['工作進度', '2026', '2026/13', '2026/09/01', 'v2026/09'], '2026/09/15'),
    ).toBeNull();
  });
});

describe('通知：LINE 為主、Email 備援', () => {
  const notify = (title: string, body: string) =>
    (backend.global.sendAutoFillNotice_ as (title: string, body: string) => string)(title, body);

  it('有設定 LINE：推給 LINE_USER_ID（帶 token），不寄信', () => {
    setup();
    expect(notify('標題', '內容')).toBe('line');
    expect(backend.linePushes).toEqual([
      { token: 'line-token', to: 'U0123456789abcdef', text: '標題\n\n內容' },
    ]);
    expect(backend.mails).toEqual([]);
  });

  it.each<[string, Record<string, string>, LoadOptions, string]>([
    ['沒有設定 LINE', {}, {}, '沒有設定指令碼屬性 LINE_CHANNEL_ACCESS_TOKEN／LINE_USER_ID'],
    ['只設定 token', { LINE_CHANNEL_ACCESS_TOKEN: 'line-token' }, {}, '沒有設定指令碼屬性'],
    ['token 失效（401）', LINE_PROPS, { lineResponse: 401 }, 'LINE 回應 HTTP 401'],
    ['LINE 連線失敗', LINE_PROPS, { lineResponse: 'throw' }, 'LINE 連線失敗'],
  ])('%s：改寄信給擁有者，信裡註明原因', (_label, properties, options, reason) => {
    setup(options, properties);
    expect(notify('標題', '內容')).toBe('email');
    expect(backend.mails).toHaveLength(1);
    expect(backend.mails[0]!.to).toBe(OWNER_EMAIL);
    expect(backend.mails[0]!.subject).toBe('標題');
    expect(backend.mails[0]!.body).toContain('內容');
    expect(backend.mails[0]!.body).toContain(reason);
    // token 是密鑰，不能出現在信裡或執行記錄
    expect(backend.mails[0]!.body).not.toContain('line-token');
    expect(backend.logs.join('\n')).not.toContain('line-token');
  });

  it('超過 5000 字：截斷，最後註明省略', () => {
    setup();
    notify('標題', '字'.repeat(6000));
    const { text } = backend.linePushes[0]!;
    expect(text).toHaveLength(5000);
    expect(text.endsWith('…（內容太長，後面省略）')).toBe(true);
  });

  it('觸發器的例外情況在沒有 LINE 時一樣寄信', () => {
    setup({}, {});
    buildTarget();
    expect(enable().error).toBeUndefined();
    create({ 專案名稱: '官網', 今日工時: 1 });
    expect(run().status).toBe('insufficient');
    expect(backend.mails[0]!.subject).toContain('工時合計未滿 8 小時');
    expect(backend.mails[0]!.body).toContain('改用 Email 通知');
  });

  it('testAutoFillNotify：送出測試訊息，執行記錄寫出用了哪個管道', () => {
    setup();
    (backend.global.testAutoFillNotify as () => void)();
    expect(backend.linePushes[0]!.text).toContain('【工作進度】測試通知');
    expect(backend.logs.at(-1)).toBe('已用 LINE 送出');

    setup({ lineResponse: 401 });
    (backend.global.testAutoFillNotify as () => void)();
    expect(backend.mails[0]!.subject).toBe('【工作進度】測試通知');
    expect(backend.logs.at(-1)).toBe(`LINE 沒有送出，已改寄信到 ${OWNER_EMAIL}`);
  });
});
