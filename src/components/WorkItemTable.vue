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
  <div class="work-item-list">
    <!-- < 768px：卡片列表 -->
    <ul class="work-item-cards">
      <li
        v-for="item in sortedItems"
        :key="item.id"
        class="work-item-cards__item"
        :class="{ 'work-item-cards__item--overdue': isOverdue(item, today) }"
      >
        <div class="work-item-cards__head">
          <span class="work-item-cards__title">{{ item.專案名稱 }}</span>
          <span v-if="isOverdue(item, today)" class="work-item-table__badge">逾期</span>
        </div>
        <div class="work-item-cards__meta">{{ item.單位 }}・{{ item.交辦人員 }}</div>
        <div v-if="item.repo.length > 0" class="work-item-cards__repo">
          <span v-for="repo in item.repo" :key="repo" class="work-item-table__repo-tag"
            >#{{ repo }}</span
          >
        </div>
        <div class="work-item-cards__content">{{ item.工作內容 }}</div>
        <div class="work-item-cards__status">今日處理情形：{{ item.今日處理情形 }}</div>
        <div class="work-item-cards__progress-row">
          <div class="work-item-table__progress">
            <div class="work-item-table__progress-bar" :style="{ width: item['完成%'] + '%' }" />
          </div>
          <span class="work-item-table__progress-text">{{ item['完成%'] }}%</span>
        </div>
        <div class="work-item-cards__footer">
          <span>工時 {{ item.今日工時 }}hr</span>
          <span>期限 {{ item.預計完成期限 }}</span>
        </div>
        <div v-if="editable" class="work-item-cards__actions">
          <button type="button" class="work-item-cards__action-btn" @click="emit('edit', item)">
            編輯
          </button>
          <button
            type="button"
            class="work-item-cards__action-btn work-item-cards__action-btn--danger"
            @click="emit('delete', item)"
          >
            刪除
          </button>
        </div>
      </li>
      <li v-if="sortedItems.length === 0" class="work-item-cards__empty">這天沒有紀錄</li>
    </ul>

    <!-- ≥ 768px：表格（768–1023px 隱藏次要欄位，≥1024px 全部顯示且欄寬固定/彈性分工） -->
    <table class="work-item-table">
      <thead>
        <tr>
          <th class="work-item-table__col--index">項次</th>
          <th class="work-item-table__col--unit work-item-table__col--secondary">單位</th>
          <th>專案名稱</th>
          <th class="work-item-table__col--repo work-item-table__col--secondary">Repo</th>
          <th>工作內容</th>
          <th class="work-item-table__col--unit work-item-table__col--secondary">交辦人員</th>
          <th class="work-item-table__col--date">預計完成期限</th>
          <th>今日處理情形</th>
          <th class="work-item-table__col--hours">今日工時</th>
          <th class="work-item-table__col--progress">完成度</th>
          <th class="work-item-table__col--secondary">完成回報</th>
          <th class="work-item-table__col--secondary">列管內容</th>
          <th v-if="editable" class="work-item-table__col--actions">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in sortedItems"
          :key="item.id"
          :class="{ 'work-item-table__row--overdue': isOverdue(item, today) }"
        >
          <td>{{ item.項次 }}</td>
          <td class="work-item-table__col--secondary">{{ item.單位 }}</td>
          <td>{{ item.專案名稱 }}</td>
          <td class="work-item-table__col--secondary">
            <span v-for="repo in item.repo" :key="repo" class="work-item-table__repo-tag"
              >#{{ repo }}</span
            >
          </td>
          <td>{{ item.工作內容 }}</td>
          <td class="work-item-table__col--secondary">{{ item.交辦人員 }}</td>
          <td>
            {{ item.預計完成期限 }}
            <span v-if="isOverdue(item, today)" class="work-item-table__badge">逾期</span>
          </td>
          <td>{{ item.今日處理情形 }}</td>
          <td>{{ item.今日工時 }}</td>
          <td>
            <div class="work-item-table__progress">
              <div
                class="work-item-table__progress-bar"
                :style="{ width: item['完成%'] + '%' }"
              />
            </div>
            <span class="work-item-table__progress-text">{{ item['完成%'] }}%</span>
          </td>
          <td class="work-item-table__col--secondary">{{ item.完成回報 }}</td>
          <td class="work-item-table__col--secondary">{{ item.列管內容 }}</td>
          <td v-if="editable" class="work-item-table__col--actions">
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
          </td>
        </tr>
        <tr v-if="sortedItems.length === 0">
          <td colspan="20" class="work-item-table__empty">這天沒有紀錄</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped lang="scss">
