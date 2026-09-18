<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    danger?: boolean
    busy?: boolean
  }>(),
  {
    confirmLabel: '確定',
    cancelLabel: '取消',
    danger: false,
    busy: false,
  },
)

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div class="confirm-dialog">
    <div class="confirm-dialog__backdrop" @click="emit('cancel')" />
    <div class="confirm-dialog__panel" role="alertdialog" aria-modal="true">
      <h2 class="confirm-dialog__title">{{ title }}</h2>
      <p class="confirm-dialog__message">{{ message }}</p>
      <div class="confirm-dialog__actions">
        <button type="button" class="confirm-dialog__btn" :disabled="busy" @click="emit('cancel')">
          {{ cancelLabel }}
        </button>
        <button
          type="button"
          class="confirm-dialog__btn confirm-dialog__btn--primary"
          :class="{ 'confirm-dialog__btn--danger': danger }"
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
  background: rgba(27, 31, 39, 0.4);
}

.confirm-dialog__panel {
  position: relative;
  width: 100%;
  max-width: 340px;
  background: var(--color-bg);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.confirm-dialog__title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-ink);
}

.confirm-dialog__message {
  margin: 0;
  font-size: 13px;
  color: var(--color-ink-muted);
  line-height: 1.6;
}

.confirm-dialog__actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.confirm-dialog__btn {
  flex: 1;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-ink);
  border-radius: 6px;
  padding: 9px;
  font-size: 14px;
  cursor: pointer;

  &--primary {
    border: none;
    background: var(--color-accent);
    color: #fff;
    font-weight: 600;
  }

  &--danger {
    background: var(--color-danger);
  }
}
</style>
