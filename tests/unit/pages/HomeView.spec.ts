// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { NDropdown } from 'naive-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { makeItem } from '@/testing/fixtures';
import type { WorkItem } from '@/types/work-item';
import { todayString } from '@/utils/date';

import HomeView from '@/pages/HomeView.vue';

/**
 * HomeView 的流程測試：存檔、刪除、複製本日、項次調整失敗時怎麼處理（登入錯誤關閉畫面並登出，
 * 其他錯誤保留畫面讓使用者重試），以及複製本日的工時檢查與覆蓋確認。
 * API、登入、Toast 都換成假的；子元件換成空殼，用 $emit 模擬使用者在子元件裡的操作
 */
const mocks = vi.hoisted(() => ({
  idToken: null as unknown as Ref<string | null>,
  items: null as unknown as Ref<WorkItem[]>,
  loading: null as unknown as Ref<boolean>,
  error: null as unknown as Ref<string | null>,
  signOut: vi.fn(),
  clearLogin: vi.fn(),
  tryAutoLogin: vi.fn(),
  ensureFreshLogin: vi.fn(),
  showToast: vi.fn(),
  rememberItems: vi.fn(),
  fetchByDate: vi.fn(),
  fetchRange: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  batchCreateItems: vi.fn(),
  reorderItems: vi.fn(),
  fetchDaySummary: vi.fn(),
  searchItems: vi.fn(),
}));

vi.mock('@/composables/useGoogleAuth', async () => {
  const { ref: vueRef, computed } = await import('vue');
  mocks.idToken = vueRef<string | null>('token');
  return {
    useGoogleAuth: () => ({
      idToken: mocks.idToken,
      userEmail: vueRef('swzx00@gmail.com'),
      isLoggedIn: computed(() => true),
      isAuthorized: computed(() => true),
      renderSignInButton: vi.fn(),
      signOut: mocks.signOut,
      clearLogin: mocks.clearLogin,
      tryAutoLogin: mocks.tryAutoLogin,
      ensureFreshLogin: mocks.ensureFreshLogin,
      // 續期重送的邏輯在 useGoogleAuth 測，這裡直接用目前的 token 呼叫一次
      withLoginRetry: <T>(token: string, run: (token: string) => Promise<T>) => run(token),
    }),
  };
});

vi.mock('@/composables/useWorkItems', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/useWorkItems')>();
  const { ref: vueRef } = await import('vue');
  mocks.items = vueRef<WorkItem[]>([]);
  mocks.loading = vueRef(false);
  mocks.error = vueRef<string | null>(null);
  return {
    ApiError: actual.ApiError,
    fetchDaySummary: mocks.fetchDaySummary,
    searchItems: mocks.searchItems,
    useWorkItems: () => ({
      items: mocks.items,
      loading: mocks.loading,
      error: mocks.error,
      fetchByDate: mocks.fetchByDate,
      fetchRange: mocks.fetchRange,
      createItem: mocks.createItem,
      batchCreateItems: mocks.batchCreateItems,
      updateItem: mocks.updateItem,
      deleteItem: mocks.deleteItem,
      reorderItems: mocks.reorderItems,
    }),
  };
});

