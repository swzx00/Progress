// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ref } from 'vue';

import { ApiError } from '@/composables/useWorkItems';
import type { WorkHoursSetting } from '@/utils/work-hours';

import WorkHoursSettingModal from './WorkHoursSettingModal.vue';

/**
 * 工時設定 Modal：驗證沒過不送出、送出的內容、清除、失敗與登入錯誤。
 * useOptions、useToast 換成假的；換算與驗證規則本身在 utils/work-hours 的單元測試
 */
const mocks = vi.hoisted(() => ({
  workHours: null as unknown as Ref<WorkHoursSetting | null>,
  loading: null as unknown as Ref<boolean>,
  error: null as unknown as Ref<string | null>,
  fetchOptions: vi.fn(),
  saveWorkHours: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/composables/useOptions', async () => {
  const { ref } = await import('vue');
  mocks.workHours = ref<WorkHoursSetting | null>(null);
  mocks.loading = ref(false);
  mocks.error = ref<string | null>(null);
  return {
    useOptions: () => ({
      workHours: mocks.workHours,
      loading: mocks.loading,
      error: mocks.error,
      fetchOptions: mocks.fetchOptions,
      saveWorkHours: mocks.saveWorkHours,
    }),
  };
});

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

const SETTING: WorkHoursSetting = {
  start: '08:30',
  end: '17:30',
  breakStart: '12:00',
  breakEnd: '13:00',
};

const mountModal = async (): Promise<VueWrapper> => {
  const wrapper = mount(WorkHoursSettingModal, { props: { idToken: 'token' } });
  await flushPromises();
  return wrapper;
};

const timeInputs = (wrapper: VueWrapper) => wrapper.findAll('input[type="time"]');

const fill = async (wrapper: VueWrapper, values: [string, string, string, string]) => {
  const inputs = timeInputs(wrapper);
  for (const [i, value] of values.entries()) {
    await inputs[i]!.setValue(value);
  }
};

const submit = async (wrapper: VueWrapper): Promise<void> => {
  await wrapper.get('form').trigger('submit');
  await flushPromises();
};

const clearButton = (wrapper: VueWrapper) =>
  wrapper.findAll('button').find((button) => button.text() === '清除設定')!;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workHours.value = null;
  mocks.loading.value = false;
  mocks.error.value = null;
});

describe('帶入與顯示', () => {
  it('打開時讀取設定，已有設定就帶入欄位並顯示每日工時', async () => {
    mocks.workHours.value = SETTING;
    const wrapper = await mountModal();
    expect(mocks.fetchOptions).toHaveBeenCalled();
    expect(timeInputs(wrapper).map((input) => (input.element as HTMLInputElement).value)).toEqual([
      '08:30',
      '17:30',
      '12:00',
      '13:00',
    ]);
    expect(wrapper.text()).toContain('每日工時：8 小時');
  });

  it('沒有設定時欄位空白，「清除設定」停用', async () => {
    const wrapper = await mountModal();
    expect(wrapper.text()).toContain('每日工時：—');
    expect(clearButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('離開時間欄位時四捨五入到 15 分鐘', async () => {
    const wrapper = await mountModal();
    const start = timeInputs(wrapper)[0]!;
    await start.setValue('08:37');
    await start.trigger('blur');
    expect((start.element as HTMLInputElement).value).toBe('08:30');
  });

  it('讀取失敗顯示訊息與「重新載入」', async () => {
    mocks.error.value = '讀取失敗';
    const wrapper = await mountModal();
    expect(wrapper.text()).toContain('讀取失敗');
    mocks.fetchOptions.mockClear();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '重新載入')!
      .trigger('click');
    expect(mocks.fetchOptions).toHaveBeenCalled();
  });
});

describe('儲存', () => {
  it('驗證沒過（不是 8 小時）：顯示錯誤，不送出', async () => {
    const wrapper = await mountModal();
    await fill(wrapper, ['08:00', '18:00', '12:00', '13:00']);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await submit(wrapper);
    expect(wrapper.get('[role="alert"]').text()).toBe('每日工時需剛好 8 小時（目前 9 小時）');
    expect(mocks.saveWorkHours).not.toHaveBeenCalled();
  });

  it('第一次儲存後錯誤即時更新，修正後消失', async () => {
    const wrapper = await mountModal();
    await fill(wrapper, ['08:00', '18:00', '12:00', '13:00']);
    await submit(wrapper);
    await timeInputs(wrapper)[1]!.setValue('17:00');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('通過：送出設定、成功 Toast、關閉', async () => {
    mocks.saveWorkHours.mockResolvedValue(undefined);
    const wrapper = await mountModal();
    await fill(wrapper, ['08:30', '17:30', '12:00', '13:00']);
    await submit(wrapper);
    expect(mocks.saveWorkHours).toHaveBeenCalledWith('token', SETTING);
    expect(mocks.showToast).toHaveBeenCalledWith('已儲存工時設定', 'success');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('沒填午休：送出的設定不帶午休欄位', async () => {
    mocks.saveWorkHours.mockResolvedValue(undefined);
    const wrapper = await mountModal();
    await fill(wrapper, ['09:00', '17:00', '', '']);
    await submit(wrapper);
    expect(mocks.saveWorkHours).toHaveBeenCalledWith('token', { start: '09:00', end: '17:00' });
  });

  it('失敗：錯誤 Toast，Modal 維持開啟', async () => {
    mocks.saveWorkHours.mockRejectedValue(new ApiError('未知的 action'));
    const wrapper = await mountModal();
    await fill(wrapper, ['08:30', '17:30', '12:00', '13:00']);
    await submit(wrapper);
    expect(mocks.showToast).toHaveBeenCalledWith('未知的 action');
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(wrapper.emitted('unauthorized')).toBeUndefined();
  });

  it('登入錯誤：emit unauthorized', async () => {
    mocks.saveWorkHours.mockRejectedValue(new ApiError('請重新登入', 'UNAUTHORIZED'));
    const wrapper = await mountModal();
    await fill(wrapper, ['08:30', '17:30', '12:00', '13:00']);
    await submit(wrapper);
    expect(wrapper.emitted('unauthorized')).toHaveLength(1);
  });

  it('送出中不能關閉', async () => {
    let resolve!: () => void;
    mocks.saveWorkHours.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    const wrapper = await mountModal();
    await fill(wrapper, ['08:30', '17:30', '12:00', '13:00']);
    await wrapper.get('form').trigger('submit');
    await wrapper.get('button[aria-label="關閉"]').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
    resolve();
    await flushPromises();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});

describe('清除設定', () => {
  it('送出 null、欄位清空、成功 Toast，Modal 維持開啟', async () => {
    mocks.workHours.value = SETTING;
    mocks.saveWorkHours.mockImplementation(async () => {
      mocks.workHours.value = null;
    });
    const wrapper = await mountModal();
    await clearButton(wrapper).trigger('click');
    await flushPromises();
    expect(mocks.saveWorkHours).toHaveBeenCalledWith('token', null);
    expect(timeInputs(wrapper).map((input) => (input.element as HTMLInputElement).value)).toEqual([
      '',
      '',
      '',
      '',
    ]);
    expect(mocks.showToast).toHaveBeenCalledWith('已清除工時設定', 'success');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('登入錯誤：emit unauthorized', async () => {
    mocks.workHours.value = SETTING;
    mocks.saveWorkHours.mockRejectedValue(new ApiError('請重新登入', 'UNAUTHORIZED'));
    const wrapper = await mountModal();
    await clearButton(wrapper).trigger('click');
    await flushPromises();
    expect(wrapper.emitted('unauthorized')).toHaveLength(1);
  });
});
