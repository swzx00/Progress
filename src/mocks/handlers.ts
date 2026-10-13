import { http, HttpResponse } from 'msw';

import schema from '../../shared/validation-schema.json';

import { isLeaveItem, type WorkItem, type WorkItemOptions } from '@/types/work-item';
import { toLocalDateString } from '@/utils/date';
import { filterRecentItems, RECENT_DAYS } from '@/utils/recent-history';
import {
  compareSearchResults,
  matchesSearch,
  SEARCH_FIELDS,
  SEARCH_KEYWORD_MAX,
  SEARCH_MAX_RESULTS,
  type SearchField,
} from '@/utils/search-work-items';
import { THEME_MODES, type ThemeMode } from '@/composables/useTheme';
import {
  AUTO_FILL_TEXT_MAX,
  validateAutoFillSetting,
  type AutoFillSetting,
} from '@/utils/auto-fill';
import { validateWorkHoursSetting, type WorkHoursSetting } from '@/utils/work-hours';
import { dailyHoursMessage, validateOptionValue } from '@/validation/work-item';

// 貼近真實 Apps Script／Google Sheet 的日期字串格式（YYYY/MM/DD，見 useWorkItems.ts）
// 用本地時間的年月日（toISOString 會換成 UTC，台灣凌晨會差一天）
const toDateString = (d: Date): string => toLocalDateString(d).replaceAll('-', '/');

const addDays = (base: Date, days: number): Date => {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
};

const today = toDateString(new Date());
const yesterday = toDateString(addDays(new Date(), -1));

let items: WorkItem[] = [
  {
    id: 'wi-1',
    項次: 1,
    交辦單位: '資訊部',
    交辦人員: '王小明',
    專案名稱: '官網改版',
    專案Repo: ['AAA', 'BBBB'],
    工作目標: '首頁切版',
    處理內容: '完成首頁 RWD 調整',
    今日工時: 4,
    預計期限: toDateString(addDays(new Date(), -2)),
    完成度: 70,
    狀態: '',
    工作日期: today,
    已刪除: false,
  },
  {
    id: 'wi-2',
    項次: 2,
    交辦單位: '資訊部',
    交辦人員: '李小華',
    專案名稱: '會員系統優化',
    專案Repo: ['member-web'],
    工作目標: '登入流程重構',
    處理內容: '完成單元測試',
    今日工時: 3,
    預計期限: toDateString(addDays(new Date(), 5)),
    完成度: 100,
    狀態: '確認上線',
    工作日期: today,
    已刪除: false,
  },
  {
    id: 'wi-3',
    項次: 3,
    交辦單位: '業務部',
    交辦人員: '陳大文',
    專案名稱: '年度報告',
    專案Repo: [],
    工作目標: '資料彙整',
    處理內容: '等待業務部提供數據',
    今日工時: 1,
    預計期限: toDateString(addDays(new Date(), -5)),
    完成度: 20,
    狀態: '',
    工作日期: today,
    已刪除: false,
  },
  {
    id: 'wi-4',
    項次: 1,
    交辦單位: '資訊部',
    交辦人員: '王小明',
    專案名稱: '官網改版',
    專案Repo: ['AAA'],
    工作目標: '首頁切版',
    處理內容: '完成版面規劃',
    今日工時: 5,
    預計期限: toDateString(addDays(new Date(), -2)),
    完成度: 50,
    狀態: '',
    工作日期: yesterday,
    已刪除: false,
  },
];

// 項次是「每天」從 1 開始的流水號：同一工作日期、未刪除紀錄的最大項次 + 1（跟 Code.gs 的
// getNextDailyIndex_ 同一套規則）。用最大值不用筆數，刪掉中間某筆後才不會撞號
const getNextDailyIndex = (date: string): number =>
  Math.max(0, ...items.filter((i) => i.工作日期 === date && !i.已刪除).map((i) => i.項次)) + 1;

