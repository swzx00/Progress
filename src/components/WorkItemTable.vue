<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { VueDraggable, type SortableEvent } from 'vue-draggable-plus';

import ClampText from '@/components/ClampText.vue';
import { getStatusKey, isLeaveItem, isOverdue, type WorkItem } from '@/types/work-item';

const props = withDefaults(
  defineProps<{
    items: WorkItem[];
    today: string;
    editable?: boolean;
    viewingToday?: boolean;
    // 對應 useTaiwanHolidays 的 getDayOffLabel()，工作日回傳 null
    dayOffLabel?: string | null;
    /** 項次調整存檔中：暫時停用拖曳與上移／下移 */
    reordering?: boolean;
    /**
     * 搜尋結果模式（搜尋欄按下搜尋後，使用者決定）：items 是跨日期的搜尋結果，照傳進來的順序顯示
     * （工作日期新的在前）；項次欄換成工作日期（點了跳到那天），不能調整順序，其他操作照常
     */
    searchMode?: boolean;
    /** 搜尋結果是空的時候，空狀態顯示的關鍵字 */
    searchKeyword?: string;
  }>(),
  {
    editable: false,
    viewingToday: false,
    reordering: false,
    searchMode: false,
    searchKeyword: '',
  },
);

const emit = defineEmits<{
  edit: [item: WorkItem];
  copy: [item: WorkItem];
  delete: [item: WorkItem];
  /** 項次調整：那天所有紀錄（含請假）依新順序排列的 id，由使用端存檔 */
  reorder: [ids: string[]];
  /** 搜尋結果模式：點工作日期，跳到那天 */
  goToDate: [date: string];
}>();

const formatDate = (date: string): string => date.replaceAll('-', '/');

// 完成度可以是 0.25 的倍數：照實際值顯示、不補多餘的 0（70 → 70、12.5 → 12.5、12.25 → 12.25），
// 四捨五入到小數兩位避免浮點誤差
const formatProgress = (value: number): string => String(Math.round(value * 100) / 100);

const statusClass = (status: string): string | undefined => {
  const key = getStatusKey(status);
  return key ? `work-item-table__status--${key}` : undefined;
};

/**
 * 列的順序一律照項次（使用者決定：逾期不再自動排到最前面，只保留紅色標線與「逾期」標籤，
 * 手動調整的順序才不會被打亂）。rows 是拖曳用的本地副本：拖曳時 VueDraggable 直接改它，
 * 再把新順序 emit 給使用端存檔；使用端更新（或失敗還原）items 後，這裡跟著重新同步
 */
const rows = ref<WorkItem[]>([]);
watch(
  () => props.items,
  (items) => {
    // 搜尋結果跨日期，照傳進來的順序（工作日期新的在前、同一天照項次）
    rows.value = props.searchMode ? [...items] : [...items].sort((a, b) => a.項次 - b.項次);
  },
  { immediate: true },
);

const emitOrder = (): void => {
  emit(
    'reorder',
    rows.value.map((row) => row.id),
  );
};

/**
 * 文字刪節（工作目標、處理內容、專案名稱/Repo）：收合時截斷，被截斷的地方在最後一行尾端出現「…展開」
 * （ClampText），點任一個整列都不截斷，每格全文的下一行出現「收合」，點任一個整列收回（使用者決定）。
 * 點列本身不展開；展開狀態不存檔，換日期（列的 id 不在了）就收回；開始拖曳時自動收合
 */
const expandedIds = ref<Set<string>>(new Set());

const isExpanded = (id: string): boolean => expandedIds.value.has(id);

const collapseRow = (id: string): void => {
  if (!expandedIds.value.has(id)) return;
  const next = new Set(expandedIds.value);
  next.delete(id);
  expandedIds.value = next;
};

