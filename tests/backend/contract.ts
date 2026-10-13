import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it } from 'vitest';

import { makeItem } from '@/testing/fixtures';
import type { WorkItem, WorkItemOptions } from '@/types/work-item';

import { loadCodeGs } from '../apps-script/load-code-gs';

/**
 * 後端的共同規格：MSW 假後端（tests/msw）與 Code.gs（tests/apps-script，接假的試算表）跑同一組案例，
 * 兩邊行為不一樣就會有一邊失敗。測每日項次、改到別天重新編號、整批退回、覆蓋、排序檢查、
 * 請假固定值、選項清單同步，錯誤訊息要跟 Code.gs 寫的一樣。
 * 每個測試都要拿到一個全新的後端（資料是空的或只有預設值），日期用 2099 年避開 MSW 的預設資料
 */
export interface BackendClient {
  /** 回應一律 HTTP 200，這裡直接回傳解析好的 JSON；body 沒帶 idToken 時用擁有者本人的 'token' */
  post: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  get: (params: Record<string, string>) => Promise<Record<string, unknown>>;
}

export const DAY = '2099/01/05';
export const OTHER_DAY = '2099/01/06';

// Code.gs 與同一個 Apps Script 專案的 AutoFill.gs（自動填入的錯誤訊息寫在那裡）
const CODE_GS_SOURCE = ['Code.gs', 'AutoFill.gs']
  .map((name) =>
    readFileSync(fileURLToPath(new URL(`../../apps-script/${name}`, import.meta.url)), 'utf-8'),
  )
  .join('\n');
const codeGs = loadCodeGs();

type Input = Omit<WorkItem, 'id' | '項次' | '已刪除'>;

/** API 格式（YYYY/MM/DD）的新增資料 */
export const input = (overrides: Partial<WorkItem> = {}): Input => {
  const item: Partial<WorkItem> = makeItem({ 工作日期: DAY, ...overrides });
  delete item.id;
  delete item.項次;
  delete item.已刪除;
  return item as Input;
};

export const leaveInput = (overrides: Partial<WorkItem> = {}): Input =>
  input({ 狀態: '休假', 工作目標: '特休', 今日工時: 8, ...overrides });

/** 固定文字的錯誤訊息要在 Code.gs 原始碼裡找得到 */
const expectCodeGsMessage = (message: unknown): void => {
  expect(CODE_GS_SOURCE).toContain(`'${message as string}'`);
};

