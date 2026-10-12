// @vitest-environment happy-dom
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { useScrollLock } from './useScrollLock';

/** 有遮罩的元件：掛載時鎖住頁面捲動、卸載時解除，疊好幾層時全部關掉才還原 */
const Overlay = defineComponent({
  setup() {
    useScrollLock();
    return () => null;
  },
});

const root = document.documentElement;

afterEach(() => {
  vi.restoreAllMocks();
  root.style.overflow = '';
  root.style.paddingRight = '';
});

describe('useScrollLock', () => {
  it('掛載時隱藏捲軸，卸載時還原', () => {
    const overlay = mount(Overlay);
    expect(root.style.overflow).toBe('hidden');
    overlay.unmount();
    expect(root.style.overflow).toBe('');
  });

  it('疊兩層：關掉上面那層還是鎖著，全部關掉才還原', () => {
    const form = mount(Overlay);
    const confirm = mount(Overlay);
    confirm.unmount();
    expect(root.style.overflow).toBe('hidden');
    form.unmount();
    expect(root.style.overflow).toBe('');
  });

  it('捲軸有佔寬度時右側補同寬的 padding，版面不會跳動；還原時拿掉', () => {
    vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(window.innerWidth - 8);
    const overlay = mount(Overlay);
    expect(root.style.paddingRight).toBe('8px');
    overlay.unmount();
    expect(root.style.paddingRight).toBe('');
  });

  it('捲軸不佔寬度（macOS 浮動捲軸、手機）就不補 padding', () => {
    vi.spyOn(root, 'clientWidth', 'get').mockReturnValue(window.innerWidth);
    const overlay = mount(Overlay);
    expect(root.style.paddingRight).toBe('');
    overlay.unmount();
  });

  it('原本就有的 inline 樣式，解除後還原成原本的值', () => {
    root.style.overflow = 'scroll';
    const overlay = mount(Overlay);
    expect(root.style.overflow).toBe('hidden');
    overlay.unmount();
    expect(root.style.overflow).toBe('scroll');
  });
});
