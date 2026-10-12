// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCalendar } from '@/testing/taiwan-calendar';
import { todayString } from '@/utils/date';

/**
 * DateNav 的日期切換：上一天／下一天、上一個／下一個工作日（緊鄰那天本來就是工作日時停用）、
 * 放假徽章與工時合計。行事曆資料換成假的（2030 中秋連假＋補班日），NDatePicker 換成空殼
 */
const fetchMock = vi.fn();

const CALENDAR = makeCalendar(2030, { '2030-09-12': '中秋節', '2030-09-13': '調整放假' }, [
  '2030-09-28',
]);

type DateNavComponent = (typeof import('./DateNav.vue'))['default'];
let DateNav: DateNavComponent;

const mountNav = async (
  modelValue: string,
  props: Record<string, unknown> = {},
): Promise<VueWrapper> => {
  const wrapper = mount(DateNav, {
    props: { modelValue, ...props },
    global: { stubs: { NDatePicker: true } },
  });
  await flushPromises();
  return wrapper;
};

const button = (wrapper: VueWrapper, label: string) => wrapper.get(`button[aria-label="${label}"]`);

const emitted = (wrapper: VueWrapper): string[] =>
  (wrapper.emitted('update:modelValue') ?? []).map(([value]) => value as string);

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => CALENDAR });
  // 行事曆快取在模組層級，重新載入元件，先把 2030 年的資料載好
  DateNav = (await import('./DateNav.vue')).default;
  await (
    await import('@/composables/useTaiwanHolidays')
  )
    .useTaiwanHolidays()
    .ensureYearLoaded('2030');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('上一天／下一天', () => {
  it('跨月加減一天', async () => {
    const wrapper = await mountNav('2030-09-30');
    await button(wrapper, '下一天').trigger('click');
    await button(wrapper, '上一天').trigger('click');
    expect(emitted(wrapper)).toEqual(['2030-10-01', '2030-09-29']);
  });
});

describe('上一個／下一個工作日', () => {
  it('連假前一天：下一個工作日跳過連假與週末，上一個工作日停用（前一天本來就是工作日）', async () => {
    const wrapper = await mountNav('2030-09-11');
    expect(button(wrapper, '上一個工作日').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '下一個工作日').attributes('disabled')).toBeUndefined();

    await button(wrapper, '下一個工作日').trigger('click');
    await flushPromises();
    expect(emitted(wrapper)).toEqual(['2030-09-16']);
  });

  it('連假後第一天：上一個工作日跳回連假前', async () => {
    const wrapper = await mountNav('2030-09-16');
    await button(wrapper, '上一個工作日').trigger('click');
    await flushPromises();
    expect(emitted(wrapper)).toEqual(['2030-09-11']);
  });

  it('補班日前一天：隔天是補班的週六，下一個工作日停用', async () => {
    const wrapper = await mountNav('2030-09-27');
    expect(button(wrapper, '下一個工作日').attributes('disabled')).toBeDefined();
  });

  it('一般平日（前後都是工作日）兩顆都停用', async () => {
    const wrapper = await mountNav('2030-09-18');
    expect(button(wrapper, '上一個工作日').attributes('disabled')).toBeDefined();
    expect(button(wrapper, '下一個工作日').attributes('disabled')).toBeDefined();
  });
});

describe('放假徽章與工時合計', () => {
  it('國定假日顯示假日名稱', async () => {
    const wrapper = await mountNav('2030-09-12', { totalHours: 0, hasItems: false });
    expect(wrapper.text()).toContain('中秋節');
  });

  it('放假且沒有紀錄：只顯示放假徽章，不顯示工時合計', async () => {
    const wrapper = await mountNav('2030-09-12', { totalHours: 0, hasItems: false });
    expect(wrapper.text()).not.toContain('今日工時合計');
  });

  it('放假但有紀錄（加班）：兩個都顯示', async () => {
    const wrapper = await mountNav('2030-09-12', { totalHours: 3, hasItems: true });
    expect(wrapper.text()).toContain('中秋節');
    expect(wrapper.text()).toContain('今日工時合計：3hr');
  });

  it('補班日不顯示放假徽章', async () => {
    const wrapper = await mountNav('2030-09-28', { totalHours: 8, hasItems: true });
    expect(wrapper.find('.date-nav__holiday-badge').exists()).toBe(false);
  });

  it('合計超過 8 小時才標紅，剛好 8 不算', async () => {
    const eight = await mountNav('2030-09-18', { totalHours: 8, hasItems: true });
    expect(eight.find('.date-nav__total--over').exists()).toBe(false);
    const over = await mountNav('2030-09-18', { totalHours: 8.25, hasItems: true });
    expect(over.find('.date-nav__total--over').exists()).toBe(true);
  });

  it('讀取中（totalHours 未定）不顯示工時合計', async () => {
    const wrapper = await mountNav('2030-09-18', { hasItems: false });
    expect(wrapper.text()).not.toContain('今日工時合計');
  });
});

describe('搜尋中', () => {
  it('只留搜尋欄：日期切換、放假徽章、動作按鈕都不顯示', async () => {
    const wrapper = mount(DateNav, {
      props: { modelValue: '2030-09-12', searching: true },
      slots: { search: '<input class="search" />', actions: '<button class="add">新增</button>' },
      global: { stubs: { NDatePicker: true } },
    });
    await flushPromises();
    expect(wrapper.find('.search').exists()).toBe(true);
    expect(wrapper.find('.add').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="下一天"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('中秋節');
  });
});

describe('日／月切換', () => {
  it('點「日」「月」emit update:viewMode，選中的那一個 aria-pressed', async () => {
    const wrapper = await mountNav('2030-09-12', { viewMode: 'day' });
    const [day, month] = wrapper.findAll('.date-nav__mode-btn');
    expect(day!.attributes('aria-pressed')).toBe('true');
    expect(month!.attributes('aria-pressed')).toBe('false');
    await month!.trigger('click');
    expect(wrapper.emitted('update:viewMode')).toEqual([['month']]);
  });

  it('月份檢視：切上個月／下個月（日保留，沒有那一天就用月底），不顯示工作日按鈕、放假徽章、工時合計', async () => {
    const wrapper = await mountNav('2030-10-31', {
      viewMode: 'month',
      totalHours: 8,
      hasItems: true,
    });
    await button(wrapper, '下個月').trigger('click');
    await button(wrapper, '上個月').trigger('click');
    expect(emitted(wrapper)).toEqual(['2030-11-30', '2030-09-30']);
    expect(wrapper.find('button[aria-label="上一個工作日"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="下一天"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('今日工時合計');
  });

  it('月份檢視：非本月顯示「回到本月」，本月顯示「本月」', async () => {
    const other = await mountNav('2030-09-12', { viewMode: 'month' });
    expect(other.get('.date-nav__today').text()).toBe('回到本月');
    const current = await mountNav(todayString(), { viewMode: 'month' });
    expect(current.get('.date-nav__today').text()).toBe('本月');
  });
});
