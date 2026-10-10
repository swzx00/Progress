import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useToast } from './useToast';

/** Toast 共用狀態：一次一則、新的取代舊的、4 秒後自動消失 */
const { toast, showToast, hideToast } = useToast();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  hideToast();
  vi.useRealTimers();
});

describe('useToast', () => {
  it('預設是錯誤樣式；可以指定 success', () => {
    showToast('儲存失敗');
    expect(toast.value).toMatchObject({ message: '儲存失敗', type: 'error' });
    showToast('已複製', 'success');
    expect(toast.value).toMatchObject({ message: '已複製', type: 'success' });
  });

  it('4 秒後自動消失', () => {
    showToast('儲存失敗');
    vi.advanceTimersByTime(3999);
    expect(toast.value).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(toast.value).toBeNull();
  });

  it('新的取代舊的：換新 id（同樣訊息也會重新播放動畫），重新計時', () => {
    showToast('儲存失敗');
    const firstId = toast.value!.id;
    vi.advanceTimersByTime(3000);
    showToast('儲存失敗');
    expect(toast.value!.id).not.toBe(firstId);
    vi.advanceTimersByTime(3000);
    expect(toast.value).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(toast.value).toBeNull();
  });

  it('hideToast 立刻關閉，之前的計時不會再動到下一則', () => {
    showToast('第一則');
    hideToast();
    expect(toast.value).toBeNull();
    vi.advanceTimersByTime(2000);
    showToast('第二則');
    vi.advanceTimersByTime(2500);
    expect(toast.value?.message).toBe('第二則');
  });

  it('不同元件呼叫 useToast 拿到同一份狀態', () => {
    useToast().showToast('別的元件發出的');
    expect(toast.value?.message).toBe('別的元件發出的');
  });
});
