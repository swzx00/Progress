import type { SelectOption } from 'naive-ui';

import { isLeaveItem, type RecentItem } from '@/types/work-item';
import { extractTaskCode } from '@/utils/day-summary';

/**
 * 近期紀錄（表單的推薦與預填用，使用者決定）：
 * - 來源：後端 doGet type=options 一起回傳的 recentItems（近 RECENT_DAYS 天、未刪除、排除請假的紀錄），
 *   存檔成功後前端再用 upsertRecentItems 補上剛存的紀錄，不用重新讀
 * - 「最近一筆」：工作日期新的優先，同一天項次大的優先；剛存檔、還沒有項次的視為當天最新
 * 後端 Code.gs 的 getRecentItems_ 只負責撈資料，篩選規則（天數、排除請假）要跟這裡一致
 */
export const RECENT_DAYS = 30;

const indexOf = (item: RecentItem): number => item.項次 ?? Number.MAX_SAFE_INTEGER;

const newestFirst = (items: RecentItem[]): RecentItem[] =>
  [...items].sort((a, b) => b.工作日期.localeCompare(a.工作日期) || indexOf(b) - indexOf(a));

const findLatest = (
  items: RecentItem[],
  predicate: (item: RecentItem) => boolean,
): RecentItem | undefined => newestFirst(items).find(predicate);

/** 只保留工作日期 ≥ cutoff、排除請假的紀錄（日期格式跟 cutoff 一致即可比較） */
export const filterRecentItems = <T extends RecentItem>(items: T[], cutoff: string): T[] =>
  items.filter((item) => item.工作日期 >= cutoff && !isLeaveItem(item));

/** 存檔後更新近期紀錄：有 id 的（編輯）取代同 id 那筆，沒有 id 的（新增、複製本日）直接加入；請假略過 */
export const upsertRecentItems = (items: RecentItem[], saved: RecentItem[]): RecentItem[] =>
  saved
    .filter((item) => !isLeaveItem(item))
    .reduce((list, item) => [...list.filter((old) => !item.id || old.id !== item.id), item], items);

// ===== 下拉選單推薦：已選一邊，另一邊推薦「最近一筆」搭配的值（只推薦、不自動填入）=====

export const recentAssignee = (items: RecentItem[], unit: string): string | undefined =>
  unit.trim() ? findLatest(items, (item) => item.交辦單位 === unit.trim())?.交辦人員 : undefined;

export const recentUnit = (items: RecentItem[], person: string): string | undefined =>
  person.trim()
    ? findLatest(items, (item) => item.交辦人員 === person.trim())?.交辦單位
    : undefined;

/** 專案名稱 → 最近一筆的專案 Repo（可能有多個，全部推薦） */
export const recentRepos = (items: RecentItem[], project: string): string[] =>
  project.trim()
    ? (findLatest(items, (item) => item.專案名稱 === project.trim())?.專案Repo ?? [])
    : [];

/** 專案 Repo（已選的任一個）→ 最近一筆包含它的專案名稱 */
export const recentProject = (items: RecentItem[], repos: string[]): string | undefined =>
  repos.length > 0
    ? findLatest(items, (item) => item.專案Repo.some((repo) => repos.includes(repo)))?.專案名稱
    : undefined;

/**
 * 下拉選項：推薦的值（還在選項清單裡才算）排最上面並標記 recent，其餘照原本順序、不重複出現。
 * 樣式由使用端依 option.recent 決定
 */
export const withRecentFirst = (
  values: string[],
  recent: string | string[] | undefined,
): SelectOption[] => {
  const recentValues = (Array.isArray(recent) ? recent : recent ? [recent] : []).filter((value) =>
    values.includes(value),
  );
  return [
    ...recentValues.map((value) => ({ label: value, value, recent: true })),
    ...values
      .filter((value) => !recentValues.includes(value))
      .map((value) => ({ label: value, value })),
  ];
};

// ===== 填完工作目標後預填 =====

/** 工作目標的比對鍵：開頭有單號（#／T＋4–5 位數字）就用單號，沒有才用整段文字（去前後空白） */
export const targetKey = (target: string): string => extractTaskCode(target) || target.trim();

/** 工作目標相同（比對鍵相同）的最近一筆 */
export const recentByTarget = (items: RecentItem[], target: string): RecentItem | undefined => {
  const key = targetKey(target);
  return key ? findLatest(items, (item) => targetKey(item.工作目標) === key) : undefined;
};
