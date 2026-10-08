import schema from '../../shared/validation-schema.json';

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

// 預計期限是選填，沒填（空字串）不算逾期；空字串在字串比較上永遠小於任何日期，要先排除
export const isOverdue = (item: WorkItem, today: string): boolean =>
  item.預計期限 !== '' && item.完成度 < 100 && item.預計期限 < today;

export interface WorkItemOptions {
  交辦單位: string[];
  交辦人員: string[];
  專案名稱: string[];
  專案Repo: string[];
}

/** 最近一次搭配的值：date 是工作日期，index 是項次（同一天比較先後用） */
export interface RecentPair {
  value: string;
  date: string;
  index: number;
}

/** 交辦單位 → 最近搭配的交辦人員、交辦人員 → 最近搭配的交辦單位（見 utils/recent-pairing.ts） */
export interface RecentPairs {
  交辦單位: Record<string, RecentPair>;
  交辦人員: Record<string, RecentPair>;
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

/**
 * 請假紀錄的狀態（規則在 shared/validation-schema.json 的 leave）。刻意不放進 STATUS_OPTIONS：
 * 一般工作紀錄的狀態下拉選單不能選到它，請假只能從「請假」按鈕開的表單建立
 */
export const LEAVE_STATUS = schema.leave.status;

export const isLeaveItem = (item: Pick<WorkItem, '狀態'>): boolean => item.狀態 === LEAVE_STATUS;

// Sheet 裡的狀態是純文字，可能出現清單外的值（舊資料、手動輸入），查不到回傳 undefined
export const getStatusKey = (status: string): string | undefined => {
  if (status === LEAVE_STATUS) return 'leave';
  return Object.hasOwn(STATUS_KEYS, status) ? STATUS_KEYS[status as Status] : undefined;
};
