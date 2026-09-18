<script setup lang="ts">
import { computed } from 'vue'

import { isOverdue, type WorkItem } from '@/types/work-item'

const props = withDefaults(
  defineProps<{
    items: WorkItem[]
    today: string
    editable?: boolean
  }>(),
  {
    editable: false,
  },
)

const emit = defineEmits<{
  edit: [item: WorkItem]
  delete: [item: WorkItem]
}>()

const sortedItems = computed(() =>
  [...props.items].sort((a, b) => {
    const aOverdue = isOverdue(a, props.today)
    const bOverdue = isOverdue(b, props.today)
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1
    return a.項次 - b.項次
  }),
)
</script>

<template>
  <div class="work-item-table" :class="{ 'work-item-table--editable': editable }" role="table">
    <div class="work-item-table__row work-item-table__row--header" role="row">
      <div
        class="work-item-table__cell work-item-table__cell--index work-item-table__cell--mobile-hide"
        role="columnheader"
      >
        項次
      </div>
      <div
        class="work-item-table__cell work-item-table__cell--assignee work-item-table__cell--secondary"
        role="columnheader"
      >
        交辦單位/人員
      </div>
      <div class="work-item-table__cell work-item-table__cell--title" role="columnheader">
        專案名稱/Repo
      </div>
      <div class="work-item-table__cell work-item-table__cell--content" role="columnheader">
        工作目標
      </div>
      <div class="work-item-table__cell work-item-table__cell--status" role="columnheader">
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
      <div
        class="work-item-table__cell work-item-table__cell--report work-item-table__cell--mobile-hide work-item-table__cell--secondary"
        role="columnheader"
      >
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
      :class="{ 'work-item-table__row--overdue': isOverdue(item, today) }"
      role="row"
    >
      <div
        class="work-item-table__cell work-item-table__cell--index work-item-table__cell--mobile-hide"
        role="cell"
      >
        {{ item.項次 }}
      </div>

      <div
        class="work-item-table__cell work-item-table__cell--assignee work-item-table__cell--secondary"
        role="cell"
      >
        <span class="work-item-table__assignee-stacked">
          <span class="work-item-table__assignee-unit">{{ item.交辦單位 }}</span>
          <span class="work-item-table__assignee-person">{{ item.交辦人員 }}</span>
        </span>
        <span class="work-item-table__assignee-inline"
          >{{ item.交辦人員 }}（{{ item.交辦單位 }}）</span
        >
      </div>

      <div class="work-item-table__cell work-item-table__cell--title" role="cell">
        <div class="work-item-table__title-text">{{ item.專案名稱 }}</div>
        <div v-if="item.專案Repo.length > 0" class="work-item-table__title-repo">
          <span v-for="repo in item.專案Repo" :key="repo" class="work-item-table__repo-tag"
            >#{{ repo }}</span
          >
        </div>
      </div>

      <div class="work-item-table__cell work-item-table__cell--content" role="cell">
        {{ item.工作目標 }}
      </div>

      <div class="work-item-table__cell work-item-table__cell--status" role="cell">
        <span class="work-item-table__mobile-label">處理內容：</span>{{ item.處理內容 }}
      </div>

      <div class="work-item-table__cell work-item-table__cell--hours" role="cell">
        <span class="work-item-table__mobile-label">工時 </span>{{ item.今日工時
        }}<span class="work-item-table__mobile-label">hr</span>
      </div>

      <div class="work-item-table__cell work-item-table__cell--due" role="cell">
        <span class="work-item-table__mobile-label">期限 </span>{{ item.預計期限
        }}<span v-if="isOverdue(item, today)" class="work-item-table__badge">逾期</span>
      </div>

      <div class="work-item-table__cell work-item-table__cell--progress" role="cell">
        <div class="work-item-table__progress">
          <div class="work-item-table__progress-bar" :style="{ width: item.完成度 + '%' }" />
        </div>
        <span class="work-item-table__progress-text">{{ item.完成度 }}%</span>
      </div>

      <div
        class="work-item-table__cell work-item-table__cell--report work-item-table__cell--mobile-hide work-item-table__cell--secondary"
        role="cell"
      >
        {{ item.狀態 }}
      </div>

      <div v-if="editable" class="work-item-table__cell work-item-table__cell--actions" role="cell">
        <div class="work-item-table__actions">
          <button type="button" class="work-item-table__action-btn" @click="emit('edit', item)">
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
    </div>

    <div v-if="sortedItems.length === 0" class="work-item-table__empty">這天沒有紀錄</div>
  </div>
</template>

<style scoped lang="scss">
.work-item-table {
  padding: 0 16px 0;

  @media (min-width: 768px) {
    padding: 0 32px 16px;
  }
}

.work-item-table__row {
  display: flex;
  flex-flow: row wrap;
  row-gap: 4px;
  column-gap: 12px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 12px;
  background: var(--color-bg);

  &--header {
    display: none;
  }

  &--overdue {
    box-shadow: inset 3px 0 0 var(--color-danger);
  }
}

