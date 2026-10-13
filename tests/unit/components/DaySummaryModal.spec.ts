// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { makeItem } from '@/testing/fixtures';
import type { WorkItem } from '@/types/work-item';
import type { AutoFillSetting } from '@/utils/auto-fill';
import { buildDaySummary } from '@/utils/day-summary';
import { ApiError } from '@/composables/useWorkItems';

import DaySummaryModal from '@/components/DaySummaryModal.vue';

/**
 * 本日總結：文字照 buildDaySummary 產生（規則在 utils/day-summary 的測試）、可以手動改、複製、
 * 沒有紀錄時的空狀態、關閉；下方自動填入設定（存在後端）與「填入」按鈕。
 * 剪貼簿、Toast、自動填入的 API 換成假的；withLoginRetry 直接用原本的 token 執行
 */
const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  writeText: vi.fn(),
  fetchAutoFillSetting: vi.fn(),
  saveAutoFillSetting: vi.fn(),
  fillAutoFill: vi.fn(),
}));

const autoFillSetting = ref<AutoFillSetting | null>(null);

vi.mock('@/composables/useToast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('@/composables/useGoogleAuth', () => ({
  useGoogleAuth: () => ({
    withLoginRetry: <T>(token: string, run: (token: string) => Promise<T>) => run(token),
  }),
}));
vi.mock('@/composables/useAutoFill', () => ({
  useAutoFill: () => ({
    setting: autoFillSetting,
    fetchAutoFillSetting: mocks.fetchAutoFillSetting,
    saveAutoFillSetting: mocks.saveAutoFillSetting,
    fillAutoFill: mocks.fillAutoFill,
  }),
}));

const SAVED: AutoFillSetting = {
  enabled: true,
  url: 'https://docs.google.com/spreadsheets/d/abcdefghijklmnopqrstuvwxyz/edit',
  name: '林家丞',
};

beforeEach(() => {
  vi.clearAllMocks();
  autoFillSetting.value = { enabled: false, url: '', name: '' };
  mocks.fetchAutoFillSetting.mockImplementation(() => {
    autoFillSetting.value = { ...SAVED };
    return Promise.resolve();
  });
  mocks.saveAutoFillSetting.mockImplementation((_token: string, value: AutoFillSetting) => {
    autoFillSetting.value = { ...value };
    return Promise.resolve();
  });
  mocks.fillAutoFill.mockResolvedValue('written');
  mocks.writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mocks.writeText },
    configurable: true,
  });
});

const ITEMS: WorkItem[] = [
  makeItem({ id: 'a', 項次: 1, 工作目標: '首頁切版', 處理內容: '完成 RWD', 今日工時: 4 }),
  makeItem({ id: 'b', 項次: 2, 工作目標: '登入流程', 完成度: 100, 今日工時: 4 }),
];

const mountModal = (items: WorkItem[] = ITEMS): VueWrapper =>
  mount(DaySummaryModal, { props: { date: '2026-10-09', items, idToken: 'token' } });

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

