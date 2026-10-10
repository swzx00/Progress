import { describe, expect, it } from 'vitest';

import { makeItem, makeRecent } from '@/testing/fixtures';
import type { WorkItemOptions } from '@/types/work-item';

import {
  SEARCH_KEYWORD_MAX,
  SUGGESTION_LIMIT,
  buildSuggestions,
  compareSearchResults,
  highlightTerms,
  matchesSearch,
  parseKeywords,
  splitHighlight,
  splitRepoHighlight,
  type TextSegment,
} from './search-work-items';

const item = makeItem({
  交辦單位: '資訊部',
  交辦人員: '王小明',
  專案名稱: '官網改版',
  專案Repo: ['Web-App', 'api'],
  工作目標: '#12345 登入頁 Bug',
  處理內容: '修正 Safari 版面\n第二行',
  狀態: '進行中',
});

/** 片段轉成「[符合]」標記的字串，方便比對 */
const marked = (segments: TextSegment[]): string =>
  segments.map((s) => (s.match ? `[${s.text}]` : s.text)).join('');

describe('parseKeywords', () => {
  it('空白隔開、轉小寫、去掉多餘空白', () => {
    expect(parseKeywords('  Login   頁面\t首頁 ')).toEqual(['login', '頁面', '首頁']);
  });

  it('空字串回空陣列', () => {
    expect(parseKeywords('   ')).toEqual([]);
  });
});

describe('matchesSearch：一般搜尋', () => {
  it.each([
    ['資訊部', '交辦單位'],
    ['小明', '交辦人員'],
    ['官網', '專案名稱'],
    ['#web-app', 'Repo 加 #'],
    ['web-app', 'Repo 不加 #'],
    ['登入頁', '工作目標'],
    ['safari', '處理內容（不分大小寫）'],
    ['第二行', '處理內容第二行'],
    ['進行中', '狀態'],
  ])('「%s」找得到（%s）', (keyword) => {
    expect(matchesSearch(item, { keyword })).toBe(true);
  });

  it('每個關鍵字都要出現（AND）', () => {
    expect(matchesSearch(item, { keyword: '官網 safari' })).toBe(true);
    expect(matchesSearch(item, { keyword: '官網 找不到' })).toBe(false);
  });

  it('關鍵字不會跨欄位黏在一起比對', () => {
    // 交辦單位「資訊部」＋交辦人員「王小明」中間有換行分隔
    expect(matchesSearch(item, { keyword: '資訊部王' })).toBe(false);
  });

  it('空白關鍵字不符合', () => {
    expect(matchesSearch(item, { keyword: '  ' })).toBe(false);
  });
});

describe('matchesSearch：指定欄位（點推薦）', () => {
  it('交辦單位、交辦人員、專案名稱要完全相同（不分大小寫）', () => {
    expect(matchesSearch(item, { keyword: '資訊部', field: '交辦單位' })).toBe(true);
    expect(matchesSearch(item, { keyword: '資訊', field: '交辦單位' })).toBe(false);
    expect(matchesSearch(item, { keyword: '王小明', field: '交辦人員' })).toBe(true);
    expect(matchesSearch(item, { keyword: '官網改版', field: '專案名稱' })).toBe(true);
    expect(matchesSearch(item, { keyword: '官網', field: '專案名稱' })).toBe(false);
  });

  it('專案 Repo 包含那一個（完全相同）', () => {
    expect(matchesSearch(item, { keyword: 'WEB-APP', field: '專案Repo' })).toBe(true);
    expect(matchesSearch(item, { keyword: 'web', field: '專案Repo' })).toBe(false);
  });

  it('工作目標包含那段文字', () => {
    expect(matchesSearch(item, { keyword: '登入頁', field: '工作目標' })).toBe(true);
    expect(matchesSearch(item, { keyword: '#12345 登入頁 bug', field: '工作目標' })).toBe(true);
  });

  it('指定欄位時不比對其他欄位', () => {
    expect(matchesSearch(item, { keyword: '資訊部', field: '專案名稱' })).toBe(false);
  });
});

describe('highlightTerms', () => {
  it('沒有搜尋不標示', () => {
    expect(highlightTerms(null, '工作目標')).toEqual([]);
  });

  it('一般搜尋：每個欄位都標每個關鍵字', () => {
    expect(highlightTerms({ keyword: 'Login 首頁' }, '處理內容')).toEqual(['login', '首頁']);
  });

  it('指定欄位：只標那個欄位，整段當一個詞', () => {
    const query = { keyword: '登入 頁', field: '工作目標' as const };
    expect(highlightTerms(query, '工作目標')).toEqual(['登入 頁']);
    expect(highlightTerms(query, '處理內容')).toEqual([]);
  });
});

