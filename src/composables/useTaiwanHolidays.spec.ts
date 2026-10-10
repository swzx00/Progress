import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCalendar } from '@/testing/taiwan-calendar';

/**
 * 台灣國定假日：放假原因、是否為工作日（補班日要算工作日）、上一個／下一個工作日。
 * 行事曆資料換成假的（2030 中秋連假＋補班日、2031 元旦跨年），快取在模組層級，每個測試重新載入模組
 */
const fetchMock = vi.fn();

const CALENDARS: Record<string, unknown> = {
  // 2030/09/12（四）中秋節、09/13（五）調整放假，09/28（六）補班
  '2030': makeCalendar(2030, { '2030-09-12': '中秋節', '2030-09-13': '調整放假' }, ['2030-09-28']),
  '2031': makeCalendar(2031, { '2031-01-01': '中華民國開國紀念日' }),
};

const serveCalendars = (): void => {
  fetchMock.mockImplementation(async (url: string) => {
    const year = /data\/(\d{4})\.json$/.exec(url)?.[1] ?? '';
    const data = CALENDARS[year];
    return data ? { ok: true, json: async () => data } : { ok: false, json: async () => ({}) };
  });
};

const fetchedYears = (): string[] =>
  fetchMock.mock.calls.map(([url]) => /data\/(\d{4})\.json$/.exec(url as string)![1]!);

const load = async () => (await import('./useTaiwanHolidays')).useTaiwanHolidays();

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  serveCalendars();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getDayOffLabel（放假原因）', () => {
  it('國定假日回傳名稱', async () => {
    const holidays = await load();
    await holidays.ensureYearLoaded('2030');
    expect(holidays.getDayOffLabel('2030-09-12')).toBe('中秋節');
    expect(holidays.getDayOffLabel('2030-09-13')).toBe('調整放假');
  });

  it('一般週末回傳週六／週日', async () => {
    const holidays = await load();
    await holidays.ensureYearLoaded('2030');
    expect(holidays.getDayOffLabel('2030-09-07')).toBe('週六');
    expect(holidays.getDayOffLabel('2030-09-08')).toBe('週日');
  });

  it('工作日與補班日回傳 null', async () => {
    const holidays = await load();
    await holidays.ensureYearLoaded('2030');
    expect(holidays.getDayOffLabel('2030-09-11')).toBeNull();
    expect(holidays.getDayOffLabel('2030-09-28')).toBeNull();
  });

  it('資料還沒載入時先用星期猜週末，猜不到國定假日；載入後以官方資料為準', async () => {
    const holidays = await load();
    expect(holidays.getDayOffLabel('2030-09-07')).toBe('週六');
    expect(holidays.getDayOffLabel('2030-09-12')).toBeNull();
    expect(holidays.getDayOffLabel('2030-09-28')).toBe('週六');

    await holidays.ensureYearLoaded('2030');
    expect(holidays.getDayOffLabel('2030-09-12')).toBe('中秋節');
    expect(holidays.getDayOffLabel('2030-09-28')).toBeNull();
  });
});

describe('isWorkday', () => {
  it('補班的週六是工作日，國定假日的平日不是', async () => {
    const holidays = await load();
    await holidays.ensureYearLoaded('2030');
    expect(holidays.isWorkday('2030-09-28')).toBe(true);
    expect(holidays.isWorkday('2030-09-12')).toBe(false);
    expect(holidays.isWorkday('2030-09-11')).toBe(true);
    expect(holidays.isWorkday('2030-09-29')).toBe(false);
  });
});

describe('findNextWorkday（上一個／下一個工作日）', () => {
  it('跳過連假與週末', async () => {
    const holidays = await load();
    expect(await holidays.findNextWorkday('2030-09-11', 1)).toBe('2030-09-16');
    expect(await holidays.findNextWorkday('2030-09-16', -1)).toBe('2030-09-11');
  });

  it('補班的週六算工作日', async () => {
    const holidays = await load();
    expect(await holidays.findNextWorkday('2030-09-27', 1)).toBe('2030-09-28');
    expect(await holidays.findNextWorkday('2030-09-30', -1)).toBe('2030-09-28');
  });

  it('從假日出發也能找到', async () => {
    const holidays = await load();
    expect(await holidays.findNextWorkday('2030-09-14', 1)).toBe('2030-09-16');
    expect(await holidays.findNextWorkday('2030-09-14', -1)).toBe('2030-09-11');
  });

  it('跨年：會載入下一年的資料，跳過元旦', async () => {
    const holidays = await load();
    expect(await holidays.findNextWorkday('2030-12-31', 1)).toBe('2031-01-02');
    expect(fetchedYears()).toEqual(['2031']);
    expect(await holidays.findNextWorkday('2031-01-02', -1)).toBe('2030-12-31');
    expect(fetchedYears()).toEqual(['2031', '2030']);
  });

  it('跨月、跨年的日期加減不會差一天（台灣時區）', async () => {
    const holidays = await load();
    // 2030/12/27（五）往後：12/28、12/29 週末，12/30（一）上班
    expect(await holidays.findNextWorkday('2030-12-27', 1)).toBe('2030-12-30');
  });

  it('連續假日超過上限（資料異常）回傳原本的日期，不會無限迴圈', async () => {
    const allHoliday = makeCalendar(2030).map((entry) => ({ ...entry, isHoliday: true }));
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => allHoliday }));
    const holidays = await load();
    expect(await holidays.findNextWorkday('2030-06-01', 1, 10)).toBe('2030-06-01');
  });
});

describe('資料載入與快取', () => {
  it('同一年只抓一次，同時呼叫共用同一個請求', async () => {
    const holidays = await load();
    await Promise.all([
      holidays.ensureYearLoaded('2030'),
      holidays.ensureYearLoaded('2030'),
      holidays.ensureYearLoaded('2030'),
    ]);
    holidays.getDayOffLabel('2030-01-01');
    await holidays.ensureYearLoaded('2030');
    expect(fetchedYears()).toEqual(['2030']);
  });

  it('還沒有那一年的資料（404）：不顯示國定假日，週末照常算放假', async () => {
    const holidays = await load();
    await holidays.ensureYearLoaded('2032');
    expect(holidays.getDayOffLabel('2032-01-03')).toBe('週六');
    expect(holidays.isWorkday('2032-01-01')).toBe(true);
  });

  it('網路錯誤不會往外丟，視為沒有資料', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const holidays = await load();
    await expect(holidays.ensureYearLoaded('2030')).resolves.toBeUndefined();
    expect(holidays.isWorkday('2030-09-12')).toBe(true);
    expect(await holidays.findNextWorkday('2030-09-13', 1)).toBe('2030-09-16');
  });

  it('網路錯誤後下次會重新抓', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const holidays = await load();
    await holidays.ensureYearLoaded('2030');
    await holidays.ensureYearLoaded('2030');
    expect(fetchedYears()).toEqual(['2030', '2030']);
    expect(holidays.getDayOffLabel('2030-09-12')).toBe('中秋節');
  });
});
