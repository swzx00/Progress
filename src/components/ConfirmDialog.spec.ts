// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import ConfirmDialog from './ConfirmDialog.vue';

const mountDialog = (props: Record<string, unknown> = {}) =>
  mount(ConfirmDialog, {
    props: { title: '刪除紀錄', message: '確定要刪除嗎？', confirmLabel: '刪除', ...props },
    attachTo: document.body,
  });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ConfirmDialog（按鈕配置照 Apple HIG）', () => {
  it('取消在左、動作在右', () => {
    const buttons = mountDialog().findAll('button');
    expect(buttons.map((b) => b.text())).toEqual(['取消', '刪除']);
  });

  it('danger：動作按鈕紅字，預設焦點在比較安全的「取消」', () => {
    const wrapper = mountDialog({ danger: true });
    const [cancel, confirm] = wrapper.findAll('button');
    expect(confirm!.classes()).toContain('confirm-dialog__btn--danger');
    expect(cancel!.classes()).toContain('confirm-dialog__btn--preferred');
    expect(document.activeElement).toBe(cancel!.element);
  });

  it('非 danger：焦點在動作按鈕', () => {
    const wrapper = mountDialog();
    const confirm = wrapper.findAll('button')[1]!;
    expect(confirm.classes()).toContain('confirm-dialog__btn--primary');
    expect(document.activeElement).toBe(confirm.element);
  });

  it('點按鈕、點背景各自送出事件', async () => {
    const wrapper = mountDialog();
    await wrapper.findAll('button')[1]!.trigger('click');
    await wrapper.findAll('button')[0]!.trigger('click');
    await wrapper.find('.confirm-dialog__backdrop').trigger('click');
    expect(wrapper.emitted('confirm')).toHaveLength(1);
    expect(wrapper.emitted('cancel')).toHaveLength(2);
  });

  it('處理中：按鈕停用、顯示「處理中…」', () => {
    const wrapper = mountDialog({ busy: true });
    const buttons = wrapper.findAll('button');
    expect(buttons.every((b) => b.attributes('disabled') !== undefined)).toBe(true);
    expect(buttons[1]!.text()).toBe('處理中…');
  });
});
