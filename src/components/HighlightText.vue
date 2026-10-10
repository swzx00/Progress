<script setup lang="ts">
import type { TextSegment } from '@/utils/search-work-items';

/**
 * 搜尋結果標示符合的字：把 splitHighlight 切好的片段逐段渲染，符合的包在 mark 裡（yellow-100 底＋粗體 purple-900 字）。
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
// 搜尋結果的色系是 purple，底色用相對色系 yellow（使用者決定）。選階：紫字對黃底在淺色、深色模式都要 ≥ 4.5:1，
// yellow-050 在深色模式是 black（B 版例外），看不出底色，所以最淺用 yellow-100；配 yellow-100 只有 purple-900 兩種模式都過
// （淺色 #ffefa3／#3b1643 13.12:1、深色 #8f590d／#f2e7f9 4.88:1）。不加內距，不影響 ClampText 的截斷判斷與排版
.highlight-text__match {
  font-weight: 700;
  color: var(--color-purple-900);
  background: var(--color-yellow-100);
  border-radius: 2px;
  box-decoration-break: clone;
}
</style>
