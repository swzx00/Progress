import { describe, expect, it } from 'vitest';

import { makeRecent } from '@/testing/fixtures';

import {
  filterRecentItems,
  recentAssignee,
  recentByTarget,
  recentProject,
  recentRepos,
  recentUnit,
  targetKey,
  upsertRecentItems,
  withRecentFirst,
} from './recent-history';

describe('filterRecentItems', () => {
  it('只保留工作日期 ≥ cutoff、排除請假', () => {
    const items = [
      makeRecent({ id: 'old', 工作日期: '2026-09-08' }),
      makeRecent({ id: 'edge', 工作日期: '2026-09-09' }),
      makeRecent({ id: 'leave', 工作日期: '2026-10-01', 狀態: '休假' }),
      makeRecent({ id: 'new', 工作日期: '2026-10-09' }),
    ];
    expect(filterRecentItems(items, '2026-09-09').map((i) => i.id)).toEqual(['edge', 'new']);
  });
});

describe('「最近一筆」的規則', () => {
  it('工作日期新的優先', () => {
    const items = [
      makeRecent({ 工作日期: '2026-10-08', 項次: 9, 交辦人員: '舊' }),
      makeRecent({ 工作日期: '2026-10-09', 項次: 1, 交辦人員: '新' }),
    ];
    expect(recentAssignee(items, '資訊部')).toBe('新');
  });

  it('同一天項次大的優先', () => {
    const items = [
      makeRecent({ 項次: 2, 交辦人員: '後' }),
      makeRecent({ 項次: 1, 交辦人員: '前' }),
    ];
    expect(recentAssignee(items, '資訊部')).toBe('後');
  });

  it('剛存檔、還沒有項次的視為當天最新', () => {
    const items = [
      makeRecent({ 項次: 5, 交辦人員: '有項次' }),
      makeRecent({ id: undefined, 項次: undefined, 交辦人員: '剛存' }),
    ];
    expect(recentAssignee(items, '資訊部')).toBe('剛存');
  });
});

describe('下拉推薦', () => {
  const items = [
    makeRecent({
      工作日期: '2026-10-01',
      交辦單位: '資訊部',
      交辦人員: '甲',
      專案名稱: 'A',
      專案Repo: ['r1'],
    }),
    makeRecent({
      工作日期: '2026-10-05',
      交辦單位: '行銷部',
      交辦人員: '乙',
      專案名稱: 'B',
      專案Repo: ['r2', 'r3'],
    }),
    makeRecent({
      工作日期: '2026-10-03',
      交辦單位: '資訊部',
      交辦人員: '丙',
      專案名稱: 'A',
      專案Repo: ['r1', 'r4'],
    }),
  ];

  it('交辦單位 → 最近一筆的交辦人員', () => {
    expect(recentAssignee(items, '資訊部')).toBe('丙');
    expect(recentAssignee(items, ' 資訊部 ')).toBe('丙');
  });

  it('交辦人員 → 最近一筆的交辦單位', () => {
    expect(recentUnit(items, '乙')).toBe('行銷部');
  });

  it('專案名稱 → 最近一筆的全部 Repo', () => {
    expect(recentRepos(items, 'A')).toEqual(['r1', 'r4']);
    expect(recentRepos(items, 'B')).toEqual(['r2', 'r3']);
  });

  it('專案 Repo（任一個）→ 最近一筆的專案名稱', () => {
    expect(recentProject(items, ['r4'])).toBe('A');
    expect(recentProject(items, ['r1', 'r3'])).toBe('B');
  });

  it('沒選或找不到時沒有推薦', () => {
    expect(recentAssignee(items, '')).toBeUndefined();
    expect(recentAssignee(items, '人事室')).toBeUndefined();
    expect(recentUnit(items, ' ')).toBeUndefined();
    expect(recentRepos(items, '')).toEqual([]);
    expect(recentRepos(items, 'C')).toEqual([]);
    expect(recentProject(items, [])).toBeUndefined();
  });
});

describe('withRecentFirst', () => {
  it('推薦的值排最上面並標記，其餘照原本順序、不重複', () => {
    expect(withRecentFirst(['a', 'b', 'c'], 'b')).toEqual([
      { label: 'b', value: 'b', recent: true },
      { label: 'a', value: 'a' },
      { label: 'c', value: 'c' },
    ]);
  });

  it('多個推薦值', () => {
    expect(withRecentFirst(['a', 'b', 'c'], ['c', 'a']).map((o) => o.value)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('不在選項清單裡的推薦值不顯示', () => {
    expect(withRecentFirst(['a', 'b'], 'x')).toEqual([
      { label: 'a', value: 'a' },
      { label: 'b', value: 'b' },
    ]);
  });

  it('沒有推薦時照原本順序', () => {
    expect(withRecentFirst(['a'], undefined)).toEqual([{ label: 'a', value: 'a' }]);
  });
});

describe('targetKey / recentByTarget', () => {
  it('開頭有單號就用單號比對', () => {
    expect(targetKey('#12345 登入頁')).toBe('#12345');
    expect(targetKey('T1234 版面')).toBe('T1234');
  });

  it('沒有單號用整段文字（去前後空白）', () => {
    expect(targetKey('  首頁改版 ')).toBe('首頁改版');
  });

  it('單號相同就算同一筆（CLAUDE.md 範例）', () => {
    const items = [makeRecent({ 工作目標: '#12345 登入頁', 完成度: 50 })];
    expect(recentByTarget(items, '#12345 登入頁修正')?.完成度).toBe(50);
  });

  it('沒有單號要整段相同', () => {
    const items = [makeRecent({ 工作目標: '首頁改版' })];
    expect(recentByTarget(items, ' 首頁改版 ')).toBeDefined();
    expect(recentByTarget(items, '首頁改版第二階段')).toBeUndefined();
  });

  it('找最近一筆', () => {
    const items = [
      makeRecent({ 工作日期: '2026-10-01', 工作目標: '首頁', 完成度: 10 }),
      makeRecent({ 工作日期: '2026-10-05', 工作目標: '首頁', 完成度: 60 }),
    ];
    expect(recentByTarget(items, '首頁')?.完成度).toBe(60);
  });

  it('空白工作目標不找', () => {
    expect(recentByTarget([makeRecent({ 工作目標: '' })], '  ')).toBeUndefined();
  });
});

describe('upsertRecentItems', () => {
  const base = [makeRecent({ id: 'a', 工作目標: '原本' }), makeRecent({ id: 'b' })];

  it('有 id 的（編輯）取代同 id 那筆', () => {
    const result = upsertRecentItems(base, [makeRecent({ id: 'a', 工作目標: '改過' })]);
    expect(result.filter((i) => i.id === 'a')).toHaveLength(1);
    expect(result.find((i) => i.id === 'a')?.工作目標).toBe('改過');
  });

  it('沒有 id 的（新增、複製本日）直接加入', () => {
    const saved = [makeRecent({ id: undefined }), makeRecent({ id: undefined })];
    expect(upsertRecentItems(base, saved)).toHaveLength(4);
  });

  it('請假略過', () => {
    expect(upsertRecentItems(base, [makeRecent({ id: undefined, 狀態: '休假' })])).toEqual(base);
  });

  it('不改動原本的陣列', () => {
    upsertRecentItems(base, [makeRecent({ id: undefined })]);
    expect(base).toHaveLength(2);
  });
});
