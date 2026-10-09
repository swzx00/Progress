<script setup lang="ts">
import type { TextSegment } from '@/utils/search-work-items';

/**
 * 搜尋結果標示符合的字：把 splitHighlight 切好的片段逐段渲染，符合的包在 mark 裡（文字 purple-700＋底線）。
 * 用文字插值渲染，不用 v-html，使用者輸入的內容不會被當成 HTML
 */
defineProps<{
  segments: TextSegment[];
}>();
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index"
    ><mark v-if="segment.match" class="highlight-text__match">{{ segment.text }}</mark
    ><template v-else>{{ segment.text }}</template></template
  >
</template>

<style scoped lang="scss">
// 搜尋結果的色系是 purple；不加底色，請假、逾期列也一樣用 purple-700
.highlight-text__match {
  color: var(--color-purple-700);
  text-decoration: underline;
  text-underline-offset: 2px;
  background: transparent;
}
</style>
