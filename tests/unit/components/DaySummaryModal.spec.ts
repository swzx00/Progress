// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeItem } from '@/testing/fixtures';
import type { WorkItem } from '@/types/work-item';
import { buildDaySummary } from '@/utils/day-summary';

import DaySummaryModal from '@/components/DaySummaryModal.vue';

/**
 * 本日總結：文字照 buildDaySummary 產生（規則在 utils/day-summary 的測試）、可以手動改、複製、
 * 沒有紀錄時的空狀態、關閉。剪貼簿與 Toast 換成假的
 */
const mocks = vi.hoisted(() => ({ showToast: vi.fn(), writeText: vi.fn() }));

vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
});

const ITEMS: WorkItem[] = [
  makeItem({ id: 'a', 項次: 1, 工作目標: '首頁切版', 處理內容: '完成 RWD' }),
  makeItem({ id: 'b', 項次: 2, 工作目標: '登入流程', 完成度: 100 }),
];

const mountModal = (items: WorkItem[] = ITEMS): VueWrapper =>
  mount(DaySummaryModal, { props: { date: '2026/10/09', items } });

const textarea = (wrapper: VueWrapper) => wrapper.get<HTMLTextAreaElement>('textarea');

it('Textarea 放 buildDaySummary 產生的文字，標題旁顯示日期', () => {
  const wrapper = mountModal();
  expect(textarea(wrapper).element.value).toBe(buildDaySummary(ITEMS));
  expect(textarea(wrapper).element.value).not.toBe('');
  expect(wrapper.get('.day-summary__date').text()).toBe('2026/10/09');
});

describe('複製', () => {
  it('複製 Textarea 目前的內容（含手動修改），成功 Toast', async () => {
    const wrapper = mountModal();
    await textarea(wrapper).setValue('改過的總結');
    await wrapper.get('.day-summary__copy-btn').trigger('click');
    await flushPromises();
    expect(mocks.writeText).toHaveBeenCalledWith('改過的總結');
    expect(mocks.showToast).toHaveBeenCalledWith('已複製本日總結', 'success');
  });

  it('剪貼簿無法使用：錯誤 Toast，請使用者手動複製', async () => {
    mocks.writeText.mockRejectedValue(new Error('denied'));
    const wrapper = mountModal();
    await wrapper.get('.day-summary__copy-btn').trigger('click');
    await flushPromises();
    expect(mocks.showToast).toHaveBeenCalledWith('複製失敗，請手動選取文字複製');
  });
});

it('修改不存檔：關掉重開恢復成產生的內容', async () => {
  const first = mountModal();
  await textarea(first).setValue('改過的總結');
  first.unmount();
  expect(textarea(mountModal()).element.value).toBe(buildDaySummary(ITEMS));
});

it('沒有紀錄：顯示「這天沒有紀錄」，沒有 Textarea 與複製按鈕', () => {
  const wrapper = mountModal([]);
  expect(wrapper.text()).toContain('這天沒有紀錄');
  expect(wrapper.find('textarea').exists()).toBe(false);
  expect(wrapper.find('.day-summary__copy-btn').exists()).toBe(false);
});

it('✕、點背景：emit close', async () => {
  const wrapper = mountModal();
  await wrapper.get('button[aria-label="關閉"]').trigger('click');
  await wrapper.get('.day-summary__backdrop').trigger('click');
  expect(wrapper.emitted('close')).toHaveLength(2);
});
