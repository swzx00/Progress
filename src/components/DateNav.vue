<script setup lang="ts">
import { computed } from 'vue';

import { NDatePicker } from 'naive-ui';

import { useTaiwanHolidays } from '@/composables/useTaiwanHolidays';
import { refreshToday, useToday } from '@/composables/useToday';
import { addDays, parseLocalDate, toLocalDateString } from '@/utils/date';
import { isSameMonth, shiftMonth } from '@/utils/month-view';
import { DAILY_HOURS_WARN } from '@/validation/work-item';

const props = defineProps<{
  modelValue: string;
  totalHours?: number;
  /** 當天有沒有紀錄：放假且沒有紀錄時才隱藏工時合計（使用者決定） */
  hasItems?: boolean;
  /** 顯示搜尋結果中：只留搜尋欄，日期切換、工時合計／今天、動作按鈕都隱藏（使用者決定） */
  searching?: boolean;
  /** 以日／月為單位檢視（使用者決定）：月份檢視時日期切換改成切月份，放假徽章、工時合計不顯示 */
  viewMode?: 'day' | 'month';
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:viewMode': [value: 'day' | 'month'];
}>();

const isMonth = computed(() => props.viewMode === 'month');

// 切月份時日保留（目標月份沒有那一天就用月底），切回單日檢視才會回到差不多的位置
const shiftMonthBy = (months: number): void => {
  emit('update:modelValue', shiftMonth(props.modelValue, months));
};

const shift = (days: number): void => {
  emit('update:modelValue', addDays(props.modelValue, days));
};

const todayStr = useToday();
const isToday = computed(() => props.modelValue === todayStr.value);
const isThisMonth = computed(() => isSameMonth(props.modelValue, todayStr.value));
// 日期選擇器、「今天／本月」標示：月份檢視看的是不是本月，單日檢視看的是不是今天
const isCurrent = computed(() => (isMonth.value ? isThisMonth.value : isToday.value));

// 每日工時警示門檻（shared/validation-schema.json 的 dailyHours.warn），合計超過才換成紅字（剛好等於不算超過）
// 放假徽章跟工時合計同一區塊：放假而且當天沒有紀錄時，只顯示放假徽章（使用者決定）
const showTotal = computed(
  () => props.totalHours !== undefined && !(dayOffLabel.value && !props.hasItems),
);

const isOverHoursLimit = computed(
  () => props.totalHours !== undefined && props.totalHours > DAILY_HOURS_WARN,
);

const goToday = (): void => {
  // 先對一次日期：電腦睡眠喚醒後計時器可能還沒觸發，todayStr 會停在昨天，「今天」標示也會跟著錯
  refreshToday();
  emit('update:modelValue', todayStr.value);
};

// NDatePicker 的值是本地午夜的時間戳，進出都用本地時間換算
const pickerValue = computed(() => parseLocalDate(props.modelValue).getTime());

const onPickerUpdate = (value: number | null): void => {
  if (value === null) return;
  emit('update:modelValue', toLocalDateString(new Date(value)));
};

// 月份選擇器回傳的是那個月 1 號，換算成「切幾個月」，日保留
const onMonthPickerUpdate = (value: number | null): void => {
  if (value === null) return;
  const picked = new Date(value);
  const current = parseLocalDate(props.modelValue);
  shiftMonthBy(
    (picked.getFullYear() - current.getFullYear()) * 12 + picked.getMonth() - current.getMonth(),
  );
};

const { getDayOffLabel, isWorkday, findNextWorkday } = useTaiwanHolidays();

const dayOffLabel = computed(() => getDayOffLabel(props.modelValue));

const adjacentDate = (days: number): string => addDays(props.modelValue, days);

// 「上一個工作日」的用途是跳過假日，如果緊鄰的那一天本來就是工作日，按下去
// 效果跟「上一天」一樣，沒有額外用途，所以停用
const prevWorkdayDisabled = computed(() => isWorkday(adjacentDate(-1)));
const nextWorkdayDisabled = computed(() => isWorkday(adjacentDate(1)));

