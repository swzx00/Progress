<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 返回最上（使用者決定）：固定在畫面右下角的圖示按鈕，點了捲回頁面最頂端。
 * 預設不顯示，往下捲超過 threshold（使用端傳頁首標題列的高度）才出現
 */
const props = defineProps<{
  /** 捲動超過幾 px 才顯示 */
  threshold: number;
}>();

const visible = ref(false);

const update = (): void => {
  visible.value = window.scrollY > props.threshold;
};

onMounted(() => {
  update();
  window.addEventListener('scroll', update, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', update);
});

// 系統設定減少動態效果時直接跳回頂端，不播平滑捲動
const scrollToTop = (): void => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
};
</script>

<template>
  <Transition name="back-to-top">
    <button
      v-if="visible"
      type="button"
      class="back-to-top"
      title="返回最上"
      aria-label="返回最上"
      @click="scrollToTop"
    >
      <!-- 圖示：Lucide arrow-up（https://lucide.dev，ISC 授權），路徑取自 lucide-static 1.52.0 -->
      <svg
        class="back-to-top__icon"
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
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </svg>
    </button>
  </Transition>
</template>

<style scoped lang="scss">
// 疊在頁面內容與固定的工具列（z-index 10）之上、Drawer／Modal（z-index 100）之下：開著表單時被遮罩蓋住
.back-to-top {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  color: var(--color-black-800);
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 999px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 15%);

  &:hover {
    color: var(--color-blue-500);
    border-color: var(--color-blue-500);
  }

  @media (min-width: 768px) {
    right: 32px;
    bottom: 32px;
  }
}

.back-to-top__icon {
  width: 20px;
  height: 20px;
}

// 出現／消失：淡入淡出＋輕微上移
.back-to-top-enter-active,
.back-to-top-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.back-to-top-enter-from,
.back-to-top-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
