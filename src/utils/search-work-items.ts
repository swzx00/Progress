import type { RecentItem, WorkItem, WorkItemOptions } from '@/types/work-item';

/**
 * 搜尋欄（使用者決定）：打字時跳出「推薦選擇」，按 Enter／搜尋按鈕／點推薦才到後端查「搜尋結果」。
 * - 推薦：只用瀏覽器裡已經有的小資料（選項清單＋近期紀錄的工作目標），不打 API
 * - 搜尋：後端 doGet type=search 查全部資料，比對規則是這裡的 matchesSearch，
 *   Code.gs 的 matchesSearch_ 手動同步（MSW 直接用這裡的），改一處要一起改
 */

/** 點推薦時只搜那個欄位；沒帶 field 就是一般的關鍵字搜尋（全部文字欄位） */
export const SEARCH_FIELDS = ['交辦單位', '交辦人員', '專案名稱', '專案Repo', '工作目標'] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

export interface SearchQuery {
  keyword: string;
  field?: SearchField;
}

/** 關鍵字長度上限（Code.gs 的 SEARCH_KEYWORD_MAX 同步） */
export const SEARCH_KEYWORD_MAX = 100;
/** 一次最多回傳幾筆（最新的優先），Code.gs 的 SEARCH_MAX_RESULTS 同步 */
export const SEARCH_MAX_RESULTS = 200;

const normalize = (value: string): string => value.trim().toLowerCase();

/** 一般搜尋：用空白隔開的關鍵字（不分大小寫） */
export const parseKeywords = (keyword: string): string[] =>
  normalize(keyword).split(/\s+/).filter(Boolean);

type SearchableItem = Pick<
  WorkItem,
  '交辦單位' | '交辦人員' | '專案名稱' | '專案Repo' | '工作目標' | '處理內容' | '狀態'
>;

const searchableText = (item: SearchableItem): string =>
  [
    item.交辦單位,
    item.交辦人員,
    item.專案名稱,
    // 畫面上 Repo 是 #AAA 標籤，搜「#AAA」或「AAA」都要找得到
    ...item.專案Repo.map((repo) => `#${repo}`),
    item.工作目標,
    item.處理內容,
    item.狀態,
  ]
    .join('\n')
    .toLowerCase();

/**
 * 搜尋比對規則：
 * - 一般搜尋：交辦單位、交辦人員、專案名稱、專案 Repo、工作目標、處理內容、狀態，
 *   用空白隔開的每個關鍵字都要出現（AND），不分大小寫
 * - 指定欄位（點推薦）：交辦單位、交辦人員、專案名稱完全相同；專案 Repo 包含那一個；
 *   工作目標包含那段文字（同一件工作的目標常會多寫幾個字）。都不分大小寫
 */
export const matchesSearch = (item: SearchableItem, query: SearchQuery): boolean => {
  const keyword = normalize(query.keyword);
  if (!keyword) return false;
  switch (query.field) {
    case '交辦單位':
    case '交辦人員':
    case '專案名稱':
      return normalize(item[query.field]) === keyword;
    case '專案Repo':
      return item.專案Repo.some((repo) => normalize(repo) === keyword);
    case '工作目標':
      return normalize(item.工作目標).includes(keyword);
    default: {
      const text = searchableText(item);
      return parseKeywords(keyword).every((word) => text.includes(word));
    }
  }
};

// ===== 搜尋結果標示符合的字 =====

/** 搜尋結果表格上會標示的欄位（一般搜尋比對的全部欄位） */
export type HighlightField = keyof SearchableItem;

/** 切好的文字片段，match 為 true 的要標示 */
export interface TextSegment {
  text: string;
  match: boolean;
}

/**
 * 某個欄位在這次搜尋要標示哪些字（小寫），規則跟 matchesSearch 一致：
 * - 一般搜尋：所有被搜尋的欄位都標示每個關鍵字（空白隔開）
 * - 指定欄位（點推薦）：只標示那個欄位，整段關鍵字當一個詞（不拆空白），其他欄位不標示
 */
export const highlightTerms = (query: SearchQuery | null, field: HighlightField): string[] => {
  if (!query) return [];
  const keyword = normalize(query.keyword);
  if (!keyword) return [];
  if (!query.field) return parseKeywords(keyword);
  return query.field === field ? [keyword] : [];
};

