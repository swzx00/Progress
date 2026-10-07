<script setup lang="ts">
import { computed } from 'vue';

import { getStatusKey, isLeaveItem, isOverdue, type WorkItem } from '@/types/work-item';

const props = withDefaults(
  defineProps<{
    items: WorkItem[];
    today: string;
    editable?: boolean;
    viewingToday?: boolean;
    // 對應 useTaiwanHolidays 的 getDayOffLabel()，工作日回傳 null
    dayOffLabel?: string | null;
  }>(),
  {
    editable: false,
    viewingToday: false,
  },
);

const emit = defineEmits<{
  edit: [item: WorkItem];
  delete: [item: WorkItem];
}>();

const formatDate = (date: string): string => date.replaceAll('-', '/');

const statusClass = (status: string): string | undefined => {
  const key = getStatusKey(status);
  return key ? `work-item-table__status--${key}` : undefined;
};

const sortedItems = computed(() =>
  [...props.items].sort((a, b) => {
    const aOverdue = isOverdue(a, props.today);
    const bOverdue = isOverdue(b, props.today);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    return a.項次 - b.項次;
  }),
);
</script>

<template>
  <div
    class="work-item-table"
    :class="{
      'work-item-table--editable': editable,
      'work-item-table--viewing-today': viewingToday,
      'work-item-table--holiday': dayOffLabel,
    }"
    role="table"
  >
    <div class="work-item-table__row work-item-table__row--header" role="row">
      <div class="work-item-table__cell work-item-table__cell--index" role="columnheader">項次</div>
      <div class="work-item-table__cell work-item-table__cell--assignee" role="columnheader">
        交辦單位/人員
      </div>
      <div class="work-item-table__cell work-item-table__cell--title" role="columnheader">
        專案名稱/Repo
      </div>
      <div class="work-item-table__cell work-item-table__cell--target" role="columnheader">
        工作目標
      </div>
      <div class="work-item-table__cell work-item-table__cell--detail" role="columnheader">
        處理內容
      </div>
      <div class="work-item-table__cell work-item-table__cell--hours" role="columnheader">
        今日工時
      </div>
      <div class="work-item-table__cell work-item-table__cell--due" role="columnheader">
        預計期限
      </div>
      <div class="work-item-table__cell work-item-table__cell--progress" role="columnheader">
        完成度
      </div>
      <div class="work-item-table__cell work-item-table__cell--status" role="columnheader">
        狀態
      </div>
      <div
        v-if="editable"
        class="work-item-table__cell work-item-table__cell--actions"
        role="columnheader"
      >
        操作
      </div>
    </div>

    <div
      v-for="item in sortedItems"
      :key="item.id"
      class="work-item-table__row"
      :class="{
        'work-item-table__row--overdue': isOverdue(item, today),
        'work-item-table__row--leave': isLeaveItem(item),
      }"
      role="row"
    >
      <div class="work-item-table__cell work-item-table__cell--index" role="cell">
        {{ item.項次 }}
      </div>

      <div class="work-item-table__cell work-item-table__cell--title" role="cell">
        <div class="work-item-table__title-text">{{ item.專案名稱 }}</div>
        <div v-if="item.專案Repo.length > 0" class="work-item-table__title-repo">
          <span v-for="repo in item.專案Repo" :key="repo" class="work-item-table__repo-tag"
            >#{{ repo }}</span
          >
        </div>
      </div>

      <div class="work-item-table__cell work-item-table__cell--status" role="cell">
        <span v-if="item.狀態" class="work-item-table__status" :class="statusClass(item.狀態)">{{
          item.狀態
        }}</span
        ><span v-if="isOverdue(item, today)" class="work-item-table__badge">逾期</span>
      </div>

      <!-- 請假列不顯示交辦人員（使用者決定），只顯示交辦單位 -->
      <div class="work-item-table__cell work-item-table__cell--assignee" role="cell">
        <span class="work-item-table__assignee-stacked">
          <span class="work-item-table__assignee-unit">{{ item.交辦單位 }}</span>
          <span v-if="!isLeaveItem(item)" class="work-item-table__assignee-person">{{
            item.交辦人員
          }}</span>
        </span>
        <span v-if="isLeaveItem(item)" class="work-item-table__assignee-inline">{{
          item.交辦單位
        }}</span>
        <span v-else class="work-item-table__assignee-inline"
          >{{ item.交辦人員 }}（{{ item.交辦單位 }}）</span
        >
      </div>

      <div class="work-item-table__cell work-item-table__cell--target" role="cell">
        {{ item.工作目標 }}
      </div>

      <div class="work-item-table__cell work-item-table__cell--detail" role="cell">
        <span class="work-item-table__mobile-label">處理內容：</span>{{ item.處理內容 }}
      </div>

      <div class="work-item-table__cell work-item-table__cell--progress" role="cell">
        <div class="work-item-table__progress">
          <div class="work-item-table__progress-bar" :style="{ width: item.完成度 + '%' }" />
        </div>
        <span class="work-item-table__progress-text">{{ item.完成度 }}%</span>
      </div>

      <div class="work-item-table__cell work-item-table__cell--hours" role="cell">
        <span class="work-item-table__mobile-label">工時：</span>{{ item.今日工時
        }}<span class="work-item-table__mobile-label">hr</span>
      </div>

      <div class="work-item-table__cell work-item-table__cell--due" role="cell">
        <span class="work-item-table__mobile-label">期限：</span>{{ formatDate(item.預計期限) }}
      </div>

      <div v-if="editable" class="work-item-table__cell work-item-table__cell--actions" role="cell">
        <button
          type="button"
          class="work-item-table__action-btn work-item-table__action-btn--edit"
          @click="emit('edit', item)"
        >
          編輯
        </button>
        <button
          type="button"
          class="work-item-table__action-btn work-item-table__action-btn--danger"
          @click="emit('delete', item)"
        >
          刪除
        </button>
      </div>
    </div>

    <div v-if="sortedItems.length === 0" class="work-item-table__empty">
      <template v-if="dayOffLabel && viewingToday">今天放假呦！</template>
      <template v-else-if="dayOffLabel">這天放假呦！</template>
      <template v-else-if="viewingToday">今天還沒有紀錄</template>
      <template v-else>這天沒有紀錄</template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.work-item-table {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px;

  @media (min-width: 768px) {
    flex: 1 1 auto;
    gap: 0;
    padding: 0;
  }

  &--viewing-today {
    .work-item-table__row {
      border: 1px solid var(--color-blue-200);

      @media (min-width: 768px) {
        border: none;
        border-bottom: 1px solid var(--color-blue-200);
      }

      &--header {
        @media (min-width: 768px) {
          background: var(--color-blue-100);
        }
      }

      &:not(.work-item-table__row--header):nth-child(even) {
        background: var(--color-blue-050);
      }

      &:not(.work-item-table__row--header):nth-child(odd) {
        background: var(--color-blue-000);
      }
    }
  }

  &--holiday {
    .work-item-table__row {
      color: var(--color-orange-1000);
      border: 1px solid var(--color-orange-200);

      @media (min-width: 768px) {
        border: none;
        border-bottom: 1px solid var(--color-orange-200);
      }

      &--header {
        @media (min-width: 768px) {
          background: var(--color-orange-100);
        }
      }

      &:not(.work-item-table__row--header):nth-child(even) {
        background: var(--color-orange-050);
      }

      &:not(.work-item-table__row--header):nth-child(odd) {
        background: var(--color-orange-000);
      }
    }

    &.work-item-table--viewing-today {
      .work-item-table__row {
        color: var(--color-yellow-1000);
        border: 1px solid var(--color-yellow-200);

        @media (min-width: 768px) {
          border: none;
          border-bottom: 1px solid var(--color-yellow-200);
        }

        &--header {
          @media (min-width: 768px) {
            background: var(--color-yellow-100);
          }
        }

        &:not(.work-item-table__row--header):nth-child(even) {
          background: var(--color-yellow-050);
        }

        &:not(.work-item-table__row--header):nth-child(odd) {
          background: var(--color-yellow-000);
        }
      }
    }
  }

  &__row {
    display: flex;
    flex-flow: row wrap;
    gap: 2px 8px;
    justify-content: space-between;
    padding: 12px 16px;
    font-size: 16px;
    border: 1px solid var(--color-black-200);
    border-radius: 8px;

    @media (min-width: 768px) {
      display: grid;
      grid-template-columns:
        32px 99px minmax(103px, 1fr) minmax(62px, 1fr) minmax(62px, 1fr)
        62px 48px 77px 58px;
      gap: 8px;
      padding: 8px 32px;
      font-size: 14px;
      border: none;
      border-bottom: 1px solid var(--color-black-200);
      border-radius: 0;
    }

    .work-item-table--editable & {
      @media (min-width: 768px) {
        grid-template-columns:
          32px 99px minmax(103px, 1fr) minmax(62px, 1fr) minmax(62px, 1fr)
          62px 48px 77px 58px 46px;
      }
    }

    &--header {
      display: none;

      @media (min-width: 768px) {
        display: grid;
        font-size: 15px;
        background: var(--color-black-100);
      }
    }

    &--header {
      display: none;

      @media (min-width: 768px) {
        display: grid;
        font-size: 15px;
        background: var(--color-black-100);
      }
    }

    &:not(.work-item-table__row--header):nth-child(even) {
      background: var(--color-black-050);
    }

    &:not(.work-item-table__row--header):nth-child(odd) {
      background: var(--color-black-000);
    }

    &--overdue {
      border-left: 1px solid var(--color-red-600);
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      box-shadow: inset 3px 0 0 var(--color-red-600);

      @media (min-width: 768px) {
        border: inherit;
        border-left: inherit;
        border-top-left-radius: inherit;
        border-bottom-left-radius: inherit;
        box-shadow: inset 4px 0 0 var(--color-red-600);
      }
    }

    // 請假列：文字與進度條用 teal 色系，左側標線同逾期樣式但用 teal（使用者決定）
    &--leave {
      color: var(--color-teal-800);
      border-left: 1px solid var(--color-teal-600);
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      box-shadow: inset 3px 0 0 var(--color-teal-600);

      @media (min-width: 768px) {
        border: inherit;
        border-left: inherit;
        border-top-left-radius: inherit;
        border-bottom-left-radius: inherit;
        box-shadow: inset 4px 0 0 var(--color-teal-600);
      }
    }
  }

  &__cell {
    display: flex;
    align-items: center;
    justify-content: flex-start;

    @media (min-width: 768px) {
      justify-content: center;
    }

    .work-item-table__row--header & {
      flex-flow: row nowrap;
      gap: 0;
      justify-content: center;
      text-align: center;
      word-break: keep-all;
    }

    &--index {
      display: none;

      @media (min-width: 768px) {
        display: flex;
        order: 0;
      }
    }

    &--title {
      display: -webkit-box;
      flex: 1 1 0;
      flex-flow: column wrap;
      gap: 2px;
      align-items: flex-start;
      align-self: center;
      order: 0;
      width: auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      -webkit-line-clamp: 5;
      font-size: 18px;
      font-weight: 500;
      line-height: 1.6;
      word-break: break-all;
      -webkit-box-orient: vertical;

      @media (min-width: 768px) {
        order: 2;
        font-size: inherit;
        font-weight: inherit;
        line-height: inherit;
      }

      * {
        max-width: 100%;
      }

      // 表頭跟內容一樣置左（使用者決定），蓋過上面表頭共用的置中
      .work-item-table__row--header & {
        justify-content: flex-start;
        text-align: start;
      }
    }

    &--status {
      flex: 0 0 auto;
      flex-direction: row;
      gap: 2px;
      align-items: flex-start;
      order: 1;

      @media (min-width: 768px) {
        flex-direction: column;
        align-items: center;
        order: 8;
      }
    }

    &--assignee {
      order: 2;
      width: 100%;
      margin-top: 2px;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--color-black-500);

      @media (min-width: 768px) {
        order: 1;
        margin-top: inherit;
        margin-bottom: inherit;
        font-size: inherit;
        color: inherit;
      }

      // 請假列：手機的次要灰字改成 teal（桌面繼承整列的 teal-800）
      .work-item-table__row--leave & {
        color: var(--color-teal-700);

        @media (min-width: 768px) {
          color: inherit;
        }
      }

      .work-item-table__assignee-stacked {
        display: none;

        @media (min-width: 768px) {
          display: flex;
          flex-direction: column;
          gap: 2px;
          align-items: center;
          width: 100%;
        }
      }

      .work-item-table__assignee-inline {
        display: inline;

        @media (min-width: 768px) {
          display: none;
        }
      }
    }

    &--target {
      display: -webkit-box;
      align-self: center;
      justify-content: flex-start;
      order: 3;
      width: 100%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      -webkit-line-clamp: 5;
      word-break: break-all;
      -webkit-box-orient: vertical;

      @media (min-width: 768px) {
        order: 3;
      }

      // 表頭跟內容一樣置左（使用者決定），蓋過上面表頭共用的置中
      .work-item-table__row--header & {
        justify-content: flex-start;
        text-align: start;
      }
    }

    &--detail {
      display: -webkit-box;
      align-self: center;
      justify-content: flex-start;
      order: 4;
      width: 100%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      -webkit-line-clamp: 5;
      font-size: 14px;
      color: var(--color-black-500);
      word-break: break-all;
      -webkit-box-orient: vertical;

      @media (min-width: 768px) {
        order: 4;
        -webkit-line-clamp: 3;
        font-size: inherit;
        color: inherit;
      }

      // 表頭跟內容一樣置左（使用者決定），蓋過上面表頭共用的置中
      .work-item-table__row--header & {
        justify-content: flex-start;
        text-align: start;
      }

      // 請假列：手機的次要灰字改成 teal（桌面繼承整列的 teal-800）
      .work-item-table__row--leave & {
        color: var(--color-teal-700);

        @media (min-width: 768px) {
          color: inherit;
        }
      }
    }

    &--progress {
      flex-direction: row;
      gap: 8px;
      order: 5;
      width: 100%;
      font-size: 14px;
      color: var(--color-blue-800);

      @media (min-width: 768px) {
        flex-direction: column;
        gap: 2px;
        order: 6;
        font-size: inherit;
        color: inherit;
      }

      // 請假列：手機的完成度文字改成 teal（桌面繼承整列的 teal-800）
      .work-item-table__row--leave & {
        color: var(--color-teal-800);

        @media (min-width: 768px) {
          color: inherit;
        }
      }
    }

    &--hours {
      flex: 0 0 auto;
      order: 6;
      width: fit-content;
      font-size: 12px;
      color: var(--color-black-500);

      @media (min-width: 768px) {
        order: 5;
        width: 100%;
        font-size: inherit;
        color: inherit;
      }

      // 請假列：手機的次要灰字改成 teal（桌面繼承整列的 teal-800）
      .work-item-table__row--leave & {
        color: var(--color-teal-700);

        @media (min-width: 768px) {
          color: inherit;
        }
      }
    }

    &--due {
      flex: 0 0 auto;
      order: 7;
      width: fit-content;
      font-size: 12px;
      color: var(--color-black-500);

      @media (min-width: 768px) {
        order: 7;
        width: 100%;
        font-size: inherit;
        color: inherit;
      }

      // 請假列：手機的次要灰字改成 teal（桌面繼承整列的 teal-800）
      .work-item-table__row--leave & {
        color: var(--color-teal-700);

        @media (min-width: 768px) {
          color: inherit;
        }
      }
    }

    &--actions {
      flex-direction: row;
      gap: 8px;
      order: 8;
      width: 100%;
      padding-top: 10px;
      margin-top: 12px;
      border-top: 1px solid var(--color-black-200);

      @media (min-width: 768px) {
        flex-direction: column;
        gap: 4px;
        order: 9;
        padding-top: unset;
        margin-top: unset;
        border-top: none;
      }
    }
  }

  &__mobile-label {
    display: inline;

    @media (min-width: 768px) {
      display: none;
    }
  }

  &__title {
    &-repo {
      display: flex;
      flex-flow: row wrap;
      gap: 2px;
      align-items: flex-start;
      justify-content: flex-start;
    }
  }

  &__repo-tag {
    display: inline-block;
    width: fit-content;
    min-width: 0;
    max-width: 30%;
    padding: 1px 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    line-height: 1.3;
    color: var(--color-black-500);
    white-space: nowrap;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-200);
    border-radius: 999px;

    @media (min-width: 768px) {
      max-width: 103px;
      font-size: 10px;
    }

    .work-item-table--overdue & {
      color: var(--color-red-400);
      background: var(--color-red-000);
      border: 1px solid var(--color-red-400);
    }
  }

  &__assignee {
    &-stacked {
      display: none;

      @media (min-width: 768px) {
        display: flex;
        flex-direction: column;
        gap: 2px;
        align-items: center;
        justify-content: center;
        width: 100%;
      }
    }

    &-inline {
      display: inline;

      @media (min-width: 768px) {
        display: none;
      }
    }
  }

  // 手機卡片：透明底＋邊框的膠囊；桌面表格維持原本的純文字樣式
  &__status {
    display: inline-flex;
    padding: 2px 10px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-black-600);
    white-space: nowrap;
    background: transparent;
    border: 1px solid currentcolor;
    border-radius: 999px;

    @media (min-width: 768px) {
      line-height: inherit;
    }

    &--todo {
      color: var(--color-black-600);
      background: var(--color-black-000);

      @media (min-width: 768px) {
        color: var(--color-black-600);
        background: transparent;
      }
    }

    &--in-progress {
      color: var(--color-blue-700);
      background: var(--color-blue-000);

      @media (min-width: 768px) {
        color: var(--color-black-600);
        background: transparent;
      }
    }

    &--frontend-done {
      color: var(--color-teal-800);
      background: var(--color-teal-000);

      @media (min-width: 768px) {
        color: var(--color-black-600);
        background: transparent;
      }
    }

    &--rework {
      color: var(--color-red-700);
      background: var(--color-red-000);

      @media (min-width: 768px) {
        color: var(--color-black-600);
        background: transparent;
      }
    }

    &--live {
      color: var(--color-green-800);
      background: var(--color-green-000);

      @media (min-width: 768px) {
        color: var(--color-black-600);
        background: transparent;
      }
    }

    &--paused {
      color: var(--color-yellow-800);
      background: var(--color-yellow-000);

      @media (min-width: 768px) {
        color: var(--color-black-600);
        background: transparent;
      }
    }

    // 請假（休假）：teal 色系，跟整列請假的文字/進度條一致
    &--leave {
      color: var(--color-teal-800);
      background: var(--color-teal-000);

      @media (min-width: 768px) {
        color: var(--color-teal-800);
        background: transparent;
      }
    }

    // 放在所有狀態修飾符之後，color: inherit 才蓋得過各狀態的顏色
    @media (min-width: 768px) {
      padding: 0;
      font-size: inherit;
      line-height: inherit;
      color: inherit;
      border: none;
      border-radius: 0;
    }
  }

  &__badge {
    display: inline-block;
    width: fit-content;
    padding: 2px 10px;
    margin-left: 6px;
    font-size: 12px;
    line-height: 1.4;
    vertical-align: middle;
    color: var(--color-black-000);
    text-align: center;
    background: var(--color-red-600);
    border: 1px solid var(--color-red-600);
    border-radius: 999px;

    @media (min-width: 768px) {
      padding: 1px 6px;
      margin-left: 0;
      font-size: 10px;
    }
  }

  &__progress {
    display: inline-block;
    width: 100%;
    height: 6px;
    overflow: hidden;
    vertical-align: middle;
    background: var(--color-blue-100);
    border-radius: 999px;

    .work-item-table__row--leave & {
      background: var(--color-teal-100);
    }

    &-bar {
      height: 100%;
      background: var(--color-blue-500);

      .work-item-table__row--leave & {
        background: var(--color-teal-500);
      }
    }

    &-text {
      flex: 0 0 46px;
      width: 46px;
      text-align: end;

      @media (min-width: 768px) {
        flex: unset;
        width: fit-content;
        text-align: center;
      }
    }
  }

  &__action-btn {
    flex: 1;
    padding: 7px;
    font-size: 12px;
    word-break: keep-all;
    cursor: pointer;
    border-radius: 6px;

    &--edit {
      color: var(--color-blue-500);
      background: var(--color-blue-000);
      border: 1px solid var(--color-blue-500);

      &:hover {
        color: var(--color-black-000);
        background: var(--color-blue-700);
        border: 1px solid var(--color-blue-700);
      }
    }

    &--danger {
      color: var(--color-red-600);
      background: var(--color-red-000);
      border: 1px solid var(--color-red-600);

      &:hover {
        color: var(--color-black-000);
        background: var(--color-red-700);
        border: 1px solid var(--color-red-700);
      }
    }

    @media (min-width: 768px) {
      flex: none;
      padding: 4px 10px;
    }
  }

  &__empty {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    padding: 32px 12px;
    color: var(--color-black-500);
    text-align: center;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-200);
    border-radius: 8px;

    @media (min-width: 768px) {
      border: none;
      border-radius: 0;
    }

    .work-item-table--viewing-today & {
      color: var(--color-blue-500);
      background: var(--color-blue-000);
      border: 1px solid var(--color-blue-200);

      @media (min-width: 768px) {
        border: none;
      }
    }

    .work-item-table--holiday & {
      color: var(--color-orange-1000);
      background: var(--color-orange-000);
      border: 1px solid var(--color-orange-200);

      @media (min-width: 768px) {
        border: none;
      }
    }

    .work-item-table--holiday.work-item-table--viewing-today & {
      color: var(--color-yellow-1000);
      background: var(--color-yellow-000);
      border: 1px solid var(--color-yellow-200);

      @media (min-width: 768px) {
        border: none;
      }
    }
  }
}
</style>
