import { readonly, ref, type Ref } from 'vue';

import { todayString } from '@/utils/date';

/** 多久檢查一次日期有沒有換（頁面開著跨過午夜時，「今天」標示要跟著換） */
const CHECK_INTERVAL_MS = 60 * 1000;

/** 模組層級共用：今天的 YYYY-MM-DD（本地時間），跨過午夜會自動更新 */
const today = ref(todayString());
let started = false;

const refresh = (): void => {
  const value = todayString();
  if (today.value !== value) today.value = value;
};

/**
 * 響應式的「今天」。computed(() => todayString()) 沒有響應式依賴、會一直沿用第一次的值，
 * 所以改成每分鐘檢查一次，並在分頁切回來（visibilitychange）時立刻檢查。
 */
export function useToday(): Readonly<Ref<string>> {
  refresh();
  if (!started && typeof window !== 'undefined') {
    started = true;
    window.setInterval(refresh, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
  }
  return readonly(today);
}