// 當天未刪除、排除 excludeId（編輯時是自己）的今日工時合計（跟 Code.gs 的
// getDayHoursExcluding_ 同一套規則）
const getDayHoursExcluding = (date: string, excludeId?: string): number =>
  items
    .filter((i) => i.工作日期 === date && !i.已刪除 && i.id !== excludeId)
    .reduce((sum, i) => sum + (Number(i.今日工時) || 0), 0);

// 請假時數超出範圍的訊息，格式跟 Code.gs 的 validateItem_（前端 validateLeave）一致
const leaveHoursError = (item: Partial<WorkItem>): string | undefined => {
  if (!isLeaveItem(item as WorkItem)) return undefined;
  const rule = schema.leave.fields.今日工時;
  const hours = Number(item.今日工時) || 0;
  return hours < rule.min || hours > rule.max
    ? `${rule.label}需介於 ${rule.min}–${rule.max}`
    : undefined;
};

// 只模擬工時相關的後端檢查：請假時數上限、每日工時合計上限
const validateHours = (
  item: Partial<WorkItem>,
  date: string,
  excludeId?: string,
): string | undefined => {
  const hours = Number(item.今日工時) || 0;
  const leaveError = leaveHoursError(item);
  if (leaveError) return leaveError;
  const otherHours = getDayHoursExcluding(date, excludeId);
  if (otherHours + hours > schema.dailyHours.max) {
    return dailyHoursMessage(otherHours, hours);
  }
  return undefined;
};

let options: WorkItemOptions = {
  交辦單位: ['資訊部', '業務部', '行銷部', '人資部'],
  交辦人員: ['王小明', '李小華', '陳大文'],
  專案名稱: ['官網改版', '會員系統優化', '年度報告'],
  專案Repo: ['AAA', 'BBBB', 'member-web'],
};

// 工時設定（Code.gs 存在「選項清單」分頁的「工時設定」欄），預設未設定
let workHours: WorkHoursSetting | null = null;

// 樣式設定（Code.gs 存在「選項清單」分頁的「樣式設定」欄），預設未設定；可用的值同 Code.gs 的 THEME_MODE_VALUES
let themeMode: ThemeMode | null = null;

// 自動填入設定（AutoFill.gs 存在「選項清單」分頁的「自動填入設定」欄），預設停用。
// MSW 沒有對方的試算表：「填入」寫進 autoFilledCells（日期 → 內容），用來模擬已經填過、格子已經有內容的情況
let autoFill: AutoFillSetting = { enabled: false, url: '', name: '' };
const autoFilledCells = new Map<string, string>();

// 請假列的固定欄位一律由後端覆蓋（跟 Code.gs 的 applyLeaveFixedValues_ 同一套規則）
const applyLeaveFixedValues = <T extends Partial<WorkItem>>(item: T): T =>
  isLeaveItem(item as WorkItem)
    ? { ...item, ...schema.leave.fixed, 專案Repo: [...schema.leave.fixed.專案Repo] }
    : item;

// 請假的固定值（人事室、--、休假）不寫回選項清單，避免出現在一般工作紀錄的下拉選單
const syncOptions = (item: WorkItem): void => {
  if (isLeaveItem(item)) return;
  addOptionIfNew('交辦單位', item.交辦單位);
  addOptionIfNew('交辦人員', item.交辦人員);
  addOptionIfNew('專案名稱', item.專案名稱);
  item.專案Repo.forEach((repo) => addOptionIfNew('專案Repo', repo));
};

const addOptionIfNew = (category: keyof WorkItemOptions, value: string): void => {
  if (!value) return;
  if (!options[category].includes(value)) {
    options = { ...options, [category]: [...options[category], value] };
  }
};

// 跟 Code.gs 的 OPTION_CATEGORIES 一致
const OPTION_CATEGORIES: readonly string[] = ['交辦單位', '交辦人員', '專案名稱', '專案Repo'];

interface CreatePayload {
  action: 'create';
  idToken: string;
  item: Omit<WorkItem, 'id' | '項次' | '已刪除'>;
}

interface BatchCreatePayload {
  action: 'batchCreate';
  idToken: string;
  items: Omit<WorkItem, 'id' | '項次' | '已刪除'>[];
  replace?: boolean;
}

