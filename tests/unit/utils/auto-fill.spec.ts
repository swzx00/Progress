import { describe, expect, it } from 'vitest';

import {
  isSameAutoFillSetting,
  validateAutoFillSetting,
  type AutoFillSetting,
} from '@/utils/auto-fill';

/**
 * 自動填入設定的驗證（AutoFill.gs 的 validateAutoFill_ 手動同步，訊息要一樣）：
 * 啟用時網址、姓名必填；停用時可以留空，有填照樣檢查格式
 */
const URL =
  'https://docs.google.com/spreadsheets/d/1OXOGgXZrDmkPFTVwjhiQgP-o_JH2uSIc9Xxq7aPQxZw/edit?gid=1#gid=1';
const setting = (overrides: Partial<AutoFillSetting> = {}): AutoFillSetting => ({
  enabled: true,
  url: URL,
  name: '林家丞',
  ...overrides,
});

describe('validateAutoFillSetting', () => {
  it.each<[Partial<AutoFillSetting>, string | null]>([
    [{}, null],
    [{ url: `  ${URL}  `, name: ' 林家丞 ' }, null],
    [
      {
        url: 'https://docs.google.com/spreadsheets/d/1OXOGgXZrDmkPFTVwjhiQgP-o_JH2uSIc9Xxq7aPQxZw',
      },
      null,
    ],
    [{ url: '' }, '請填寫試算表網址'],
    [
      { url: 'https://example.com/spreadsheets/d/1OXOGgXZrDmkPFTVwjhiQgP' },
      '試算表網址格式不正確，請貼上 Google 試算表的網址',
    ],
    [
      { url: 'https://docs.google.com/spreadsheets/d/short/edit' },
      '試算表網址格式不正確，請貼上 Google 試算表的網址',
    ],
    [
      { url: 'http://docs.google.com/spreadsheets/d/1OXOGgXZrDmkPFTVwjhiQgP-o_JH2uSIc9Xxq7aPQxZw' },
      '試算表網址格式不正確，請貼上 Google 試算表的網址',
    ],
    [{ name: '  ' }, '請填寫姓名'],
    [{ name: '名'.repeat(20) }, null],
    [{ name: '名'.repeat(21) }, '姓名不可超過 20 個字'],
    [{ enabled: false, url: '', name: '' }, null],
    [
      { enabled: false, url: 'not a url', name: '' },
      '試算表網址格式不正確，請貼上 Google 試算表的網址',
    ],
    [{ enabled: false, url: '', name: '名'.repeat(21) }, '姓名不可超過 20 個字'],
  ])('%j → %s', (overrides, expected) => {
    expect(validateAutoFillSetting(setting(overrides))).toBe(expected);
  });
});

describe('isSameAutoFillSetting', () => {
  it('網址、姓名去頭尾空白後比對', () => {
    expect(isSameAutoFillSetting(setting(), setting({ url: ` ${URL} `, name: '林家丞 ' }))).toBe(
      true,
    );
    expect(isSameAutoFillSetting(setting(), setting({ enabled: false }))).toBe(false);
    expect(isSameAutoFillSetting(setting(), setting({ name: '王小明' }))).toBe(false);
  });
});
