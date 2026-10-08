import type { SelectOption } from 'naive-ui';

import { isLeaveItem, type RecentPairs, type WorkItem } from '@/types/work-item';

/**
 * 交辦單位 ↔ 交辦人員的「最近搭配」推薦（使用者決定）：
 * - 只看最近 RECENT_PAIR_DAYS 天的紀錄、排除請假；每個交辦單位只記最近一次搭配的交辦人員，反之亦然
 * - 「最近」比較工作日期，同一天再比項次（後面的較新）
 * 後端 Code.gs 的 getRecentPairs_ 用同一套規則（手動同步），MSW 用這裡的 buildRecentPairs
 */
export const RECENT_PAIR_DAYS = 30;

export const emptyRecentPairs = (): RecentPairs => ({ 交辦單位: {}, 交辦人員: {} });

type PairSource = Pick<WorkItem, '工作日期' | '交辦單位' | '交辦人員' | '狀態'> & {
  項次?: number;
};

const isNewer = (date: string, index: number, current?: { date: string; index: number }) =>
  !current || date > current.date || (date === current.date && index >= current.index);

/** 用一筆紀錄更新推薦資料（比現有的新才覆蓋），回傳新的物件；沒有項次（剛存檔的）視為當天最新 */
export const applyRecentPair = (pairs: RecentPairs, item: PairSource): RecentPairs => {
  const unit = item.交辦單位.trim();
  const person = item.交辦人員.trim();
  if (isLeaveItem(item) || !unit || !person) return pairs;
  const index = item.項次 ?? Number.MAX_SAFE_INTEGER;
  const next: RecentPairs = { 交辦單位: { ...pairs.交辦單位 }, 交辦人員: { ...pairs.交辦人員 } };
  if (isNewer(item.工作日期, index, next.交辦單位[unit])) {
    next.交辦單位[unit] = { value: person, date: item.工作日期, index };
  }
  if (isNewer(item.工作日期, index, next.交辦人員[person])) {
    next.交辦人員[person] = { value: unit, date: item.工作日期, index };
  }
  return next;
};

/** 從一批紀錄整理推薦資料，只算工作日期 ≥ cutoff 的（日期格式跟 cutoff 一致即可比較） */
export const buildRecentPairs = (items: PairSource[], cutoff: string): RecentPairs =>
  items
    .filter((item) => item.工作日期 >= cutoff)
    .reduce((pairs, item) => applyRecentPair(pairs, item), emptyRecentPairs());

/**
 * 下拉選項：推薦的值（還在選項清單裡才算）排最上面並標記 recent，其餘照原本順序、不重複出現。
 * 樣式由使用端依 option.recent 決定
 */
export const withRecentFirst = (values: string[], recent: string | undefined): SelectOption[] => {
  const rest = values.map((value) => ({ label: value, value }));
  if (!recent || !values.includes(recent)) return rest;
  return [
    { label: recent, value: recent, recent: true },
    ...rest.filter((option) => option.value !== recent),
  ];
};