describe('自動填入設定', () => {
  const urlInput = (wrapper: VueWrapper) => wrapper.get<HTMLInputElement>('input[type="url"]');
  const nameInput = (wrapper: VueWrapper) =>
    wrapper.get<HTMLInputElement>('.day-summary__form input[type="text"]');
  const toggle = (wrapper: VueWrapper) => wrapper.get<HTMLInputElement>('input[type="checkbox"]');
  const saveBtn = (wrapper: VueWrapper) => wrapper.get<HTMLButtonElement>('button[type="submit"]');

  it('還沒讀過：開啟時從後端讀，讀到後填進欄位', async () => {
    autoFillSetting.value = null;
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('設定載入中');
    await flushPromises();
    expect(mocks.fetchAutoFillSetting).toHaveBeenCalledWith('token');
    expect(toggle(wrapper).element.checked).toBe(true);
    expect(urlInput(wrapper).element.value).toBe(SAVED.url);
    expect(nameInput(wrapper).element.value).toBe(SAVED.name);
  });

  it('已經讀過：直接用快取，不再讀', () => {
    mountModal();
    expect(mocks.fetchAutoFillSetting).not.toHaveBeenCalled();
  });

  it('讀取失敗：顯示錯誤與「重新載入」', async () => {
    autoFillSetting.value = null;
    mocks.fetchAutoFillSetting.mockRejectedValueOnce(new Error('連線失敗'));
    const wrapper = mountModal();
    await flushPromises();
    expect(wrapper.text()).toContain('連線失敗');
    await wrapper.get('.day-summary__state--error button').trigger('click');
    await flushPromises();
    expect(urlInput(wrapper).element.value).toBe(SAVED.url);
  });

  it('沒啟用：網址、姓名 disabled；打開開關才能編輯', async () => {
    const wrapper = mountModal();
    expect(urlInput(wrapper).element.disabled).toBe(true);
    expect(nameInput(wrapper).element.disabled).toBe(true);
    await toggle(wrapper).setValue(true);
    expect(urlInput(wrapper).element.disabled).toBe(false);
    expect(nameInput(wrapper).element.disabled).toBe(false);
  });

  it('沒有修改時「儲存」disabled', async () => {
    const wrapper = mountModal();
    expect(saveBtn(wrapper).element.disabled).toBe(true);
    await toggle(wrapper).setValue(true);
    expect(saveBtn(wrapper).element.disabled).toBe(false);
  });

  it('啟用但沒填網址：顯示驗證錯誤，不送出', async () => {
    const wrapper = mountModal();
    await toggle(wrapper).setValue(true);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toBe('請填寫試算表網址');
    expect(mocks.saveAutoFillSetting).not.toHaveBeenCalled();
  });

  it('儲存：送出設定，成功 Toast', async () => {
    const wrapper = mountModal();
    await toggle(wrapper).setValue(true);
    await urlInput(wrapper).setValue(SAVED.url);
    await nameInput(wrapper).setValue(SAVED.name);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.saveAutoFillSetting).toHaveBeenCalledWith('token', SAVED);
    expect(mocks.showToast).toHaveBeenCalledWith('已儲存自動填入設定', 'success');
    expect(saveBtn(wrapper).element.disabled).toBe(true);
  });

  it('儲存失敗（例如找不到姓名）：錯誤 Toast，欄位保留', async () => {
    mocks.saveAutoFillSetting.mockRejectedValueOnce(new ApiError('在試算表裡找不到「林家丞」'));
    const wrapper = mountModal();
    await toggle(wrapper).setValue(true);
    await urlInput(wrapper).setValue(SAVED.url);
    await nameInput(wrapper).setValue(SAVED.name);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(mocks.showToast).toHaveBeenCalledWith('在試算表裡找不到「林家丞」');
    expect(nameInput(wrapper).element.value).toBe(SAVED.name);
    expect(wrapper.emitted('unauthorized')).toBeUndefined();
  });

  it('登入錯誤：emit unauthorized', async () => {
    mocks.saveAutoFillSetting.mockRejectedValueOnce(new ApiError('未登入或無權限', 'UNAUTHORIZED'));
    const wrapper = mountModal();
    await toggle(wrapper).setValue(false);
    await toggle(wrapper).setValue(true);
    await urlInput(wrapper).setValue(SAVED.url);
    await nameInput(wrapper).setValue(SAVED.name);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.emitted('unauthorized')).toHaveLength(1);
  });

  it('沒有紀錄時照樣可以設定', () => {
    const wrapper = mountModal([]);
    expect(wrapper.find('form').exists()).toBe(true);
  });
});

