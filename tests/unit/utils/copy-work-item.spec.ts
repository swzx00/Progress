import { describe, expect, it } from 'vitest';

import { makeItem } from '@/testing/fixtures';

import { buildCopyPayload } from '@/utils/copy-work-item';

describe('buildCopyPayload', () => {
  it('工作紀錄：帶入專案相關欄位，處理內容、今日工時清空，工作日期換成目標日', () => {
    const source = makeItem({
      id: 'src',
      項次: 3,
      工作日期: '2026-10-08',
      專案Repo: ['AAA'],
      處理內容: '當天做的事',
      今日工時: 4,
      預計期限: '2026-10-31',
      完成度: 50,
      狀態: '進行中',
    });
    expect(buildCopyPayload(source, '2026-10-09')).toEqual({
      工作日期: '2026-10-09',
      交辦單位: '資訊部',
      交辦人員: '王小明',
      專案名稱: '官網改版',
      專案Repo: ['AAA'],
      工作目標: '首頁改版',
      預計期限: '2026-10-31',
      完成度: 50,
      狀態: '進行中',
      處理內容: '',
      今日工時: 0,
    });
  });

  it('不帶 id、項次、已刪除（項次由後端決定）', () => {
    const payload = buildCopyPayload(makeItem(), '2026-10-09');
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('項次');
    expect(payload).not.toHaveProperty('已刪除');
  });

  it('舊資料狀態為空時帶「待辦」', () => {
    expect(buildCopyPayload(makeItem({ 狀態: '' }), '2026-10-09').狀態).toBe('待辦');
  });

  it('專案 Repo 是複製的陣列，不會跟來源共用', () => {
    const source = makeItem({ 專案Repo: ['AAA'] });
    const payload = buildCopyPayload(source, '2026-10-09');
    payload.專案Repo.push('BBB');
    expect(source.專案Repo).toEqual(['AAA']);
  });

  it('請假紀錄：帶入假別、請假時數、備註，其他欄位用固定值', () => {
    const source = makeItem({
      狀態: '休假',
      交辦單位: '亂填',
      專案Repo: ['X'],
      工作目標: '特休',
      處理內容: '出國',
      今日工時: 4,
      預計期限: '2026-10-31',
      完成度: 0,
    });
    expect(buildCopyPayload(source, '2026-10-12')).toEqual({
      工作日期: '2026-10-12',
      交辦單位: '人事室',
      交辦人員: '--',
      專案名稱: '休假',
      專案Repo: [],
      預計期限: '',
      完成度: 100,
      工作目標: '特休',
      處理內容: '出國',
      今日工時: 4,
      狀態: '休假',
    });
  });
});
