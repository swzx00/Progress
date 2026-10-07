<script setup lang="ts">
import { NTooltip } from 'naive-ui';
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue';

/**
 * 文字刪節：收合時最多顯示 mobileLines（手機）／lines（平板、桌面）行，超過的部分截斷。
 * - 只負責截斷與「是不是真的被截斷」的判斷，展開／收合的狀態由使用端決定（expanded）
 * - 有滑鼠的裝置（hover: hover、pointer: fine）滑過被截斷的文字，用 NTooltip 顯示全文
 *   （延遲 0.3 秒、寬度上限 360px）；觸控裝置不做 tooltip，靠使用端的「展開」看全文
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
  /** 收合狀態下內容是否被截斷（只在收合時判斷，展開中維持上一次的結果） */
  overflow: [value: boolean];
}>();

const el = ref<HTMLElement | null>(null);
const clamped = ref(false);

const measure = (): void => {
  const node = el.value;
  if (!node || props.expanded) return;
  const heightClamped = node.scrollHeight > node.clientHeight + 1;
  const widthClamped = Array.from(node.querySelectorAll<HTMLElement>('[data-ellipsis]')).some(
    (child) => child.scrollWidth > child.clientWidth + 1,
  );
  const next = heightClamped || widthClamped;
  if (next !== clamped.value) {
    clamped.value = next;
    emit('overflow', next);
  }
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
  if (el.value) observer.observe(el.value);
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
        ref="el"
        class="clamp-text"
        :class="{ 'clamp-text--expanded': expanded }"
        :style="{ '--clamp-lines': lines, '--clamp-mobile-lines': mobileLines }"
      >
        <slot />
      </div>
    </template>
    <div class="clamp-text__tooltip">{{ fullText }}</div>
  </NTooltip>
</template>

<style scoped lang="scss">
.clamp-text {
  display: -webkit-box;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  -webkit-line-clamp: var(--clamp-mobile-lines);
  word-break: break-all;
  -webkit-box-orient: vertical;

  &--expanded {
    display: block;
    overflow: visible;
  }

  @media (min-width: 768px) {
    -webkit-line-clamp: var(--clamp-lines);
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
