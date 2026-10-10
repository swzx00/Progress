import type { Directive } from 'vue';

/**
 * textarea 高度隨內容自動調整（v-auto-resize）：
 * - 先把高度設回 auto 再量 scrollHeight，內容變少時才縮得回來；最小高度維持 rows 設定的行數
 * - 輸入（v-model 更新後元件重新渲染）、程式改值（例如編輯時帶入資料）都會觸發 updated 重新計算
 * - 寬度改變（視窗縮放、Drawer 寬度變化）時折行數會變，用 ResizeObserver 只在寬度改變時重算，
 *   避免自己改高度又觸發觀察造成循環
 */
const observers = new WeakMap<HTMLTextAreaElement, ResizeObserver>();

const resize = (el: HTMLTextAreaElement): void => {
  el.style.height = 'auto';
  // scrollHeight 不含邊框，加回上下邊框才不會多出捲軸
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
};

export const vAutoResize: Directive<HTMLTextAreaElement> = {
  mounted(el) {
    resize(el);
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      resize(el);
    });
    observer.observe(el);
    observers.set(el, observer);
  },
  updated(el) {
    resize(el);
  },
  unmounted(el) {
    observers.get(el)?.disconnect();
    observers.delete(el);
  },
};