vi.mock('@/composables/useOptions', () => ({
  useOptions: () => ({ rememberItems: mocks.rememberItems }),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock('@/composables/useTaiwanHolidays', () => ({
  useTaiwanHolidays: () => ({ getDayOffLabel: () => null }),
}));

vi.mock('@/composables/useTheme', async () => {
  const { ref: vueRef } = await import('vue');
  return {
    THEME_MODES: [],
    useTheme: () => ({ mode: vueRef('auto'), isDark: vueRef(false), setMode: vi.fn() }),
  };
});

const { ApiError } = await import('@/composables/useWorkItems');

const unauthorized = () => new ApiError('登入已過期，請重新登入', 'UNAUTHORIZED');

// DateNav 只保留 slot，動作按鈕（複製本日、請假、新增）才點得到
const DateNavStub = {
  name: 'DateNav',
  props: ['modelValue', 'viewMode'],
  emits: ['update:modelValue', 'update:viewMode'],
  template: '<div><slot name="search" /><slot name="actions" /></div>',
};

const stubNames = [
  'NDropdown',
  'AppToast',
  'AppLoading',
  'WorkItemTable',
  'WorkItemForm',
  'WorkItemSearch',
  'CopyDayDialog',
  'ConfirmDialog',
  'OptionsManagerModal',
  'WorkHoursSettingModal',
  'DaySummaryModal',
  'ExportModal',
];

let router: Router;

/** path 是打開頁面時的網址（例如 /?date=2026-09-01），用來測 ?date= 開到指定日期 */
const mountView = async (path = '/'): Promise<VueWrapper> => {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { render: () => null } }],
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(HomeView, {
    global: {
      plugins: [router],
      stubs: {
        ...Object.fromEntries(stubNames.map((name) => [name, true])),
        DateNav: DateNavStub,
      },
    },
  });
  await flushPromises();
  return wrapper;
};

/** 找到空殼子元件，模擬它發出事件 */
const emitFrom = async (
  wrapper: VueWrapper,
  name: string,
  event: string,
  ...args: unknown[]
): Promise<void> => {
  wrapper.findComponent({ name }).vm.$emit(event, ...args);
  await flushPromises();
};

const exists = (wrapper: VueWrapper, name: string): boolean =>
  wrapper.findComponent({ name }).exists();

const today = todayString();
const dayItems = (): WorkItem[] => [
  makeItem({ id: 'a', 項次: 1, 工作日期: today, 今日工時: 3 }),
  makeItem({ id: 'b', 項次: 2, 工作日期: today, 今日工時: 5 }),
];

const savePayload = () => {
  const item: Partial<WorkItem> = makeItem({ 工作日期: today });
  delete item.id;
  delete item.項次;
  delete item.已刪除;
  return item;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.idToken.value = 'token';
  mocks.items.value = dayItems();
  mocks.loading.value = false;
  mocks.error.value = null;
  mocks.fetchByDate.mockResolvedValue(undefined);
  mocks.fetchRange.mockResolvedValue(undefined);
  mocks.ensureFreshLogin.mockResolvedValue(true);
  mocks.tryAutoLogin.mockResolvedValue(false);
});

describe('讀取', () => {
  it('打開時讀今天的紀錄，網址不加 date', async () => {
    await mountView();
    expect(mocks.fetchByDate).toHaveBeenCalledWith(today);
    expect(router.currentRoute.value.query).toEqual({});
  });
});

