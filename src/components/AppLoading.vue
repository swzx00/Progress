<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 轉圈下方的說明文字，不含結尾的點點（點點由元件自己做動畫） */
    label?: string;
  }>(),
  {
    label: '載入中',
  },
);
</script>

<template>
  <!-- 只負責轉圈＋文字本身，外層要佔多少空間、怎麼留白由使用端決定 -->
  <div class="app-loading" role="status">
    <span class="app-loading__spinner" aria-hidden="true"></span>
    <!-- 點點三顆輪流閃爍：一直都在、只變透明度，寬度固定，置中的文字不會跳動；螢幕閱讀器只唸 label。
         label 跟點點要寫在同一行，中間有換行的話會被壓成一個空白，變成「載入中 ...」 -->
    <span class="app-loading__label"
      >{{ label
      }}<span class="app-loading__dots" aria-hidden="true"
        ><span class="app-loading__dot">.</span><span class="app-loading__dot">.</span
        ><span class="app-loading__dot">.</span></span
      ></span
    >
  </div>
</template>

<style scoped lang="scss">
.app-loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  justify-content: center;
  color: var(--color-black-500);

  &__spinner {
    width: 28px;
    height: 28px;
    border: 3px solid var(--color-black-100);
    border-top-color: var(--color-blue-500);
    border-radius: 50%;
    animation: app-loading-spin 0.7s linear infinite;
  }

  &__label {
    font-size: 12px;
    font-weight: 400;
    line-height: 1;
    color: var(--color-black-400);
  }

  &__dot {
    animation: app-loading-blink 1.2s ease-in-out infinite;

    // 三顆點錯開 0.2 秒，形成依序亮起的波浪
    &:nth-child(2) {
      animation-delay: 0.2s;
    }

    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }

  @keyframes app-loading-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes app-loading-blink {
    0%,
    80%,
    100% {
      opacity: 0.2;
    }

    40% {
      opacity: 1;
    }
  }
}
</style>
