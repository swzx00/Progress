import { beforeEach, expect, it, vi } from 'vitest';

/**
 * 自動填入的 API：都是要登入的 doPost（設定不放進公開的 doGet），日期送出前轉成 YYYY/MM/DD，
 * 讀到、存好的設定寫進模組層級快取
 */
const mocks = vi.hoisted(() => ({ postApi: vi.fn() }));

vi.mock('@/composables/useWorkItems', () => ({
  postApi: mocks.postApi,
  toApiDate: (date: string) => date.replaceAll('-', '/'),
}));

const SETTING = { enabled: true, url: 'https://docs.google.com/spreadsheets/d/x', name: '林家丞' };

beforeEach(() => {
  vi.resetModules();
  mocks.postApi.mockReset();
});

const load = async () => (await import('@/composables/useAutoFill')).useAutoFill();

it('fetchAutoFillSetting：doPost getAutoFillSetting，寫進快取', async () => {
  mocks.postApi.mockResolvedValue({ autoFill: SETTING });
  const { setting, fetchAutoFillSetting } = await load();
  expect(setting.value).toBeNull();
  await fetchAutoFillSetting('token');
  expect(mocks.postApi).toHaveBeenCalledWith('token', { action: 'getAutoFillSetting' });
  expect(setting.value).toEqual(SETTING);
});

it('saveAutoFillSetting：網址、姓名去頭尾空白後送出，回應寫進快取', async () => {
  mocks.postApi.mockResolvedValue({ autoFill: SETTING });
  const { setting, saveAutoFillSetting } = await load();
  await saveAutoFillSetting('token', { ...SETTING, url: ` ${SETTING.url} `, name: ' 林家丞 ' });
  expect(mocks.postApi).toHaveBeenCalledWith('token', {
    action: 'saveAutoFillSetting',
    autoFill: SETTING,
  });
  expect(setting.value).toEqual(SETTING);
});

it('fillAutoFill：日期轉成 YYYY/MM/DD，回傳後端的 status', async () => {
  mocks.postApi.mockResolvedValue({ status: 'unchanged' });
  const { fillAutoFill } = await load();
  expect(await fillAutoFill('token', '2026-10-13', '內容')).toBe('unchanged');
  expect(mocks.postApi).toHaveBeenCalledWith('token', {
    action: 'autoFillNow',
    date: '2026/10/13',
    text: '內容',
  });
});

it('失敗時把 postApi 的錯誤丟給呼叫端', async () => {
  mocks.postApi.mockRejectedValue(new Error('自動填入沒有啟用'));
  const { fillAutoFill } = await load();
  await expect(fillAutoFill('token', '2026-10-13', '內容')).rejects.toThrow('自動填入沒有啟用');
});
