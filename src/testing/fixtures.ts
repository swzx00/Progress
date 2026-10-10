import type { RecentItem, WorkItem } from '@/types/work-item';

/** 測試用的工作紀錄：預設值是一筆完整的一般工作紀錄，只要覆寫測試在意的欄位 */
export const makeItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'id-1',
  項次: 1,
  工作日期: '2026-10-09',
  交辦單位: '資訊部',
  交辦人員: '王小明',
  專案名稱: '官網改版',
  專案Repo: [],
  工作目標: '首頁改版',
  處理內容: '',
  今日工時: 0,
  預計期限: '',
  完成度: 0,
  狀態: '待辦',
  已刪除: false,
  ...overrides,
});

/** 測試用的近期紀錄 */
export const makeRecent = (overrides: Partial<RecentItem> = {}): RecentItem => ({
  id: 'id-1',
  項次: 1,
  工作日期: '2026-10-09',
  交辦單位: '資訊部',
  交辦人員: '王小明',
  專案名稱: '官網改版',
  專案Repo: [],
  工作目標: '首頁改版',
  預計期限: '',
  完成度: 0,
  狀態: '待辦',
  ...overrides,
});
