<script setup lang="ts">
import { NTooltip } from 'naive-ui';
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue';

/**
 * 文字刪節：收合時最多顯示 mobileLines（手機）／lines（平板、桌面）行，超過的部分截斷。
 * - 被截斷時，「…<展開>」接在最後一行的最後面（float 繞排：文字自動在按鈕前面斷開，不用拿底色去蓋文字，
 *   斑馬紋、今天、放假、請假等各種底色都不會穿幫）；展開後全文顯示，下一行出現「<收合>」（按鈕文字含角括號，使用者決定）
 * - 展開／收合的狀態由使用端決定（expanded），按鈕只 emit toggle
 * - 按鈕顏色吃使用端設定的 CSS 變數 --expand-toggle／--expand-toggle-hover（依列的色系），
 *   沒設定時用 black-700／black-800
 * - 有滑鼠的裝置（hover: hover、pointer: fine）滑過被截斷的文字，用 NTooltip 顯示全文
 *   （延遲 0.3 秒、寬度上限 360px）；觸控裝置不做 tooltip
 * - 子元素加 data-ellipsis 的（例如 Repo 膠囊單行「…」截斷），寬度被截斷也算被截斷
 * - inlineToggle 為 false 時（專案名稱/Repo：膠囊本身已經有「…」），不加「…」也不接在行尾，
 *   「<展開>」直接放在截斷內容的下一行（使用者決定）
 */
const props = withDefaults(
  defineProps<{
    /** tooltip 顯示的全文 */
    fullText: string;
    /** 使用端展開中：不截斷、不顯示 tooltip */
    expanded?: boolean;
    /** 平板、桌面收合時的行數 */
    lines?: number;
    /** 手機收合時的行數 */
    mobileLines?: number;
    /** 「…<展開>」接在最後一行尾端（true），或「<展開>」放在截斷內容的下一行（false） */
    inlineToggle?: boolean;
  }>(),
  {
    expanded: false,
    lines: 2,
    mobileLines: 3,
    inlineToggle: true,
  },
);

const emit = defineEmits<{
  /** 點「展開」或「收合」 */
  toggle: [event: MouseEvent];
}>();

const body = ref<HTMLElement | null>(null);
/** 收合狀態下是否被截斷（只在收合時判斷，展開中維持上一次的結果，「收合」才知道要不要出現） */
const clamped = ref(false);

const measure = (): void => {
  const node = body.value;
  if (!node || props.expanded) return;
  // 量的時候先把「…展開」拿掉，不然剛好放得下的文字會被按鈕擠出一行、誤判成被截斷
  const more = node.querySelector<HTMLElement>('.clamp-text__more');
  if (more) more.style.display = 'none';
  const heightClamped = node.scrollHeight > node.clientHeight + 1;
  const widthClamped = Array.from(node.querySelectorAll<HTMLElement>('[data-ellipsis]')).some(
    (child) => child.scrollWidth > child.clientWidth + 1,
  );
  if (more) more.style.display = '';
  clamped.value = heightClamped || widthClamped;
};

// 有滑鼠的裝置才做 tooltip
const hoverQuery =
  typeof window !== 'undefined' ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
const canHover = ref(hoverQuery?.matches ?? false);
const onHoverChange = (e: MediaQueryListEvent): void => {
  canHover.value = e.matches;
};

let observer: ResizeObserver | null = null;

onMounted(() => {
  measure();
  observer = new ResizeObserver(() => measure());
  if (body.value) observer.observe(body.value);
  hoverQuery?.addEventListener('change', onHoverChange);
});

// 內容（文字、Repo）變動後重新判斷
onUpdated(() => measure());

// 收回時等畫面套用截斷樣式後再判斷
watch(
  () => props.expanded,
  async (expanded) => {
    if (expanded) return;
    await nextTick();
    measure();
  },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  hoverQuery?.removeEventListener('change', onHoverChange);
});
</script>