const jumpToWorkday = async (direction: 1 | -1): Promise<void> => {
  const next = await findNextWorkday(props.modelValue, direction);
  emit('update:modelValue', next);
};
</script>

<template>
  <div class="date-nav">
    <!-- 第一列：搜尋欄＋動作按鈕（使用者決定）。
         桌面、平板：搜尋欄靠左（最大寬度跟日期切換一樣寬），動作按鈕靠右；
         手機：動作按鈕（三顆平均分配整列寬度）在上、搜尋欄在下，再下面才是日期切換。
         動作按鈕沒傳 slot（未登入）時不渲染，只剩搜尋欄；顯示搜尋結果時（searching）也只剩搜尋欄 -->
    <div v-if="$slots.actions || $slots.search" class="date-nav__toolbar">
      <div v-if="$slots.search" class="date-nav__search">
        <slot name="search" />
      </div>
      <div v-if="$slots.actions && !searching" class="date-nav__actions">
        <slot name="actions" />
      </div>
    </div>
    <!-- 日期切換：桌面、平板靠左；手機撐滿整列（⏮ 最左、⏭ 最右，日期選擇器填滿中間） -->
    <div v-if="!searching && isMonth" class="date-nav__switcher">
      <button type="button" class="date-nav__btn" aria-label="上個月" @click="shiftMonthBy(-1)">
        <svg
          class="date-nav__icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <NDatePicker
        class="date-nav__picker date-nav__picker--month"
        :class="{ 'date-nav__picker--today': isThisMonth }"
        :value="pickerValue"
        type="month"
        format="yyyy/MM"
        :clearable="false"
        :actions="['now']"
        @update:value="onMonthPickerUpdate"
      />
      <button type="button" class="date-nav__btn" aria-label="下個月" @click="shiftMonthBy(1)">
        <svg
          class="date-nav__icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
    <div v-else-if="!searching" class="date-nav__switcher">
      <button
        type="button"
        class="date-nav__btn"
        aria-label="上一個工作日"
        title="上一個工作日"
        :disabled="prevWorkdayDisabled"
        @click="jumpToWorkday(-1)"
      >
        <svg
          class="date-nav__icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m11 17-5-5 5-5" />
          <path d="m18 17-5-5 5-5" />
        </svg>
      </button>
      <button type="button" class="date-nav__btn" aria-label="上一天" @click="shift(-1)">
        <svg
          class="date-nav__icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <NDatePicker
        class="date-nav__picker"
        :class="{ 'date-nav__picker--today': isToday }"
        :value="pickerValue"
        type="date"
        format="yyyy/MM/dd (EEEEE)"
        :clearable="false"
        :actions="['now']"
        :first-day-of-week="6"
        @update:value="onPickerUpdate"
      />
      <button type="button" class="date-nav__btn" aria-label="下一天" @click="shift(1)">
        <svg
          class="date-nav__icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      <button
        type="button"
        class="date-nav__btn"
        aria-label="下一個工作日"
        title="下一個工作日"
        :disabled="nextWorkdayDisabled"
        @click="jumpToWorkday(1)"
      >
        <svg
          class="date-nav__icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m6 17 5-5-5-5" />
          <path d="m13 17 5-5-5-5" />
        </svg>
      </button>
    </div>
    <!-- 日／月切換（使用者決定：放在日期切換的右邊）：手機跟下面的狀態列同一列、排在最左邊 -->
    <div v-if="!searching" class="date-nav__mode" role="group" aria-label="檢視單位">
      <button
        type="button"
        class="date-nav__mode-btn"
        :class="{ 'date-nav__mode-btn--active': !isMonth }"
        :aria-pressed="!isMonth"
        @click="emit('update:viewMode', 'day')"
      >
        日
      </button>
      <button
        type="button"
        class="date-nav__mode-btn"
        :class="{ 'date-nav__mode-btn--active': isMonth }"
        :aria-pressed="isMonth"
        @click="emit('update:viewMode', 'month')"
      >
        月
      </button>
    </div>
    <!-- 放假徽章＋工時合計（同一區塊）與今天：桌面、平板靠右；手機跟日／月切換同一列，左右對齊。
         月份檢視不顯示放假徽章、工時合計（使用者決定），只留「本月／回到本月」 -->
    <div v-if="!searching" class="date-nav__status">
      <div v-if="!isMonth" class="date-nav__info">
        <span
          v-if="dayOffLabel"
          class="date-nav__holiday-badge"
          :class="{ 'date-nav__holiday-badge--today': isToday }"
        >
          🏮 {{ dayOffLabel }}
        </span>
        <span
          v-if="showTotal"
          class="date-nav__total"
          :class="{ 'date-nav__total--over': isOverHoursLimit }"
        >
          今日工時合計：{{ totalHours }}hr
        </span>
      </div>
      <!-- 今天時只是狀態標示（不可操作），用 span 而不是 disabled 按鈕 -->
      <span v-if="isCurrent" class="date-nav__today date-nav__today--current">{{
        isMonth ? '本月' : '今天'
      }}</span>
      <button v-else type="button" class="date-nav__today" @click="goToday">
        {{ isMonth ? '回到本月' : '回到今天' }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.date-nav {
  // 日期切換（⏮ ◀ 日期選擇器 ▶ ⏭）在桌面、平板的寬度：4 顆 32px 按鈕＋170px 日期選擇器＋4 個 8px 間距，
  // 搜尋欄的最大寬度跟它一樣（使用者決定）。改按鈕、日期選擇器寬度或間距時要一起改
  --switcher-width: calc(4 * 32px + 170px + 4 * 8px);

  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 16px;

  // 桌面、平板兩列：第一列動作按鈕靠右；第二列日期切換靠左、放假徽章／工時合計＋今天靠右。
  // 手機三列：動作按鈕、日期切換、放假徽章／工時合計＋今天，各自撐滿整列（使用者決定）
  @media (min-width: 768px) {
    padding: 16px 32px;
  }
}

.date-nav__btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  aspect-ratio: 1/1;
  padding: 4px;
}

