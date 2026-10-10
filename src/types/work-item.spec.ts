import { describe, expect, it } from 'vitest';

import { makeItem } from '@/testing/fixtures';

import { STATUS_OPTIONS, getStatusKey, isLeaveItem, isOverdue } from './work-item';

describe('isOverdue', () => {
  const today = '2026-10-09';

  it('預計期限已過、完成度未滿 100 算逾期', () => {
    expect(isOverdue(makeItem({ 預計期限: '2026-10-08', 完成度: 99.75 }), today)).toBe(true);
  });

  it('預計期限是今天不算逾期', () => {
    expect(isOverdue(makeItem({ 預計期限: today }), today)).toBe(false);
  });

  it('完成度 100 不算逾期', () => {
    expect(isOverdue(makeItem({ 預計期限: '2026-10-01', 完成度: 100 }), today)).toBe(false);
  });

  it('沒填預計期限不算逾期', () => {
    expect(isOverdue(makeItem({ 預計期限: '' }), today)).toBe(false);
  });
});

describe('getStatusKey', () => {
  it('每個狀態都有英文 key', () => {
    STATUS_OPTIONS.forEach((status) => {
      expect(getStatusKey(status)).toMatch(/^[a-z]+(-[a-z]+)*$/);
    });
  });

  it('休假是 leave', () => {
    expect(getStatusKey('休假')).toBe('leave');
  });

  it('清單外的值回 undefined', () => {
    expect(getStatusKey('')).toBeUndefined();
    expect(getStatusKey('完成')).toBeUndefined();
    expect(getStatusKey('toString')).toBeUndefined();
  });
});

describe('isLeaveItem / STATUS_OPTIONS', () => {
  it('狀態是「休假」才是請假紀錄', () => {
    expect(isLeaveItem({ 狀態: '休假' })).toBe(true);
    expect(isLeaveItem({ 狀態: '待辦' })).toBe(false);
  });

  it('「休假」不在一般工作紀錄的狀態選項裡', () => {
    expect(STATUS_OPTIONS).not.toContain('休假');
  });
});