<template>
  <NTooltip
    :disabled="!canHover || !clamped || expanded"
    :delay="300"
    placement="top-start"
    :style="{ maxWidth: '360px' }"
  >
    <template #trigger>
      <div
        class="clamp-text"
        :class="{ 'clamp-text--expanded': expanded, 'clamp-text--block-toggle': !inlineToggle }"
        :style="{ '--clamp-lines': lines, '--clamp-mobile-lines': mobileLines }"
      >
        <div ref="body" class="clamp-text__body">
          <!-- 收合且被截斷：浮在最後一行右側，文字會在它前面斷開 -->
          <span v-if="inlineToggle && clamped && !expanded" class="clamp-text__more"
            >…<button
              type="button"
              class="clamp-text__toggle"
              :aria-expanded="false"
              @click="emit('toggle', $event)"
            >
              &lt;展開&gt;
            </button></span
          >
          <slot />
          <button
            v-if="clamped && expanded"
            type="button"
            class="clamp-text__toggle clamp-text__toggle--collapse"
            :aria-expanded="true"
            @click="emit('toggle', $event)"
          >
            &lt;收合&gt;
          </button>
        </div>
        <!-- 不接在行尾的模式：收合時「<展開>」放在截斷內容的下一行（在 __body 外面才不會被截掉） -->
        <button
          v-if="!inlineToggle && clamped && !expanded"
          type="button"
          class="clamp-text__toggle clamp-text__toggle--collapse"
          :aria-expanded="false"
          @click="emit('toggle', $event)"
        >
          &lt;展開&gt;
        </button>
      </div>
    </template>
    <div class="clamp-text__tooltip">{{ fullText }}</div>
  </NTooltip>
</template>

<style scoped lang="scss">
// flex 讓 __body 的高度是確定值，::before 的 height: 100% 才算得出來
.clamp-text {
  display: flex;
  width: 100%;
  min-width: 0;

  &__body {
    width: 100%;
    max-height: calc(var(--clamp-mobile-lines) * 1lh);
    overflow: hidden;
    word-break: break-all;

    // 保留使用者在表單按 Enter 打的換行（處理內容、工作目標），不然會被當成空白連成一段
    white-space: pre-wrap;

    // 佔位：把「…展開」推到最後一行（高度＝收合高度扣掉一行）
    &::before {
      float: right;
      height: calc(100% - 1lh);
      content: '';
    }

    @media (min-width: 768px) {
      max-height: calc(var(--clamp-lines) * 1lh);
    }
  }

  &__more {
    float: right;
    clear: both;
    white-space: normal;
  }

  // 「展開／收合」：依列的色系（--expand-toggle），滑過變深並出現底線；
  // ::after 往外撐開點擊範圍，手機比較好點，不影響排版
  &__toggle {
    position: relative;
    padding: 0;
    margin-left: 2px;
    font: inherit;
    font-size: 0.875em;
    font-weight: 500;
    color: var(--expand-toggle, var(--color-black-700));

    // 按鈕文字前後的空白不要被 pre-wrap 保留
    white-space: normal;
    cursor: pointer;
    background: none;
    border: none;

    &::after {
      position: absolute;
      inset: -8px -4px;
      content: '';
    }

    &:hover {
      color: var(--expand-toggle-hover, var(--color-black-800));
      text-decoration: underline;
    }

    // 獨立一行的按鈕（展開後的收合、Repo 欄的展開）：寬度跟著文字走，不要被撐滿整欄
    // （Repo 欄的展開在 flex column 裡，預設 align-items: stretch 會把按鈕拉滿）
    &--collapse {
      display: block;
      align-self: flex-start;
      width: fit-content;
      margin-top: 2px;
      margin-left: 0;
    }
  }

  // 不接在行尾：內容與「<展開>」上下排，也不需要把按鈕推到最後一行的佔位
  &--block-toggle {
    flex-direction: column;
  }

  &--block-toggle &__body::before {
    display: none;
  }

  &--expanded &__body {
    max-height: none;
    overflow: visible;

    &::before {
      display: none;
    }
  }

  // tooltip 內容：保留換行，太長的在框內捲動
  &__tooltip {
    max-height: 320px;
    overflow: auto;
    word-break: break-all;
    white-space: pre-wrap;
  }
}
</style>
