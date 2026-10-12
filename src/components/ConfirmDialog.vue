<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { useScrollLock } from '@/composables/useScrollLock';

/**
 * 按鈕配置參照 Apple Human Interface Guidelines（Alerts）：
 * - 取消在前（左）、動作在後（右）
 * - danger（破壞性動作）：動作按鈕用紅色文字，不是紅色實心底；預設按鈕（粗體、
 *   開啟時取得焦點、按 Enter 觸發）改成比較安全的「取消」，避免誤按就執行破壞性動作
 * - 非 danger：動作按鈕是預設按鈕（主色實心底、取得焦點）
 */
const props = withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    busy?: boolean;
  }>(),
  {
    confirmLabel: '確定',
    cancelLabel: '取消',
    danger: false,
    busy: false,
  },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const cancelBtn = ref<HTMLButtonElement | null>(null);
const confirmBtn = ref<HTMLButtonElement | null>(null);

onMounted(() => {
  (props.danger ? cancelBtn : confirmBtn).value?.focus();
});

// 有遮罩：開著時頁面不能捲動、不顯示捲軸
useScrollLock();
</script>

<template>
  <div class="confirm-dialog">
    <div class="confirm-dialog__backdrop" @click="emit('cancel')" />
    <div class="confirm-dialog__panel" role="alertdialog" aria-modal="true">
      <h2 class="confirm-dialog__title">{{ title }}</h2>
      <p class="confirm-dialog__message">{{ message }}</p>
      <div class="confirm-dialog__actions">
        <button
          ref="cancelBtn"
          type="button"
          class="confirm-dialog__btn"
          :class="{ 'confirm-dialog__btn--preferred': danger }"
          :disabled="busy"
          @click="emit('cancel')"
        >
          {{ cancelLabel }}
        </button>
        <button
          ref="confirmBtn"
          type="button"
          class="confirm-dialog__btn"
          :class="danger ? 'confirm-dialog__btn--danger' : 'confirm-dialog__btn--primary'"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ busy ? '處理中…' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.confirm-dialog {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.confirm-dialog__backdrop {
  position: absolute;
  inset: 0;
  background: rgb(27 31 39 / 40%);
}

.confirm-dialog__panel {
  position: relative;
  width: 100%;
  max-width: 340px;
  padding: 24px;
  background: var(--color-black-000);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
}

.confirm-dialog__title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-black-800);
}

.confirm-dialog__message {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-black-500);
}

.confirm-dialog__actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.confirm-dialog__btn {
  flex: 1;
  padding: 9px;
  font-size: 14px;
  color: var(--color-black-800);
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 6px;

  // 預設按鈕（非破壞性的確認）：主色實心底
  &--primary {
    font-weight: 600;
    color: var(--color-black-000);
    background: var(--color-blue-500);
    border: none;
  }

  // danger 時的預設按鈕是「取消」：只用粗體強調，維持外框樣式
  &--preferred {
    font-weight: 600;
  }

  // 破壞性動作：HIG 的 destructive 樣式是紅色文字，不是紅色實心底
  &--danger {
    color: var(--color-red-600);
  }
}

/*
 * 開關動畫：使用端用 <Transition name="confirm-dialog"> 包住 <ConfirmDialog v-if>。
 * 參照 OptionsManagerModal 桌面版的淡入＋輕微縮放；ConfirmDialog 在手機也是置中卡片
 * （不是滿版），所以不分斷點都用這組，不套用 OptionsManagerModal 手機的「由下滑入」。
 * 根元素（.confirm-dialog）自己也要宣告 transition-duration：Vue 判斷動畫時長是看
 * Transition 套用 class 的那個元素（元件根節點）身上的 transition-duration，不會往子元素找，
 * 沒有這條，離場時會被瞬間拔掉 DOM，子元素的動畫來不及播放（同 OptionsManagerModal）。
 */
.confirm-dialog-enter-active,
.confirm-dialog-leave-active {
  transition: transform 0.2s ease;
}

.confirm-dialog-enter-active .confirm-dialog__panel,
.confirm-dialog-leave-active .confirm-dialog__panel {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.confirm-dialog-enter-active .confirm-dialog__backdrop,
.confirm-dialog-leave-active .confirm-dialog__backdrop {
  transition: opacity 0.2s ease;
}

.confirm-dialog-enter-from .confirm-dialog__panel,
.confirm-dialog-leave-to .confirm-dialog__panel {
  opacity: 0;
  transform: scale(0.95);
}

.confirm-dialog-enter-from .confirm-dialog__backdrop,
.confirm-dialog-leave-to .confirm-dialog__backdrop {
  opacity: 0;
}
</style>
