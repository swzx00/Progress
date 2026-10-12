// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CopyDayDialog from '@/components/CopyDayDialog.vue';

/**
 * 「複製本日」選目標日期：預設下一個工作日（使用者先選了就不覆蓋）、送出的日期、busy／錯誤狀態。
 * 下一個工作日的算法在 useTaiwanHolidays 的測試，這裡換成假的
 */
const mocks = vi.hoisted(() => ({ findNextWorkday: vi.fn() }));

vi.mock('@/composables/useTaiwanHolidays', () => ({
  useTaiwanHolidays: () => ({ findNextWorkday: mocks.findNextWorkday }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findNextWorkday.mockResolvedValue('2026-10-12');
});

const mountDialog = async (props: Record<string, unknown> = {}): Promise<VueWrapper> => {
  const wrapper = mount(CopyDayDialog, { props: { sourceDate: '2026-10-08', count: 3, ...props } });
  await flushPromises();
  return wrapper;
};

const dateInput = (wrapper: VueWrapper) => wrapper.get<HTMLInputElement>('input[type="date"]');
const button = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find((b) => b.text() === text)!;

describe('目標日期', () => {
  it('預設來源日期的下一個工作日，訊息顯示來源日期與筆數', async () => {
    const wrapper = await mountDialog();
    expect(mocks.findNextWorkday).toHaveBeenCalledWith('2026-10-08', 1);
    expect(dateInput(wrapper).element.value).toBe('2026-10-12');
    expect(wrapper.text()).toContain('把 2026/10/08 的 3 筆紀錄（含請假）');
  });

  it('查假日還沒回來前使用者先選了日期：不覆蓋', async () => {
    let resolve!: (date: string) => void;
    mocks.findNextWorkday.mockReturnValue(new Promise((r) => (resolve = r)));
    const wrapper = mount(CopyDayDialog, { props: { sourceDate: '2026-10-08', count: 3 } });
    await dateInput(wrapper).setValue('2026-10-20');
    resolve('2026-10-12');
    await flushPromises();
    expect(dateInput(wrapper).element.value).toBe('2026-10-20');
  });

  it('日期範圍跟工作日期欄位一樣', async () => {
    const wrapper = await mountDialog();
    expect(dateInput(wrapper).attributes('min')).toBe('2020-01-01');
    expect(dateInput(wrapper).attributes('max')).toBe('2099-12-31');
  });
});

describe('按鈕', () => {
  it('複製：送出選的日期；沒選日期時停用', async () => {
    const wrapper = await mountDialog();
    await dateInput(wrapper).setValue('2026-10-13');
    await button(wrapper, '複製').trigger('click');
    expect(wrapper.emitted('confirm')).toEqual([['2026-10-13']]);
    await dateInput(wrapper).setValue('');
    expect(button(wrapper, '複製').attributes('disabled')).toBeDefined();
  });

  it('取消、點背景：emit cancel', async () => {
    const wrapper = await mountDialog();
    await button(wrapper, '取消').trigger('click');
    await wrapper.get('.copy-day-dialog__backdrop').trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(2);
  });

  it('複製中：顯示「複製中…」，全部停用，點背景不會關閉', async () => {
    const wrapper = await mountDialog({ busy: true });
    expect(button(wrapper, '複製中…').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '取消').attributes('disabled')).toBeDefined();
    expect(dateInput(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('.copy-day-dialog__backdrop').trigger('click');
    expect(wrapper.emitted('cancel')).toBeUndefined();
  });

  it('錯誤訊息（例如超過 24 小時）顯示在日期下面', async () => {
    const wrapper = await mountDialog({ error: '當天工時合計不可超過 24 小時' });
    expect(wrapper.get('[role="alert"]').text()).toBe('當天工時合計不可超過 24 小時');
    expect(wrapper.get('label').classes()).toContain('copy-day-dialog__field--invalid');
  });
});
