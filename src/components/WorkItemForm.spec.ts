// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeItem, makeRecent } from '@/testing/fixtures';
import type { RecentItem, WorkItem } from '@/types/work-item';
import type { WorkHoursSetting } from '@/utils/work-hours';

import WorkItemForm from './WorkItemForm.vue';

/**
 * WorkItemForm 的元件測試：只測元件自己的行為（欄位連動、何時查詢、送出內容、確認對話框），
 * 換算、驗證規則本身在 utils／validation 的單元測試裡測過。
 * 選項清單（useOptions）與當天紀錄查詢（fetchDaySummary）都換成假的，不打 API；
 * NSelect 換成空殼，需要選值的情境改用「編輯既有紀錄」帶入；選項載入狀態改用只渲染 empty slot 的殼
 */
const mocks = vi.hoisted(() => ({
  fetchDaySummary: vi.fn(),
  recentItems: null as unknown as { value: RecentItem[] },
  workHours: null as unknown as { value: WorkHoursSetting | null },
  optionsLoading: null as unknown as { value: boolean },
  optionsError: null as unknown as { value: Error | null },
  fetchOptions: vi.fn(),
}));

vi.mock('@/composables/useWorkItems', () => ({
  fetchDaySummary: mocks.fetchDaySummary,
}));

vi.mock('@/composables/useOptions', async () => {
  const { ref: vueRef } = await import('vue');
  mocks.recentItems = vueRef<RecentItem[]>([]);
  mocks.workHours = vueRef<WorkHoursSetting | null>(null);
  mocks.optionsLoading = vueRef(false);
  mocks.optionsError = vueRef<Error | null>(null);
  return {
    useOptions: () => ({
      options: vueRef({ 交辦單位: [], 交辦人員: [], 專案名稱: [], 專案Repo: [] }),
      recentItems: mocks.recentItems,
      workHours: mocks.workHours,
      loading: mocks.optionsLoading,
      error: mocks.optionsError,
      fetchOptions: mocks.fetchOptions,
    }),
  };
});

const SETTING: WorkHoursSetting = {
  start: '08:30',
  end: '18:00',
  breakStart: '12:00',
  breakEnd: '13:30',
};

/** fetchDaySummary 的回應：entries 是當天既有的紀錄 */
const daySummary = (entries: Pick<WorkItem, 'id' | '項次' | '今日工時'>[], excludeId?: string) => ({
  nextIndex: Math.max(0, ...entries.map((e) => e.項次)) + 1,
  otherHours: entries.filter((e) => e.id !== excludeId).reduce((sum, e) => sum + e.今日工時, 0),
  itemCount: entries.length,
  entries,
});