/**
 * 把文字切成「符合／不符合」的片段（不分大小寫，重疊或相連的符合範圍合併成一段），
 * 畫面用切好的陣列渲染，不用 v-html，使用者輸入的內容不會被當成 HTML
 */
export const splitHighlight = (text: string, terms: string[]): TextSegment[] => {
  const lower = text.toLowerCase();
  // 少數字元轉小寫後長度會變，位置對不上就不標示
  if (!text || terms.length === 0 || lower.length !== text.length) return [{ text, match: false }];
  const marks: boolean[] = new Array<boolean>(text.length).fill(false);
  terms.forEach((term) => {
    if (!term) return;
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + 1)) {
      marks.fill(true, i, i + term.length);
    }
  });
  const segments: TextSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.match === marks[i]) last.text += text[i];
    else segments.push({ text: text[i] as string, match: marks[i] as boolean });
  }
  return segments;
};

/**
 * 專案 Repo 標籤（畫面上是 #AAA）：一般搜尋用 #AAA 比對（搜「#AAA」或「AAA」都標得到）；
 * 點推薦搜 Repo 是「完全相同」，只有那一個標籤整個標示，不會標到名稱只是部分相同的其他標籤
 */
export const splitRepoHighlight = (repo: string, query: SearchQuery | null): TextSegment[] => {
  if (query?.field === '專案Repo') {
    return normalize(repo) === normalize(query.keyword)
      ? [
          { text: '#', match: false },
          { text: repo, match: true },
        ]
      : [{ text: `#${repo}`, match: false }];
  }
  return splitHighlight(`#${repo}`, highlightTerms(query, '專案Repo'));
};

/** 搜尋結果的順序：工作日期新的在前，同一天照項次 */
export const compareSearchResults = (a: WorkItem, b: WorkItem): number =>
  b.工作日期.localeCompare(a.工作日期) || a.項次 - b.項次;

// ===== 推薦選擇 =====

export interface SearchSuggestion {
  field: SearchField;
  value: string;
}

/** 推薦最多幾筆 */
export const SUGGESTION_LIMIT = 8;

/** 推薦清單上的分類名稱 */
export const SEARCH_FIELD_LABELS: Record<SearchField, string> = {
  交辦單位: '交辦單位',
  交辦人員: '交辦人員',
  專案名稱: '專案名稱',
  專案Repo: '專案 Repo',
  工作目標: '工作目標',
};

/**
 * 推薦選擇：從選項清單（交辦單位、交辦人員、專案名稱、專案 Repo）與近期紀錄的工作目標（新的優先、不重複）
 * 找出包含關鍵字的值（不分大小寫）。開頭就符合的排前面，其餘照分類順序；最多 SUGGESTION_LIMIT 筆。
 * 點推薦會把整個值當關鍵字送出，超過 SEARCH_KEYWORD_MAX 字的值（工作目標最長 500 字）後端會拒絕，所以不推薦
 */
export const buildSuggestions = (
  keyword: string,
  options: WorkItemOptions | null,
  recentItems: RecentItem[],
): SearchSuggestion[] => {
  const word = normalize(keyword);
  if (!word) return [];

  const targets = [...recentItems]
    .sort((a, b) => b.工作日期.localeCompare(a.工作日期))
    .map((item) => item.工作目標.trim())
    .filter((target, index, list) => target && list.indexOf(target) === index);

  const candidates: SearchSuggestion[] = [
    ...(['交辦單位', '交辦人員', '專案名稱', '專案Repo'] as const).flatMap((field) =>
      (options?.[field] ?? []).map((value) => ({ field, value })),
    ),
    ...targets.map((value) => ({ field: '工作目標' as const, value })),
  ].filter(
    (candidate) =>
      candidate.value.trim().length <= SEARCH_KEYWORD_MAX &&
      normalize(candidate.value).includes(word),
  );

  const startsWith = (candidate: SearchSuggestion): boolean =>
    normalize(candidate.value).startsWith(word);
  return [...candidates.filter(startsWith), ...candidates.filter((c) => !startsWith(c))].slice(
    0,
    SUGGESTION_LIMIT,
  );
};
