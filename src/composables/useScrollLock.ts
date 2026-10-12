import { onBeforeUnmount, onMounted } from 'vue';

/**
 * 有遮罩的畫面（表單 Drawer、各個 Modal／對話框）開著時，頁面本身不能捲動、也不顯示捲軸（使用者決定）。
 * 在元件 setup 裡呼叫：掛載時鎖住、卸載時解除（這些元件都是 v-if 開關，掛載期間就是開著的期間；
 * 有離場動畫的話，動畫播完卸載才解除）。
 *
 * 模組層級計數：可能疊好幾層（例如表單上面再開放棄變更的 ConfirmDialog），全部關掉才還原。
 * 鎖的是 <html>（頁面的捲動容器）。捲軸消失時右側補上同寬的 padding，版面才不會往右跳一下；
 * macOS 浮動捲軸、手機本來就不佔寬度，量出來是 0，不用補
 */
let lockCount = 0;
let saved: { overflow: string; paddingRight: string } | null = null;

const lock = (): void => {
  lockCount += 1;
  if (lockCount > 1) return;
  const root = document.documentElement;
  const scrollbarWidth = window.innerWidth - root.clientWidth;
  saved = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
  root.style.overflow = 'hidden';
  if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`;
};

const unlock = (): void => {
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount > 0 || !saved) return;
  const root = document.documentElement;
  root.style.overflow = saved.overflow;
  root.style.paddingRight = saved.paddingRight;
  saved = null;
};

export function useScrollLock(): void {
  onMounted(lock);
  onBeforeUnmount(unlock);
}