const mountForm = async (props: Record<string, unknown> = {}): Promise<VueWrapper> => {
  const wrapper = mount(WorkItemForm, {
    props: { defaultDate: '2026-10-09', ...props },
    global: { stubs: { NSelect: true, Transition: false } },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
};

const submit = async (wrapper: VueWrapper): Promise<void> => {
  await wrapper.find('form').trigger('submit');
  await flushPromises();
};

const errorTexts = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.work-item-form__error').map((e) => e.text());

const indexText = (wrapper: VueWrapper): string => wrapper.find('.work-item-form__readonly').text();

const hoursInput = (wrapper: VueWrapper) => wrapper.find<HTMLInputElement>('input[type="number"]');

beforeEach(() => {
  document.body.innerHTML = '';
  mocks.fetchDaySummary.mockReset();
  mocks.fetchDaySummary.mockResolvedValue(daySummary([]));
  mocks.recentItems.value = [];
  mocks.workHours.value = null;
  mocks.optionsLoading.value = false;
  mocks.optionsError.value = null;
  mocks.fetchOptions.mockReset();
});

describe('項次', () => {
  it('新增時顯示當天的預計項次', async () => {
    mocks.fetchDaySummary.mockResolvedValue(
      daySummary([
        { id: 'a', 項次: 1, 今日工時: 1 },
        { id: 'b', 項次: 3, 今日工時: 1 },
      ]),
    );
    const wrapper = await mountForm();
    expect(mocks.fetchDaySummary).toHaveBeenCalledWith('2026-10-09', undefined);
    expect(indexText(wrapper)).toBe('4');
  });

  it('編輯且日期沒改：顯示自己的項次', async () => {
    const wrapper = await mountForm({ item: makeItem({ id: 'x', 項次: 2 }) });
    expect(indexText(wrapper)).toBe('2');
  });

  it('編輯時把日期改到別天：改顯示那天的預計項次', async () => {
    const wrapper = await mountForm({ item: makeItem({ id: 'x', 項次: 2 }) });
    mocks.fetchDaySummary.mockResolvedValue(daySummary([{ id: 'c', 項次: 5, 今日工時: 1 }]));
    await wrapper.find('input[type="date"]').setValue('2026-10-12');
    await flushPromises();
    expect(mocks.fetchDaySummary).toHaveBeenLastCalledWith('2026-10-12', 'x');
    expect(indexText(wrapper)).toBe('6');
  });

  it('查詢失敗時留空、不擋畫面', async () => {
    mocks.fetchDaySummary.mockRejectedValue(new Error('網路錯誤'));
    const wrapper = await mountForm();
    expect(wrapper.find('.work-item-form__readonly--placeholder').exists()).toBe(true);
  });
});

describe('送出', () => {
  it('必填沒填：顯示錯誤、不送出', async () => {
    const wrapper = await mountForm();
    await submit(wrapper);
    expect(errorTexts(wrapper)).toEqual(
      expect.arrayContaining([
        '請選擇交辦單位',
        '請選擇交辦人員',
        '請選擇專案名稱',
        '請填寫工作目標',
      ]),
    );
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('第一次送出才顯示錯誤，之後修改即時重新驗證', async () => {
    const wrapper = await mountForm({ item: makeItem({ 工作目標: '' }) });
    expect(errorTexts(wrapper)).toEqual([]);
    await submit(wrapper);
    expect(errorTexts(wrapper)).toEqual(['請填寫工作目標']);
    await wrapper.find('textarea').setValue('補上目標');
    expect(errorTexts(wrapper)).toEqual([]);
  });

  it('編輯：送出去掉前後空白的值，不含 id、項次', async () => {
    const wrapper = await mountForm({
      item: makeItem({ id: 'x', 項次: 2, 專案Repo: [' AAA ', ''], 今日工時: 2 }),
    });
    await wrapper.find('textarea').setValue('  首頁改版  ');
    await submit(wrapper);
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      工作日期: '2026-10-09',
      交辦單位: '資訊部',
      交辦人員: '王小明',
      專案名稱: '官網改版',
      專案Repo: ['AAA'],
      工作目標: '首頁改版',
      預計期限: '',
      處理內容: '',
      今日工時: 2,
      完成度: 0,
      狀態: '待辦',
    });
  });

  it('今日工時清空時送 0', async () => {
    const wrapper = await mountForm({ item: makeItem({ 今日工時: 3 }) });
    await hoursInput(wrapper).setValue('');
    await submit(wrapper);
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ 今日工時: 0 });
  });

  it('當天合計超過 24 小時：顯示錯誤、不送出', async () => {
    mocks.fetchDaySummary.mockResolvedValue(
      daySummary(
        [
          { id: 'x', 項次: 1, 今日工時: 2 },
          { id: 'y', 項次: 2, 今日工時: 20 },
        ],
        'x',
      ),
    );
    const wrapper = await mountForm({ item: makeItem({ id: 'x', 今日工時: 2 }) });
    await hoursInput(wrapper).setValue(4.25);
    await submit(wrapper);
    expect(errorTexts(wrapper)).toEqual([
      '當天工時合計不可超過 24 小時（其他紀錄已 20 小時，已超出0.25小時）',
    ]);
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('剛好 24 小時可以存', async () => {
    mocks.fetchDaySummary.mockResolvedValue(daySummary([{ id: 'y', 項次: 2, 今日工時: 20 }]));
    const wrapper = await mountForm({ item: makeItem({ id: 'x', 今日工時: 4 }) });
    await submit(wrapper);
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('查不到當天合計：送出時再查一次，還是查不到就擋下', async () => {
    mocks.fetchDaySummary.mockRejectedValue(new Error('網路錯誤'));
    const wrapper = await mountForm({ item: makeItem() });
    const callsBefore = mocks.fetchDaySummary.mock.calls.length;
    await submit(wrapper);
    expect(mocks.fetchDaySummary.mock.calls.length).toBe(callsBefore + 1);
    expect(errorTexts(wrapper)).toEqual(['無法確認當天工時合計，請稍後再試']);
    expect(wrapper.emitted('save')).toBeUndefined();
  });

  it('送出時補查成功就放行', async () => {
    mocks.fetchDaySummary.mockRejectedValueOnce(new Error('網路錯誤'));
    const wrapper = await mountForm({ item: makeItem() });
    await submit(wrapper);
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('送出中（saving）不會重複送出', async () => {
    const wrapper = await mountForm({ item: makeItem(), saving: true });
    await submit(wrapper);
    expect(wrapper.emitted('save')).toBeUndefined();
  });
});

describe('請假', () => {
  it('請假：送出時補上固定值（假別是 NSelect，用編輯既有請假紀錄驗證）', async () => {
    const leave = makeItem({ 狀態: '休假', 工作目標: '特休', 今日工時: 4, 處理內容: ' 出國 ' });
    const wrapper = await mountForm({ item: leave });
    await submit(wrapper);
    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      交辦單位: '人事室',
      交辦人員: '--',
      專案名稱: '休假',
      專案Repo: [],
      預計期限: '',
      完成度: 100,
      工作日期: '2026-10-09',
      工作目標: '特休',
      處理內容: '出國',
      今日工時: 4,
      狀態: '休假',
    });
  });

  it('新增請假的請假時數預設 8', async () => {
    const wrapper = await mountForm({ leave: true });
    expect(hoursInput(wrapper).element.value).toBe('8');
    expect(wrapper.find('.work-item-form__title').text()).toBe('新增請假');
  });

  it('編輯、複製時不顯示「工作項目 ｜ 請假」切換', async () => {
    expect((await mountForm()).find('.work-item-form__mode').exists()).toBe(true);
    expect((await mountForm({ item: makeItem() })).find('.work-item-form__mode').exists()).toBe(
      false,
    );
    expect(
      (await mountForm({ copySource: makeItem() })).find('.work-item-form__mode').exists(),
    ).toBe(false);
  });

  it('沒填內容時直接切換；切到請假後工時預設變 8', async () => {
    const wrapper = await mountForm();
    await wrapper.findAll('.work-item-form__mode-btn')[1]!.trigger('click');
    expect(wrapper.find('.confirm-dialog').exists()).toBe(false);
    expect(hoursInput(wrapper).element.value).toBe('8');
  });

  it('有填內容時切換要先確認', async () => {
    const wrapper = await mountForm();
    await wrapper.find('textarea').setValue('寫了一半');
    await wrapper.findAll('.work-item-form__mode-btn')[1]!.trigger('click');
    expect(wrapper.find('.confirm-dialog').exists()).toBe(true);
  });
});

describe('複製', () => {
  it('帶入來源紀錄，工作日期用選到的那天、處理內容與工時清空', async () => {
    const source = makeItem({
      工作日期: '2026-10-01',
      處理內容: '舊的',
      今日工時: 5,
      完成度: 40,
      狀態: '進行中',
    });
    const wrapper = await mountForm({ copySource: source });
    expect(wrapper.find('.work-item-form__title').text()).toBe('複製工作項目');
    await submit(wrapper);
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      工作日期: '2026-10-09',
      處理內容: '',
      今日工時: 0,
      完成度: 40,
      狀態: '進行中',
    });
  });
});

describe('未儲存確認', () => {
  it('沒修改：直接關閉', async () => {
    const wrapper = await mountForm({ item: makeItem() });
    await wrapper.find('.work-item-form__close-btn').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('改了又改回原值：直接關閉', async () => {
    const wrapper = await mountForm({ item: makeItem() });
    await wrapper.find('textarea').setValue('別的');
    await wrapper.find('textarea').setValue('首頁改版');
    await wrapper.find('.work-item-form__close-btn').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('有修改：先跳確認，不關閉', async () => {
    const wrapper = await mountForm({ item: makeItem() });
    await wrapper.find('textarea').setValue('改過');
    await wrapper.find('.work-item-form__backdrop').trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
    expect(wrapper.find('.confirm-dialog__title').text()).toBe('要放棄變更嗎？');
  });

  it('複製預填後沒改：直接關閉', async () => {
    const wrapper = await mountForm({ copySource: makeItem({ 完成度: 40 }) });
    await wrapper.find('.work-item-form__close-btn').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });

  it('送出中不能關閉', async () => {
    const wrapper = await mountForm({ item: makeItem(), saving: true });
    await wrapper.find('.work-item-form__backdrop').trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
  });
});

describe('填完工作目標後預填', () => {
  const recent = makeRecent({
    工作日期: '2026-10-05',
    工作目標: '#12345 登入頁',
    交辦單位: '行銷部',
    交辦人員: '李小華',
    專案名稱: '會員系統',
    專案Repo: ['member-web'],
    預計期限: '2026-10-31',
    完成度: 50,
    狀態: '進行中',
  });

  it('單號相同就帶入，並提示帶入了哪些欄位', async () => {
    mocks.recentItems.value = [recent];
    const wrapper = await mountForm();
    const target = wrapper.find('textarea');
    await target.setValue('#12345 登入頁修正');
    await target.trigger('blur');
    expect(wrapper.find('.work-item-form__hint').text()).toBe(
      '已依 2026/10/05 的紀錄帶入：預計期限、完成度、狀態、交辦單位、交辦人員、專案名稱、專案 Repo',
    );
    await submit(wrapper);
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      交辦單位: '行銷部',
      交辦人員: '李小華',
      專案名稱: '會員系統',
      專案Repo: ['member-web'],
      預計期限: '2026-10-31',
      完成度: 50,
      狀態: '進行中',
    });
  });

  it('找不到相同的工作目標就什麼都不做', async () => {
    mocks.recentItems.value = [recent];
    const wrapper = await mountForm();
    await wrapper.find('textarea').setValue('別的工作');
    await wrapper.find('textarea').trigger('blur');
    expect(wrapper.find('.work-item-form__hint').exists()).toBe(false);
  });

  it('編輯時不預填', async () => {
    mocks.recentItems.value = [recent];
    const wrapper = await mountForm({ item: makeItem({ 工作目標: '#12345 登入頁' }) });
    await wrapper.find('textarea').trigger('blur');
    expect(wrapper.find('.work-item-form__hint').exists()).toBe(false);
  });

  it('不蓋掉已經填的值（完成度改過就不帶入）', async () => {
    mocks.recentItems.value = [recent];
    const wrapper = await mountForm();
    const progress = wrapper.findAll('input[type="number"]')[1]!;
    await progress.setValue(10);
    await wrapper.find('textarea').setValue('#12345');
    await wrapper.find('textarea').trigger('blur');
    expect(wrapper.find('.work-item-form__hint').text()).not.toContain('完成度');
  });
});

describe('工作時段', () => {
  const rangeInputs = (wrapper: VueWrapper) => {
    const inputs = wrapper.findAll<HTMLInputElement>('input[type="time"]');
    return { start: inputs[0]!, end: inputs[1]! };
  };

  it('沒有工時設定時不顯示', async () => {
    const wrapper = await mountForm();
    expect(wrapper.findAll('input[type="time"]')).toHaveLength(0);
  });

  it('依當天前面紀錄的工時推算時段，改今日工時會重算', async () => {
    mocks.workHours.value = SETTING;
    mocks.fetchDaySummary.mockResolvedValue(
      daySummary([
        { id: 'a', 項次: 1, 今日工時: 2 },
        { id: 'b', 項次: 2, 今日工時: 0.5 },
      ]),
    );
    const wrapper = await mountForm();
    await hoursInput(wrapper).setValue(1.25);
    const { start, end } = rangeInputs(wrapper);
    expect([start.element.value, end.element.value]).toEqual(['11:00', '13:45']);
  });

  it('改時段只更新今日工時、保留填的時間，離開欄位時四捨五入到 15 分鐘', async () => {
    mocks.workHours.value = SETTING;
    const wrapper = await mountForm();
    const { start, end } = rangeInputs(wrapper);
    await start.setValue('11:05');
    await start.trigger('blur');
    await end.setValue('14:00');
    await end.trigger('blur');
    expect(start.element.value).toBe('11:00');
    expect(end.element.value).toBe('14:00');
    expect(hoursInput(wrapper).element.value).toBe('1.5');
  });

  it('編輯沒改日期：只累計項次排在前面的紀錄', async () => {
    mocks.workHours.value = SETTING;
    mocks.fetchDaySummary.mockResolvedValue(
      daySummary(
        [
          { id: 'a', 項次: 1, 今日工時: 1 },
          { id: 'x', 項次: 2, 今日工時: 2 },
          { id: 'c', 項次: 3, 今日工時: 3 },
        ],
        'x',
      ),
    );
    const wrapper = await mountForm({ item: makeItem({ id: 'x', 項次: 2, 今日工時: 2 }) });
    const { start, end } = rangeInputs(wrapper);
    expect([start.element.value, end.element.value]).toEqual(['09:30', '11:30']);
  });

  it('改日期後還沒查完就按儲存：送出時補查的結果照樣推算時段，不會一直空白', async () => {
    mocks.workHours.value = SETTING;
    const wrapper = await mountForm({ item: makeItem({ id: 'x', 項次: 2, 今日工時: 2 }) });
    mocks.fetchDaySummary
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce(daySummary([{ id: 'c', 項次: 1, 今日工時: 1 }], 'x'));
    await wrapper.find('input[type="date"]').setValue('2026-10-12');
    await submit(wrapper);
    const { start, end } = rangeInputs(wrapper);
    expect([start.element.value, end.element.value]).toEqual(['09:30', '11:30']);
  });

  it('結束早於開始：提示錯誤並擋下送出', async () => {
    mocks.workHours.value = SETTING;
    const wrapper = await mountForm({ item: makeItem({ 今日工時: 1 }) });
    const { start, end } = rangeInputs(wrapper);
    await start.setValue('14:00');
    await start.trigger('blur');
    await end.setValue('13:00');
    await end.trigger('blur');
    expect(errorTexts(wrapper)).toContain('結束時間需晚於開始時間');
    await submit(wrapper);
    expect(wrapper.emitted('save')).toBeUndefined();
  });
});

describe('選項清單載入中／失敗', () => {
  // NSelect 換成只渲染 empty slot 的殼，才看得到下拉選單裡的狀態畫面（Naive UI 的元件名稱是 Select）
  const SelectWithEmpty = { template: '<div class="select-stub"><slot name="empty" /></div>' };
  const mountWithSelect = async (): Promise<VueWrapper> => {
    const wrapper = mount(WorkItemForm, {
      props: { defaultDate: '2026-10-09' },
      global: { stubs: { Select: SelectWithEmpty, Transition: false } },
      attachTo: document.body,
    });
    await flushPromises();
    return wrapper;
  };

  it('開表單就讀選項清單', async () => {
    await mountWithSelect();
    expect(mocks.fetchOptions).toHaveBeenCalledTimes(1);
  });

  it('載入中：四個可搜尋下拉選單都顯示「選項載入中」', async () => {
    mocks.optionsLoading.value = true;
    const wrapper = await mountWithSelect();
    const states = wrapper.findAll('.options-dropdown-state');
    expect(states).toHaveLength(4);
    expect(states.every((s) => s.text().includes('選項載入中'))).toBe(true);
  });

  it('載入失敗：顯示「選項清單載入失敗」，按「重新載入」再讀一次', async () => {
    mocks.optionsError.value = new Error('網路錯誤');
    const wrapper = await mountWithSelect();
    expect(wrapper.findAll('.options-dropdown-state__message')).toHaveLength(4);
    await wrapper.findAll('.options-dropdown-state__retry')[2]!.trigger('click');
    expect(mocks.fetchOptions).toHaveBeenCalledTimes(2);
  });

  it('讀好了：不放狀態畫面（下拉選單顯示 Naive UI 本身的「無資料」）', async () => {
    const wrapper = await mountWithSelect();
    expect(wrapper.find('.options-dropdown-state').exists()).toBe(false);
  });
});