.work-item-table__cell {
  flex-basis: 100%;
  font-size: 13px;
  color: var(--color-ink);

  &--mobile-hide {
    display: none;
  }

  &--title {
    order: 1;
  }

  &--assignee {
    order: 2;
  }

  &--content {
    order: 3;
  }

  &--status {
    order: 4;
    font-size: 12px;
    color: var(--color-ink-muted);
  }

  &--progress {
    order: 5;
  }

  &--hours {
    order: 6;
    flex-basis: 50%;
    font-size: 11px;
    color: var(--color-ink-muted);
  }

  &--due {
    order: 7;
    flex-basis: 50%;
    text-align: right;
    font-size: 11px;
    color: var(--color-ink-muted);
  }

  &--actions {
    order: 8;
  }
}

.work-item-table__title-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-ink);
}

.work-item-table__title-repo {
  margin-top: 4px;
}

.work-item-table__assignee-stacked {
  display: none;
}

.work-item-table__assignee-inline {
  display: inline;
  font-size: 12px;
  color: var(--color-ink-muted);
}

.work-item-table__mobile-label {
  color: var(--color-ink-muted);
}

.work-item-table__repo-tag {
  display: inline-block;
  margin-right: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-ink-muted);
  font-size: 11px;
}

.work-item-table__badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--color-danger);
  color: #fff;
  font-size: 11px;
}

.work-item-table__progress {
  width: 90px;
  height: 6px;
  border-radius: 999px;
  background: var(--color-surface);
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
}

.work-item-table__progress-bar {
  height: 100%;
  background: var(--color-accent);
}

.work-item-table__progress-text {
  margin-left: 6px;
  font-size: 12px;
  color: var(--color-ink-muted);
}

.work-item-table__actions {
  display: flex;
  gap: 8px;
}

.work-item-table__action-btn {
  flex: 1;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-ink);
  border-radius: 6px;
  padding: 7px;
  font-size: 13px;
  cursor: pointer;

  &--danger {
    color: var(--color-danger);
  }
}

.work-item-table__empty {
  text-align: center;
  padding: 32px 12px;
  color: var(--color-ink-muted);
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

/* ≥ 768px：由卡片堆疊改成表格式 CSS Grid，欄位靠 grid-template-columns 對齊 */
@media (min-width: 768px) {
  .work-item-table__row {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 64px 140px 150px;
    align-items: center;
    gap: 0;
    border: none;
    border-radius: 0;
    padding: 0;
    margin-bottom: 0;
    border-bottom: 1px solid var(--color-border);

    &--header {
      display: grid;
      border-bottom: 2px solid var(--color-border);

      .work-item-table__cell {
        color: var(--color-ink-muted);
        font-weight: 600;
        font-size: 13px;
      }
    }

    &--overdue {
      box-shadow: inset 3px 0 0 var(--color-danger);
    }
  }

  .work-item-table--editable .work-item-table__row {
    grid-template-columns: 48px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) 64px 140px 150px 130px;
  }

  .work-item-table__cell {
    padding: 10px 10px;
    order: 0;
    flex-basis: auto;
    text-align: left;
    font-size: 13px;
    color: var(--color-ink);

    &--mobile-hide {
      display: block;
    }

    &--secondary {
      display: none;
    }

    &--title {
      font-size: 13px;
    }

    &--status {
      font-size: 13px;
      color: var(--color-ink);
    }

    &--hours,
    &--due {
      text-align: left;
      font-size: 13px;
      color: var(--color-ink);
      white-space: nowrap;
    }
  }

  .work-item-table__title-text {
    font-size: 13px;
    font-weight: 400;
  }

  .work-item-table__mobile-label {
    display: none;
  }

  .work-item-table__actions {
    white-space: nowrap;
  }

  .work-item-table__action-btn {
    flex: none;
    padding: 4px 10px;
    font-size: 12px;
  }
}

/* ≥ 1024px：恢復次要欄位（交辦人員／狀態），套完整欄寬 */
@media (min-width: 1024px) {
  .work-item-table__row {
    grid-template-columns: 48px 110px minmax(0, 1fr) minmax(0, 1fr) minmax(
        0,
        1fr
      ) 64px 140px 150px minmax(0, 1fr);
  }

  .work-item-table--editable .work-item-table__row {
    grid-template-columns: 48px 110px minmax(0, 1fr) minmax(0, 1fr) minmax(
        0,
        1fr
      ) 64px 140px 150px minmax(0, 1fr) 130px;
  }

  .work-item-table__cell--secondary {
    display: block;
  }

  .work-item-table__assignee-stacked {
    display: flex;
    flex-direction: column;
  }

  .work-item-table__assignee-inline {
    display: none;
  }
}
</style>
