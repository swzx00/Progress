<script setup lang="ts">
import { ref } from 'vue';

import { useScrollLock } from '@/composables/useScrollLock';
import { useToast } from '@/composables/useToast';
import type { WorkItem } from '@/types/work-item';
import { buildDaySummary } from '@/utils/day-summary';

/**
 * 本日總結：把選到那天的工作紀錄照 buildDaySummary 的規則整理成文字，放在 Textarea 裡讓使用者
 * 複製（使用者決定可以先手動修改，修改內容不存檔、不送後端，關掉重開就恢復成產生的內容）。
 * 外觀、手機滿版、開關動畫比照 OptionsManagerModal
 */
const props = defineProps<{
  /** 顯示用日期（YYYY/MM/DD） */
  date: string;
  items: WorkItem[];
}>();

const emit = defineEmits<{
  close: [];
}>();

const { showToast } = useToast();

const text = ref(buildDaySummary(props.items));
const isEmpty = text.value === '';

const copy = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text.value);
    showToast('已複製本日總結', 'success');
  } catch {
    showToast('複製失敗，請手動選取文字複製');
  }
};

// 有遮罩：開著時頁面不能捲動、不顯示捲軸
useScrollLock();
</script>

<template>
  <div class="day-summary">
    <div class="day-summary__backdrop" @click="emit('close')" />

    <div
      class="day-summary__panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="day-summary-title"
    >
      <div class="day-summary__header">
        <h2 id="day-summary-title" class="day-summary__title">本日總結</h2>
        <span class="day-summary__date">{{ date }}</span>
        <button
          type="button"
          class="day-summary__close-btn"
          aria-label="關閉"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <p v-if="isEmpty" class="day-summary__empty">這天沒有紀錄</p>
      <template v-else>
        <textarea
          v-model="text"
          class="day-summary__textarea"
          aria-label="本日總結內容"
          spellcheck="false"
        />
        <div class="day-summary__footer">
          <button type="button" class="day-summary__copy-btn" @click="copy">複製</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
// 手機：滿版全螢幕；桌面（≥768px）：置中的 Modal 卡片（比照 OptionsManagerModal）
.day-summary {
  position: fixed;
  inset: 0;
  z-index: 100;

  @media (min-width: 768px) {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
}

.day-summary__backdrop {
  position: absolute;
  inset: 0;
  display: none;
  background: rgb(27 31 39 / 40%);

  @media (min-width: 768px) {
    display: block;
  }
}

.day-summary__panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: var(--color-black-000);

  @media (min-width: 768px) {
    position: relative;
    inset: auto;
    width: 100%;
    max-width: 560px;
    height: min(80vh, 640px);
    padding: 24px;
    border-radius: 12px;
    box-shadow: 0 12px 32px rgb(0 0 0 / 18%);
  }
}

.day-summary__header {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--color-black-100);

  @media (min-width: 768px) {
    padding-bottom: 0;
    border-bottom: none;
  }
}

.day-summary__title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-black-800);
}

.day-summary__date {
  flex: 1;
  font-size: 13px;
  color: var(--color-black-500);
}

.day-summary__close-btn {
  padding: 4px;
  font-size: 16px;
  line-height: 1;
  color: var(--color-black-500);
  cursor: pointer;
  background: transparent;
  border: none;
}

.day-summary__empty {
  padding: 16px 0;
  margin: 0;
  color: var(--color-black-500);
}

.day-summary__textarea {
  flex: 1;
  min-height: 0;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--color-black-800);

  // 很長、中間沒空白的英文（或網址）直接在字中間折行，不會整串被推到下一行、看起來跟「- 」分開
  overflow-wrap: anywhere;
  resize: none;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 8px;

  &:focus {
    outline: none;
    border-color: var(--color-blue-500);
  }
}

.day-summary__footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.day-summary__copy-btn {
  width: 100%;
  padding: 8px 20px;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-black-000);
  cursor: pointer;
  background: var(--color-blue-500);
  border: none;
  border-radius: 8px;

  &:hover {
    background: var(--color-blue-700);
  }

  @media (min-width: 768px) {
    width: auto;
  }
}

/*
 * 開關動畫比照 OptionsManagerModal：手機從下方滑入／滑出，桌面淡入＋輕微縮放。
 * 根元素也要宣告 transition-duration，Vue 才等得到子元素的離場動畫播完
 */
.day-summary-enter-active,
.day-summary-leave-active {
  transition: transform 0.2s ease;
}

.day-summary-enter-active .day-summary__panel,
.day-summary-leave-active .day-summary__panel {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.day-summary-enter-active .day-summary__backdrop,
.day-summary-leave-active .day-summary__backdrop {
  transition: opacity 0.2s ease;
}

.day-summary-enter-from .day-summary__panel,
.day-summary-leave-to .day-summary__panel {
  transform: translateY(100%);

  @media (min-width: 768px) {
    opacity: 0;
    transform: scale(0.95);
  }
}

.day-summary-enter-from .day-summary__backdrop,
.day-summary-leave-to .day-summary__backdrop {
  opacity: 0;
}
</style>
