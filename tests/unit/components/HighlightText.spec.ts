// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { splitHighlight } from '@/utils/search-work-items';

import HighlightText from '@/components/HighlightText.vue';

describe('HighlightText', () => {
  it('符合的片段包在 mark 裡', () => {
    const wrapper = mount(HighlightText, {
      props: { segments: splitHighlight('首頁改版與首頁', ['首頁']) },
    });
    expect(wrapper.findAll('mark').map((m) => m.text())).toEqual(['首頁', '首頁']);
    expect(wrapper.text()).toBe('首頁改版與首頁');
  });

  it('使用者輸入的 HTML 顯示成文字，不會變成元素', () => {
    const wrapper = mount(HighlightText, {
      props: { segments: splitHighlight('<img src=x onerror=alert(1)>粗', ['粗']) },
    });
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.text()).toBe('<img src=x onerror=alert(1)>粗');
  });

  it('保留換行', () => {
    const wrapper = mount(HighlightText, {
      props: { segments: splitHighlight('第一行\n第二行', ['二']) },
    });
    expect(wrapper.text()).toContain('\n');
  });
});
