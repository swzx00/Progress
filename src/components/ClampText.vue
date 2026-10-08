<script setup lang="ts">
import { NTooltip } from 'naive-ui';
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue';

/**
 * 文字刪節：收合時最多顯示 mobileLines（手機）／lines（平板、桌面）行，超過的部分截斷。
 * - 被截斷時，「…展開」接在最後一行的最後面（float 繞排：文字自動在按鈕前面斷開，不用拿底色去蓋文字，
 *   斑馬紋、今天、放假、請假等各種底色都不會穿幫）；展開後全文顯示，下一行出現「收合」（使用者決定）
 * - 展開／收合的狀態由使用端決定（expanded），按鈕只 emit toggle
 * - 按鈕顏色吃使用端設定的 CSS 變數 --expand-toggle／--expand-toggle-hover（依列的色系），
 *   沒設定時用主色 blue-700／blue-800
 * - 有滑鼠的裝置（hover: hover、pointer: fine）滑過被截斷的文字，用 NTooltip 顯示全文
 *   （延遲 0.3 秒、寬度上限 360px）；觸控裝置不做 tooltip
 * - 子元素加 data-ellipsis 的（例如 Repo 膠囊單行「…」截斷），寬度被截斷也算被截斷
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
  }>(),
  {
    expanded: false,
    lines: 2,
    mobileLines: 3,
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
        :class="{ 'clamp-text--expanded': expanded }"
        :style="{ '--clamp-lines': lines, '--clamp-mobile-lines': mobileLines }"
      >
        <div ref="body" class="clamp-text__body">
          <!-- 收合且被截斷：浮在最後一行右側，文字會在它前面斷開 -->
          <span v-if="clamped && !expanded" class="clamp-text__more"
            >…<button
              type="button"
              class="clamp-text__toggle"
              :aria-expanded="false"
              @click="emit('toggle', $event)"
            >
              展開
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
            收合
          </button>
        </div>
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
    color: var(--expand-toggle, var(--color-blue-700));
    cursor: pointer;
    background: none;
    border: none;

    &::after {
      position: absolute;
      inset: -8px -4px;
      content: '';
    }

    &:hover {
      color: var(--expand-toggle-hover, var(--color-blue-800));
      text-decoration: underline;
    }

    // 收合：展開後全文的下一行
    &--collapse {
      display: block;
      margin-top: 2px;
      margin-left: 0;
    }
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
