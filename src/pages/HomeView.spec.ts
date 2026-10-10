// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { NDropdown } from 'naive-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';

import { makeItem } from '@/testing/fixtures';
import type { WorkItem } from '@/types/work-item';
import { todayString } from '@/utils/date';

import HomeView from './HomeView.vue';

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
  showToast: vi.fn(),
  rememberItems: vi.fn(),
  fetchByDate: vi.fn(),
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
  props: ['modelValue'],
  emits: ['update:modelValue'],
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

const mountView = async (): Promise<VueWrapper> => {
  const wrapper = mount(HomeView, {
    global: {
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
});

describe('讀取', () => {
  it('打開時讀今天的紀錄', async () => {
    await mountView();
    expect(mocks.fetchByDate).toHaveBeenCalledWith(today);
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
    expect(mocks.signOut).toHaveBeenCalled();
    expect(exists(wrapper, 'WorkItemForm')).toBe(false);
  });

  it('其他錯誤：Toast，表單維持開啟、不登出、不記住近期紀錄', async () => {
    mocks.createItem.mockRejectedValue(new ApiError('工作目標為必填'));
    const wrapper = await mountView();
    await openCreate(wrapper);
    await emitFrom(wrapper, 'WorkItemForm', 'save', savePayload());

    expect(mocks.showToast).toHaveBeenCalledWith('工作目標為必填');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(exists(wrapper, 'WorkItemForm')).toBe(true);
    expect(mocks.rememberItems).not.toHaveBeenCalled();
  });

  it('網路錯誤（不是 ApiError）也是保留表單', async () => {
    mocks.createItem.mockRejectedValue(new TypeError('Failed to fetch'));
    const wrapper = await mountView();
    await openCreate(wrapper);
    await emitFrom(wrapper, 'WorkItemForm', 'save', savePayload());

    expect(mocks.signOut).not.toHaveBeenCalled();
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

  it('沒有 token：不送出，直接登出', async () => {
    const wrapper = await mountView();
    await openCreate(wrapper);
    mocks.idToken.value = null;
    await emitFrom(wrapper, 'WorkItemForm', 'save', savePayload());

    expect(mocks.createItem).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith('尚未登入，無法儲存');
    expect(mocks.signOut).toHaveBeenCalled();
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
    expect(mocks.signOut).toHaveBeenCalled();
    expect(exists(wrapper, 'ConfirmDialog')).toBe(false);
  });

  it('其他錯誤：Toast，確認對話框維持開啟可以重試', async () => {
    mocks.deleteItem.mockRejectedValueOnce(new ApiError('找不到這筆紀錄'));
    const wrapper = await mountView();
    await openDelete(wrapper);
    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');

    expect(mocks.showToast).toHaveBeenCalledWith('找不到這筆紀錄');
    expect(mocks.signOut).not.toHaveBeenCalled();
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
    expect(mocks.signOut).toHaveBeenCalled();
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

    expect(mocks.items.value.map((item) => [item.id, item.項次])).toEqual([
      ['b', 1],
      ['a', 2],
    ]);
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
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('登入錯誤：還原並登出', async () => {
    mocks.reorderItems.mockRejectedValue(unauthorized());
    const wrapper = await mountView();
    const before = mocks.items.value;
    await emitFrom(wrapper, 'WorkItemTable', 'reorder', ['b', 'a']);

    expect(mocks.items.value).toBe(before);
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it('沒有 token：不送出、不改順序，直接登出', async () => {
    const wrapper = await mountView();
    const before = mocks.items.value;
    mocks.idToken.value = null;
    await emitFrom(wrapper, 'WorkItemTable', 'reorder', ['b', 'a']);

    expect(mocks.reorderItems).not.toHaveBeenCalled();
    expect(mocks.items.value).toBe(before);
    expect(mocks.signOut).toHaveBeenCalled();
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
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(exists(wrapper, 'CopyDayDialog')).toBe(true);
  });

  it('登入錯誤：關閉對話框並登出', async () => {
    mocks.fetchDaySummary.mockResolvedValue({ otherHours: 0, itemCount: 1 });
    mocks.batchCreateItems.mockRejectedValue(unauthorized());
    const wrapper = await mountView();
    await openCopyDay(wrapper);
    await emitFrom(wrapper, 'CopyDayDialog', 'confirm', TARGET);
    await emitFrom(wrapper, 'ConfirmDialog', 'confirm');

    expect(mocks.signOut).toHaveBeenCalled();
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
    expect(mocks.signOut).toHaveBeenCalled();
    expect(exists(wrapper, name)).toBe(false);
  });
});
