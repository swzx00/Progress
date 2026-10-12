// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';

import { useToast } from '@/composables/useToast';

import AppToast from '@/components/AppToast.vue';

/** 畫面上唯一的 Toast：錯誤用 alert、成功用 status，可以手動關閉 */
const { showToast, hideToast } = useToast();

// Vue Test Utils 預設把 Transition 換成直接切換，不用等動畫
const mountToast = () => mount(AppToast);

afterEach(() => {
  hideToast();
});

describe('AppToast', () => {
  it('沒有訊息時只有 aria-live 區域（一直存在，訊息出現時螢幕閱讀器才會唸）', () => {
    const wrapper = mountToast();
    expect(wrapper.get('.app-toast').attributes('aria-live')).toBe('assertive');
    expect(wrapper.find('.app-toast__panel').exists()).toBe(false);
  });

  it('錯誤：role="alert"、⚠ 圖示、紅色樣式', async () => {
    const wrapper = mountToast();
    showToast('儲存失敗，請再試一次');
    await nextTick();
    const panel = wrapper.get('[role="alert"]');
    expect(panel.get('.app-toast__message').text()).toBe('儲存失敗，請再試一次');
    expect(panel.get('.app-toast__icon').text()).toBe('⚠');
    expect(panel.classes()).not.toContain('app-toast__panel--success');
  });

  it('成功：role="status"、✓ 圖示、綠色樣式', async () => {
    const wrapper = mountToast();
    showToast('已複製到 10/08', 'success');
    await nextTick();
    const panel = wrapper.get('[role="status"]');
    expect(panel.get('.app-toast__icon').text()).toBe('✓');
    expect(panel.classes()).toContain('app-toast__panel--success');
  });

  it('按「關閉」就消失', async () => {
    const wrapper = mountToast();
    showToast('儲存失敗');
    await nextTick();
    await wrapper.get('button[aria-label="關閉"]').trigger('click');
    expect(wrapper.find('.app-toast__panel').exists()).toBe(false);
  });

  it('新訊息取代舊訊息，畫面上只有一則', async () => {
    const wrapper = mountToast();
    showToast('第一則');
    await nextTick();
    showToast('第二則');
    await nextTick();
    expect(wrapper.findAll('.app-toast__panel').map((p) => p.text())).toEqual([
      expect.stringContaining('第二則'),
    ]);
  });
});
