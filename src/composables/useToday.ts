import { readonly, ref, type Ref } from 'vue';

import { todayString } from '@/utils/date';

/** 模組層級共用：今天的 YYYY-MM-DD（本地時間），跨過午夜會自動更新 */
const today = ref(todayString());
let started = false;
let timer: number | undefined;

/** 距離下一個本地午夜的毫秒數（多加 1 秒，避免計時器稍微提早觸發時還是同一天） */
const msUntilNextMidnight = (): number => {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + 1000;
};

const refresh = (): void => {
  const value = todayString();
  if (today.value !== value) today.value = value;
};

/** 對一次日期，並重新排定下一次在午夜觸發 */
const refreshAndSchedule = (): void => {
  refresh();
  window.clearTimeout(timer);
  timer = window.setTimeout(refreshAndSchedule, msUntilNextMidnight());
};

/**
 * 響應式的「今天」。computed(() => todayString()) 沒有響應式依賴、會一直沿用第一次的值，
 * 所以改成在下一個午夜更新；電腦睡眠時計時器會延後，分頁切回來（visibilitychange）時也重新對一次
 */
export function useToday(): Readonly<Ref<string>> {
  refresh();
  if (!started && typeof window !== 'undefined') {
    started = true;
    refreshAndSchedule();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshAndSchedule();
    });
  }
  return readonly(today);
}