describe('網址的 ?date=', () => {
  it('格式正確：開到那天', async () => {
    const wrapper = await mountView('/?date=2026-09-01');
    expect(mocks.fetchByDate).toHaveBeenCalledWith('2026-09-01');
    expect(mocks.fetchByDate).not.toHaveBeenCalledWith(today);
    expect(wrapper.findComponent({ name: 'DateNav' }).props('modelValue')).toBe('2026-09-01');
  });

  it.each(['2026/09/01', '2026-9-1', '2026-02-30', 'abc', ''])(
    '不正確（%s）：退回今天，把 date 從網址拿掉、保留其他參數',
    async (date) => {
      await mountView(`/?date=${encodeURIComponent(date)}&foo=1`);
      expect(mocks.fetchByDate).toHaveBeenCalledWith(today);
      expect(router.currentRoute.value.query).toEqual({ foo: '1' });
    },
  );

  it('重複帶 date（陣列）也當成不正確', async () => {
    await mountView('/?date=2026-09-01&date=2026-09-02');
    expect(mocks.fetchByDate).toHaveBeenCalledWith(today);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it('切換日期：用 replace 更新網址，不新增瀏覽紀錄', async () => {
    const wrapper = await mountView();
    const push = vi.spyOn(router, 'push');
    const replace = vi.spyOn(router, 'replace');
    await emitFrom(wrapper, 'DateNav', 'update:modelValue', '2026-09-02');
    expect(router.currentRoute.value.query).toEqual({ date: '2026-09-02' });
    expect(replace).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(mocks.fetchByDate).toHaveBeenLastCalledWith('2026-09-02');
  });

  it('網址的 date 被改掉時跟著切過去', async () => {
    await mountView('/?date=2026-09-01');
    await router.replace({ query: { date: '2026-09-03' } });
    await flushPromises();
    expect(mocks.fetchByDate).toHaveBeenLastCalledWith('2026-09-03');
  });
});

describe('月份檢視', () => {
  it('切到月份檢視：讀那個月的紀錄，網址加 view=month，表格用 month-mode', async () => {
    const wrapper = await mountView('/?date=2026-09-15');
    await emitFrom(wrapper, 'DateNav', 'update:viewMode', 'month');
    expect(mocks.fetchRange).toHaveBeenCalledWith('2026-09-01', '2026-09-30');
    expect(router.currentRoute.value.query).toEqual({ date: '2026-09-15', view: 'month' });
    expect(wrapper.findComponent({ name: 'WorkItemTable' }).props('monthMode')).toBe(true);
  });

  it('網址帶 view=month：直接開月份檢視；同一個月內換日期不重讀，換月份才重讀', async () => {
    const wrapper = await mountView('/?date=2026-09-15&view=month');
    expect(mocks.fetchByDate).not.toHaveBeenCalled();
    expect(mocks.fetchRange).toHaveBeenCalledTimes(1);
    await emitFrom(wrapper, 'DateNav', 'update:modelValue', '2026-09-20');
    expect(mocks.fetchRange).toHaveBeenCalledTimes(1);
    await emitFrom(wrapper, 'DateNav', 'update:modelValue', '2026-10-20');
    expect(mocks.fetchRange).toHaveBeenLastCalledWith('2026-10-01', '2026-10-31');
  });

  it('view 不是 month：當成單日檢視，從網址拿掉', async () => {
    await mountView('/?view=week');
    expect(mocks.fetchByDate).toHaveBeenCalledWith(today);
    expect(router.currentRoute.value.query).toEqual({});
  });

  it('點日期：切回那天的單日檢視', async () => {
    const wrapper = await mountView('/?date=2026-09-15&view=month');
    await emitFrom(wrapper, 'WorkItemTable', 'goToDate', '2026-09-03');
    expect(mocks.fetchByDate).toHaveBeenLastCalledWith('2026-09-03');
    expect(router.currentRoute.value.query).toEqual({ date: '2026-09-03' });
  });

  it('調整順序：只換掉那一天的紀錄，用表格帶的日期存檔', async () => {
    const other = makeItem({ id: 'x', 項次: 1, 工作日期: '2026-09-01' });
    mocks.items.value = [other, ...dayItems().map((item) => ({ ...item, 工作日期: '2026-09-15' }))];
    mocks.reorderItems.mockResolvedValue(undefined);
    const wrapper = await mountView('/?date=2026-09-20&view=month');
    await emitFrom(wrapper, 'WorkItemTable', 'reorder', ['b', 'a'], '2026-09-15');
    expect(mocks.reorderItems).toHaveBeenCalledWith('token', '2026-09-15', ['b', 'a']);
    expect(mocks.items.value.map((item) => [item.id, item.項次])).toEqual([
      ['x', 1],
      ['b', 1],
      ['a', 2],
    ]);
  });

  it('存檔後重讀整個月；不顯示「複製本日」', async () => {
    const wrapper = await mountView('/?date=2026-09-15&view=month');
    expect(wrapper.find('button[aria-label="複製本日"]').exists()).toBe(false);
    mocks.createItem.mockResolvedValue(undefined);
    await wrapper.get('button[aria-label="新增"]').trigger('click');
    await emitFrom(wrapper, 'WorkItemForm', 'save', savePayload());
    expect(mocks.fetchRange).toHaveBeenCalledTimes(2);
    expect(mocks.fetchRange).toHaveBeenLastCalledWith('2026-09-01', '2026-09-30');
  });
});

describe('存檔（新增／編輯）', () => {
  const openCreate = async (wrapper: VueWrapper): Promise<void> => {
    await wrapper.get('button[aria-label="新增"]').trigger('click');
  };

  it('新增成功：送出、記住近期紀錄、重讀當天、關閉表單', async () => {
    mocks.createItem.mockResolvedValue(undefined);
    const wrapper = await mountView();
    await openCreate(wrapper);
    expect(exists(wrapper, 'WorkItemForm')).toBe(true);

    mocks.fetchByDate.mockClear();
    const payload = savePayload();
    await emitFrom(wrapper, 'WorkItemForm', 'save', payload);

    expect(mocks.createItem).toHaveBeenCalledWith('token', payload);
    expect(mocks.rememberItems).toHaveBeenCalledWith([{ ...payload, id: undefined }]);
    expect(mocks.fetchByDate).toHaveBeenCalledWith(today);
    expect(exists(wrapper, 'WorkItemForm')).toBe(false);
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('編輯成功：用紀錄的 id 更新，近期紀錄帶 id', async () => {
    mocks.updateItem.mockResolvedValue(undefined);
    const wrapper = await mountView();
    await emitFrom(wrapper, 'WorkItemTable', 'edit', mocks.items.value[1]);
    const payload = savePayload();
    await emitFrom(wrapper, 'WorkItemForm', 'save', payload);

    expect(mocks.updateItem).toHaveBeenCalledWith('token', 'b', payload);
    expect(mocks.createItem).not.toHaveBeenCalled();
    expect(mocks.rememberItems).toHaveBeenCalledWith([{ ...payload, id: 'b' }]);
  });

  it('登入錯誤：Toast、關閉表單、登出', async () => {
    mocks.createItem.mockRejectedValue(unauthorized());
    const wrapper = await mountView();
    await openCreate(wrapper);
    await emitFrom(wrapper, 'WorkItemForm', 'save', savePayload());

    expect(mocks.showToast).toHaveBeenCalledWith('登入已過期，請重新登入');
    expect(mocks.clearLogin).toHaveBeenCalled();
    expect(exists(wrapper, 'WorkItemForm')).toBe(false);
  });

  it('其他錯誤：Toast，表單維持開啟、不登出、不記住近期紀錄', async () => {
    mocks.createItem.mockRejectedValue(new ApiError('工作目標為必填'));
    const wrapper = await mountView();
    await openCreate(wrapper);
    await emitFrom(wrapper, 'WorkItemForm', 'save', savePayload());

    expect(mocks.showToast).toHaveBeenCalledWith('工作目標為必填');
    expect(mocks.clearLogin).not.toHaveBeenCalled();
    expect(exists(wrapper, 'WorkItemForm')).toBe(true);
    expect(mocks.rememberItems).not.toHaveBeenCalled();
  });

  it('網路錯誤（不是 ApiError）也是保留表單', async () => {
    mocks.createItem.mockRejectedValue(new TypeError('Failed to fetch'));
    const wrapper = await mountView();
    await openCreate(wrapper);
    await emitFrom(wrapper, 'WorkItemForm', 'save', savePayload());

    expect(mocks.clearLogin).not.toHaveBeenCalled();
    expect(exists(wrapper, 'WorkItemForm')).toBe(true);
  });

  it('送出中表單收到 saving，結束後變回 false', async () => {
    let resolve!: () => void;
    mocks.createItem.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const wrapper = await mountView();
    await openCreate(wrapper);
    wrapper.findComponent({ name: 'WorkItemForm' }).vm.$emit('save', savePayload());
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'WorkItemForm' }).props('saving')).toBe(true);
    resolve();
    await flushPromises();
    expect(exists(wrapper, 'WorkItemForm')).toBe(false);
  });

  it('登入已過期：不打開表單，提示重新登入', async () => {
    mocks.ensureFreshLogin.mockResolvedValue(false);
    const wrapper = await mountView();
    await openCreate(wrapper);
    await emitFrom(wrapper, 'WorkItemTable', 'edit', mocks.items.value[0]);

    expect(exists(wrapper, 'WorkItemForm')).toBe(false);
    expect(mocks.showToast).toHaveBeenCalledWith('登入已過期，請重新登入');
  });

  it('沒有 token：不送出，直接登出', async () => {
    const wrapper = await mountView();
    await openCreate(wrapper);
    mocks.idToken.value = null;
    await emitFrom(wrapper, 'WorkItemForm', 'save', savePayload());

    expect(mocks.createItem).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith('尚未登入，無法儲存');
    expect(mocks.clearLogin).toHaveBeenCalled();
  });
});

describe('刪除', () => {
  const openDelete = async (wrapper: VueWrapper): Promise<void> => {
    await emitFrom(wrapper, 'WorkItemTable', 'delete', mocks.items.value[0]);
    expect(exists(wrapper, 'ConfirmDialog')).toBe(true);
  };

  it('成功：送出 id、關閉確認對話框、重讀', async () => {
    mocks.deleteItem.mockResolvedValue(undefined);
    const wrapper = await mountView();
    await openDelete(wrapper);
    mocks.fetchByDate.mockClear();
    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');

    expect(mocks.deleteItem).toHaveBeenCalledWith('token', 'a');
    expect(exists(wrapper, 'ConfirmDialog')).toBe(false);
    expect(mocks.fetchByDate).toHaveBeenCalled();
  });

  it('登入錯誤：關閉確認對話框並登出', async () => {
    mocks.deleteItem.mockRejectedValue(unauthorized());
    const wrapper = await mountView();
    await openDelete(wrapper);
    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');

    expect(mocks.showToast).toHaveBeenCalledWith('登入已過期，請重新登入');
    expect(mocks.clearLogin).toHaveBeenCalled();
    expect(exists(wrapper, 'ConfirmDialog')).toBe(false);
  });

  it('其他錯誤：Toast，確認對話框維持開啟可以重試', async () => {
    mocks.deleteItem.mockRejectedValueOnce(new ApiError('找不到這筆紀錄'));
    const wrapper = await mountView();
    await openDelete(wrapper);
    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');

    expect(mocks.showToast).toHaveBeenCalledWith('找不到這筆紀錄');
    expect(mocks.clearLogin).not.toHaveBeenCalled();
    expect(exists(wrapper, 'ConfirmDialog')).toBe(true);

    mocks.deleteItem.mockResolvedValueOnce(undefined);
    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');
    expect(mocks.deleteItem).toHaveBeenCalledTimes(2);
    expect(exists(wrapper, 'ConfirmDialog')).toBe(false);
  });

  it('沒有 token：不送出，關閉並登出', async () => {
    const wrapper = await mountView();
    await openDelete(wrapper);
    mocks.idToken.value = null;
    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');

    expect(mocks.deleteItem).not.toHaveBeenCalled();
    expect(mocks.clearLogin).toHaveBeenCalled();
    expect(exists(wrapper, 'ConfirmDialog')).toBe(false);
  });
});

describe('項次調整', () => {
  it('先在畫面套用新順序（項次改成 1、2…），再送出', async () => {
    let resolve!: () => void;
    mocks.reorderItems.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const wrapper = await mountView();
    wrapper.findComponent({ name: 'WorkItemTable' }).vm.$emit('reorder', ['b', 'a']);
    await wrapper.vm.$nextTick();

    // 畫面馬上套用新順序（不等登入檢查）
    expect(mocks.items.value.map((item) => [item.id, item.項次])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
    // 確認登入還有效（ensureFreshLogin）之後才送出
    await flushPromises();
    expect(mocks.reorderItems).toHaveBeenCalledWith('token', today, ['b', 'a']);
    expect(wrapper.findComponent({ name: 'WorkItemTable' }).props('reordering')).toBe(true);
    resolve();
    await flushPromises();
    expect(wrapper.findComponent({ name: 'WorkItemTable' }).props('reordering')).toBe(false);
  });

  it('失敗：還原成移動前的順序，Toast，不登出', async () => {
    mocks.reorderItems.mockRejectedValue(new ApiError('紀錄已變更，請重新整理後再排序'));
    const wrapper = await mountView();
    const before = mocks.items.value;
    await emitFrom(wrapper, 'WorkItemTable', 'reorder', ['b', 'a']);

    expect(mocks.items.value).toBe(before);
    expect(mocks.showToast).toHaveBeenCalledWith('紀錄已變更，請重新整理後再排序');
    expect(mocks.clearLogin).not.toHaveBeenCalled();
  });

  it('失敗前已經切到別天：不動目前畫面', async () => {
    let reject!: (e: unknown) => void;
    mocks.reorderItems.mockReturnValue(new Promise<void>((_, r) => (reject = r)));
    const wrapper = await mountView();
    wrapper.findComponent({ name: 'WorkItemTable' }).vm.$emit('reorder', ['b', 'a']);
    await wrapper.vm.$nextTick();

    const otherDay = [makeItem({ id: 'c', 項次: 1, 工作日期: '2030-01-02' })];
    await emitFrom(wrapper, 'DateNav', 'update:modelValue', '2030-01-02');
    mocks.items.value = otherDay;
    reject(new ApiError('紀錄已變更，請重新整理後再排序'));
    await flushPromises();

    expect(mocks.items.value).toEqual(otherDay);
    expect(mocks.showToast).toHaveBeenCalledWith('紀錄已變更，請重新整理後再排序');
  });

  it('失敗前切走又切回同一天：不用快照蓋掉重新讀到的資料', async () => {
    let reject!: (e: unknown) => void;
    mocks.reorderItems.mockReturnValue(new Promise<void>((_, r) => (reject = r)));
    const wrapper = await mountView();
    wrapper.findComponent({ name: 'WorkItemTable' }).vm.$emit('reorder', ['b', 'a']);
    await wrapper.vm.$nextTick();

    await emitFrom(wrapper, 'DateNav', 'update:modelValue', '2030-01-02');
    await emitFrom(wrapper, 'DateNav', 'update:modelValue', today);
    const refetched = [makeItem({ id: 'b', 項次: 1, 工作日期: today })];
    mocks.items.value = refetched;
    reject(new ApiError('紀錄已變更，請重新整理後再排序'));
    await flushPromises();

    expect(mocks.items.value).toEqual(refetched);
  });

  it('登入錯誤：還原並登出', async () => {
    mocks.reorderItems.mockRejectedValue(unauthorized());
    const wrapper = await mountView();
    const before = mocks.items.value;
    await emitFrom(wrapper, 'WorkItemTable', 'reorder', ['b', 'a']);

    expect(mocks.items.value).toBe(before);
    expect(mocks.clearLogin).toHaveBeenCalled();
  });

  it('登入已過期：不送出，重新指定原本的順序讓表格同步回來，提示重新登入', async () => {
    mocks.ensureFreshLogin.mockResolvedValue(false);
    const wrapper = await mountView();
    const before = mocks.items.value;
    await emitFrom(wrapper, 'WorkItemTable', 'reorder', ['b', 'a']);

    expect(mocks.reorderItems).not.toHaveBeenCalled();
    expect(mocks.items.value).not.toBe(before);
    expect(mocks.items.value).toEqual(before);
    expect(mocks.showToast).toHaveBeenCalledWith('登入已過期，請重新登入');
  });

  it('沒有 token：不送出、不改順序，直接登出', async () => {
    const wrapper = await mountView();
    const before = mocks.items.value;
    mocks.idToken.value = null;
    await emitFrom(wrapper, 'WorkItemTable', 'reorder', ['b', 'a']);

    expect(mocks.reorderItems).not.toHaveBeenCalled();
    expect(mocks.items.value).toBe(before);
    expect(mocks.clearLogin).toHaveBeenCalled();
  });
});

describe('複製本日', () => {
  const TARGET = '2099-12-31';

  const openCopyDay = async (wrapper: VueWrapper): Promise<void> => {
    await wrapper.get('button[aria-label="複製本日"]').trigger('click');
    expect(exists(wrapper, 'CopyDayDialog')).toBe(true);
  };

  const copyDayError = (wrapper: VueWrapper): unknown =>
    wrapper.findComponent({ name: 'CopyDayDialog' }).props('error');

  it('當天沒有紀錄時不顯示「複製本日」', async () => {
    mocks.items.value = [];
    const wrapper = await mountView();
    expect(wrapper.find('button[aria-label="複製本日"]').exists()).toBe(false);
  });

  it('目標日期跟來源同一天：顯示錯誤，不查詢', async () => {
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', today);

    expect(copyDayError(wrapper)).toBe('目標日期不能跟來源同一天');
    expect(mocks.fetchDaySummary).not.toHaveBeenCalled();
  });

  it('目標日沒有紀錄：依項次順序直接複製（不覆蓋），切到目標日並顯示成功 Toast', async () => {
    mocks.items.value = [...dayItems()].reverse();
    mocks.fetchDaySummary.mockResolvedValue({ otherHours: 0, itemCount: 0 });
    mocks.batchCreateItems.mockResolvedValue(undefined);
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    mocks.fetchByDate.mockClear();
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);

    const [token, payloads, replace] = mocks.batchCreateItems.mock.calls[0]!;
    expect(token).toBe('token');
    expect(replace).toBe(false);
    expect((payloads as WorkItem[]).map((item) => [item.工作日期, item.今日工時])).toEqual([
      [TARGET, 0],
      [TARGET, 0],
    ]);
    expect(mocks.rememberItems).toHaveBeenCalledWith(payloads);
    expect(exists(wrapper, 'CopyDayDialog')).toBe(false);
    expect(mocks.fetchByDate).toHaveBeenCalledWith(TARGET);
    expect(mocks.showToast).toHaveBeenCalledWith('已複製 2 筆紀錄到 2099/12/31', 'success');
  });

  it('目標日沒有紀錄：既有工時＋這批超過 24 小時就擋下、不送出', async () => {
    // 今日工時是「當天」的內容，複製時重設成 0；請假時數會帶過去
    mocks.items.value = [
      makeItem({ id: 'l', 項次: 1, 工作日期: today, 今日工時: 8, 狀態: '休假' }),
    ];
    mocks.fetchDaySummary.mockResolvedValue({ otherHours: 17, itemCount: 0 });
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);

    expect(copyDayError(wrapper)).toContain('當天工時合計不可超過 24 小時');
    expect(copyDayError(wrapper)).toContain('其他紀錄已 17 小時');
    expect(mocks.batchCreateItems).not.toHaveBeenCalled();
  });

  it('剛好 24 小時可以複製', async () => {
    mocks.items.value = [
      makeItem({ id: 'l', 項次: 1, 工作日期: today, 今日工時: 8, 狀態: '休假' }),
    ];
    mocks.fetchDaySummary.mockResolvedValue({ otherHours: 16, itemCount: 0 });
    mocks.batchCreateItems.mockResolvedValue(undefined);
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);

    expect(mocks.batchCreateItems).toHaveBeenCalled();
  });

  it('目標日已有紀錄：工時只算這批，先跳覆蓋確認，確認後用 replace 送出', async () => {
    mocks.items.value = [
      makeItem({ id: 'l', 項次: 1, 工作日期: today, 今日工時: 8, 狀態: '休假' }),
    ];
    // 既有 20 小時加這批 8 小時會超過，但覆蓋時既有的會被刪掉，所以不擋
    mocks.fetchDaySummary.mockResolvedValue({ otherHours: 20, itemCount: 3 });
    mocks.batchCreateItems.mockResolvedValue(undefined);
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);

    expect(mocks.batchCreateItems).not.toHaveBeenCalled();
    const confirm = wrapper.findComponent({ name: 'ConfirmDialog' });
    expect(confirm.props('title')).toBe('目標日已有紀錄');
    expect(confirm.props('message')).toContain('已經有 3 筆紀錄');

    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');
    expect(mocks.batchCreateItems.mock.calls[0]![2]).toBe(true);
    expect(exists(wrapper, 'ConfirmDialog')).toBe(false);
    expect(exists(wrapper, 'CopyDayDialog')).toBe(false);
  });

  it('覆蓋確認按取消：回到選日期的對話框，不送出', async () => {
    mocks.fetchDaySummary.mockResolvedValue({ otherHours: 0, itemCount: 1 });
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);
    await emitFrom(wrapper, 'ConfirmDialog', 'cancel');

    expect(exists(wrapper, 'ConfirmDialog')).toBe(false);
    expect(exists(wrapper, 'CopyDayDialog')).toBe(true);
    expect(mocks.batchCreateItems).not.toHaveBeenCalled();
  });

  it('查不到目標日的紀錄：擋下並提示稍後再試', async () => {
    mocks.fetchDaySummary.mockRejectedValue(new Error('讀取失敗'));
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);

    expect(copyDayError(wrapper)).toBe('無法確認目標日的紀錄，請稍後再試');
    expect(mocks.batchCreateItems).not.toHaveBeenCalled();
  });

  it('後端退回（其他錯誤）：Toast，對話框維持開啟', async () => {
    mocks.fetchDaySummary.mockResolvedValue({ otherHours: 0, itemCount: 0 });
    mocks.batchCreateItems.mockRejectedValue(new ApiError('第 2 筆：工作目標為必填'));
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);

    expect(mocks.showToast).toHaveBeenCalledWith('第 2 筆：工作目標為必填');
    expect(mocks.clearLogin).not.toHaveBeenCalled();
    expect(exists(wrapper, 'CopyDayDialog')).toBe(true);
  });

  it('登入錯誤：關閉對話框並登出', async () => {
    mocks.fetchDaySummary.mockResolvedValue({ otherHours: 0, itemCount: 1 });
    mocks.batchCreateItems.mockRejectedValue(unauthorized());
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);
    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');

    expect(mocks.clearLogin).toHaveBeenCalled();
    expect(exists(wrapper, 'CopyDayDialog')).toBe(false);
    expect(exists(wrapper, 'ConfirmDialog')).toBe(false);
  });
});

