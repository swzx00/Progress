<script setup lang="ts">
import AppLoading from '@/components/AppLoading.vue';

/**
 * 下拉選單（交辦單位、交辦人員、專案名稱、專案 Repo）的選項還沒準備好時，放在 NSelect 的 empty slot：
 * - 載入中：AppLoading 的轉圈，下方「選項載入中」
 * - 載入失敗：「選項清單載入失敗」＋「重新載入」（emit retry，由使用端重新讀取）
 * 只負責畫面，什麼時候顯示由使用端決定（載入中或失敗時才把它放進 empty slot）
 */
defineProps<{
  loading: boolean;
}>();

const emit = defineEmits<{
  retry: [];
}>();
</script>

<template>
  <div class="options-dropdown-state">
    <AppLoading v-if="loading" label="選項載入中" />
    <template v-else>
      <span class="options-dropdown-state__message">選項清單載入失敗</span>
      <!-- mousedown.prevent：避免點按鈕時下拉選單的輸入框失去焦點、選單先被關掉 -->
      <button
        type="button"
        class="options-dropdown-state__retry"
        @mousedown.prevent
        @click="emit('retry')"
      >
        重新載入
      </button>
    </template>
  </div>
</template>

<style scoped lang="scss">
.options-dropdown-state {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  padding: 16px 12px;
  font-size: 13px;
  color: var(--color-black-500);

  &__message {
    color: var(--color-red-600);
  }

  &__retry {
    padding: 4px 12px;
    font-size: 13px;
    color: var(--color-blue-700);
    cursor: pointer;
    background: var(--color-black-000);
    border: 1px solid var(--color-blue-500);
    border-radius: 6px;

    &:hover {
      color: var(--color-black-000);
      background: var(--color-blue-700);
      border-color: var(--color-blue-700);
    }
  }
}
</style>