const toggleRow = async (id: string, event: MouseEvent): Promise<void> => {
  if (!isExpanded(id)) {
    expandedIds.value = new Set(expandedIds.value).add(id);
    return;
  }
  const row = (event.target as HTMLElement).closest<HTMLElement>('.work-item-table__row');
  collapseRow(id);
  // 收合後這一列如果捲出畫面上緣，自動捲回來，避免畫面跳走找不到剛剛那一列
  await nextTick();
  if (row && row.getBoundingClientRect().top < 0) {
    row.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
};

// 換日期（或紀錄被刪除）後，不在畫面上的列不再保留展開狀態
watch(
  () => props.items,
  (items) => {
    const ids = new Set(items.map((item) => item.id));
    expandedIds.value = new Set([...expandedIds.value].filter((id) => ids.has(id)));
  },
);

// 開始拖曳時，那一列如果是展開的就先收合，避免拖著很高的列
const onDragStart = (event: SortableEvent): void => {
  const id = event.item.dataset.id;
  if (id) collapseRow(id);
};

const titleFullText = (item: WorkItem): string =>
  [item.專案名稱, item.專案Repo.map((repo) => `#${repo}`).join(' ')].filter(Boolean).join('\n');

// 上移／下移：跟相鄰那筆交換位置
const moveRow = (index: number, direction: -1 | 1): void => {
  const target = index + direction;
  if (props.reordering || target < 0 || target >= rows.value.length) return;
  const ids = rows.value.map((row) => row.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  emit('reorder', ids);
};
</script>

<template>
  <div
    class="work-item-table"
    :class="{
      'work-item-table--editable': editable,
      'work-item-table--viewing-today': viewingToday,
      'work-item-table--holiday': dayOffLabel,
      'work-item-table--search': searchMode,
    }"
    role="table"
  >
    <div class="work-item-table__row work-item-table__row--header" role="row">
      <div class="work-item-table__cell work-item-table__cell--index" role="columnheader">
        {{ searchMode ? '工作日期' : '項次' }}
      </div>
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

    <!--
      資料列可拖曳排序（vue-draggable-plus）：只有按住拖曳把手（work-item-table__drag-handle）才能拖，
      手機不用長按延遲（把手設了 touch-action: none，不會跟頁面捲動衝突）；存檔中或唯讀時停用。
      forceFallback 讓拖曳中的那一列由 SortableJS 自己畫（才能加陰影，fallback-class），原位置留半透明佔位（ghost-class）
    -->
    <VueDraggable
      v-model="rows"
      class="work-item-table__body"
      :disabled="!editable || reordering || searchMode"
      :animation="150"
      handle=".work-item-table__drag-handle"
      :force-fallback="true"
      fallback-class="work-item-table__row--dragging"
      ghost-class="work-item-table__row--ghost"
      @start="onDragStart"
      @update="emitOrder"
    >
      <div
        v-for="(item, index) in rows"
        :key="item.id"
        class="work-item-table__row"
        :class="{
          'work-item-table__row--overdue': isOverdue(item, today),
          'work-item-table__row--leave': isLeaveItem(item),
          'work-item-table__row--expanded': isExpanded(item.id),
        }"
        :data-id="item.id"
        role="row"
      >
        <!-- 項次：平板、桌面在數字上下放上移／下移（圖示：Lucide chevron-up／chevron-down，ISC 授權） -->
        <!-- 搜尋結果模式：項次欄換成工作日期，點了跳到那天（跨日期的結果，項次本身沒有意義） -->
        <div
          v-if="searchMode"
          class="work-item-table__cell work-item-table__cell--index work-item-table__cell--date"
          role="cell"
        >
          <button
            type="button"
            class="work-item-table__date-link"
            :title="`跳到 ${formatDate(item.工作日期)}`"
            @click="emit('goToDate', item.工作日期)"
          >
            {{ formatDate(item.工作日期) }}
          </button>
        </div>
        <div v-else class="work-item-table__cell work-item-table__cell--index" role="cell">
          <button
            v-if="editable"
            type="button"
            class="work-item-table__move-btn"
            title="上移"
            aria-label="上移"
            :disabled="reordering || index === 0"
            @click="moveRow(index, -1)"
          >
            <svg
              class="work-item-table__move-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <span>{{ item.項次 }}</span>
          <button
            v-if="editable"
            type="button"
            class="work-item-table__move-btn"
            title="下移"
            aria-label="下移"
            :disabled="reordering || index === rows.length - 1"
            @click="moveRow(index, 1)"
          >
            <svg
              class="work-item-table__move-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>

        <div class="work-item-table__cell work-item-table__cell--title" role="cell">
          <ClampText
            :full-text="titleFullText(item)"
            :expanded="isExpanded(item.id)"
            :inline-toggle="false"
            @toggle="toggleRow(item.id, $event)"
          >
            <div class="work-item-table__title-text">{{ item.專案名稱 }}</div>
            <div v-if="item.專案Repo.length > 0" class="work-item-table__title-repo">
              <span
                v-for="repo in item.專案Repo"
                :key="repo"
                class="work-item-table__repo-tag"
                data-ellipsis
                >#{{ repo }}</span
              >
            </div>
          </ClampText>
        </div>

        <div class="work-item-table__cell work-item-table__cell--status" role="cell">
          <span v-if="item.狀態" class="work-item-table__status" :class="statusClass(item.狀態)">{{
            item.狀態
          }}</span
          ><span v-if="isOverdue(item, today)" class="work-item-table__badge">逾期</span>
        </div>

        <!--
          拖曳把手（只在登入時顯示）：桌面、平板在列的最左邊（左側內距裡的 20px 窄欄），手機在卡片右上角。
          上移／下移按鈕是同功能的無障礙替代，所以把手本身對螢幕閱讀器隱藏。
          圖示：Lucide grip-vertical（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0
        -->
        <span
          v-if="editable && !searchMode"
          class="work-item-table__drag-handle"
          title="按住拖曳排序"
          aria-hidden="true"
        >
          <svg
            class="work-item-table__drag-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            focusable="false"
          >
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="19" r="1" />
          </svg>
        </span>

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
          <ClampText
            :full-text="item.工作目標"
            :expanded="isExpanded(item.id)"
            @toggle="toggleRow(item.id, $event)"
            >{{ item.工作目標 }}</ClampText
          >
        </div>

        <div class="work-item-table__cell work-item-table__cell--detail" role="cell">
          <ClampText
            :full-text="item.處理內容"
            :expanded="isExpanded(item.id)"
            @toggle="toggleRow(item.id, $event)"
            ><span class="work-item-table__mobile-label">處理內容：</span
            >{{ item.處理內容 }}</ClampText
          >
        </div>

        <div class="work-item-table__cell work-item-table__cell--progress" role="cell">
          <div class="work-item-table__progress">
            <div class="work-item-table__progress-bar" :style="{ width: item.完成度 + '%' }" />
          </div>
          <span class="work-item-table__progress-text">{{ formatProgress(item.完成度) }}%</span>
        </div>

        <div class="work-item-table__cell work-item-table__cell--hours" role="cell">
          <span class="work-item-table__mobile-label">工時：</span>{{ item.今日工時
          }}<span class="work-item-table__mobile-label work-item-table__mobile-label--unit"
            >hr</span
          >
        </div>

        <div class="work-item-table__cell work-item-table__cell--due" role="cell">
          <!-- 沒有預計期限時不顯示「期限：」標籤（使用者決定） -->
          <span v-if="item.預計期限" class="work-item-table__mobile-label">期限：</span
          >{{ formatDate(item.預計期限) }}
        </div>

        <!--
        操作欄（橫排）：手機卡片是文字按鈕，平板是圖示按鈕（滑過用 title 顯示文字提示），桌面是圖示＋文字。
        圖示：Lucide pencil／copy／trash-2（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0
      -->
        <div
          v-if="editable"
          class="work-item-table__cell work-item-table__cell--actions"
          role="cell"
        >
          <!-- 手機卡片沒有項次欄，上移／下移放在操作列最前面（平板、桌面隱藏，改用項次欄的） -->
          <span v-if="!searchMode" class="work-item-table__move-group">
            <button
              type="button"
              class="work-item-table__move-btn"
              title="上移"
              aria-label="上移"
              :disabled="reordering || index === 0"
              @click="moveRow(index, -1)"
            >
              <svg
                class="work-item-table__move-icon"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
            <button
              type="button"
              class="work-item-table__move-btn"
              title="下移"
              aria-label="下移"
              :disabled="reordering || index === rows.length - 1"
              @click="moveRow(index, 1)"
            >
              <svg
                class="work-item-table__move-icon"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </span>
          <button
            type="button"
            class="work-item-table__action-btn work-item-table__action-btn--edit"
            title="編輯"
            aria-label="編輯"
            @click="emit('edit', item)"
          >
            <svg
              class="work-item-table__action-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
              />
              <path d="m15 5 4 4" />
            </svg>
            <span class="work-item-table__action-label">編輯</span>
          </button>
          <button
            type="button"
            class="work-item-table__action-btn work-item-table__action-btn--copy"
            title="複製"
            aria-label="複製"
            @click="emit('copy', item)"
          >
            <svg
              class="work-item-table__action-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span class="work-item-table__action-label">複製</span>
          </button>
          <button
            type="button"
            class="work-item-table__action-btn work-item-table__action-btn--danger"
            title="刪除"
            aria-label="刪除"
            @click="emit('delete', item)"
          >
            <svg
              class="work-item-table__action-icon"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span class="work-item-table__action-label">刪除</span>
          </button>
        </div>
      </div>
    </VueDraggable>

    <div v-if="rows.length === 0" class="work-item-table__empty">
      <template v-if="searchMode">找不到符合「{{ searchKeyword }}」的紀錄</template>
      <template v-else-if="dayOffLabel && viewingToday">今天放假呦！</template>
      <template v-else-if="dayOffLabel">這天放假呦！</template>
      <template v-else-if="viewingToday">今天還沒有紀錄</template>
      <template v-else>這天沒有紀錄</template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.work-item-table {
  // 展開中的列（底色、框線）與「展開／收合」（文字、滑過）依色系的顏色，見 &__row--expanded 與 ClampText
  --expand-bg: var(--color-black-100);
  --expand-border: var(--color-black-300);
  --expand-toggle: var(--color-black-700);
  --expand-toggle-hover: var(--color-black-800);

  // 平板、桌面第一欄（項次）的寬度；搜尋結果模式換成工作日期，要放得下 2026/10/09
  --index-col: 32px;

  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 0 16px;

  @media (min-width: 768px) {
    flex: 1 1 auto;
    gap: 0;
    padding: 0;
  }

  // 資料列的容器（拖曳排序的範圍）；表頭在它外面，所以資料列的 nth-child 從 1 開始算
  &__body {
    display: flex;
    flex-direction: column;
    gap: 12px;

    @media (min-width: 768px) {
      gap: 0;
    }
  }

  // 搜尋結果模式：第一欄放工作日期（2026/10/09），平板、桌面加寬。
  // 色系用 purple（使用者決定），階數比照今天（藍）：表頭 100、斑馬紋 050／000、邊框 200、文字 700。
  // 搜尋結果不會同時是今天／放假（使用端不傳那兩個 prop），請假、逾期的列照常用自己的顏色
  &--search {
    --index-col: 84px;
    --expand-bg: var(--color-purple-100);
    --expand-border: var(--color-purple-300);
    --expand-toggle: var(--color-purple-700);
    --expand-toggle-hover: var(--color-purple-800);

    .work-item-table__row {
      border: 1px solid var(--color-purple-200);

      @media (min-width: 768px) {
        border: none;
        border-bottom: 1px solid var(--color-purple-200);
      }

      &--header {
        @media (min-width: 768px) {
          background: var(--color-purple-100);
        }
      }

      &:not(.work-item-table__row--header):nth-child(odd) {
        background: var(--color-purple-050);
      }

      &:not(.work-item-table__row--header):nth-child(even) {
        background: var(--color-purple-000);
      }
    }
  }

  &--viewing-today {
    --expand-bg: var(--color-blue-100);
    --expand-border: var(--color-blue-300);
    --expand-toggle: var(--color-blue-700);
    --expand-toggle-hover: var(--color-blue-800);

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

      &:not(.work-item-table__row--header):nth-child(odd) {
        background: var(--color-blue-050);
      }

      &:not(.work-item-table__row--header):nth-child(even) {
        background: var(--color-blue-000);
      }
    }
  }

  &--holiday {
    --expand-bg: var(--color-orange-100);
    --expand-border: var(--color-orange-300);
    --expand-toggle: var(--color-orange-800);
    --expand-toggle-hover: var(--color-orange-900);

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

      &:not(.work-item-table__row--header):nth-child(odd) {
        background: var(--color-orange-050);
      }

      &:not(.work-item-table__row--header):nth-child(even) {
        background: var(--color-orange-000);
      }
    }

    &.work-item-table--viewing-today {
      --expand-bg: var(--color-yellow-100);
      --expand-border: var(--color-yellow-300);
      --expand-toggle: var(--color-yellow-800);
      --expand-toggle-hover: var(--color-yellow-900);

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

        &:not(.work-item-table__row--header):nth-child(odd) {
          background: var(--color-yellow-050);
        }

        &:not(.work-item-table__row--header):nth-child(even) {
          background: var(--color-yellow-000);
        }
      }
    }
  }

  &__row {
    position: relative;
    display: flex;
    flex-flow: row wrap;
    gap: 2px 8px;
    justify-content: space-between;
    padding: 12px 16px;
    font-size: 16px;
    border: 1px solid var(--color-black-200);
    border-radius: 8px;

    // 平板（768–1023px）：完成度、今日工時、預計期限三欄合併成一欄（第 6 欄），分成上下兩小行：
    // 上行完成度，下行工時置左、期限置右；其他欄位跨滿兩行（各欄的 grid-row／grid-column 寫在下方
    // &__cell 各自的區塊）；
    // 桌面（≥ 1024px）才恢復一欄一個欄位（使用者決定，平板寬度原本放不下）
    @media (min-width: 768px) {
      display: grid;
      grid-template-columns:
        var(--index-col) 99px minmax(103px, 1fr) minmax(62px, 1fr) minmax(62px, 1fr)
        120px 58px;
      gap: 2px 8px;
      padding: 8px 32px;
      font-size: 14px;
      border: none;
      border-bottom: 1px solid var(--color-black-200);
      border-radius: 0;
    }

    @media (min-width: 1024px) {
      grid-template-columns:
        var(--index-col) 99px minmax(103px, 1fr) minmax(62px, 1fr) minmax(62px, 1fr)
        62px 48px 77px 58px;
      gap: 8px;
    }

    .work-item-table--editable & {
      @media (min-width: 768px) {
        grid-template-columns:
          var(--index-col) 99px minmax(103px, 1fr) minmax(62px, 1fr) minmax(62px, 1fr)
          120px 58px 100px;
      }

      @media (min-width: 1024px) {
        grid-template-columns:
          var(--index-col) 99px minmax(103px, 1fr) minmax(62px, 1fr) minmax(62px, 1fr)
          62px 48px 77px 58px 208px;
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

    &:not(.work-item-table__row--header):nth-child(odd) {
      background: var(--color-black-050);
    }

    &:not(.work-item-table__row--header):nth-child(even) {
      background: var(--color-black-000);
    }

    // 展開中（使用者決定）：底色與 2px 框線依各自色系（顏色是 --expand-* 變數，定義在 .work-item-table
    // 的今天／放假修飾符與列的請假／逾期修飾符上，列自己的值優先）。用 isolation 建立堆疊脈絡、
    // ::before 放 z-index: -1：色塊蓋在列原本的底色（斑馬紋、今天、放假）上、文字下面，框線畫在 ::before
    // 上所以不影響排版；請假、逾期的左側標線也一起畫在 ::before 上，不會被色塊蓋掉
    &--expanded {
      isolation: isolate;

      &::before {
        position: absolute;
        inset: 0;
        z-index: -1;
        pointer-events: none;
        content: '';
        background: var(--expand-bg);
        border: 2px solid var(--expand-border);
        border-radius: inherit;
        box-shadow: inset 3px 0 0 var(--expand-marker, transparent);

        @media (min-width: 768px) {
          box-shadow: inset 4px 0 0 var(--expand-marker, transparent);
        }
      }
    }

    // 拖曳中留在原位的佔位列
    &--ghost {
      opacity: 0.4;
    }

    // 拖曳中跟著游標走的那一列：加陰影浮起來（使用者決定）
    &--dragging {
      background: var(--color-black-000);
      box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
      opacity: 1;
    }

    // 逾期、請假是列自己的屬性，展開時的顏色優先於今天／放假（使用者決定）
    &--overdue {
      --expand-bg: var(--color-red-050);
      --expand-border: var(--color-red-300);
      --expand-toggle: var(--color-red-700);
      --expand-toggle-hover: var(--color-red-800);
      --expand-marker: var(--color-red-600);

      border-left: 1px solid var(--color-red-600);
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      box-shadow: inset 3px 0 0 var(--color-red-600);

      // 只取消手機版加的左邊框；不能用 border: inherit，會連列的 border-bottom 一起清掉
      @media (min-width: 768px) {
        border-left: none;
        box-shadow: inset 4px 0 0 var(--color-red-600);
      }
    }

    // 請假列：文字與進度條用 teal 色系，左側標線同逾期樣式但用 teal（使用者決定）
    &--leave {
      --expand-bg: var(--color-teal-050);
      --expand-border: var(--color-teal-300);
      --expand-toggle: var(--color-teal-700);
      --expand-toggle-hover: var(--color-teal-800);
      --expand-marker: var(--color-teal-600);

      color: var(--color-teal-800);
      border-left: 1px solid var(--color-teal-600);
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      box-shadow: inset 3px 0 0 var(--color-teal-600);

      // 只取消手機版加的左邊框；不能用 border: inherit，會連列的 border-bottom 一起清掉
      @media (min-width: 768px) {
        border-left: none;
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

      // 平板、桌面：上移／數字／下移 由上而下疊
      @media (min-width: 768px) {
        display: flex;
        flex-direction: column;
        grid-row: 1 / span 2;
        grid-column: 1;
        gap: 2px;
        order: 0;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
      }
    }

    // 搜尋結果模式的工作日期：手機卡片自成最上面一行（項次欄在手機原本是隱藏的），
    // 平板、桌面沿用項次欄的位置
    &--date {
      display: flex;
      flex: 1 0 100%;
      order: -1;

      @media (min-width: 768px) {
        flex: none;
      }
    }

    // 工作目標、處理內容、專案名稱/Repo 的截斷交給 ClampText，儲存格本身不再設 line-clamp
    &--title {
      flex: 1 1 0;
      flex-direction: column;
      gap: 2px;
      align-items: flex-start;
      align-self: center;
      order: 0;
      width: auto;
      min-width: 0;
      font-size: 18px;
      font-weight: 500;
      line-height: 1.6;
      word-break: break-all;

      @media (min-width: 768px) {
        grid-row: 1 / span 2;
        grid-column: 3;
        order: 2;
        font-size: inherit;
        font-weight: inherit;
        line-height: inherit;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
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
        grid-row: 1 / span 2;
        grid-column: 7;
        align-items: center;
        order: 8;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
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
        grid-row: 1 / span 2;
        grid-column: 2;
        order: 1;
        margin-top: inherit;
        margin-bottom: inherit;
        font-size: inherit;
        color: inherit;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
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
      flex-direction: column;
      align-items: flex-start;
      align-self: center;
      justify-content: flex-start;
      order: 3;
      width: 100%;
      min-width: 0;
      word-break: break-all;

      @media (min-width: 768px) {
        grid-row: 1 / span 2;
        grid-column: 4;
        order: 3;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
      }

      // 表頭跟內容一樣置左（使用者決定），蓋過上面表頭共用的置中
      .work-item-table__row--header & {
        justify-content: flex-start;
        text-align: start;
      }
    }

    &--detail {
      flex-direction: column;
      align-items: flex-start;
      align-self: center;
      justify-content: flex-start;
      order: 4;
      width: 100%;
      min-width: 0;
      font-size: 14px;
      color: var(--color-black-500);
      word-break: break-all;

      @media (min-width: 768px) {
        grid-row: 1 / span 2;
        grid-column: 5;
        order: 4;
        font-size: inherit;
        color: inherit;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
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

      // 平板：合併欄上行，進度條跟百分比左右並排（同手機，使用者決定）；桌面才改成上下疊
      @media (min-width: 768px) {
        grid-row: 1;
        grid-column: 6;
        order: 6;
        font-size: inherit;
        color: inherit;
      }

      @media (min-width: 1024px) {
        flex-direction: column;
        grid-row: auto;
        grid-column: auto;
        gap: 2px;
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

      // 平板：合併欄下行的左邊
      @media (min-width: 768px) {
        grid-row: 2;
        grid-column: 6;
        justify-self: start;
        order: 5;
        font-size: inherit;
        color: inherit;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
        justify-self: auto;
        width: 100%;
      }

      // 表頭：平板只留這一格，用 ::after 補上「/預計期限」，跟「預計期限」表頭合成一行（那格在平板隱藏）
      .work-item-table__row--header & {
        @media (min-width: 768px) {
          justify-self: center;
          font-size: 13px;

          &::after {
            content: '/預計期限';
          }
        }

        @media (min-width: 1024px) {
          justify-self: auto;
          font-size: inherit;

          &::after {
            content: none;
          }
        }
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

      // 平板：合併欄下行的右邊
      @media (min-width: 768px) {
        grid-row: 2;
        grid-column: 6;
        justify-self: end;
        order: 7;
        font-size: inherit;
        color: inherit;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
        justify-self: auto;
        width: 100%;
      }

      // 表頭：平板併進「今日工時」那格（見上方 &--hours），這格先隱藏
      .work-item-table__row--header & {
        @media (min-width: 768px) {
          display: none;
        }

        @media (min-width: 1024px) {
          display: flex;
        }
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
        grid-row: 1 / span 2;
        grid-column: 8;
        gap: 4px;
        justify-content: center;
        order: 9;
        padding-top: unset;
        margin-top: unset;
        border-top: none;
      }

      @media (min-width: 1024px) {
        grid-row: auto;
        grid-column: auto;
      }
    }
  }

  &__mobile-label {
    display: inline;

    @media (min-width: 768px) {
      display: none;
    }

    // 單位（hr）：平板合併欄不顯示「工時：」「期限：」標籤，但保留 hr 單位（使用者決定）；桌面有表頭，不顯示
    &--unit {
      @media (min-width: 768px) {
        display: inline;
      }

      @media (min-width: 1024px) {
        display: none;
      }
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

    // 展開中：完整顯示，超長的換行並改成圓角矩形（多行時 999px 圓角會變成扁橢圓）
    .work-item-table__row--expanded & {
      max-width: 100%;
      white-space: normal;
      border-radius: 8px;
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

    // 百分比：手機、平板固定 46px 靠右（每列進度條等長，放得下「12.25%」）；桌面才改成置中
    &-text {
      flex: 0 0 46px;
      width: 46px;
      text-align: end;

      @media (min-width: 1024px) {
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

    // 複製：中性灰，跟編輯（藍）、刪除（紅）區分
    &--copy {
      color: var(--color-black-600);
      background: var(--color-black-000);
      border: 1px solid var(--color-black-300);

      &:hover {
        color: var(--color-black-000);
        background: var(--color-black-600);
        border: 1px solid var(--color-black-600);
      }
    }

    // 刪除跟前面的按鈕拉開到 12px，避免誤按（使用者決定）：手機 gap 8px＋4px
    &--danger {
      margin-left: 4px;
      color: var(--color-red-600);
      background: var(--color-red-000);
      border: 1px solid var(--color-red-600);

      &:hover {
        color: var(--color-black-000);
        background: var(--color-red-700);
        border: 1px solid var(--color-red-700);
      }
    }

    // 平板：28px 正方形圖示按鈕，文字收起來（按鈕名稱靠 aria-label，滑過靠 title 顯示）
    @media (min-width: 768px) {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;

      // 平板、桌面 gap 4px＋8px＝12px
      &--danger {
        margin-left: 8px;
      }
    }

    // 桌面：圖示＋文字橫排（使用者決定），按鈕寬度隨內容
    @media (min-width: 1024px) {
      gap: 4px;
      width: auto;
      padding: 0 8px;
    }
  }

  // 圖示：手機不顯示（文字按鈕），平板、桌面顯示
  // 拖曳把手：手機在卡片右上角（第一行，排在狀態後面）；桌面、平板放在列左側 32px 內距裡
  // （絕對定位，不佔 grid 欄位，表格寬度不用變）。平時淡灰，滑過那一列時變深
  &__drag-handle {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    order: 1;
    width: 24px;
    height: 24px;
    color: var(--color-black-300);
    touch-action: none;
    cursor: grab;

    .work-item-table__row:hover & {
      color: var(--color-black-600);
    }

    &:active {
      cursor: grabbing;
    }

    @media (min-width: 768px) {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 6px;
      width: 20px;
      height: auto;
    }
  }

  // 搜尋結果的工作日期：連結樣式的按鈕，點了跳到那天
  &__date-link {
    padding: 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-purple-700);
    white-space: nowrap;
    cursor: pointer;
    background: none;
    border: none;

    &:hover {
      color: var(--color-purple-800);
      text-decoration: underline;
    }

    @media (min-width: 768px) {
      font-size: 14px;
    }
  }

  &__drag-icon {
    width: 16px;
    height: 16px;
  }

  // 上移／下移：平板、桌面放在項次欄（數字上下），手機放在操作列最前面
  &__move-btn {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    color: var(--color-black-600);
    cursor: pointer;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-300);
    border-radius: 6px;

    &:hover:not(:disabled) {
      color: var(--color-black-000);
      background: var(--color-black-600);
      border-color: var(--color-black-600);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    @media (min-width: 768px) {
      width: 24px;
      height: 18px;
      border-color: transparent;
    }
  }

  &__move-icon {
    width: 16px;
    height: 16px;
  }

  &__move-group {
    display: inline-flex;
    flex: none;
    gap: 8px;

    @media (min-width: 768px) {
      display: none;
    }
  }

  &__action-icon {
    display: none;
    flex: none;
    width: 16px;
    height: 16px;

    @media (min-width: 768px) {
      display: block;
    }
  }

  // 文字：手機、桌面顯示，平板收起來（只顯示圖示）
  &__action-label {
    @media (min-width: 768px) {
      display: none;
    }

    @media (min-width: 1024px) {
      display: inline;
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

    .work-item-table--search & {
      color: var(--color-purple-700);
      background: var(--color-purple-000);
      border: 1px solid var(--color-purple-200);

      @media (min-width: 768px) {
        border: none;
      }
    }
  }
}
</style>