describe('設定類 Modal 的登入錯誤', () => {
  it.each([
    ['選項清單', 'OptionsManagerModal'],
    ['工時設定', 'WorkHoursSettingModal'],
  ])('%s回報 unauthorized：關閉 Modal 並登出', async (label, name) => {
    const wrapper = await mountView();
    const dropdown = wrapper
      .findAllComponents(NDropdown)
      .find((component) =>
        (component.props('options') as { label: string }[]).some((o) => o.label === label),
      )!;
    dropdown.vm.$emit('select', name === 'OptionsManagerModal' ? 'options' : 'workHours');
    await flushPromises();
    expect(exists(wrapper, name)).toBe(true);

    await emitFrom(wrapper, name, 'unauthorized');
    expect(mocks.clearLogin).toHaveBeenCalled();
    expect(exists(wrapper, name)).toBe(false);
  });
});

describe('搜尋', () => {
  const result = (keyword: string, total = 1) => ({
    items: [makeItem({ id: `r-${keyword}`, 工作目標: keyword })],
    total,
  });

  const tableItems = (wrapper: VueWrapper): WorkItem[] =>
    wrapper.findComponent({ name: 'WorkItemTable' }).props('items') as WorkItem[];

  it('搜尋：顯示搜尋結果表格與筆數；超過上限時提示只顯示最新的筆數', async () => {
    mocks.searchItems.mockResolvedValue(result('官網', 250));
    const wrapper = await mountView();
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '官網' });
    expect(mocks.searchItems).toHaveBeenCalledWith({ keyword: '官網' });
    expect(wrapper.get('[role="status"]').text()).toContain('共 250 筆，只顯示最新的 200 筆');
    expect(tableItems(wrapper).map((i) => i.id)).toEqual(['r-官網']);
  });

  it('點推薦搜尋：摘要前面加欄位名稱', async () => {
    mocks.searchItems.mockResolvedValue(result('官網改版'));
    const wrapper = await mountView();
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '官網改版', field: '專案名稱' });
    expect(wrapper.get('[role="status"]').text()).toContain('搜尋結果：專案名稱「官網改版」');
  });

  it('連續搜尋：先送出的比較晚回來，不會蓋掉後面的結果', async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.searchItems
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(result('第二次'));
    const wrapper = await mountView();
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '第一次' });
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '第二次' });
    resolveFirst(result('第一次'));
    await flushPromises();
    expect(tableItems(wrapper).map((i) => i.id)).toEqual(['r-第二次']);
  });

  it('清除後才回來的結果不會再顯示', async () => {
    let resolve!: (value: unknown) => void;
    mocks.searchItems.mockReturnValue(new Promise((r) => (resolve = r)));
    const wrapper = await mountView();
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '官網' });
    await emitFrom(wrapper, 'WorkItemSearch', 'clear');
    resolve(result('官網'));
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(tableItems(wrapper).map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('失敗：顯示錯誤與「重新載入」，重試成功後顯示結果', async () => {
    mocks.searchItems
      .mockRejectedValueOnce(new Error('搜尋失敗'))
      .mockResolvedValueOnce(result('官網'));
    const wrapper = await mountView();
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '官網' });
    expect(wrapper.text()).toContain('搜尋失敗');
    await wrapper.get('.home-view__retry-btn').trigger('click');
    await flushPromises();
    expect(mocks.searchItems).toHaveBeenCalledTimes(2);
    expect(tableItems(wrapper).map((i) => i.id)).toEqual(['r-官網']);
  });

  it('點結果的日期：結束搜尋、切到那天', async () => {
    mocks.searchItems.mockResolvedValue(result('官網'));
    const wrapper = await mountView();
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '官網' });
    mocks.fetchByDate.mockClear();
    await emitFrom(wrapper, 'WorkItemTable', 'goToDate', '2026-09-30');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(mocks.fetchByDate).toHaveBeenCalledWith('2026-09-30');
  });

  it('「結束搜尋」回到單日表格', async () => {
    mocks.searchItems.mockResolvedValue(result('官網'));
    const wrapper = await mountView();
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '官網' });
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '結束搜尋')!
      .trigger('click');
    expect(tableItems(wrapper).map((i) => i.id)).toEqual(['a', 'b']);
  });
});