.work-item-list {
  padding: 0 16px 0;
  @media (min-width: 768px) {
    padding: 0 32px 16px;
  }
}
/* 手機（< 768px）：卡片列表，預設顯示 */
.work-item-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.work-item-cards__item {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 14px;
}

.work-item-cards__item--overdue {
  box-shadow: inset 3px 0 0 var(--color-danger);
}

.work-item-cards__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.work-item-cards__title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-ink);
}

.work-item-cards__meta {
  font-size: 12px;
  color: var(--color-ink-muted);
  margin-top: 3px;
}

.work-item-cards__repo {
  margin-top: 6px;
}

.work-item-cards__content {
  font-size: 13px;
  color: var(--color-ink);
  margin-top: 8px;
}

.work-item-cards__status {
  font-size: 12px;
  color: var(--color-ink-muted);
  margin-top: 6px;
}

.work-item-cards__progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.work-item-cards__footer {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 11px;
  color: var(--color-ink-muted);
}

.work-item-cards__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.work-item-cards__action-btn {
  flex-grow: 1;
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

.work-item-cards__empty {
  text-align: center;
  padding: 32px 12px;
  color: var(--color-ink-muted);
  border: 1px solid var(--color-border);
  border-radius: 10px;
}

/* 平板/桌面（≥ 768px）：表格，手機時預設隱藏 */
.work-item-table {
  display: none;
  width: 100%;
  table-layout: auto;
  border-collapse: collapse;
  background: var(--color-bg);
  font-size: 14px;
}

/*
 * 固定寬度給內容長度有上限的欄位；專案名稱/工作內容/今日處理情形/完成回報/列管內容
 * 不設寬度，讓瀏覽器的 table auto-layout 把螢幕變寬多出來的空間分給這些自由文字欄，
 * 而不是每欄等比例被拉寬、變成短內容旁邊一大片空白。
 */
.work-item-table__col--index {
  width: 48px;
}

.work-item-table__col--unit {
  width: 90px;
}

.work-item-table__col--repo {
  width: 160px;
}

.work-item-table__col--date {
  width: 140px;
}

.work-item-table__col--hours {
  width: 64px;
}

.work-item-table__col--progress {
  width: 150px;
}

.work-item-table__col--actions {
  width: 130px;
}

/* 768–1023px（平板）先隱藏次要欄位，避免橫向擠爆；≥1024px（桌面）恢復顯示 */
.work-item-table__col--secondary {
  display: none;
}

.work-item-table th {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 2px solid var(--color-border);
  color: var(--color-ink-muted);
  font-weight: 600;
  white-space: nowrap;
}

.work-item-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-ink);
  vertical-align: middle;
}

.work-item-table__row--overdue {
  box-shadow: inset 3px 0 0 var(--color-danger);
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

.work-item-table__repo-tag {
  display: inline-block;
  margin-right: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-ink-muted);
  font-size: 11px;
  white-space: nowrap;
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

.work-item-table__action-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-ink);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  margin-right: 6px;
  cursor: pointer;

  &--danger {
    color: var(--color-danger);
  }
}

.work-item-table__empty {
  text-align: center;
  padding: 32px 12px;
  color: var(--color-ink-muted);
}

@media (min-width: 768px) {
  .work-item-cards {
    display: none;
  }

  .work-item-table {
    display: table;
  }
}

@media (min-width: 1024px) {
  .work-item-table__col--secondary {
    display: table-cell;
  }
}
</style>
