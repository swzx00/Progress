import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkItem } from '@/types/work-item';

import { DAY, OTHER_DAY, input } from '../backend/contract';

import { loadCodeGsBackend, type CodeGsBackend } from './load-code-gs-backend';

/**
 * doGet 的讀取快取（CacheService）：同樣的請求第二次直接回快取、不讀 Sheet；
 * 會改資料的 doPost 都換快取版本（舊的不會再被讀到）；直接改 Sheet 要等過期或執行 clearReadCache()
 */
let backend: CodeGsBackend;

beforeEach(() => {
  backend = loadCodeGsBackend();
});

const post = (body: Record<string, unknown>) => backend.doPost({ idToken: 'token', ...body });
const create = (overrides: Partial<WorkItem> = {}) => {
  const res = post({ action: 'create', item: input(overrides) });
  expect(res.error).toBeUndefined();
  return res.item as WorkItem;
};
const targets = (date = DAY) =>
  (backend.doGet({ date }).items as WorkItem[]).map((item) => item.工作目標);
/** 直接在 Sheet 上改第 2 列的工作目標（模擬手動編輯，快取不會知道） */
const editSheetDirectly = (value: string) => {
  const sheet = backend.spreadsheet.getSheetByName('工作紀錄')!;
  const col =
    (sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] as string[]).indexOf(
      '工作目標',
    ) + 1;
  sheet.getRange(2, col).setValue(value);
};
const readKeys = () => [...backend.cache.keys()].filter((key) => key.startsWith('read:'));

describe('讀取快取', () => {
  it('同樣的請求第二次直接回快取（直接改 Sheet 看不到），存 600 秒', () => {
    create({ 工作目標: 'A' });
    expect(targets()).toEqual(['A']);
    editSheetDirectly('手動改的');
    expect(targets()).toEqual(['A']);
    expect(readKeys()).toHaveLength(1);
    expect(backend.cache.get(readKeys()[0]!)!.seconds).toBe(600);
  });

  it('clearReadCache()：清掉快取，下一次重新讀 Sheet', () => {
    create({ 工作目標: 'A' });
    targets();
    editSheetDirectly('手動改的');
    (backend.global.clearReadCache as () => void)();
    expect(targets()).toEqual(['手動改的']);
    expect(backend.logs.at(-1)).toBe('已清除讀取快取');
  });

  it('不同參數各自快取：不同日期、options、range、search', () => {
    create({ 工作目標: 'A' });
    create({ 工作目標: 'B', 工作日期: OTHER_DAY });
    expect(targets(DAY)).toEqual(['A']);
    expect(targets(OTHER_DAY)).toEqual(['B']);
    backend.doGet({ type: 'options' });
    backend.doGet({ type: 'range', from: DAY, to: OTHER_DAY });
    backend.doGet({ type: 'search', q: 'A' });
    expect(readKeys()).toHaveLength(5);
  });

  it.each([
    ['create', () => create({ 工作目標: 'B' })],
    ['update', (id: string) => post({ action: 'update', id, item: { 工作目標: 'B' } })],
    ['delete', (id: string) => post({ action: 'delete', id })],
  ])('用網站寫入（%s）：快取立刻失效，讀到新資料', (_label, write) => {
    const { id } = create({ 工作目標: 'A' });
    targets();
    write(id);
    const after = targets();
    expect(after).not.toEqual(['A']);
  });

  it('寫入失敗（驗證沒過）也換版本：保守起見，不會讀到寫一半的資料', () => {
    create({ 工作目標: 'A' });
    targets();
    const version = backend.cache.get('read-version')!.value;
    expect(post({ action: 'create', item: input({ 工作目標: '' }) }).error).toBeTruthy();
    expect(backend.cache.get('read-version')!.value).not.toBe(version);
  });

  it('只讀的 getAutoFillSetting、沒登入的請求不換版本', () => {
    targets();
    const version = backend.cache.get('read-version')!.value;
    post({ action: 'getAutoFillSetting' });
    backend.doPost({ idToken: '', action: 'create', item: input() });
    expect(backend.cache.get('read-version')!.value).toBe(version);
  });

  it('錯誤的回應不快取', () => {
    expect(backend.doGet({}).error).toBe('缺少 date 參數');
    expect(backend.doGet({ type: 'range', from: 'x', to: 'y' }).error).toBeTruthy();
    expect(readKeys()).toEqual([]);
  });

  it('超過 100KB 的回應不快取（照常回傳）', () => {
    for (let i = 0; i < 20; i++) create({ 工作目標: `項目${i}`, 處理內容: '字'.repeat(2000) });
    expect(targets()).toHaveLength(20);
    expect(readKeys()).toEqual([]);
  });

  it('鍵名：版本＋參數；太長（超過 240 字）回 null 不快取', () => {
    const key = backend.global.readCacheKey_ as (version: string, params: object) => string | null;
    expect(key('v1', { date: DAY })).toBe(`read:v1:["","${DAY}","","","",""]`);
    expect(key('v1', { type: 'search', q: '長'.repeat(100) })).not.toBeNull();
    expect(key('v1', { type: 'search', q: '長'.repeat(250) })).toBeNull();
  });

  it('快取服務異常：照常讀 Sheet、照常寫入', () => {
    backend = loadCodeGsBackend({}, { cacheAvailable: false });
    create({ 工作目標: 'A' });
    expect(targets()).toEqual(['A']);
    editSheetDirectly('手動改的');
    expect(targets()).toEqual(['手動改的']);
  });
});
