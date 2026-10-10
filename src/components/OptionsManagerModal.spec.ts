// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';

import { ApiError } from '@/composables/useWorkItems';
import type { WorkItemOptions } from '@/types/work-item';

import OptionsManagerModal from './OptionsManagerModal.vue';

/**
 * 選項清單管理：兩層導覽、新增／重新命名／刪除送出的內容、失敗時 Modal 維持原狀、登入錯誤。
 * useOptions、useToast 換成假的
 */
const mocks = vi.hoisted(() => ({
  options: null as unknown as Ref<WorkItemOptions | null>,
  loading: null as unknown as Ref<boolean>,
  error: null as unknown as Ref<string | null>,
  fetchOptions: vi.fn(),
  addOption: vi.fn(),
  renameOption: vi.fn(),
  deleteOption: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/composables/useOptions', async () => {
  const { ref } = await import('vue');
  mocks.options = ref<WorkItemOptions | null>(null);
  mocks.loading = ref(false);
  mocks.error = ref<string | null>(null);
  return {
    useOptions: () => ({
      options: mocks.options,
      loading: mocks.loading,
      error: mocks.error,
      fetchOptions: mocks.fetchOptions,
      addOption: mocks.addOption,
      renameOption: mocks.renameOption,
      deleteOption: mocks.deleteOption,
    }),
  };
});

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

const OPTIONS: WorkItemOptions = {
  交辦單位: ['資訊部', '業務部'],
  交辦人員: ['王小明'],
  專案名稱: [],
  專案Repo: ['web'],
};

const mountModal = async (): Promise<VueWrapper> => {
  const wrapper = mount(OptionsManagerModal, { props: { idToken: 'token' } });
  await flushPromises();
  return wrapper;
};

const buttonByText = (wrapper: VueWrapper, text: string, index = 0) =>
  wrapper.findAll('button').filter((button) => button.text().includes(text))[index]!;

const openCategory = async (wrapper: VueWrapper, category: string): Promise<void> => {
  await buttonByText(wrapper, category).trigger('click');
  await flushPromises();
};

const values = (wrapper: VueWrapper): string[] =>
  wrapper.findAll('.options-manager__item-value').map((item) => item.text());

beforeEach(() => {
  vi.clearAllMocks();
  mocks.options.value = structuredClone(OPTIONS);
  mocks.loading.value = false;
  mocks.error.value = null;
});

describe('導覽', () => {
  it('第一層列出四個母項與筆數', async () => {
    const wrapper = await mountModal();
    expect(mocks.fetchOptions).toHaveBeenCalled();
    const categories = wrapper.findAll('.options-manager__category-btn').map((b) => b.text());
    expect(categories).toEqual([
      expect.stringContaining('交辦單位2 筆'),
      expect.stringContaining('交辦人員1 筆'),
      expect.stringContaining('專案名稱0 筆'),
      expect.stringContaining('專案Repo1 筆'),
    ]);
  });

  it('選了母項只顯示那一類的值，返回回到第一層', async () => {
    const wrapper = await mountModal();
    await openCategory(wrapper, '交辦單位');
    expect(values(wrapper)).toEqual(['資訊部', '業務部']);
    await buttonByText(wrapper, '返回').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.options-manager__category-btn')).toHaveLength(4);
  });

  it('沒有值時顯示「尚無資料」', async () => {
    const wrapper = await mountModal();
    await openCategory(wrapper, '專案名稱');
    expect(wrapper.text()).toContain('尚無資料');
  });

  it('讀取失敗在 Modal 內顯示訊息', async () => {
    mocks.options.value = null;
    mocks.error.value = '找不到選項清單分頁';
    const wrapper = await mountModal();
    expect(wrapper.text()).toContain('找不到選項清單分頁');
  });
});

describe('新增', () => {
  it('去前後空白後送出，成功清空輸入框', async () => {
    mocks.addOption.mockResolvedValue(undefined);
    const wrapper = await mountModal();
    await openCategory(wrapper, '交辦單位');
    const input = wrapper.get('.options-manager__add-input');
    await input.setValue('  法務部 ');
    await buttonByText(wrapper, '新增').trigger('click');
    await flushPromises();
    expect(mocks.addOption).toHaveBeenCalledWith('token', '交辦單位', '法務部');
    expect((input.element as HTMLInputElement).value).toBe('');
  });

  it('空白不送出', async () => {
    const wrapper = await mountModal();
    await openCategory(wrapper, '交辦單位');
    await wrapper.get('.options-manager__add-input').setValue('   ');
    await buttonByText(wrapper, '新增').trigger('click');
    expect(mocks.addOption).not.toHaveBeenCalled();
  });

  it('失敗：Toast，輸入的值保留', async () => {
    mocks.addOption.mockRejectedValue(new ApiError('新增的值不可為空'));
    const wrapper = await mountModal();
    await openCategory(wrapper, '交辦單位');
    const input = wrapper.get('.options-manager__add-input');
    await input.setValue('法務部');
    await input.trigger('keyup.enter');
    await flushPromises();
    expect(mocks.showToast).toHaveBeenCalledWith('新增的值不可為空');
    expect((input.element as HTMLInputElement).value).toBe('法務部');
    expect(wrapper.emitted('unauthorized')).toBeUndefined();
  });
});

describe('重新命名', () => {
  const startRename = async (wrapper: VueWrapper, newValue: string) => {
    await openCategory(wrapper, '交辦單位');
    await buttonByText(wrapper, '重新命名').trigger('click');
    const input = wrapper.get('.options-manager__edit-input');
    expect((input.element as HTMLInputElement).value).toBe('資訊部');
    await input.setValue(newValue);
    return input;
  };

  it('送出舊值與新值（去前後空白）', async () => {
    mocks.renameOption.mockResolvedValue(undefined);
    const wrapper = await mountModal();
    const input = await startRename(wrapper, ' 資訊處 ');
    await input.trigger('keyup.enter');
    await flushPromises();
    expect(mocks.renameOption).toHaveBeenCalledWith('token', '交辦單位', '資訊部', '資訊處');
    expect(wrapper.find('.options-manager__edit-input').exists()).toBe(false);
  });

  it('沒改或改成空白：直接結束編輯，不送出', async () => {
    const wrapper = await mountModal();
    const input = await startRename(wrapper, '資訊部');
    await input.trigger('keyup.enter');
    expect(mocks.renameOption).not.toHaveBeenCalled();
    expect(wrapper.find('.options-manager__edit-input').exists()).toBe(false);

    const again = await (async () => {
      await buttonByText(wrapper, '重新命名').trigger('click');
      const el = wrapper.get('.options-manager__edit-input');
      await el.setValue('  ');
      return el;
    })();
    await again.trigger('keyup.enter');
    expect(mocks.renameOption).not.toHaveBeenCalled();
  });

  it('Esc 取消', async () => {
    const wrapper = await mountModal();
    const input = await startRename(wrapper, '資訊處');
    await input.trigger('keyup.esc');
    expect(wrapper.find('.options-manager__edit-input').exists()).toBe(false);
    expect(mocks.renameOption).not.toHaveBeenCalled();
  });

  it('失敗：Toast，維持編輯狀態', async () => {
    mocks.renameOption.mockRejectedValue(new ApiError('這個名稱已經存在'));
    const wrapper = await mountModal();
    const input = await startRename(wrapper, '業務部');
    await input.trigger('keyup.enter');
    await flushPromises();
    expect(mocks.showToast).toHaveBeenCalledWith('這個名稱已經存在');
    expect(wrapper.find('.options-manager__edit-input').exists()).toBe(true);
  });
});

describe('刪除', () => {
  const openDelete = async (wrapper: VueWrapper): Promise<void> => {
    await openCategory(wrapper, '交辦單位');
    await buttonByText(wrapper, '刪除', 1).trigger('click');
    await flushPromises();
  };

  it('先跳確認，確認後送出', async () => {
    mocks.deleteOption.mockResolvedValue(undefined);
    const wrapper = await mountModal();
    await openDelete(wrapper);
    const dialog = wrapper.findComponent({ name: 'ConfirmDialog' });
    expect(dialog.props('message')).toContain('「業務部」');
    expect(mocks.deleteOption).not.toHaveBeenCalled();
    dialog.vm.$emit('confirm');
    await flushPromises();
    expect(mocks.deleteOption).toHaveBeenCalledWith('token', '交辦單位', '業務部');
    expect(wrapper.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false);
  });

  it('取消不送出', async () => {
    const wrapper = await mountModal();
    await openDelete(wrapper);
    wrapper.findComponent({ name: 'ConfirmDialog' }).vm.$emit('cancel');
    await flushPromises();
    expect(mocks.deleteOption).not.toHaveBeenCalled();
    expect(wrapper.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false);
  });

  it('失敗：Toast，確認對話框維持開啟', async () => {
    mocks.deleteOption.mockRejectedValue(new ApiError('找不到這個值'));
    const wrapper = await mountModal();
    await openDelete(wrapper);
    wrapper.findComponent({ name: 'ConfirmDialog' }).vm.$emit('confirm');
    await flushPromises();
    expect(mocks.showToast).toHaveBeenCalledWith('找不到這個值');
    expect(wrapper.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(true);
  });

  it('登入錯誤：關閉確認對話框並 emit unauthorized', async () => {
    mocks.deleteOption.mockRejectedValue(new ApiError('請重新登入', 'UNAUTHORIZED'));
    const wrapper = await mountModal();
    await openDelete(wrapper);
    wrapper.findComponent({ name: 'ConfirmDialog' }).vm.$emit('confirm');
    await flushPromises();
    expect(wrapper.emitted('unauthorized')).toHaveLength(1);
    expect(wrapper.findComponent({ name: 'ConfirmDialog' }).exists()).toBe(false);
  });
});