describe('網址的 ?q=／?field=', () => {
  beforeEach(() => {
    mocks.searchItems.mockResolvedValue({ items: [], total: 0 });
  });

  it('帶 q：開頁面就搜尋，搜尋欄填好關鍵字', async () => {
    const wrapper = await mountView('/?q=官網');
    expect(mocks.searchItems).toHaveBeenCalledWith({ keyword: '官網' });
    expect(wrapper.findComponent({ name: 'WorkItemSearch' }).props('modelValue')).toBe('官網');
  });

  it('帶 q＋field：只搜那個欄位，date 也一起套用', async () => {
    await mountView('/?date=2026-09-01&q=官網改版&field=專案名稱');
    expect(mocks.searchItems).toHaveBeenCalledWith({ keyword: '官網改版', field: '專案名稱' });
    expect(mocks.fetchByDate).toHaveBeenCalledWith('2026-09-01');
    expect(router.currentRoute.value.query).toEqual({
      date: '2026-09-01',
      q: '官網改版',
      field: '專案名稱',
    });
  });

  it.each([
    ['q 空白', '/?q=%20%20&foo=1'],
    ['q 超過 100 字', `/?q=${'a'.repeat(101)}&foo=1`],
    ['field 不是可搜尋的欄位', '/?q=官網&field=處理內容&foo=1'],
    ['只有 field', '/?field=專案名稱&foo=1'],
  ])('不正確（%s）：不搜尋，把 q／field 從網址拿掉、保留其他參數', async (_label, path) => {
    await mountView(path);
    expect(mocks.searchItems).not.toHaveBeenCalled();
    expect(router.currentRoute.value.query).toEqual({ foo: '1' });
  });

  it('搜尋時用 replace 寫進網址，換一次搜尋就換掉', async () => {
    const wrapper = await mountView();
    const push = vi.spyOn(router, 'push');
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '官網改版', field: '專案名稱' });
    expect(router.currentRoute.value.query).toEqual({ q: '官網改版', field: '專案名稱' });
    await emitFrom(wrapper, 'WorkItemSearch', 'search', { keyword: '首頁' });
    expect(router.currentRoute.value.query).toEqual({ q: '首頁' });
    expect(push).not.toHaveBeenCalled();
  });

  it('清空搜尋：拿掉 q／field，date 留著', async () => {
    const wrapper = await mountView('/?date=2026-09-01&q=官網');
    await emitFrom(wrapper, 'WorkItemSearch', 'clear');
    expect(router.currentRoute.value.query).toEqual({ date: '2026-09-01' });
  });

  it('點結果的工作日期：拿掉 q／field，date 換成那天', async () => {
    const wrapper = await mountView('/?q=官網&field=專案名稱');
    await emitFrom(wrapper, 'WorkItemTable', 'go-to-date', '2026-09-05');
    expect(router.currentRoute.value.query).toEqual({ date: '2026-09-05' });
    expect(mocks.fetchByDate).toHaveBeenLastCalledWith('2026-09-05');
  });
});
