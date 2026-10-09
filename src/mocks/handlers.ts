import { http, HttpResponse } from 'msw';

import schema from '../../shared/validation-schema.json';

import { isLeaveItem, type WorkItem, type WorkItemOptions } from '@/types/work-item';
import { filterRecentItems, RECENT_DAYS } from '@/utils/recent-history';
import { dailyHoursMessage } from '@/validation/work-item';

// 貼近真實 Apps Script／Google Sheet 的日期字串格式（YYYY/MM/DD，見 useWorkItems.ts）
const toDateString = (d: Date): string => d.toISOString().slice(0, 10).replaceAll('-', '/');

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

// 只模擬工時相關的後端檢查：請假時數上限、每日工時合計上限
const validateHours = (
  item: Partial<WorkItem>,
  date: string,
  excludeId?: string,
): string | undefined => {
  const hours = Number(item.今日工時) || 0;
  if (isLeaveItem(item as WorkItem) && hours > schema.leave.fields.今日工時.max) {
    return `請假時數不可超過 ${schema.leave.fields.今日工時.max} 小時`;
  }
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
  originalDate: string;
  item: Partial<Omit<WorkItem, 'id'>>;
}

interface DeletePayload {
  action: 'delete';
  idToken: string;
  id: string;
  originalDate: string;
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

type DoPostPayload =
  | CreatePayload
  | BatchCreatePayload
  | ReorderPayload
  | UpdatePayload
  | DeletePayload
  | AddOptionPayload
  | RenameOptionPayload
  | DeleteOptionPayload;

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
      return HttpResponse.json({ options, recentItems });
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
      const leaveMax = schema.leave.fields.今日工時.max;
      const invalidIndex = body.items.findIndex(
        (item) => isLeaveItem(item as WorkItem) && Number(item.今日工時) > leaveMax,
      );
      if (invalidIndex !== -1) {
        return HttpResponse.json({
          error: `第 ${invalidIndex + 1} 筆：請假時數不可超過 ${leaveMax} 小時`,
        });
      }
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
      const existing = items.find((item) => item.id === body.id);
      if (existing) {
        const merged = { ...existing, ...body.item };
        const hoursError = validateHours(merged, merged.工作日期, existing.id);
        if (hoursError) return HttpResponse.json({ error: hoursError });
      }
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
      items = items.map((item) => (item.id === body.id ? { ...item, 已刪除: true } : item));
      return HttpResponse.json({ ok: true });
    }

    if (body.action === 'addOption') {
      const value = body.value.trim();
      if (!value) return HttpResponse.json({ error: '新增的值不可為空' });
      addOptionIfNew(body.category, value);
      return HttpResponse.json({ options });
    }

    if (body.action === 'renameOption') {
      const newValue = body.newValue.trim();
      if (!newValue) return HttpResponse.json({ error: '新名稱不可為空' });
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
      if (!options[body.category].includes(body.value)) {
        return HttpResponse.json({ error: '找不到這個值' });
      }
      options = {
        ...options,
        [body.category]: options[body.category].filter((v) => v !== body.value),
      };
      return HttpResponse.json({ options });
    }

    return HttpResponse.json({ error: 'unknown action' });
  }),
];
