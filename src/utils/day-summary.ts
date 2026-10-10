import { isLeaveItem, type WorkItem } from '@/types/work-item';

/** 不列進本日總結的專案名稱（完全相同才排除） */
const EXCLUDED_PROJECTS = ['會議討論'];

/** 工作目標開頭的單號：「#」或「T」加 4–5 位數字（後面不能再接數字） */
const TASK_CODE_PATTERN = /^(#\d{4,5}|T\d{4,5})(?!\d)/;

/** 工作目標開頭是單號就回傳單號，否則回傳空字串 */
export const extractTaskCode = (target: string): string =>
  TASK_CODE_PATTERN.exec(target.trim())?.[1] ?? '';

/**
 * 第一行標題：有 Repo 放 Repo（逗號串，同 Sheet 格式），工作目標開頭有單號就接在後面；
 * 沒有 Repo 放專案名稱，再沒有放工作目標（這兩種情況不加單號）
 */
const buildHeading = (item: WorkItem): string => {
  const repos = item.專案Repo.join(',');
  if (repos) return [repos, extractTaskCode(item.工作目標)].filter(Boolean).join(' ');
  return item.專案名稱.trim() || item.工作目標.trim();
};

/** 處理內容每一行（略過空行）前面加「- 」，本身已經是「-」開頭的維持原樣 */
const buildBodyLines = (content: string): string[] =>
  content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('-') ? line : `- ${line}`));

/**
 * 本日總結（使用者決定）：排除請假、專案名稱「會議討論」，照項次排序後重新從 1 編號，每筆一段：
 * - 第一行「N.標題」（編號後面不空格），標題規則見 buildHeading
 * - 下面每一行是處理內容的一行，前面加「- 」；沒有處理內容就只有第一行
 */
export const buildDaySummary = (items: WorkItem[]): string =>
  items
    .filter((item) => !isLeaveItem(item) && !EXCLUDED_PROJECTS.includes(item.專案名稱.trim()))
    .sort((a, b) => a.項次 - b.項次)
    .map((item, index) =>
      [`${index + 1}.${buildHeading(item)}`, ...buildBodyLines(item.處理內容)].join('\n'),
    )
    .join('\n');
