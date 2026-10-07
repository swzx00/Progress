import { readonly, ref } from 'vue';

/** error：錯誤提示（預設）；success：操作成功的提示（例如「複製本日」完成） */
export type ToastType = 'error' | 'success';

export interface Toast {
  /** 每次顯示都換新 id，讓同樣訊息連續出現時 Transition 也會重新播放 */
  id: number;
  message: string;
  type: ToastType;
}

const AUTO_HIDE_MS = 4000;

// 模組層級共用狀態：任何元件呼叫 showToast，畫面上唯一的 AppToast 都看得到
const toast = ref<Toast | null>(null);
let nextId = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

const hideToast = (): void => {
  clearTimeout(hideTimer);
  toast.value = null;
};

/** 一次只顯示一則，新的直接取代舊的，並重新計時自動消失 */
const showToast = (message: string, type: ToastType = 'error'): void => {
  clearTimeout(hideTimer);
  nextId += 1;
  toast.value = { id: nextId, message, type };
  hideTimer = setTimeout(hideToast, AUTO_HIDE_MS);
};

export function useToast() {
  return { toast: readonly(toast), showToast, hideToast };
}
