// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';

import { makeRecent } from '@/testing/fixtures';
import type { RecentItem, WorkItemOptions } from '@/types/work-item';

import WorkItemSearch from '@/components/WorkItemSearch.vue';

/**
 * 搜尋欄：推薦清單（第一項固定「搜尋全部欄位」）、鍵盤操作、送出的查詢、清除。
 * useOptions 換成假的；推薦的排序與比對規則在 utils/search-work-items 的單元測試
 */
const mocks = vi.hoisted(() => ({
  options: null as unknown as Ref<WorkItemOptions | null>,
  recentItems: null as unknown as Ref<RecentItem[]>,
  fetchOptions: vi.fn(),
}));

vi.mock('@/composables/useOptions', async () => {
  const { ref } = await import('vue');
  mocks.options = ref<WorkItemOptions | null>(null);
  mocks.recentItems = ref<RecentItem[]>([]);
  return {
    useOptions: () => ({
      options: mocks.options,
      recentItems: mocks.recentItems,
      fetchOptions: mocks.fetchOptions,
    }),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.value = {
    交辦單位: ['資訊部'],
    交辦人員: ['王小明'],
    專案名稱: ['官網改版', '新官網'],
    專案Repo: ['AAA'],
  };
  mocks.recentItems.value = [makeRecent({ 工作目標: '官網首頁切版' })];
});

/** 用 v-model 接一個 ref（跟 HomeView 一樣），輸入框改值時 keyword 同步更新 */
const keyword = ref('');

const mountSearch = (initial = ''): VueWrapper => {
  keyword.value = initial;
  const Host = defineComponent(
    () => () =>
      h(WorkItemSearch, {
        modelValue: keyword.value,
        'onUpdate:modelValue': (value: string) => (keyword.value = value),
      }),
  );
  return mount(Host, { attachTo: document.body }).findComponent(WorkItemSearch);
};

const input = (wrapper: VueWrapper) => wrapper.get('input');
const options = (wrapper: VueWrapper) => wrapper.findAll('[role="option"]');
const listVisible = (wrapper: VueWrapper): boolean =>
  (wrapper.get('[role="listbox"]').element as HTMLElement).style.display !== 'none';

const type = async (wrapper: VueWrapper, value: string): Promise<void> => {
  await input(wrapper).trigger('focus');
  await input(wrapper).setValue(value);
};

describe('推薦清單', () => {
  it('第一次聚焦才讀選項清單', async () => {
    const wrapper = mountSearch();
    expect(mocks.fetchOptions).not.toHaveBeenCalled();
    await input(wrapper).trigger('focus');
    expect(mocks.fetchOptions).toHaveBeenCalledTimes(1);
  });

  it('打字後跳出：第一項是「搜尋全部欄位」，其餘依開頭符合在前，符合的字加粗', async () => {
    const wrapper = mountSearch();
    await type(wrapper, '官網');
    expect(listVisible(wrapper)).toBe(true);
    expect(input(wrapper).attributes('aria-expanded')).toBe('true');
    expect(
      options(wrapper).map((o) => [
        o.get('.work-item-search__category').text(),
        o.get('.work-item-search__value').text(),
      ]),
    ).toEqual([
      ['全部欄位', '搜尋「官網」'],
      ['專案名稱', '官網改版'],
      ['工作目標', '官網首頁切版'],
      ['專案名稱', '新官網'],
    ]);
    expect(options(wrapper)[3]!.get('mark').text()).toBe('官網');
  });

  it('沒有輸入時不顯示，搜尋按鈕停用', async () => {
    const wrapper = mountSearch();
    await input(wrapper).trigger('focus');
    expect(listVisible(wrapper)).toBe(false);
    expect(wrapper.get('button[aria-label="搜尋"]').attributes('disabled')).toBeDefined();
  });

  it('失焦時關閉', async () => {
    const wrapper = mountSearch();
    await type(wrapper, '官網');
    await input(wrapper).trigger('blur');
    expect(listVisible(wrapper)).toBe(false);
  });
});

describe('送出搜尋', () => {
  it('Enter（沒選推薦）：搜尋全部欄位，關閉清單', async () => {
    const wrapper = mountSearch();
    await type(wrapper, '  官網 ');
    await input(wrapper).trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('search')).toEqual([[{ keyword: '官網' }]]);
    expect(listVisible(wrapper)).toBe(false);
  });

  it('點推薦：只搜那個欄位，輸入框換成推薦的值', async () => {
    const wrapper = mountSearch();
    await type(wrapper, '官網');
    await options(wrapper)[1]!.trigger('click');
    expect(wrapper.emitted('search')).toEqual([[{ keyword: '官網改版', field: '專案名稱' }]]);
    expect(keyword.value).toBe('官網改版');
  });

  it('搜尋按鈕：搜尋全部欄位', async () => {
    const wrapper = mountSearch();
    await type(wrapper, '官網');
    await wrapper.get('button[aria-label="搜尋"]').trigger('click');
    expect(wrapper.emitted('search')).toEqual([[{ keyword: '官網' }]]);
  });

  it('上下鍵移動反白，Enter 送出反白的那一項；超過最後一項回到「沒有選」', async () => {
    const wrapper = mountSearch();
    await type(wrapper, '官網');
    const key = (k: string) => input(wrapper).trigger('keydown', { key: k });
    await key('ArrowDown');
    await key('ArrowDown');
    expect(input(wrapper).attributes('aria-activedescendant')).toBe(
      options(wrapper)[1]!.attributes('id'),
    );
    expect(options(wrapper)[1]!.attributes('aria-selected')).toBe('true');
    await key('ArrowUp');
    await key('ArrowUp');
    expect(input(wrapper).attributes('aria-activedescendant')).toBeUndefined();
    await key('ArrowUp');
    expect(options(wrapper).at(-1)!.attributes('aria-selected')).toBe('true');
    await key('Enter');
    expect(wrapper.emitted('search')).toEqual([[{ keyword: '新官網', field: '專案名稱' }]]);
  });
});

describe('清除', () => {
  it('Esc：先關推薦，再按一次清空並 emit clear', async () => {
    const wrapper = mountSearch();
    await type(wrapper, '官網');
    await input(wrapper).trigger('keydown', { key: 'Escape' });
    expect(listVisible(wrapper)).toBe(false);
    expect(wrapper.emitted('clear')).toBeUndefined();
    await input(wrapper).trigger('keydown', { key: 'Escape' });
    expect(keyword.value).toBe('');
    expect(wrapper.emitted('clear')).toHaveLength(1);
  });

  it('✕ 按鈕：清空並 emit clear，空白時不顯示 ✕', async () => {
    const wrapper = mountSearch('官網');
    await wrapper.get('button[aria-label="清除搜尋"]').trigger('click');
    expect(keyword.value).toBe('');
    expect(wrapper.emitted('clear')).toHaveLength(1);
    expect(wrapper.find('button[aria-label="清除搜尋"]').exists()).toBe(false);
  });

  it('自己刪光輸入框也 emit clear', async () => {
    const wrapper = mountSearch('官網');
    await input(wrapper).setValue('');
    expect(wrapper.emitted('clear')).toHaveLength(1);
  });
});