describe('splitHighlight', () => {
  it('標出每個符合的地方（不分大小寫，保留原本大小寫）', () => {
    expect(marked(splitHighlight('Bug 與 bug', ['bug']))).toBe('[Bug] 與 [bug]');
  });

  it('重疊或相連的範圍合併成一段', () => {
    expect(marked(splitHighlight('abcdef', ['abc', 'cd']))).toBe('[abcd]ef');
    expect(marked(splitHighlight('abcdef', ['ab', 'cd']))).toBe('[abcd]ef');
  });

  it('保留換行', () => {
    expect(marked(splitHighlight('第一行\n第二行', ['二']))).toBe('第一行\n第[二]行');
  });

  it('使用者輸入的 HTML 只是文字', () => {
    expect(splitHighlight('<b>粗體</b>', ['粗'])).toEqual([
      { text: '<b>', match: false },
      { text: '粗', match: true },
      { text: '體</b>', match: false },
    ]);
  });

  it('沒有關鍵字或空字串回單一片段', () => {
    expect(splitHighlight('文字', [])).toEqual([{ text: '文字', match: false }]);
    expect(splitHighlight('', ['a'])).toEqual([{ text: '', match: false }]);
  });

  it('轉小寫後長度會變的字元不標示（避免位置對不上）', () => {
    expect(splitHighlight('İstanbul', ['stan'])).toEqual([{ text: 'İstanbul', match: false }]);
  });
});

describe('splitRepoHighlight', () => {
  it('一般搜尋「#AAA」連 # 一起標', () => {
    expect(marked(splitRepoHighlight('AAA', { keyword: '#aaa' }))).toBe('[#AAA]');
  });

  it('一般搜尋「AAA」只標名稱', () => {
    expect(marked(splitRepoHighlight('AAA', { keyword: 'aaa' }))).toBe('#[AAA]');
  });

  it('點推薦搜 Repo：完全相同才整個標示', () => {
    const query = { keyword: 'AAA', field: '專案Repo' as const };
    expect(marked(splitRepoHighlight('AAA', query))).toBe('#[AAA]');
    expect(marked(splitRepoHighlight('AAAB', query))).toBe('#AAAB');
  });

  it('點推薦搜其他欄位時 Repo 不標示', () => {
    expect(marked(splitRepoHighlight('AAA', { keyword: 'AAA', field: '專案名稱' }))).toBe('#AAA');
  });
});

describe('compareSearchResults', () => {
  it('工作日期新的在前，同一天照項次', () => {
    const items = [
      makeItem({ id: 'a', 工作日期: '2026-10-08', 項次: 1 }),
      makeItem({ id: 'b', 工作日期: '2026-10-09', 項次: 2 }),
      makeItem({ id: 'c', 工作日期: '2026-10-09', 項次: 1 }),
    ];
    expect(items.sort(compareSearchResults).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('buildSuggestions', () => {
  const options: WorkItemOptions = {
    交辦單位: ['資訊部', '行銷部'],
    交辦人員: ['王小明'],
    專案名稱: ['官網改版', '新官網'],
    專案Repo: ['web-官網'],
  };

  it('空白關鍵字沒有推薦', () => {
    expect(buildSuggestions(' ', options, [])).toEqual([]);
  });

  it('開頭符合的排前面，其餘照分類順序', () => {
    expect(buildSuggestions('官網', options, [])).toEqual([
      { field: '專案名稱', value: '官網改版' },
      { field: '專案名稱', value: '新官網' },
      { field: '專案Repo', value: 'web-官網' },
    ]);
  });

  it('近期紀錄的工作目標：新的優先、不重複', () => {
    const recent = [
      makeRecent({ 工作日期: '2026-10-01', 工作目標: '官網首頁' }),
      makeRecent({ 工作日期: '2026-10-05', 工作目標: '修正官網' }),
      makeRecent({ 工作日期: '2026-10-03', 工作目標: ' 官網首頁 ' }),
    ];
    expect(buildSuggestions('官網', null, recent).map((s) => `${s.field}:${s.value}`)).toEqual([
      '工作目標:官網首頁',
      '工作目標:修正官網',
    ]);
  });

  it('不分大小寫', () => {
    expect(buildSuggestions('WEB', options, [])).toEqual([
      { field: '專案Repo', value: 'web-官網' },
    ]);
  });

  it(`超過 ${SEARCH_KEYWORD_MAX} 字的值不推薦（點了會被後端以關鍵字太長退回）`, () => {
    const long = `官網${'字'.repeat(SEARCH_KEYWORD_MAX)}`;
    const recent = [
      makeRecent({ 工作日期: '2026-10-05', 工作目標: long }),
      makeRecent({ 工作日期: '2026-10-01', 工作目標: '官網首頁' }),
    ];
    expect(buildSuggestions('官網', null, recent).map((s) => s.value)).toEqual(['官網首頁']);
  });

  it(`最多 ${SUGGESTION_LIMIT} 筆`, () => {
    const many = { ...options, 專案名稱: Array.from({ length: 20 }, (_, i) => `專案${i}`) };
    expect(buildSuggestions('專案', many, [])).toHaveLength(SUGGESTION_LIMIT);
  });
});