// 圖示用 Lucide SVG，不用 ⏮ ◀ ▶ ⏭ 字元：iOS 會把這類字元畫成彩色 emoji
.date-nav__icon {
  width: 16px;
  height: 16px;
}

.date-nav__today {
  padding: 6px 12px;
  word-break: keep-all;
}

.date-nav__btn,
.date-nav__today {
  display: flex;
  font-size: 14px;
  color: var(--color-black-800);
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 8px;
}

.date-nav__btn:hover,
.date-nav__today:not(.date-nav__today--current):hover {
  color: var(--color-blue-500);
  border-color: var(--color-blue-500);
}

.date-nav__btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;

  &:hover {
    color: var(--color-black-800);
    border-color: var(--color-black-100);
  }
}

.date-nav__switcher {
  display: flex;
  flex: 1 0 100%;
  gap: 8px;
  align-items: center;
  justify-content: space-between;

  @media (min-width: 768px) {
    flex: none;
    justify-content: flex-start;
  }
}

// 手機：填滿 ⏮ ◀ 跟 ▶ ⏭ 中間剩下的寬度；桌面、平板固定 170px
.date-nav__picker {
  flex: 1 1 auto;
  min-width: 0;

  @media (min-width: 768px) {
    flex: none;
    width: 170px;
  }

  // 月份檢視只有 ◀ ▶ 兩顆按鈕，選擇器加寬補回 ⏮ ⏭，日期切換總寬度維持 --switcher-width，搜尋欄寬度不用跟著改
  &--month {
    @media (min-width: 768px) {
      width: calc(var(--switcher-width) - 2 * 32px - 2 * 8px);
    }
  }
}

