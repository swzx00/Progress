import { describe, expect, it } from 'vitest';

import { makeItem } from '@/testing/fixtures';

import { buildDaySummary, extractTaskCode } from '@/utils/day-summary';

describe('extractTaskCode', () => {
  it.each([
    ['#7902 修正登入', '#7902'],
    ['#12345 修正登入', '#12345'],
    ['T1234 調整版面', 'T1234'],
    ['  #7902 前面有空白', '#7902'],
    ['#7902', '#7902'],
  ])('「%s」→ %s', (target, code) => {
    expect(extractTaskCode(target)).toBe(code);
  });

  it.each([
    ['#123 太短'],
    ['#123456 太長（後面還接數字）'],
    ['修正 #7902 不在開頭'],
    ['t1234 小寫 t'],
    ['T12 太短'],
    [''],
  ])('「%s」不算單號', (target) => {
    expect(extractTaskCode(target)).toBe('');
  });
});

describe('buildDaySummary', () => {
  it('CLAUDE.md 範例', () => {
    const items = [
      makeItem({
        項次: 1,
        專案Repo: ['web-components-vue3/notify-message-recruit'],
        工作目標: '即時通',
        處理內容: '即時通測試',
      }),
      makeItem({
        項次: 2,
        專案Repo: ['release_source'],
        工作目標: '#7902 工單',
        處理內容: '與 PM 確認工單內容',
      }),
    ];
    expect(buildDaySummary(items)).toBe(
      [
        '1.web-components-vue3/notify-message-recruit',
        '- 即時通測試',
        '2.release_source #7902',
        '- 與 PM 確認工單內容',
      ].join('\n'),
    );
  });

  it('排除請假與專案名稱「會議討論」，照項次排序後重新編號', () => {
    const items = [
      makeItem({ 項次: 4, 專案名稱: 'D' }),
      makeItem({ 項次: 1, 專案名稱: '會議討論' }),
      makeItem({ 項次: 2, 狀態: '休假', 專案名稱: '休假' }),
      makeItem({ 項次: 3, 專案名稱: 'C' }),
    ];
    expect(buildDaySummary(items)).toBe('1.C\n2.D');
  });

  it('「會議討論」要完全相同才排除', () => {
    expect(buildDaySummary([makeItem({ 專案名稱: '會議討論準備' })])).toBe('1.會議討論準備');
  });

  it('多個 Repo 用逗號串', () => {
    expect(buildDaySummary([makeItem({ 專案Repo: ['AAA', 'BBBB'] })])).toBe('1.AAA,BBBB');
  });

  it('沒有 Repo 放專案名稱，不加單號', () => {
    expect(buildDaySummary([makeItem({ 專案名稱: '官網', 工作目標: '#7902 修正' })])).toBe(
      '1.官網',
    );
  });

  it('沒有 Repo 也沒有專案名稱放工作目標', () => {
    expect(buildDaySummary([makeItem({ 專案名稱: ' ', 工作目標: ' 首頁改版 ' })])).toBe(
      '1.首頁改版',
    );
  });

  it('處理內容每一行加「- 」，略過空行，已經是「-」開頭的維持原樣', () => {
    const item = makeItem({ 處理內容: '第一行\n\n  第二行  \n- 已有符號\n-緊貼' });
    expect(buildDaySummary([item])).toBe(
      ['1.官網改版', '- 第一行', '- 第二行', '- 已有符號', '-緊貼'].join('\n'),
    );
  });

  it('沒有紀錄回空字串', () => {
    expect(buildDaySummary([])).toBe('');
    expect(buildDaySummary([makeItem({ 狀態: '休假' })])).toBe('');
  });
});
