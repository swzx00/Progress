// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { makeItem } from '@/testing/fixtures';

import ExportModal from './ExportModal.vue';

/**
 * 匯出 Excel 的 Modal：匯出方式與範圍換算成的讀取期間、檔名、超過天數上限、沒有紀錄、失敗。
 * 讀資料（fetchByRange）、產生檔案、下載、Toast 換成假的；檔案內容在 tests/export 測。
 * NDatePicker 換成空殼，用 update:value 模擬選日期（值是本地時間的時間戳）
 */
const mocks = vi.hoisted(() => ({
  fetchByRange: vi.fn(),
  buildExportWorkbook: vi.fn(),
  downloadBlob: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/composables/useWorkItems', () => ({ fetchByRange: mocks.fetchByRange }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('@/utils/export-excel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/export-excel')>()),
  buildExportWorkbook: mocks.buildExportWorkbook,
  downloadBlob: mocks.downloadBlob,
}));

const DatePickerStub = defineComponent({
  name: 'NDatePicker',
  props: { value: { type: null, default: null }, type: String, status: String, disabled: Boolean },
  emits: ['update:value'],
  template: '<div class="date-picker-stub" />',
});

const ts = (iso: string): number => new Date(`${iso}T00:00:00`).getTime();

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-15T10:00:00'));
  mocks.fetchByRange.mockResolvedValue([makeItem()]);
  mocks.buildExportWorkbook.mockResolvedValue(new Blob(['xlsx']));
});

afterEach(() => {
  vi.useRealTimers();
});

const mountModal = (): VueWrapper =>
  mount(ExportModal, {
    props: { defaultDate: '2026-10-09' },
    global: { stubs: { DatePicker: DatePickerStub } },
  });

const picker = (wrapper: VueWrapper) => wrapper.findComponent(DatePickerStub);
const exportButton = (wrapper: VueWrapper) => wrapper.get('.export-modal__export-btn');
const chooseMode = (wrapper: VueWrapper, label: string) =>
  wrapper
    .findAll('.export-modal__mode-btn')
    .find((b) => b.text() === label)!
    .trigger('click');

const runExport = async (wrapper: VueWrapper): Promise<void> => {
  await exportButton(wrapper).trigger('click');
  await flushPromises();
};

describe('匯出範圍', () => {
  it.each([
    ['年份', '2026-01-01', '2026-12-31', '工作進度_2026.xlsx'],
    ['季度', '2026-07-01', '2026-09-30', '工作進度_2026Q3.xlsx'],
    ['月份', '2026-08-01', '2026-08-31', '工作進度_2026-08.xlsx'],
    ['指定天數', '2026-10-09', '2026-10-09', '工作進度_2026-10-09_2026-10-09.xlsx'],
  ])('%s：預設今天（指定天數是選到的那天）所在的期間', async (label, from, to, fileName) => {
    const wrapper = mountModal();
    await chooseMode(wrapper, label);
    await runExport(wrapper);
    expect(mocks.fetchByRange).toHaveBeenCalledWith(from, to);
    expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), fileName);
  });

  it('選了別的季度：換算成那一季', async () => {
    const wrapper = mountModal();
    await chooseMode(wrapper, '季度');
    picker(wrapper).vm.$emit('update:value', ts('2025-11-20'));
    await runExport(wrapper);
    expect(mocks.fetchByRange).toHaveBeenCalledWith('2025-10-01', '2025-12-31');
  });

  it('指定天數用本地時間的年月日（不會差一天）', async () => {
    const wrapper = mountModal();
    await chooseMode(wrapper, '指定天數');
    picker(wrapper).vm.$emit('update:value', [ts('2026-03-01'), ts('2026-03-31')]);
    await runExport(wrapper);
    expect(mocks.fetchByRange).toHaveBeenCalledWith('2026-03-01', '2026-03-31');
  });

  it('指定天數超過 366 天：顯示錯誤、停用匯出', async () => {
    const wrapper = mountModal();
    await chooseMode(wrapper, '指定天數');
    picker(wrapper).vm.$emit('update:value', [ts('2025-01-01'), ts('2026-01-02')]);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('日期範圍不可超過 366 天');
    expect(picker(wrapper).props('status')).toBe('error');
    expect(exportButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('清空日期：停用匯出', async () => {
    const wrapper = mountModal();
    picker(wrapper).vm.$emit('update:value', null);
    await flushPromises();
    expect(exportButton(wrapper).attributes('disabled')).toBeDefined();
  });
});

describe('匯出結果', () => {
  it('成功：產生檔案、下載、Toast 顯示筆數', async () => {
    mocks.fetchByRange.mockResolvedValue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    const wrapper = mountModal();
    await runExport(wrapper);
    expect(mocks.buildExportWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'year', from: '2026-01-01' }),
      expect.arrayContaining([expect.objectContaining({ id: 'a' })]),
    );
    expect(mocks.showToast).toHaveBeenCalledWith('已匯出 2 筆紀錄', 'success');
  });

  it('沒有紀錄：顯示提示、不下載；換範圍後提示消失', async () => {
    mocks.fetchByRange.mockResolvedValue([]);
    const wrapper = mountModal();
    await runExport(wrapper);
    expect(wrapper.get('[role="status"]').text()).toBe('這段期間沒有紀錄');
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
    await chooseMode(wrapper, '月份');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('失敗：錯誤 Toast，Modal 維持開啟', async () => {
    mocks.fetchByRange.mockRejectedValue(new Error('日期範圍不可超過 366 天'));
    const wrapper = mountModal();
    await runExport(wrapper);
    expect(mocks.showToast).toHaveBeenCalledWith('日期範圍不可超過 366 天');
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(exportButton(wrapper).text()).toBe('匯出');
  });

  it('匯出中：按鈕顯示「匯出中」，不能關閉、不能換匯出方式', async () => {
    let resolve!: (items: unknown[]) => void;
    mocks.fetchByRange.mockReturnValue(new Promise((r) => (resolve = r)));
    const wrapper = mountModal();
    await exportButton(wrapper).trigger('click');
    expect(exportButton(wrapper).text()).toBe('匯出中');
    expect(exportButton(wrapper).attributes('disabled')).toBeDefined();
    await wrapper.get('.export-modal__backdrop').trigger('click');
    await wrapper.get('button[aria-label="關閉"]').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(
      wrapper
        .findAll('.export-modal__mode-btn')
        .every((b) => b.attributes('disabled') !== undefined),
    ).toBe(true);
    resolve([makeItem()]);
    await flushPromises();
    await wrapper.get('button[aria-label="關閉"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