/*
 * 這裡整段都要用 :deep()：NDatePicker／NInput 實際顯示文字跟畫邊框的都是內部
 * 元素，不是我們拿到 class 的這個外層根節點，Naive UI 直接在那些內部元素自己
 * 身上設定顏色（不是繼承外層），單寫在外層 class 上不會生效：
 * - 邊框：NInput 用兩個疊在一起的空 div 畫邊框（<div class="n-input__border">
 *   是預設常駐的邊框，<div class="n-input__state-border"> 是 hover/focus 時才
 *   淡入的狀態邊框），要蓋掉平常看到的顏色要改前者
 * - 文字：實際輸入框是 <input class="n-input__input-el">
 * 這是目前唯一會對 NDatePicker／NInput 內部 class 用 :deep() 的地方，套件升級
 * 如果改了這幾個內部 class 名稱，這段「今天」標色會失效，但不影響日期選擇功能。
 */
.date-nav__picker--today {
  border-radius: 6px;

  :deep(.n-input__border) {
    border-color: var(--color-blue-700);
  }

  :deep(.n-input__input-el) {
    color: var(--color-blue-700);
  }
}

.date-nav__today--current {
  padding-top: 5px;
  padding-bottom: 5px;
  font-weight: 500;
  color: var(--color-blue-500);
  cursor: default;
  background: transparent;
  border: 1px solid var(--color-blue-500);
  border-radius: 999px;
}

.date-nav__holiday-badge {
  padding: 2px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-orange-800);
  white-space: nowrap;
  border: 1px solid var(--color-orange-800);
  border-radius: 999px;
}

// 放假色預設 orange，今天剛好放假時改 yellow，跟 WorkItemTable 的 --holiday／--viewing-today 一致
.date-nav__holiday-badge--today {
  color: var(--color-yellow-800);
  border-color: var(--color-yellow-800);
}

.date-nav__mode {
  display: flex;
  flex: none;
  overflow: hidden;
  border: 1px solid var(--color-black-100);
  border-radius: 8px;
}

.date-nav__mode-btn {
  min-width: 36px;
  height: 30px;
  padding: 0 10px;
  font-size: 14px;
  color: var(--color-black-800);
  cursor: pointer;
  background: var(--color-black-000);
  border: none;

  & + & {
    border-left: 1px solid var(--color-black-100);
  }

  &:hover:not(.date-nav__mode-btn--active) {
    color: var(--color-blue-500);
  }

  // 選中的那一個：淡藍底＋深藍字（深色模式 token 會對調，不用另外寫）
  &--active {
    font-weight: 600;
    color: var(--color-blue-700);
    cursor: default;
    background: var(--color-blue-050);
  }
}

.date-nav__status {
  display: flex;
  flex: 1 1 0;
  gap: 12px;
  align-items: center;
  justify-content: space-between;

  @media (min-width: 768px) {
    flex: none;
    justify-content: flex-end;
    margin-left: auto;
  }
}

.date-nav__info {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.date-nav__toolbar {
  display: flex;
  flex: 1 0 100%;
  flex-direction: column;
  gap: 8px;

  @media (min-width: 768px) {
    flex-direction: row;
    align-items: center;
  }
}

.date-nav__search {
  order: 1;

  @media (min-width: 768px) {
    flex: 1 1 var(--switcher-width);
    order: 0;
    max-width: var(--switcher-width);
  }
}

.date-nav__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: flex-end;

  @media (min-width: 768px) {
    flex: 1 1 auto;
  }
}

.date-nav__total {
  font-size: 13px;
  color: var(--color-black-500);
  white-space: nowrap;

  // 超過每日工時上限：只換文字顏色（使用者決定，不用膠囊）
  &--over {
    color: var(--color-red-700);
  }
}
</style>
