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
const SHEET_NAME = '20991';
const WORK_HOURS = { start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' };

let backend: CodeGsBackend;
let target: FakeSpreadsheet;

const post = (body: Record<string, unknown>) => backend.doPost({ idToken: 'token', ...body });
const create = (overrides: Partial<WorkItem> = {}): void => {
  const data = post({ action: 'create', item: input(overrides) });
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

const setup = (options: LoadOptions = {}): void => {
  backend = loadCodeGsBackend({}, options);
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
    expect(backend.mails).toEqual([]);
  });

  describe('啟用後', () => {
    beforeEach(() => {
      expect(enable().error).toBeUndefined();
    });

    it('格子是空的：寫入當天的本日總結，不寄信', () => {
      create({ 專案Repo: ['release_source'], 工作目標: 'T12346 埋 JS', 處理內容: '新增 oplog.js' });
      expect(run().status).toBe('written');
      expect(myCell()).toBe('1.release_source T12346\n- 新增 oplog.js');
      expect(myCell(6)).toBe('');
      expect(backend.mails).toEqual([]);
    });

    it('格子已經是一樣的內容：不寫也不寄信', () => {
      create({ 專案名稱: '官網' });
      run();
      expect(run().status).toBe('unchanged');
      expect(backend.mails).toEqual([]);
    });

    it('格子已經有不同的內容：不覆蓋，寄信附上兩邊的內容', () => {
      create({ 專案名稱: '官網' });
      target.getSheetByName(SHEET_NAME)!.getRange(5, 5).setValue('手動寫的');
      expect(run().status).toBe('conflict');
      expect(myCell()).toBe('手動寫的');
      expect(backend.mails).toHaveLength(1);
      expect(backend.mails[0]!.to).toBe(OWNER_EMAIL);
      expect(backend.mails[0]!.subject).toContain('已經有內容');
      expect(backend.mails[0]!.body).toContain('手動寫的');
      expect(backend.mails[0]!.body).toContain('1.官網');
    });

    it('當天沒有紀錄：寄信提醒', () => {
      expect(run().status).toBe('empty');
      expect(backend.mails[0]!.subject).toContain('沒有可以填入的工作紀錄');
    });

    it('週末不執行', () => {
      create({ 工作日期: '2099/01/03', 專案名稱: '官網' });
      expect(run(new Date(2099, 0, 3, 16)).status).toBe('holiday');
      expect(backend.mails).toEqual([]);
    });

    it('找不到這個月的分頁、日期、姓名：寄信，不寫入', () => {
      create({ 工作日期: '2099/01/07', 專案名稱: '官網' });
      expect(run(new Date(2099, 0, 7, 16))).toEqual({ status: 'error' });
      expect(backend.mails.at(-1)!.subject).toContain('找不到 2099/01/07 這一欄');

      create({ 工作日期: '2099/02/02', 專案名稱: '官網' });
      run(new Date(2099, 1, 2, 16));
      expect(backend.mails.at(-1)!.subject).toContain('找不到「20992」分頁');

      target.getSheetByName(SHEET_NAME)!.getRange(5, 2).setValue('改名了');
      create({ 專案名稱: '官網' });
      run();
      expect(backend.mails.at(-1)!.subject).toContain('找不到「林家丞」');
      expect(backend.mails.at(-1)!.body).toContain('1.官網');
    });

    it('打不開對方的試算表：寄信', () => {
      create({ 專案名稱: '官網' });
      backend.books.delete(TARGET_ID);
      expect(run().status).toBe('error');
      expect(backend.mails[0]!.subject).toContain('打不開對方的試算表');
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

  it('runAutoFill 拿鎖執行，發生錯誤時寄信', () => {
    expect(enable().error).toBeUndefined();
    (backend.global.runAutoFill as () => void)();
    expect(backend.lockCalls.slice(-2)).toEqual(['lock', 'release']);

    setup({ lockAvailable: false });
    buildTarget();
    (backend.global.runAutoFill as () => void)();
    expect(backend.mails.at(-1)!.subject).toContain('執行時發生錯誤');
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

    it('填入畫面上的文字（可能手動改過），不管工作日', () => {
      expect(fillNow('  手動整理的內容\n- 第二行  ')).toEqual({ status: 'written' });
      expect(myCell()).toBe('手動整理的內容\n- 第二行');
      expect(fillNow('手動整理的內容\n- 第二行')).toEqual({ status: 'unchanged' });
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
      expect(fillNow('內容', '2099/01/07').error).toBe('「20991」分頁裡找不到 2099/01/07 這一欄');
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
