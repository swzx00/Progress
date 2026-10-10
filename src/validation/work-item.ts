import schema from '../../shared/validation-schema.json';

import { STATUS_OPTIONS } from '@/types/work-item';

/** 表單欄位值（前端內部格式：日期是 ISO YYYY-MM-DD；數字欄位清空時是空字串） */
export interface WorkItemFormValues {
  工作日期: string;
  交辦單位: string;
  交辦人員: string;
  專案名稱: string;
  專案Repo: string[];
  工作目標: string;
  處理內容: string;
  今日工時: number | '';
  完成度: number | '';
  預計期限: string;
  狀態: string;
}

export type WorkItemFieldName = keyof WorkItemFormValues;

export type WorkItemErrors = Partial<Record<WorkItemFieldName, string>>;

interface FieldRule {
  label: string;
  kind: 'date' | 'select' | 'tags' | 'text' | 'number' | 'status' | 'leaveType';
  required: boolean;
  default?: number | string;
  maxLength?: number;
  maxItems?: number;
  forbiddenChars?: string;
  min?: number;
  max?: number;
  step?: number;
  minYear?: number;
  maxYear?: number;
}

/** 規則來源是 shared/validation-schema.json（前後端共用的唯一事實來源），這裡只負責套用 */
export const WORK_ITEM_RULES = schema.fields as Record<WorkItemFieldName, FieldRule>;

/** 請假表單的欄位規則：請假只用到這四個欄位，其餘欄位寫入固定值（LEAVE_FIXED_VALUES） */
type LeaveFieldName = '工作日期' | '工作目標' | '處理內容' | '今日工時';
export const LEAVE_RULES = schema.leave.fields as Record<LeaveFieldName, FieldRule>;

/** 假別可選值，存在「工作目標」欄位 */
export const LEAVE_TYPES: string[] = schema.leave.types;

/** 請假列固定寫入的值（後端也會強制覆蓋），不會寫回「選項清單」 */
export const LEAVE_FIXED_VALUES = schema.leave.fixed as Pick<
  WorkItemFormValues,
  '交辦單位' | '交辦人員' | '專案名稱' | '專案Repo' | '預計期限'
> & { 完成度: number };

/** 每日工時合計：超過 WARN 時 DateNav 顯示紅字，超過 MAX 時不能存（後端也會擋） */
export const DAILY_HOURS_WARN: number = schema.dailyHours.warn;
export const DAILY_HOURS_MAX: number = schema.dailyHours.max;

// 時數都是 0.25 的倍數，四捨五入到小數兩位避免浮點誤差（例如 0.30000000000000004）
const roundHours = (n: number): number => Math.round(n * 100) / 100;

/** otherHours：當天其他紀錄的工時合計；hours：這筆填的工時（Code.gs、MSW 的訊息格式相同） */
export const dailyHoursMessage = (otherHours: number, hours: number): string => {
  const exceeded = roundHours(otherHours + hours - DAILY_HOURS_MAX);
  return `當天工時合計不可超過 ${DAILY_HOURS_MAX} 小時（其他紀錄已 ${roundHours(otherHours)} 小時，已超出${exceeded}小時）`;
};

