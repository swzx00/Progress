<script setup lang="ts">
import { computed, ref } from 'vue';

import { useOptions } from '@/composables/useOptions';
import {
  buildSuggestions,
  SEARCH_FIELD_LABELS,
  SEARCH_KEYWORD_MAX,
  type SearchQuery,
  type SearchSuggestion,
} from '@/utils/search-work-items';

/**
 * 搜尋欄（使用者決定）：打字時跳出「推薦選擇」，按 Enter、搜尋按鈕或點推薦才 emit search，
 * 由使用端（HomeView）到後端查全部資料並顯示搜尋結果。
 * - 推薦只用瀏覽器裡已經有的選項清單＋近期紀錄的工作目標（useOptions，第一次聚焦時才讀），不打 API
 * - 推薦清單第一項固定是「搜尋全部欄位」，其餘是 buildSuggestions 的結果；點推薦只搜那個欄位
 * - 鍵盤：上下鍵移動、Enter 送出（沒選推薦就是搜尋全部欄位）、Esc 先關推薦，推薦已關時清除搜尋
 * - 清空輸入框（✕、Esc、自己刪光）就 emit clear，回到單日表格
 */
const keyword = defineModel<string>({ required: true });

const emit = defineEmits<{
  search: [query: SearchQuery];
  clear: [];
}>();

const { options, recentItems, fetchOptions } = useOptions();

const LISTBOX_ID = 'work-item-search-listbox';

const open = ref(false);
// 推薦清單目前反白的項目（-1 代表沒有選，Enter 就是搜尋全部欄位）
const activeIndex = ref(-1);

const trimmed = computed(() => keyword.value.trim());

interface Choice {
  id: string;
  query: SearchQuery;
  suggestion?: SearchSuggestion;
}

const choices = computed<Choice[]>(() => {
  if (!trimmed.value) return [];
  return [
    { id: `${LISTBOX_ID}-all`, query: { keyword: trimmed.value } },
    ...buildSuggestions(trimmed.value, options.value, recentItems.value).map(
      (suggestion, index) => ({
        id: `${LISTBOX_ID}-${index}`,
        query: { keyword: suggestion.value, field: suggestion.field },
        suggestion,
      }),
    ),
  ];
});

const showList = computed(() => open.value && choices.value.length > 0);

const activeId = computed(() =>
  showList.value && activeIndex.value >= 0 ? choices.value[activeIndex.value]?.id : undefined,
);

/** 推薦的值裡符合關鍵字的那一段（不分大小寫），拆開來加粗顯示 */
const highlight = (value: string): { before: string; match: string; after: string } => {
  const start = value.toLowerCase().indexOf(trimmed.value.toLowerCase());
  if (start === -1) return { before: value, match: '', after: '' };
  const end = start + trimmed.value.length;
  return { before: value.slice(0, start), match: value.slice(start, end), after: value.slice(end) };
};

const onFocus = (): void => {
  void fetchOptions();
  if (trimmed.value) open.value = true;
};

// 用輸入框本身的值判斷有沒有刪光：v-model 的 keyword 要等父層重新渲染才會更新，
// 使用者打字時瀏覽器會先跑完那次更新，但程式觸發的 input 事件（例如測試）讀到的會是舊值
const onInput = (event: Event): void => {
  activeIndex.value = -1;
  open.value = true;
  if (!(event.target as HTMLInputElement).value) emit('clear');
};

const submit = (query: SearchQuery): void => {
  if (!query.keyword.trim()) return;
  keyword.value = query.keyword;
  open.value = false;
  activeIndex.value = -1;
  emit('search', query);
};

const submitActive = (): void => {
  const choice = activeIndex.value >= 0 ? choices.value[activeIndex.value] : undefined;
  submit(choice ? choice.query : { keyword: trimmed.value });
};

const move = (step: 1 | -1): void => {
  if (!choices.value.length) return;
  if (!showList.value) {
    open.value = true;
    return;
  }
  const count = choices.value.length;
  activeIndex.value = (activeIndex.value + step + count + 1) % (count + 1);
  // 最後一項再往下（或第一項再往上）回到「沒有選」，Enter 就是搜尋全部欄位
  if (activeIndex.value === count) activeIndex.value = -1;
};

const clear = (): void => {
  keyword.value = '';
  open.value = false;
  activeIndex.value = -1;
  emit('clear');
};

const onEscape = (): void => {
  if (showList.value) {
    open.value = false;
    activeIndex.value = -1;
    return;
  }
  clear();
};

const onBlur = (): void => {
  open.value = false;
  activeIndex.value = -1;
};
</script>

