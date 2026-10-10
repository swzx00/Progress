<script setup lang="ts">
import { useToast } from '@/composables/useToast';

const { toast, hideToast } = useToast();
</script>

<template>
  <!-- aria-live 區域要一直存在，內容出現時螢幕閱讀器才會唸出來 -->
  <div class="app-toast" aria-live="assertive">
    <!-- out-in：新訊息取代舊訊息時，先讓舊的淡出再顯示新的，避免兩則短暫疊在一起 -->
    <Transition name="app-toast" mode="out-in">
      <div
        v-if="toast"
        :key="toast.id"
        class="app-toast__panel"
        :class="{ 'app-toast__panel--success': toast.type === 'success' }"
        :role="toast.type === 'success' ? 'status' : 'alert'"
      >
        <span class="app-toast__icon" aria-hidden="true">{{
          toast.type === 'success' ? '✓' : '⚠'
        }}</span>
        <span class="app-toast__message">{{ toast.message }}</span>
        <button type="button" class="app-toast__close" aria-label="關閉" @click="hideToast">
          ✕
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
// 疊在 Drawer／Modal（z-index 100）之上，畫面上方置中，避免擋到手機底部的操作區
.app-toast {
  position: fixed;
  top: 16px;
  left: 50%;
  z-index: 200;
  width: calc(100% - 32px);
  max-width: 400px;
  pointer-events: none;
  transform: translateX(-50%);

  &__panel {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 12px 12px 12px 16px;
    font-size: 14px;
    color: var(--color-red-700);
    pointer-events: auto;
    background: var(--color-red-000);
    border: 1px solid var(--color-red-200);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 12%);

    // 操作成功：綠色系，跟錯誤的紅色區分
    &--success {
      color: var(--color-green-800);
      background: var(--color-green-000);
      border-color: var(--color-green-200);
    }
  }

  &__icon {
    flex: none;
  }

  &__message {
    flex: 1 1 auto;
    overflow-wrap: anywhere;
  }

  &__close {
    flex: none;
    padding: 0 4px;
    font-size: 14px;
    line-height: inherit;
    color: inherit;
    cursor: pointer;
    background: transparent;
    border: none;
  }
}

.app-toast-enter-active,
.app-toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.app-toast-enter-from,
.app-toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
