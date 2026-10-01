export interface WorkItem {
  id: string;
  項次: number;
  交辦單位: string;
  交辦人員: string;
  專案名稱: string;
  專案Repo: string[];
  工作目標: string;
  處理內容: string;
  今日工時: number;
  預計期限: string;
  完成度: number;
  狀態: string;
  工作日期: string;
  已刪除: boolean;
}

export const isOverdue = (item: WorkItem, today: string): boolean =>
  item.完成度 < 100 && item.預計期限 < today;

export interface WorkItemOptions {
  交辦單位: string[];
  交辦人員: string[];
  專案名稱: string[];
  專案Repo: string[];
}

export const STATUS_OPTIONS = ['進行中', '前端完成', '返修', '待辦', '確認上線', '暫緩'] as const;

export type Status = (typeof STATUS_OPTIONS)[number];

// class 名稱只能用英文 kebab-case（BEM），所以狀態要先對應成英文 key 才能當 modifier
export const STATUS_KEYS: Record<Status, string> = {
  進行中: 'in-progress',
  前端完成: 'frontend-done',
  返修: 'rework',
  待辦: 'todo',
  確認上線: 'live',
  暫緩: 'paused',
};

// Sheet 裡的狀態是純文字，可能出現清單外的值（舊資料、手動輸入），查不到回傳 undefined
export const getStatusKey = (status: string): string | undefined =>
  Object.hasOwn(STATUS_KEYS, status) ? STATUS_KEYS[status as Status] : undefined;