export const describeBackendContract = (getClient: () => BackendClient): void => {
  const post = (body: Record<string, unknown>) => getClient().post({ idToken: 'token', ...body });
  const get = (params: Record<string, string>) => getClient().get(params);

  const create = async (overrides: Partial<WorkItem> = {}): Promise<WorkItem> =>
    (await post({ action: 'create', item: input(overrides) })).item as WorkItem;

  const dayItems = async (date = DAY): Promise<WorkItem[]> =>
    ((await get({ date })).items as WorkItem[]).sort((a, b) => a.項次 - b.項次);

  const indexes = async (date = DAY): Promise<[string, number][]> =>
    (await dayItems(date)).map((item) => [item.工作目標, item.項次]);

  describe('登入與未知的 action', () => {
    it('沒有 idToken 回 UNAUTHORIZED', async () => {
      const data = await post({ idToken: '', action: 'delete', id: 'x' });
      expect(data.code).toBe('UNAUTHORIZED');
      expectCodeGsMessage(data.error);
    });

    it('未知的 action', async () => {
      const data = await post({ action: 'nope' });
      expectCodeGsMessage(data.error);
    });
  });

  describe('每日項次（同 Code.gs 的 getNextDailyIndex_）', () => {
    it('每天從 1 開始，最大項次＋1', async () => {
      await create({ 工作目標: 'A' });
      await create({ 工作目標: 'B' });
      await create({ 工作目標: 'C', 工作日期: OTHER_DAY });
      expect(await indexes()).toEqual([
        ['A', 1],
        ['B', 2],
      ]);
      expect(await indexes(OTHER_DAY)).toEqual([['C', 1]]);
    });

    it('刪掉中間一筆後新增不撞號；刪掉最後一筆再新增拿回同一號', async () => {
      await create({ 工作目標: 'A' });
      const b = await create({ 工作目標: 'B' });
      const c = await create({ 工作目標: 'C' });
      await post({ action: 'delete', id: b.id });
      await create({ 工作目標: 'D' });
      expect(await indexes()).toEqual([
        ['A', 1],
        ['C', 3],
        ['D', 4],
      ]);

      await post({ action: 'delete', id: c.id });
      const items = await dayItems();
      await post({ action: 'delete', id: items.find((item) => item.工作目標 === 'D')!.id });
      await create({ 工作目標: 'E' });
      expect(await indexes()).toEqual([
        ['A', 1],
        ['E', 2],
      ]);
    });

    it('前端送來的項次會被忽略', async () => {
      const created = (await post({ action: 'create', item: { ...input(), 項次: 99 } }))
        .item as WorkItem;
      expect(created.項次).toBe(1);
    });

    it('跟 Code.gs 的 getNextDailyIndex_ 算出一樣的號碼', async () => {
      await create({ 工作目標: 'A' });
      const b = await create({ 工作目標: 'B' });
      await create({ 工作目標: 'C' });
      await post({ action: 'delete', id: b.id });
      const rows = (await dayItems()).map((item) => ({ item: { 項次: item.項次 } }));
      expect((await create()).項次).toBe(codeGs.getNextDailyIndex_(rows));
    });
  });

  describe('update', () => {
    it('工作日期沒改：沿用原本的項次，忽略送來的值', async () => {
      await create({ 工作目標: 'A' });
      const b = await create({ 工作目標: 'B' });
      const updated = (
        await post({ action: 'update', id: b.id, item: { 項次: 1, 處理內容: '改' } })
      ).item as WorkItem;
      expect(updated.項次).toBe(2);
      expect(updated.處理內容).toBe('改');
    });

    it('改到別天：在新的那天重新編號', async () => {
      await create({ 工作目標: 'X', 工作日期: OTHER_DAY });
      const a = await create({ 工作目標: 'A' });
      const updated = (await post({ action: 'update', id: a.id, item: { 工作日期: OTHER_DAY } }))
        .item as WorkItem;
      expect(updated.項次).toBe(2);
      expect(await dayItems()).toEqual([]);
    });

    it('找不到（含已刪除的）回「找不到這筆紀錄」', async () => {
      const a = await create();
      await post({ action: 'delete', id: a.id });
      for (const id of ['missing', a.id]) {
        const data = await post({ action: 'update', id, item: { 處理內容: '改' } });
        expect(data.error).toBe('找不到這筆紀錄');
        expectCodeGsMessage(data.error);
      }
    });

    it('工時合計排除自己，超過 24 小時擋下（訊息同 Code.gs 的 dailyHoursError_）', async () => {
      await create({ 今日工時: 20 });
      const self = await create({ 今日工時: 2 });
      expect((await post({ action: 'update', id: self.id, item: { 今日工時: 4 } })).error).toBe(
        undefined,
      );
      const data = await post({ action: 'update', id: self.id, item: { 今日工時: 4.25 } });
      expect(data.error).toBe(codeGs.dailyHoursError_(20, 4.25));
    });
  });

  describe('delete', () => {
    it('刪除後讀不到，也不算工時', async () => {
      const a = await create({ 今日工時: 20 });
      expect((await post({ action: 'delete', id: a.id })).ok).toBe(true);
      expect(await dayItems()).toEqual([]);
      expect((await post({ action: 'create', item: input({ 今日工時: 24 }) })).error).toBe(
        undefined,
      );
    });

    it('找不到或已刪除回「找不到這筆紀錄」', async () => {
      const a = await create();
      await post({ action: 'delete', id: a.id });
      expect((await post({ action: 'delete', id: a.id })).error).toBe('找不到這筆紀錄');
      expect((await post({ action: 'delete', id: 'missing' })).error).toBe('找不到這筆紀錄');
    });
  });

  describe('create 的工時與請假', () => {
    it('當天合計超過 24 小時擋下，剛好 24 可以', async () => {
      await create({ 今日工時: 16 });
      const over = await post({ action: 'create', item: input({ 今日工時: 8.25 }) });
      expect(over.error).toBe(codeGs.dailyHoursError_(16, 8.25));
      expect((await post({ action: 'create', item: input({ 今日工時: 8 }) })).error).toBe(
        undefined,
      );
    });

    it('請假的固定欄位由後端覆蓋', async () => {
      const created = (
        await post({
          action: 'create',
          item: leaveInput({ 交辦單位: '資訊部', 專案名稱: '亂填', 專案Repo: ['x'], 完成度: 3 }),
        })
      ).item as WorkItem;
      expect(created).toMatchObject({
        交辦單位: '人事室',
        交辦人員: '--',
        專案名稱: '休假',
        專案Repo: [],
        預計期限: '',
        完成度: 100,
      });
    });

    it('請假時數超出範圍：訊息同 Code.gs 的 validateItem_', async () => {
      const leave = leaveInput({ 今日工時: 9 });
      const data = await post({ action: 'create', item: leave });
      expect(data.error).toBe(codeGs.validateItem_({ ...leave }).join('；'));
    });

    it('請假的固定值不寫回選項清單，一般紀錄的新值會寫回', async () => {
      await post({ action: 'create', item: leaveInput() });
      await create({ 交辦單位: '新單位', 專案Repo: ['new-repo'] });
      const { options } = (await get({ type: 'options' })) as { options: WorkItemOptions };
      expect(options.交辦單位).toContain('新單位');
      expect(options.專案Repo).toContain('new-repo');
      expect(options.交辦單位).not.toContain('人事室');
      expect(options.專案名稱).not.toContain('休假');
    });
  });

  describe('batchCreate（複製本日）', () => {
    it('項次依陣列順序接續當天既有的號碼', async () => {
      await create({ 工作目標: 'A' });
      const data = await post({
        action: 'batchCreate',
        items: [input({ 工作目標: 'B' }), input({ 工作目標: 'C' })],
      });
      expect(data.replaced).toBe(0);
      expect(await indexes()).toEqual([
        ['A', 1],
        ['B', 2],
        ['C', 3],
      ]);
    });

    it('任何一天合計超過 24 小時：整批退回，一筆都不寫入', async () => {
      await create({ 工作目標: 'A', 今日工時: 20 });
      const data = await post({
        action: 'batchCreate',
        items: [input({ 工作目標: 'B', 今日工時: 3 }), input({ 工作目標: 'C', 今日工時: 2 })],
      });
      expect(data.error).toBe(codeGs.dailyHoursError_(20, 5));
      expect(await indexes()).toEqual([['A', 1]]);
    });

    it('其中一筆請假時數不合格：整批退回，訊息標出第幾筆', async () => {
      const items = [input({ 工作目標: 'B' }), leaveInput({ 今日工時: 9 })];
      const data = await post({ action: 'batchCreate', items });
      expect(data.error).toBe(`第 2 筆：${codeGs.validateItem_({ ...items[1] }).join('、')}`);
      expect(await dayItems()).toEqual([]);
    });

    it('沒有要新增的紀錄', async () => {
      const data = await post({ action: 'batchCreate', items: [] });
      expectCodeGsMessage(data.error);
    });

    it('覆蓋（replace）：工時只算這批，原本的紀錄（含請假）被取代，新紀錄從 1 開始', async () => {
      await create({ 工作目標: 'A', 今日工時: 16 });
      await post({ action: 'create', item: leaveInput({ 今日工時: 8 }) });
      const data = await post({
        action: 'batchCreate',
        replace: true,
        items: [input({ 工作目標: 'B', 今日工時: 10 }), input({ 工作目標: 'C', 今日工時: 10 })],
      });
      expect(data.replaced).toBe(2);
      expect(await indexes()).toEqual([
        ['B', 1],
        ['C', 2],
      ]);
    });

    it('覆蓋時驗證沒過，原本的紀錄完全不動', async () => {
      await create({ 工作目標: 'A' });
      const data = await post({
        action: 'batchCreate',
        replace: true,
        items: [input({ 今日工時: 20 }), input({ 今日工時: 5 })],
      });
      // 原本的紀錄會被搬走，工時只算這批
      expect(data.error).toBe(codeGs.dailyHoursError_(0, 25));
      expect(await indexes()).toEqual([['A', 1]]);
    });
  });

  describe('reorder（同 Code.gs 的 handleReorder_）', () => {
    const setup = async (): Promise<WorkItem[]> => {
      await create({ 工作目標: 'A' });
      await create({ 工作目標: 'B' });
      await post({ action: 'create', item: leaveInput() });
      return dayItems();
    };

    it('依 ids 順序把項次改成 1、2、3（請假也能排）', async () => {
      const [a, b, leave] = await setup();
      expect(
        (await post({ action: 'reorder', date: DAY, ids: [leave!.id, a!.id, b!.id] })).ok,
      ).toBe(true);
      expect(await indexes()).toEqual([
        ['特休', 1],
        ['A', 2],
        ['B', 3],
      ]);
    });

    it.each([
      ['少一筆', (ids: string[]) => ids.slice(1)],
      ['多一筆', (ids: string[]) => [...ids, 'other']],
      ['重複', (ids: string[]) => [ids[0]!, ids[0]!, ids[1]!]],
    ])('ids 跟當天紀錄對不上（%s）：整批退回、項次不動', async (_label, mutate) => {
      const items = await setup();
      const data = await post({
        action: 'reorder',
        date: DAY,
        ids: mutate(items.map((i) => i.id)),
      });
      expect(data.error).toBe('紀錄已變更，請重新整理後再排序');
      expectCodeGsMessage(data.error);
      expect(await indexes()).toEqual([
        ['A', 1],
        ['B', 2],
        ['特休', 3],
      ]);
    });

    it('混到已刪除的紀錄也算對不上', async () => {
      const [a, b, leave] = await setup();
      await post({ action: 'delete', id: b!.id });
      const data = await post({ action: 'reorder', date: DAY, ids: [leave!.id, a!.id, b!.id] });
      expect(data.error).toBe('紀錄已變更，請重新整理後再排序');
    });

    it('日期格式不對、沒有 ids：訊息同 Code.gs', async () => {
      const [a] = await setup();
      const badDate = await post({ action: 'reorder', date: '2099-01-05', ids: [a!.id] });
      expect(badDate.error).toBe('工作日期格式不正確');
      expectCodeGsMessage(badDate.error);
      const empty = await post({ action: 'reorder', date: DAY, ids: [] });
      expect(empty.error).toBe('沒有要排序的紀錄');
      expectCodeGsMessage(empty.error);
    });
  });

  describe('選項清單管理', () => {
    // 兩邊起始的選項清單不同（MSW 有預設值、Code.gs 是空的），先補上測試要用的值
    beforeEach(async () => {
      await post({ action: 'addOption', category: '交辦單位', value: '資訊部' });
      await post({ action: 'addOption', category: '交辦單位', value: '業務部' });
    });

    it('新增、重新命名、刪除都回最新的 options', async () => {
      const added = (await post({ action: 'addOption', category: '交辦單位', value: ' 法務部 ' }))
        .options as WorkItemOptions;
      expect(added.交辦單位).toContain('法務部');
      const renamed = (
        await post({
          action: 'renameOption',
          category: '交辦單位',
          oldValue: '法務部',
          newValue: '法務室',
        })
      ).options as WorkItemOptions;
      expect(renamed.交辦單位).toContain('法務室');
      expect(renamed.交辦單位).not.toContain('法務部');
      const deleted = (
        await post({ action: 'deleteOption', category: '交辦單位', value: '法務室' })
      ).options as WorkItemOptions;
      expect(deleted.交辦單位).not.toContain('法務室');
    });

    it.each([
      ['未知的分類', { action: 'addOption', category: '不存在', value: 'x' }],
      [
        '未知的分類（重新命名）',
        { action: 'renameOption', category: '不存在', oldValue: 'a', newValue: 'b' },
      ],
      ['未知的分類（刪除）', { action: 'deleteOption', category: '不存在', value: 'x' }],
      ['新增空白', { action: 'addOption', category: '交辦單位', value: '  ' }],
      [
        '新名稱空白',
        { action: 'renameOption', category: '交辦單位', oldValue: '資訊部', newValue: ' ' },
      ],
      [
        '重新命名找不到',
        { action: 'renameOption', category: '交辦單位', oldValue: '無', newValue: '有' },
      ],
      [
        '名稱已存在',
        { action: 'renameOption', category: '交辦單位', oldValue: '資訊部', newValue: '業務部' },
      ],
      ['刪除找不到', { action: 'deleteOption', category: '交辦單位', value: '無' }],
    ])('%s：錯誤訊息同 Code.gs', async (_label, body) => {
      const data = await post(body);
      expect(data.error).toBeTruthy();
      expectCodeGsMessage(data.error);
    });

    it.each([
      [
        '新增超過 50 字',
        { action: 'addOption', category: '交辦單位', value: '字'.repeat(51) },
        '交辦單位不可超過 50 字',
      ],
      [
        '新增的 Repo 含逗號',
        { action: 'addOption', category: '專案Repo', value: 'web,api' },
        '專案 Repo 不可包含「,」',
      ],
      [
        '重新命名超過 50 字',
        {
          action: 'renameOption',
          category: '交辦單位',
          oldValue: '資訊部',
          newValue: '字'.repeat(51),
        },
        '交辦單位不可超過 50 字',
      ],
    ])('%s：跟工作紀錄同一套規則擋下，選項清單不變', async (_label, body, message) => {
      const data = await post(body);
      expect(data.error).toBe(message);
      const { options } = (await get({ type: 'options' })) as { options: WorkItemOptions };
      expect(options.專案Repo).not.toContain('web,api');
      expect(options.交辦單位).toContain('資訊部');
    });

    it('剛好 50 字可以新增', async () => {
      const value = '字'.repeat(50);
      const data = await post({ action: 'addOption', category: '交辦人員', value });
      expect((data.options as WorkItemOptions).交辦人員).toContain(value);
    });
  });

  describe('樣式設定（同 Code.gs 的 handleSaveThemeMode_）', () => {
    it('沒設定時 options 的 themeMode 是 null；存了之後讀得到', async () => {
      expect((await get({ type: 'options' })).themeMode).toBeNull();
      expect(await post({ action: 'saveThemeMode', themeMode: 'dark' })).toEqual({
        themeMode: 'dark',
      });
      expect((await get({ type: 'options' })).themeMode).toBe('dark');
      await post({ action: 'saveThemeMode', themeMode: 'auto' });
      expect((await get({ type: 'options' })).themeMode).toBe('auto');
    });

    it.each([['purple'], [''], [null], [undefined]])(
      '不合法的值（%s）：錯誤訊息同 Code.gs，不寫入',
      async (themeMode) => {
        await post({ action: 'saveThemeMode', themeMode: 'light' });
        const res = await post({ action: 'saveThemeMode', themeMode });
        expectCodeGsMessage(res.error);
        expect((await get({ type: 'options' })).themeMode).toBe('light');
      },
    );

    it('沒登入不能存', async () => {
      const res = await getClient().post({ action: 'saveThemeMode', themeMode: 'dark' });
      expect(res.code).toBe('UNAUTHORIZED');
      expect((await get({ type: 'options' })).themeMode).toBeNull();
    });
  });

  describe('自動填入（同 AutoFill.gs，啟用時要開對方試算表的部分在 tests/apps-script/auto-fill.spec.ts）', () => {
    const URL = 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit';
    const save = (autoFill: unknown) => post({ action: 'saveAutoFillSetting', autoFill });
    const fillNow = (text: unknown, date = DAY) => post({ action: 'autoFillNow', date, text });

    it('預設停用、空白；停用時存得進網址與姓名；不放進公開的 options', async () => {
      expect((await post({ action: 'getAutoFillSetting' })).autoFill).toEqual({
        enabled: false,
        url: '',
        name: '',
      });
      const saved = { enabled: false, url: URL, name: '林家丞' };
      expect((await save({ ...saved, url: ` ${URL} `, name: ' 林家丞 ' })).autoFill).toEqual(saved);
      expect((await post({ action: 'getAutoFillSetting' })).autoFill).toEqual(saved);
      expect(await get({ type: 'options' })).not.toHaveProperty('autoFill');
    });

    it.each([
      [{ enabled: 'yes', url: URL, name: '林家丞' }],
      [null],
      [{ enabled: true, url: '', name: '林家丞' }],
      [{ enabled: true, url: 'https://example.com/x', name: '林家丞' }],
      [{ enabled: false, url: 'not a url', name: '' }],
      [{ enabled: true, url: URL, name: ' ' }],
    ])('設定不合法（%j）：錯誤訊息同 AutoFill.gs，不寫入', async (autoFill) => {
      const res = await save(autoFill);
      expectCodeGsMessage(res.error);
      expect((await post({ action: 'getAutoFillSetting' })).autoFill).toEqual({
        enabled: false,
        url: '',
        name: '',
      });
    });

    it('姓名超過上限：訊息同 AutoFill.gs', async () => {
      const autoFill = { enabled: false, url: '', name: '名'.repeat(21) };
      expect((await save(autoFill)).error).toBe(codeGs.validateAutoFill_(autoFill));
    });

    it('填入的驗證：錯誤訊息同 AutoFill.gs（沒啟用也是錯誤）', async () => {
      expectCodeGsMessage((await fillNow('內容', '2099-01-05')).error);
      expectCodeGsMessage((await fillNow('  ')).error);
      expect((await fillNow('字'.repeat(codeGs.AUTO_FILL_TEXT_MAX + 1))).error).toBe(
        `填入內容不可超過 ${codeGs.AUTO_FILL_TEXT_MAX} 個字`,
      );
      expectCodeGsMessage((await fillNow('內容')).error);
    });

    it('沒登入不能讀、不能存、不能填', async () => {
      for (const action of ['getAutoFillSetting', 'saveAutoFillSetting', 'autoFillNow']) {
        expect((await getClient().post({ action })).code).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('讀取', () => {
    it('range 的錯誤訊息同 Code.gs', async () => {
      const bad = await get({ type: 'range', from: '2099/02/30', to: '2099/03/01' });
      expectCodeGsMessage(bad.error);
      const reversed = await get({ type: 'range', from: '2099/03/01', to: '2099/02/01' });
      expectCodeGsMessage(reversed.error);
      const tooLong = await get({ type: 'range', from: '2098/01/01', to: '2099/01/02' });
      expect(tooLong.error).toBe(`日期範圍不可超過 ${codeGs.RANGE_MAX_DAYS} 天`);
    });

    it('range 含頭尾、含請假、不含已刪除', async () => {
      await create({ 工作目標: 'A' });
      await post({ action: 'create', item: leaveInput() });
      const deleted = await create({ 工作目標: 'D', 工作日期: OTHER_DAY });
      await post({ action: 'delete', id: deleted.id });
      await create({ 工作目標: 'E', 工作日期: OTHER_DAY });
      const { items } = (await get({ type: 'range', from: DAY, to: OTHER_DAY })) as {
        items: WorkItem[];
      };
      expect(items.map((item) => item.工作目標).sort()).toEqual(['A', 'E', '特休']);
    });

    it('search 的錯誤訊息同 Code.gs', async () => {
      expectCodeGsMessage((await get({ type: 'search', q: '  ' })).error);
      expectCodeGsMessage((await get({ type: 'search', q: '官網', field: '不存在' })).error);
    });
  });
};