describe('填入', () => {
  const fillBtn = (wrapper: VueWrapper) => wrapper.get<HTMLButtonElement>('.day-summary__fill-btn');

  it('後端的設定沒啟用：disabled（畫面上打開開關但還沒儲存也一樣）', async () => {
    const wrapper = mountModal();
    expect(fillBtn(wrapper).element.disabled).toBe(true);
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(fillBtn(wrapper).element.disabled).toBe(true);
  });

  describe('已啟用', () => {
    beforeEach(() => {
      autoFillSetting.value = { ...SAVED };
    });

    it('填入 Textarea 目前的內容到那一天，成功 Toast', async () => {
      const wrapper = mountModal();
      expect(fillBtn(wrapper).element.disabled).toBe(false);
      await textarea(wrapper).setValue('改過的總結');
      await fillBtn(wrapper).trigger('click');
      await flushPromises();
      expect(mocks.fillAutoFill).toHaveBeenCalledWith('token', '2026-10-09', '改過的總結');
      expect(mocks.showToast).toHaveBeenCalledWith('已填入對方的試算表', 'success');
    });

    it('對方已經是一樣的內容：提示', async () => {
      mocks.fillAutoFill.mockResolvedValueOnce('unchanged');
      const wrapper = mountModal();
      await fillBtn(wrapper).trigger('click');
      await flushPromises();
      expect(mocks.showToast).toHaveBeenCalledWith('對方的試算表已經是一樣的內容', 'success');
    });

    it('格子已經有內容等錯誤：錯誤 Toast', async () => {
      mocks.fillAutoFill.mockRejectedValueOnce(new ApiError('對方試算表的格子已經有內容'));
      const wrapper = mountModal();
      await fillBtn(wrapper).trigger('click');
      await flushPromises();
      expect(mocks.showToast).toHaveBeenCalledWith('對方試算表的格子已經有內容');
    });

    it('Textarea 清空：disabled', async () => {
      const wrapper = mountModal();
      await textarea(wrapper).setValue('  ');
      expect(fillBtn(wrapper).element.disabled).toBe(true);
    });

    describe('這天工時合計（含請假）未滿 8 小時：先跳確認', () => {
      const SHORT: WorkItem[] = [
        makeItem({ id: 'a', 項次: 1, 工作目標: '首頁切版', 今日工時: 3 }),
        makeItem({ id: 'b', 項次: 2, 狀態: '休假', 工作目標: '特休', 今日工時: 2.5 }),
      ];
      const dialog = (wrapper: VueWrapper) => wrapper.find('[role="alertdialog"]');

      it('顯示工時合計，取消就不填', async () => {
        const wrapper = mountModal(SHORT);
        await fillBtn(wrapper).trigger('click');
        expect(dialog(wrapper).text()).toContain('工時未滿 8 小時');
        expect(dialog(wrapper).text()).toContain('這天的工時合計 5.5 小時');
        expect(mocks.fillAutoFill).not.toHaveBeenCalled();
        await dialog(wrapper).get('button:first-child').trigger('click');
        expect(dialog(wrapper).exists()).toBe(false);
        expect(mocks.fillAutoFill).not.toHaveBeenCalled();
      });

      it('確定後才填入', async () => {
        const wrapper = mountModal(SHORT);
        await fillBtn(wrapper).trigger('click');
        await dialog(wrapper).get('button:last-child').trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(mocks.fillAutoFill).toHaveBeenCalledWith(
          'token',
          '2026-10-09',
          buildDaySummary(SHORT),
        );
      });

      it('剛好 8 小時（含請假）：不用確認', async () => {
        const wrapper = mountModal([
          makeItem({ id: 'a', 項次: 1, 工作目標: '首頁切版', 今日工時: 6 }),
          makeItem({ id: 'b', 項次: 2, 狀態: '休假', 工作目標: '特休', 今日工時: 2 }),
        ]);
        await fillBtn(wrapper).trigger('click');
        await flushPromises();
        expect(dialog(wrapper).exists()).toBe(false);
        expect(mocks.fillAutoFill).toHaveBeenCalled();
      });
    });

    it('填入中：按鈕 disabled、顯示「填入中」', async () => {
      let resolve: (value: string) => void = () => undefined;
      mocks.fillAutoFill.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      const wrapper = mountModal();
      await fillBtn(wrapper).trigger('click');
      expect(fillBtn(wrapper).text()).toBe('填入中');
      expect(fillBtn(wrapper).element.disabled).toBe(true);
      resolve('written');
      await flushPromises();
      expect(fillBtn(wrapper).text()).toBe('填入');
    });
  });
});
