import schema from '../../shared/validation-schema.json';

/**
 * 工時設定（「工具 → 工時設定」，存在「選項清單」分頁的「工時設定」欄），時間都是 HH:mm。
 * 午休選填，沒填就不扣。工作紀錄本身只存「今日工時」（小時），時段只是表單上的換算工具，不存檔
 */
export interface WorkHoursSetting {
  /** 上班時間 */
  start: string;
  /** 下班時間 */
  end: string;
  /** 午休開始（選填） */
  breakStart?: string;
  /** 午休結束（選填） */
  breakEnd?: string;
}

/** 時段（HH:mm） */
export interface TimeRange {
  start: string;
  end: string;
}

/**
 * 每日工時標準：下班 − 上班 − 午休 必須剛好等於這個數字才能存（Code.gs 的 WORK_HOURS_DAILY_STANDARD 手動同步）
 */
export const WORK_HOURS_DAILY_STANDARD: number = schema.workHours.dailyStandard;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;
const QUARTER_MINUTES = 15;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** HH:mm 轉成從 00:00 起算的分鐘數，空白或格式不對回 null */
export const parseTime = (time: string | undefined): number | null => {
  const match = TIME_PATTERN.exec(time ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const formatTime = (minutes: number): string =>
  `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

// 時數都是 0.25 的倍數，四捨五入到小數兩位避免浮點誤差
const toHours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

interface MinuteRange {
  start: number;
  end: number;
}

/** 午休（分鐘），沒填、只填一邊或格式不對都當作沒有午休 */
const breakRange = (setting: WorkHoursSetting): MinuteRange | null => {
  const start = parseTime(setting.breakStart);
  const end = parseTime(setting.breakEnd);
  return start !== null && end !== null && start < end ? { start, end } : null;
};

/** 時間四捨五入到最近的 15 分鐘（離開時間欄位時用）；空白或格式不對原樣回傳，最晚到 23:45 */
export const roundToQuarter = (time: string): string => {
  const minutes = parseTime(time);
  if (minutes === null) return time;
  const rounded = Math.round(minutes / QUARTER_MINUTES) * QUARTER_MINUTES;
  return formatTime(Math.min(rounded, MINUTES_PER_DAY - QUARTER_MINUTES));
};

/**
 * 時段 → 小時。結束早於或等於開始（含跨午夜）、格式不對回 null。
 * 午休扣除：只有開始早於午休開始、而且結束晚於午休結束（兩端都在午休外、跨過整段午休）才扣掉午休長度；
 * 有一端落在午休內（含剛好等於午休開始或結束）整段照算不扣。上班時間外的時段照算
 */
export const rangeToHours = (
  start: string,
  end: string,
  setting: WorkHoursSetting,
): number | null => {
  const from = parseTime(start);
  const to = parseTime(end);
  if (from === null || to === null || to <= from) return null;
  const lunch = breakRange(setting);
  const deduct = lunch && from < lunch.start && to > lunch.end ? lunch.end - lunch.start : 0;
  return toHours(to - from - deduct);
};

/** 從 from 起往後累計 minutes 分鐘工時，跨過午休就跳過；剛好累計到午休開始時停在午休開始 */
const advance = (from: number, minutes: number, lunch: MinuteRange | null): number => {
  const to = from + minutes;
  return lunch && from < lunch.start && to > lunch.start ? to + (lunch.end - lunch.start) : to;
};

/**
 * 小時 → 時段：開始時間＝上班時間往後累計 startOffsetHours 小時（遇到午休跳過，開始剛好落在午休開始就移到午休結束），
 * 結束時間＝開始時間往後累計 hours 小時（同樣跳過午休）。超過下班時間就直接往後延。
 * 工時是 0、結束超過 24:00（時間欄位顯示不了）回 null，表單不顯示時段。
 * 反推出的時段用 rangeToHours 換算回來會等於原本的小時
 */
export const hoursToRange = (
  startOffsetHours: number,
  hours: number,
  setting: WorkHoursSetting,
): TimeRange | null => {
  const workStart = parseTime(setting.start);
  if (workStart === null || !(hours > 0) || !(startOffsetHours >= 0)) return null;
  const lunch = breakRange(setting);
  let start = advance(workStart, Math.round(startOffsetHours * 60), lunch);
  if (lunch && start >= lunch.start && start < lunch.end) start = lunch.end;
  const end = advance(start, Math.round(hours * 60), lunch);
  if (end >= MINUTES_PER_DAY) return null;
  return { start: formatTime(start), end: formatTime(end) };
};

/** 設定的每日工時（下班 − 上班 − 午休），上下班沒填或順序不對回 null */
export const workHoursTotal = (setting: WorkHoursSetting): number | null => {
  const start = parseTime(setting.start);
  const end = parseTime(setting.end);
  if (start === null || end === null || end <= start) return null;
  const lunch = breakRange(setting);
  return toHours(end - start - (lunch ? lunch.end - lunch.start : 0));
};

/**
 * 工時設定驗證，回傳第一個錯誤訊息，全部通過回 null（Code.gs 的 validateWorkHours_ 同一套規則與訊息）：
 * 上班、下班必填；午休選填，要填就開始結束都填；上班 < 午休開始 < 午休結束 < 下班；合計剛好 WORK_HOURS_DAILY_STANDARD 小時
 */
export const validateWorkHoursSetting = (setting: WorkHoursSetting): string | null => {
  if (!setting.start) return '請填寫上班時間';
  if (!setting.end) return '請填寫下班時間';
  const start = parseTime(setting.start);
  const end = parseTime(setting.end);
  if (start === null) return '上班時間格式不正確';
  if (end === null) return '下班時間格式不正確';

  if (!!setting.breakStart !== !!setting.breakEnd) return '午休時間需填寫開始與結束';
  if (setting.breakStart) {
    const breakStart = parseTime(setting.breakStart);
    const breakEnd = parseTime(setting.breakEnd);
    if (breakStart === null || breakEnd === null) return '午休時間格式不正確';
    if (!(start < breakStart && breakStart < breakEnd && breakEnd < end)) {
      return '時間順序需為：上班時間 → 午休開始 → 午休結束 → 下班時間';
    }
  } else if (end <= start) {
    return '下班時間需晚於上班時間';
  }

  const total = workHoursTotal(setting);
  if (total !== WORK_HOURS_DAILY_STANDARD) {
    return `每日工時需剛好 ${WORK_HOURS_DAILY_STANDARD} 小時（目前 ${total} 小時）`;
  }
  return null;
};