/** <input type="date"> 的 min/max 屬性值，限制日期選擇器可選的年份範圍 */
export const dateInputRange = (field: '工作日期' | '預計期限'): { min: string; max: string } => {
  const rule = WORK_ITEM_RULES[field];
  return { min: `${rule.minYear}-01-01`, max: `${rule.maxYear}-12-31` };
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * YYYY-MM-DD 是不是真的存在的日期（2/30、4/31、平年 2/29 不是）：Date.UTC 會把不存在的日期進位到下個月，
 * 比對回去對不上就是不存在。Code.gs 的 validateDateField_ 用 apiDateToUtc_ 做同樣的檢查
 */
const isExistingDate = (value: string): boolean => {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const isMultipleOf = (value: number, step: number): boolean =>
  Math.abs(value / step - Math.round(value / step)) < 1e-9;

const validateText = (rule: FieldRule, value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    if (!rule.required) return undefined;
    return rule.kind === 'select' ? `請選擇${rule.label}` : `請填寫${rule.label}`;
  }
  if (rule.maxLength !== undefined && trimmed.length > rule.maxLength) {
    return `${rule.label}不可超過 ${rule.maxLength} 字`;
  }
  return undefined;
};

const validateTags = (rule: FieldRule, values: string[]): string | undefined => {
  const tags = values.map((v) => v.trim()).filter((v) => v);
  if (tags.length === 0) return rule.required ? `請選擇${rule.label}` : undefined;
  if (rule.maxItems !== undefined && tags.length > rule.maxItems) {
    return `${rule.label} 最多 ${rule.maxItems} 個`;
  }
  if (rule.maxLength !== undefined && tags.some((tag) => tag.length > rule.maxLength!)) {
    return `每個${rule.label} 不可超過 ${rule.maxLength} 字`;
  }
  // Sheet 用逗號把多個 Repo 串成一格存，名稱本身含逗號讀回來會被拆開
  const forbidden = [...(rule.forbiddenChars ?? '')];
  if (tags.some((tag) => forbidden.some((char) => tag.includes(char)))) {
    return `${rule.label} 不可包含「${forbidden.join('')}」`;
  }
  return undefined;
};

const validateNumber = (rule: FieldRule, value: number | ''): string | undefined => {
  // 選填數字欄位清空時，送出會用預設值（0），不算錯誤
  if (value === '') return rule.required ? `請填寫${rule.label}` : undefined;
  if (Number.isNaN(value)) return `${rule.label}需為數字`;
  if (
    (rule.min !== undefined && value < rule.min) ||
    (rule.max !== undefined && value > rule.max)
  ) {
    return `${rule.label}需介於 ${rule.min}–${rule.max}`;
  }
  if (rule.step !== undefined && !isMultipleOf(value, rule.step)) {
    return rule.step === 1 ? `${rule.label}需為整數` : `${rule.label}需為 ${rule.step} 的倍數`;
  }
  return undefined;
};

const validateDate = (rule: FieldRule, value: string): string | undefined => {
  if (!value) return rule.required ? `請選擇${rule.label}` : undefined;
  if (!ISO_DATE_PATTERN.test(value) || !isExistingDate(value)) return `${rule.label}格式不正確`;
  const year = Number(value.slice(0, 4));
  if (
    (rule.minYear !== undefined && year < rule.minYear) ||
    (rule.maxYear !== undefined && year > rule.maxYear)
  ) {
    return `${rule.label}的年份需介於 ${rule.minYear}–${rule.maxYear}`;
  }
  return undefined;
};

const validateStatus = (rule: FieldRule, value: string): string | undefined => {
  if (!value) return rule.required ? `請選擇${rule.label}` : undefined;
  return (STATUS_OPTIONS as readonly string[]).includes(value) ? undefined : `請選擇${rule.label}`;
};

const validateLeaveType = (rule: FieldRule, value: string): string | undefined =>
  LEAVE_TYPES.includes(value) ? undefined : `請選擇${rule.label}`;

const validateField = (
  rule: FieldRule,
  value: WorkItemFormValues[WorkItemFieldName],
): string | undefined => {
  switch (rule.kind) {
    case 'tags':
      return validateTags(rule, value as string[]);
    case 'number':
      return validateNumber(rule, value as number | '');
    case 'date':
      return validateDate(rule, value as string);
    case 'status':
      return validateStatus(rule, value as string);
    case 'leaveType':
      return validateLeaveType(rule, value as string);
    default:
      return validateText(rule, value as string);
  }
};

/** 請假表單驗證，只檢查請假用到的四個欄位，回傳格式同 validateWorkItem */
export const validateLeave = (values: WorkItemFormValues): WorkItemErrors => {
  const errors: WorkItemErrors = {};
  (Object.keys(LEAVE_RULES) as LeaveFieldName[]).forEach((field) => {
    const message = validateField(LEAVE_RULES[field], values[field]);
    if (message) errors[field] = message;
  });
  return errors;
};

/** 回傳每個欄位的錯誤訊息，沒有錯誤的欄位不會出現在結果裡（全部通過時是空物件） */
export const validateWorkItem = (values: WorkItemFormValues): WorkItemErrors => {
  const errors: WorkItemErrors = {};
  (Object.keys(WORK_ITEM_RULES) as WorkItemFieldName[]).forEach((field) => {
    const message = validateField(WORK_ITEM_RULES[field], values[field]);
    if (message) errors[field] = message;
  });
  return errors;
};
