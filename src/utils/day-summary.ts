import { isLeaveItem, type WorkItem } from '@/types/work-item';

/** 不列進本日總結的專案名稱（完全相同才排除） */
const EXCLUDED_PROJECTS = ['會議討論'];

/** 工作目標開頭的單號：「#」或「T」加 4–5 位數字（後面不能再接數字） */
const TASK_CODE_PATTERN = /^(#\d{4,5}|T\d{4,5})(?!\d)/;

/** 工作目標開頭是單號就回傳單號，否則回傳空字串 */
export const extractTaskCode = (target: string): string =>
  TASK_CODE_PATTERN.exec(target.trim())?.[1] ?? '';

/**
 * 本日總結（使用者決定）：排除請假、專案名稱「會議討論」，照項次排序後重新從 1 編號，每筆一段：
 * - 第一行「N. 專案Repo 單號」：Repo 用逗號串（同 Sheet 格式），單號是工作目標開頭的「#／T＋4–5 位數字」，
 *   沒有就不顯示
 * - 第二行處理內容；處理內容是空的改顯示工作目標
 * - 沒有 Repo 也沒有單號時，第二行的內容直接接在「N.」後面，只佔一行
 */
export const buildDaySummary = (items: WorkItem[]): string =>
  items
    .filter((item) => !isLeaveItem(item) && !EXCLUDED_PROJECTS.includes(item.專案名稱.trim()))
    .sort((a, b) => a.項次 - b.項次)
    .map((item, index) => {
      const heading = [item.專案Repo.join(','), extractTaskCode(item.工作目標)]
        .filter(Boolean)
        .join(' ');
      const body = item.處理內容.trim() || item.工作目標.trim();
      return heading ? `${index + 1}. ${heading}\n${body}` : `${index + 1}. ${body}`;
    })
    .join('\n');