interface ReorderPayload {
  action: 'reorder';
  idToken: string;
  date: string;
  ids: string[];
}

interface UpdatePayload {
  action: 'update';
  idToken: string;
  id: string;
  item: Partial<Omit<WorkItem, 'id'>>;
}

interface DeletePayload {
  action: 'delete';
  idToken: string;
  id: string;
}

interface AddOptionPayload {
  action: 'addOption';
  idToken: string;
  category: keyof WorkItemOptions;
  value: string;
}

interface RenameOptionPayload {
  action: 'renameOption';
  idToken: string;
  category: keyof WorkItemOptions;
  oldValue: string;
  newValue: string;
}

interface DeleteOptionPayload {
  action: 'deleteOption';
  idToken: string;
  category: keyof WorkItemOptions;
  value: string;
}

interface SaveThemeModePayload {
  action: 'saveThemeMode';
  idToken: string;
  themeMode: unknown;
}

interface SaveWorkHoursPayload {
  action: 'saveWorkHours';
  idToken: string;
  /** null 代表清除 */
  workHours: WorkHoursSetting | null;
}

interface GetAutoFillSettingPayload {
  action: 'getAutoFillSetting';
  idToken: string;
}

interface SaveAutoFillSettingPayload {
  action: 'saveAutoFillSetting';
  idToken: string;
  autoFill: unknown;
}

interface AutoFillNowPayload {
  action: 'autoFillNow';
  idToken: string;
  date: string;
  text: unknown;
}

type DoPostPayload =
  | CreatePayload
  | BatchCreatePayload
  | ReorderPayload
  | UpdatePayload
  | DeletePayload
  | AddOptionPayload
  | RenameOptionPayload
  | DeleteOptionPayload
  | SaveWorkHoursPayload
  | SaveThemeModePayload
  | GetAutoFillSettingPayload
  | SaveAutoFillSettingPayload
  | AutoFillNowPayload;

// 匯出 Excel（type=range）一次最多可讀的天數，跟 Code.gs 的 RANGE_MAX_DAYS 一致
const RANGE_MAX_DAYS = 366;

// YYYY/MM/DD 轉成 UTC 午夜的毫秒數，格式或日期本身不合法回 NaN（同 Code.gs 的 apiDateToUtc_）
const apiDateToUtc = (value: string | null): number => {
  if (!value || !/^\d{4}\/\d{2}\/\d{2}$/.test(value)) return NaN;
  const [year, month, day] = value.split('/').map(Number) as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return NaN;
  return time;
};

// 錯誤訊息跟 Code.gs 的 handleRange_ 一致
const validateRange = (from: string | null, to: string | null): string | undefined => {
  const fromTime = apiDateToUtc(from);
  const toTime = apiDateToUtc(to);
  if (Number.isNaN(fromTime) || Number.isNaN(toTime)) return 'from／to 日期格式不正確';
  if (fromTime > toTime) return '開始日期不能晚於結束日期';
  if (Math.round((toTime - fromTime) / 86400000) + 1 > RANGE_MAX_DAYS) {
    return `日期範圍不可超過 ${RANGE_MAX_DAYS} 天`;
  }
  return undefined;
};

