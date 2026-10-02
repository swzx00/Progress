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
  kind: 'date' | 'select' | 'tags' | 'text' | 'number' | 'status';
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

/** <input type="date"> 的 min/max 屬性值，限制日期選擇器可選的年份範圍 */
export const dateInputRange = (field: '工作日期' | '預計期限'): { min: string; max: string } => {
  const rule = WORK_ITEM_RULES[field];
  return { min: `${rule.minYear}-01-01`, max: `${rule.maxYear}-12-31` };
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
  if (!ISO_DATE_PATTERN.test(value)) return `${rule.label}格式不正確`;
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
    default:
      return validateText(rule, value as string);
  }
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
