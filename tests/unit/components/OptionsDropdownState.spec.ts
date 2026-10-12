// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import OptionsDropdownState from '@/components/OptionsDropdownState.vue';

/** 下拉選單選項還沒準備好時的畫面：載入中、載入失敗＋重新載入 */
describe('OptionsDropdownState', () => {
  it('載入中：轉圈＋「選項載入中」，沒有重新載入按鈕', () => {
    const wrapper = mount(OptionsDropdownState, { props: { loading: true } });
    expect(wrapper.get('[role="status"]').text()).toContain('選項載入中');
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('載入失敗');
  });

  it('載入失敗：顯示訊息，點「重新載入」emit retry', async () => {
    const wrapper = mount(OptionsDropdownState, { props: { loading: false } });
    expect(wrapper.get('.options-dropdown-state__message').text()).toBe('選項清單載入失敗');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
  });

  it('按下按鈕時不搶走焦點（mousedown 取消預設行為），下拉選單才不會先關掉', async () => {
    const wrapper = mount(OptionsDropdownState, { props: { loading: false } });
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    wrapper.get('button').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('重新載入後變回載入中', async () => {
    const wrapper = mount(OptionsDropdownState, { props: { loading: false } });
    await wrapper.setProps({ loading: true });
    expect(wrapper.find('button').exists()).toBe(false);
    expect(wrapper.text()).toContain('選項載入中');
  });
});