<template>
  <div class="work-item-search" role="search">
    <div class="work-item-search__field">
      <input
        v-model="keyword"
        type="text"
        class="work-item-search__input"
        placeholder="搜尋全部紀錄"
        aria-label="搜尋全部紀錄"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="showList"
        :aria-controls="LISTBOX_ID"
        :aria-activedescendant="activeId"
        :maxlength="SEARCH_KEYWORD_MAX"
        autocomplete="off"
        enterkeyhint="search"
        @focus="onFocus"
        @input="onInput"
        @blur="onBlur"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="submitActive"
        @keydown.esc.prevent="onEscape"
      />
      <button
        v-if="keyword"
        type="button"
        class="work-item-search__clear"
        title="清除搜尋"
        aria-label="清除搜尋"
        @click="clear"
      >
        <!-- 圖示：Lucide x（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0 -->
        <svg
          class="work-item-search__icon"
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
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>

      <!-- 推薦選擇：mousedown.prevent 讓點選時輸入框不會先失焦把清單關掉 -->
      <ul
        v-show="showList"
        :id="LISTBOX_ID"
        class="work-item-search__list"
        role="listbox"
        aria-label="搜尋推薦"
      >
        <li
          v-for="(choice, index) in choices"
          :id="choice.id"
          :key="choice.id"
          class="work-item-search__option"
          :class="{ 'work-item-search__option--active': index === activeIndex }"
          role="option"
          :aria-selected="index === activeIndex"
          @mousedown.prevent
          @mouseenter="activeIndex = index"
          @click="submit(choice.query)"
        >
          <span class="work-item-search__category">
            {{ choice.suggestion ? SEARCH_FIELD_LABELS[choice.suggestion.field] : '全部欄位' }}
          </span>
          <span class="work-item-search__value">
            <template v-if="choice.suggestion">
              {{ highlight(choice.suggestion.value).before
              }}<mark class="work-item-search__match">{{
                highlight(choice.suggestion.value).match
              }}</mark
              >{{ highlight(choice.suggestion.value).after }}
            </template>
            <template v-else>搜尋「{{ trimmed }}」</template>
          </span>
        </li>
      </ul>
    </div>
    <button
      type="button"
      class="work-item-search__submit"
      title="搜尋"
      aria-label="搜尋"
      :disabled="!trimmed"
      @click="submit({ keyword: trimmed })"
    >
      <!-- 圖示：Lucide search（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0 -->
      <svg
        class="work-item-search__icon"
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
        <path d="m21 21-4.34-4.34" />
        <circle cx="11" cy="11" r="8" />
      </svg>
    </button>
  </div>
</template>

<style scoped lang="scss">
// 輸入框＋右邊的搜尋按鈕接在一起；寬度由使用端（DateNav）決定
.work-item-search {
  display: flex;
  width: 100%;

  &__field {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    min-width: 0;
  }

  // 手機用 16px：iOS Safari 聚焦字級 < 16px 的輸入框時會自動放大畫面
  &__input {
    width: 100%;
    height: 34px;
    padding: 0 34px 0 10px;
    font-size: 16px;
    color: var(--color-black-800);
    outline: none;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-100);
    border-right: none;
    border-radius: 6px 0 0 6px;

    &::placeholder {
      color: var(--color-black-500);
    }

    &:focus {
      border-color: var(--color-blue-500);
    }

    @media (min-width: 768px) {
      font-size: 14px;
    }
  }

  &__clear {
    position: absolute;
    right: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    color: var(--color-black-500);
    cursor: pointer;
    background: transparent;
    border: none;
    border-radius: 4px;

    &:hover {
      color: var(--color-black-800);
      background: var(--color-black-050);
    }
  }

  &__submit {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 34px;
    padding: 0;
    color: var(--color-black-000);
    cursor: pointer;
    background: var(--color-blue-500);
    border: 1px solid var(--color-blue-500);
    border-radius: 0 6px 6px 0;

    &:hover:not(:disabled) {
      background: var(--color-blue-700);
      border-color: var(--color-blue-700);
    }

    &:disabled {
      cursor: not-allowed;
      background: var(--color-blue-300);
      border-color: var(--color-blue-300);
    }
  }

  &__icon {
    width: 16px;
    height: 16px;
  }

  &__list {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    left: 0;
    z-index: 20;
    max-height: 320px;
    padding: 4px 0;
    margin: 0;
    overflow-y: auto;
    list-style: none;
    background: var(--color-black-000);
    border: 1px solid var(--color-black-100);
    border-radius: 6px;
    box-shadow: 0 6px 16px rgb(0 0 0 / 12%);
  }

  &__option {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 10px;
    font-size: 14px;
    color: var(--color-black-800);
    cursor: pointer;

    &--active {
      background: var(--color-blue-050);
    }
  }

  // 分類標籤（交辦單位、專案名稱…）：固定寬度讓值對齊
  &__category {
    flex: none;
    width: 64px;
    font-size: 12px;
    color: var(--color-black-500);
  }

  &__value {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__match {
    font-weight: 600;
    color: var(--color-blue-700);
    background: none;
  }
}
</style>