export const handlers = [
  http.get('*/exec', ({ request }) => {
    const url = new URL(request.url);

    if (url.searchParams.get('type') === 'options') {
      // 跟 Code.gs 的 getRecentItems_ 一樣：近 RECENT_DAYS 天、未刪除、排除請假
      const cutoff = toDateString(addDays(new Date(), -RECENT_DAYS));
      const recentItems = filterRecentItems(
        items.filter((item) => !item.已刪除),
        cutoff,
      );
      return HttpResponse.json({ options, recentItems, workHours, themeMode });
    }

    if (url.searchParams.get('type') === 'range') {
      const rangeError = validateRange(url.searchParams.get('from'), url.searchParams.get('to'));
      if (rangeError) return HttpResponse.json({ error: rangeError });
      const from = url.searchParams.get('from') as string;
      const to = url.searchParams.get('to') as string;
      // YYYY/MM/DD 補零固定長度，字串可以直接比大小（同 Code.gs 的 handleRange_）
      const rangeItems = items.filter(
        (item) => item.工作日期 >= from && item.工作日期 <= to && !item.已刪除,
      );
      return HttpResponse.json({ items: rangeItems });
    }

    // 跟 Code.gs 的 handleSearch_ 同一套規則（比對規則共用 matchesSearch）
    if (url.searchParams.get('type') === 'search') {
      const keyword = (url.searchParams.get('q') ?? '').trim();
      const field = url.searchParams.get('field') || undefined;
      if (!keyword) return HttpResponse.json({ error: '請輸入搜尋關鍵字' });
      if (keyword.length > SEARCH_KEYWORD_MAX) {
        return HttpResponse.json({ error: `搜尋關鍵字不可超過 ${SEARCH_KEYWORD_MAX} 字` });
      }
      if (field && !(SEARCH_FIELDS as readonly string[]).includes(field)) {
        return HttpResponse.json({ error: '不支援的搜尋欄位' });
      }
      const matched = items
        .filter(
          (item) => !item.已刪除 && matchesSearch(item, { keyword, field: field as SearchField }),
        )
        .sort(compareSearchResults);
      return HttpResponse.json({
        items: matched.slice(0, SEARCH_MAX_RESULTS),
        total: matched.length,
      });
    }

    const date = url.searchParams.get('date') ?? today;
    const dayItems = items.filter((item) => item.工作日期 === date && !item.已刪除);
    return HttpResponse.json({ items: dayItems });
  }),

  http.post('*/exec', async ({ request }) => {
    const body = (await request.json()) as DoPostPayload;

    // Apps Script 網頁應用程式的回應一律是 HTTP 200，錯誤只能放在回應內容的
    // error 欄位裡，這裡刻意不用 { status: 401 } 之類的寫法，貼近真實行為。
    if (!body.idToken) {
      return HttpResponse.json({ error: '未登入或無權限', code: 'UNAUTHORIZED' });
    }

    if (body.action === 'create') {
      const hoursError = validateHours(body.item, body.item.工作日期);
      if (hoursError) return HttpResponse.json({ error: hoursError });
      const created: WorkItem = {
        ...applyLeaveFixedValues(body.item),
        id: crypto.randomUUID(),
        項次: getNextDailyIndex(body.item.工作日期),
        已刪除: false,
      };
      items = [...items, created];
      syncOptions(created);
      return HttpResponse.json({ item: created });
    }

    // 跟 Code.gs 的 handleBatchCreate_ 同一套規則：全部先檢查，任何一筆不合格或任何一天
    // 合計超過上限就整批退回、不寫入任何一筆
    if (body.action === 'batchCreate') {
      if (body.items.length === 0) return HttpResponse.json({ error: '沒有要新增的紀錄' });
      // 錯誤訊息格式同 Code.gs：「第 N 筆：訊息」，多筆用「；」串起來
      const itemErrors = body.items.flatMap((item, i) => {
        const leaveError = leaveHoursError(item);
        return leaveError ? [`第 ${i + 1} 筆：${leaveError}`] : [];
      });
      if (itemErrors.length > 0) return HttpResponse.json({ error: itemErrors.join('；') });
      const batchHours = new Map<string, number>();
      body.items.forEach((item) => {
        const hours = batchHours.get(item.工作日期) ?? 0;
        batchHours.set(item.工作日期, hours + (Number(item.今日工時) || 0));
      });
      // 覆蓋模式：工時合計只算這批，通過後先把這些日期原本的紀錄（含請假）搬到『已刪除紀錄』分頁（mock 沒有分頁，用已刪除標記模擬）
      for (const [date, hours] of batchHours) {
        const otherHours = body.replace ? 0 : getDayHoursExcluding(date);
        if (otherHours + hours > schema.dailyHours.max) {
          return HttpResponse.json({ error: dailyHoursMessage(otherHours, hours) });
        }
      }
      let replaced = 0;
      if (body.replace) {
        items = items.map((item) => {
          if (!batchHours.has(item.工作日期) || item.已刪除) return item;
          replaced += 1;
          return { ...item, 已刪除: true };
        });
      }
      const created = body.items.map((item) => {
        const createdItem: WorkItem = {
          ...applyLeaveFixedValues(item),
          id: crypto.randomUUID(),
          項次: getNextDailyIndex(item.工作日期),
          已刪除: false,
        };
        items = [...items, createdItem];
        syncOptions(createdItem);
        return createdItem;
      });
      return HttpResponse.json({ items: created, replaced });
    }

    // 跟 Code.gs 的 handleReorder_ 同一套規則：ids 必須跟那天未刪除的紀錄完全一致，
    // 通過後項次依順序改成 1、2、3…
    if (body.action === 'reorder') {
      if (!body.date || !/^\d{4}\/\d{2}\/\d{2}$/.test(body.date)) {
        return HttpResponse.json({ error: '工作日期格式不正確' });
      }
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        return HttpResponse.json({ error: '沒有要排序的紀錄' });
      }
      const dayIds = items.filter((i) => i.工作日期 === body.date && !i.已刪除).map((i) => i.id);
      const valid =
        body.ids.length === dayIds.length &&
        new Set(body.ids).size === body.ids.length &&
        body.ids.every((id) => dayIds.includes(id));
      if (!valid) return HttpResponse.json({ error: '紀錄已變更，請重新整理後再排序' });
      items = items.map((item) => {
        const index = body.ids.indexOf(item.id);
        return index === -1 || item.已刪除 ? item : { ...item, 項次: index + 1 };
      });
      return HttpResponse.json({ ok: true });
    }

    if (body.action === 'update') {
      // 跟 Code.gs 的 handleUpdate_ 一樣：找不到（含已刪除的）就回錯誤
      const existing = items.find((item) => item.id === body.id && !item.已刪除);
      if (!existing) return HttpResponse.json({ error: '找不到這筆紀錄' });
      const merged = applyLeaveFixedValues({ ...existing, ...body.item });
      const hoursError = validateHours(merged, merged.工作日期, existing.id);
      if (hoursError) return HttpResponse.json({ error: hoursError });
      let updated: WorkItem | undefined;
      items = items.map((item) => {
        if (item.id !== body.id) return item;
        // 項次一律由後端決定：工作日期沒改沿用原本的項次，改到別天就在新的那天重新編號
        const nextDate = body.item.工作日期 ?? item.工作日期;
        const 項次 = nextDate === item.工作日期 ? item.項次 : getNextDailyIndex(nextDate);
        updated = applyLeaveFixedValues({ ...item, ...body.item, 項次 });
        return updated;
      });
      if (updated) syncOptions(updated);
      return HttpResponse.json({ item: updated });
    }

    if (body.action === 'delete') {
      if (!items.some((item) => item.id === body.id && !item.已刪除)) {
        return HttpResponse.json({ error: '找不到這筆紀錄' });
      }
      items = items.map((item) => (item.id === body.id ? { ...item, 已刪除: true } : item));
      return HttpResponse.json({ ok: true });
    }

    if (body.action === 'addOption') {
      if (!OPTION_CATEGORIES.includes(body.category)) {
        return HttpResponse.json({ error: '未知的選項分類' });
      }
      const value = (body.value ?? '').trim();
      if (!value) return HttpResponse.json({ error: '新增的值不可為空' });
      const invalid = validateOptionValue(body.category, value);
      if (invalid) return HttpResponse.json({ error: invalid });
      addOptionIfNew(body.category, value);
      return HttpResponse.json({ options });
    }

    if (body.action === 'renameOption') {
      if (!OPTION_CATEGORIES.includes(body.category)) {
        return HttpResponse.json({ error: '未知的選項分類' });
      }
      const newValue = (body.newValue ?? '').trim();
      if (!newValue) return HttpResponse.json({ error: '新名稱不可為空' });
      const invalidName = validateOptionValue(body.category, newValue);
      if (invalidName) return HttpResponse.json({ error: invalidName });
      if (!options[body.category].includes(body.oldValue)) {
        return HttpResponse.json({ error: '找不到這個值' });
      }
      if (options[body.category].includes(newValue)) {
        return HttpResponse.json({ error: '這個名稱已經存在' });
      }
      options = {
        ...options,
        [body.category]: options[body.category].map((v) => (v === body.oldValue ? newValue : v)),
      };
      return HttpResponse.json({ options });
    }

    if (body.action === 'deleteOption') {
      if (!OPTION_CATEGORIES.includes(body.category)) {
        return HttpResponse.json({ error: '未知的選項分類' });
      }
      if (!options[body.category].includes(body.value)) {
        return HttpResponse.json({ error: '找不到這個值' });
      }
      options = {
        ...options,
        [body.category]: options[body.category].filter((v) => v !== body.value),
      };
      return HttpResponse.json({ options });
    }

    // 跟 Code.gs 的 handleSaveThemeMode_ 同一套規則：只接受 auto／light／dark，回應帶回存好的值
    if (body.action === 'saveThemeMode') {
      if (!THEME_MODES.some(({ mode }) => mode === body.themeMode)) {
        return HttpResponse.json({ error: '樣式設定只能是 auto、light 或 dark' });
      }
      themeMode = body.themeMode as ThemeMode;
      return HttpResponse.json({ themeMode });
    }

    // 自動填入（AutoFill.gs）：設定只能登入後讀（不放進 doGet）；驗證規則同 validateAutoFill_，
    // 啟用時真後端會先開對方的試算表找姓名，MSW 沒有對方的試算表，略過這一步
    if (body.action === 'getAutoFillSetting') return HttpResponse.json({ autoFill });

    if (body.action === 'saveAutoFillSetting') {
      const value = body.autoFill as Partial<AutoFillSetting> | null;
      if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') {
        return HttpResponse.json({ error: '自動填入設定格式不正確' });
      }
      const next: AutoFillSetting = {
        enabled: value.enabled,
        url: String(value.url ?? '').trim(),
        name: String(value.name ?? '').trim(),
      };
      const autoFillError = validateAutoFillSetting(next);
      if (autoFillError) return HttpResponse.json({ error: autoFillError });
      autoFill = next;
      return HttpResponse.json({ autoFill });
    }

    // 同 AutoFill.gs 的 handleAutoFillNow_：格子是空的才寫、一樣的內容不動、不同的內容不覆蓋
    if (body.action === 'autoFillNow') {
      if (Number.isNaN(apiDateToUtc(body.date))) {
        return HttpResponse.json({ error: '日期格式不正確' });
      }
      const text = String(body.text ?? '').trim();
      if (!text) return HttpResponse.json({ error: '沒有可以填入的內容' });
      if (text.length > AUTO_FILL_TEXT_MAX) {
        return HttpResponse.json({ error: `填入內容不可超過 ${AUTO_FILL_TEXT_MAX} 個字` });
      }
      if (!autoFill.enabled) return HttpResponse.json({ error: '自動填入沒有啟用' });
      const existing = autoFilledCells.get(body.date);
      if (existing === text) return HttpResponse.json({ status: 'unchanged' });
      if (existing !== undefined) {
        return HttpResponse.json({
          error: '對方試算表的格子已經有內容，為了不覆蓋別人的紀錄，這次沒有寫入',
        });
      }
      autoFilledCells.set(body.date, text);
      return HttpResponse.json({ status: 'written' });
    }

    // 跟 Code.gs 的 handleSaveWorkHours_ 同一套規則：驗證通過才存，回應帶回最新的工時設定
    if (body.action === 'saveWorkHours') {
      if (body.workHours) {
        const workHoursError = validateWorkHoursSetting(body.workHours);
        if (workHoursError) return HttpResponse.json({ error: workHoursError });
      }
      workHours = body.workHours
        ? {
            start: body.workHours.start,
            end: body.workHours.end,
            ...(body.workHours.breakStart && {
              breakStart: body.workHours.breakStart,
              breakEnd: body.workHours.breakEnd,
            }),
          }
        : null;
      return HttpResponse.json({ workHours });
    }

    return HttpResponse.json({ error: '未知的 action' });
  }),
];
