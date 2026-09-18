<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

import { parseRepoInput, type WorkItem } from '@/types/work-item'

const props = withDefaults(
  defineProps<{
    item?: WorkItem | null
    defaultDate: string
    saving?: boolean
  }>(),
  {
    saving: false,
  },
)

const emit = defineEmits<{
  save: [payload: Omit<WorkItem, 'id' | '項次' | '已刪除'>]
  cancel: []
}>()

const form = reactive({
  單位: '',
  專案名稱: '',
  repoInput: '',
  工作內容: '',
  交辦人員: '',
  預計完成期限: '',
  工作日期: props.defaultDate,
  今日處理情形: '',
  今日工時: 0,
  '完成%': 0,
  完成回報: '',
  列管內容: '',
})

const resetForm = (item: WorkItem | null | undefined): void => {
  form.單位 = item?.單位 ?? ''
  form.專案名稱 = item?.專案名稱 ?? ''
  form.repoInput = item ? item.repo.join(', ') : ''
  form.工作內容 = item?.工作內容 ?? ''
  form.交辦人員 = item?.交辦人員 ?? ''
  form.預計完成期限 = item?.預計完成期限 ?? ''
  form.工作日期 = item?.工作日期 ?? props.defaultDate
  form.今日處理情形 = item?.今日處理情形 ?? ''
  form.今日工時 = item?.今日工時 ?? 0
  form['完成%'] = item?.['完成%'] ?? 0
  form.完成回報 = item?.完成回報 ?? ''
  form.列管內容 = item?.列管內容 ?? ''
}

watch(() => props.item, resetForm, { immediate: true })

const title = computed(() => (props.item ? '編輯工作項目' : '新增工作項目'))
const repoPreview = computed(() => parseRepoInput(form.repoInput))

const onSubmit = (): void => {
  emit('save', {
    單位: form.單位,
    專案名稱: form.專案名稱,
    repo: parseRepoInput(form.repoInput),
    工作內容: form.工作內容,
    交辦人員: form.交辦人員,
    預計完成期限: form.預計完成期限,
    工作日期: form.工作日期,
    今日處理情形: form.今日處理情形,
    今日工時: Number(form.今日工時),
    '完成%': Number(form['完成%']),
    完成回報: form.完成回報,
    列管內容: form.列管內容,
  })
}
</script>

<template>
  <div class="work-item-form">
    <div class="work-item-form__backdrop" @click="emit('cancel')" />
    <div class="work-item-form__panel" role="dialog" aria-modal="true">
      <div class="work-item-form__mobile-header">
        <button type="button" class="work-item-form__text-btn" @click="emit('cancel')">取消</button>
        <h2 class="work-item-form__mobile-title">{{ title }}</h2>
        <button
          type="submit"
          form="work-item-form-body"
          class="work-item-form__text-btn work-item-form__text-btn--accent"
          :disabled="saving"
        >
          {{ saving ? '儲存中…' : '儲存' }}
        </button>
      </div>

      <div class="work-item-form__desktop-header">
        <h2 class="work-item-form__desktop-title">{{ title }}</h2>
        <button
          type="button"
          aria-label="關閉"
          class="work-item-form__close-btn"
          @click="emit('cancel')"
        >
          ✕
        </button>
      </div>

      <form id="work-item-form-body" class="work-item-form__body" @submit.prevent="onSubmit">
        <div class="work-item-form__row">
          <label class="work-item-form__field">
            單位
            <input v-model="form.單位" type="text" required />
          </label>
          <label class="work-item-form__field">
            交辦人員
            <input v-model="form.交辦人員" type="text" required />
          </label>
        </div>

        <label class="work-item-form__field">
          專案名稱
          <input v-model="form.專案名稱" type="text" required />
        </label>

        <label class="work-item-form__field">
          Repo（選填，可多個）
          <input v-model="form.repoInput" type="text" placeholder="以逗號分隔，例如 AAA,BBBB" />
          <div v-if="repoPreview.length > 0" class="work-item-form__repo-preview">
            <span v-for="repo in repoPreview" :key="repo" class="work-item-form__repo-tag"
              >#{{ repo }}</span
            >
          </div>
        </label>

        <label class="work-item-form__field">
          工作內容
          <textarea v-model="form.工作內容" rows="2" required />
        </label>

        <div class="work-item-form__row">
          <label class="work-item-form__field">
            工作日期
            <input v-model="form.工作日期" type="date" required />
          </label>
          <label class="work-item-form__field">
            預計完成期限
            <input v-model="form.預計完成期限" type="date" required />
          </label>
        </div>

        <label class="work-item-form__field">
          今日處理情形
          <textarea v-model="form.今日處理情形" rows="2" required />
        </label>

        <div class="work-item-form__row">
          <label class="work-item-form__field">
            今日工時
            <input v-model.number="form.今日工時" type="number" min="0" required />
          </label>
          <label class="work-item-form__field">
            完成% (0–100)
            <input v-model.number="form['完成%']" type="number" min="0" max="100" required />
          </label>
        </div>

        <label class="work-item-form__field">
          完成回報
          <input v-model="form.完成回報" type="text" placeholder="（選填）" />
        </label>

        <label class="work-item-form__field">
          列管內容
          <textarea v-model="form.列管內容" rows="2" placeholder="（選填）" />
        </label>
      </form>

      <div class="work-item-form__desktop-footer">
        <button type="button" class="work-item-form__btn" @click="emit('cancel')">取消</button>
        <button
          type="submit"
          form="work-item-form-body"
          class="work-item-form__btn work-item-form__btn--primary"
          :disabled="saving"
        >
          {{ saving ? '儲存中…' : '儲存' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.work-item-form {
  position: fixed;
  inset: 0;
  z-index: 100;
}

.work-item-form__backdrop {
  display: none;
  position: absolute;
  inset: 0;
  background: rgba(27, 31, 39, 0.35);
}

.work-item-form__panel {
  position: absolute;
  inset: 0;
  background: var(--color-bg);
  display: flex;
  flex-direction: column;
}

.work-item-form__mobile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
}

.work-item-form__mobile-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-ink);
}

.work-item-form__text-btn {
  border: none;
  background: transparent;
  color: var(--color-ink-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 4px;

  &--accent {
    color: var(--color-accent);
    font-weight: 700;
  }
}

.work-item-form__desktop-header {
  display: none;
}

.work-item-form__desktop-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--color-ink);
}

.work-item-form__close-btn {
  border: none;
  background: transparent;
  color: var(--color-ink-muted);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
}

.work-item-form__body {
  flex-grow: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.work-item-form__row {
  display: flex;
  gap: 10px;

  .work-item-form__field {
    flex: 1;
  }
}

.work-item-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--color-ink-muted);

  input,
  textarea {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--color-ink);
    font-family: inherit;
  }

  textarea {
    resize: vertical;
  }
}

.work-item-form__repo-preview {
  margin-top: 2px;
}

.work-item-form__repo-tag {
  display: inline-block;
  margin-right: 4px;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-ink-muted);
  font-size: 11px;
}

.work-item-form__desktop-footer {
  display: none;
}

.work-item-form__btn {
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
}

@media (min-width: 768px) {
  .work-item-form__backdrop {
    display: block;
  }

  .work-item-form__panel {
    inset: 0 0 0 auto;
    width: min(440px, 100%);
    box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
  }

  .work-item-form__mobile-header {
    display: none;
  }

  .work-item-form__desktop-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid var(--color-border);
  }

  .work-item-form__body {
    padding: 20px 24px;
  }

  .work-item-form__desktop-footer {
    display: flex;
    gap: 10px;
    padding: 16px 24px;
    border-top: 1px solid var(--color-border);
  }
}

/*
 * 進場/退場動畫：手機由下往上滑入，≥768px（平板/桌面）由右側滑入。
 * 動畫套在外層 .work-item-form（Transition 元件套用 class 的地方），
 * 用子選擇器分別控制 panel 的位移跟 backdrop 的淡入淡出。
 *
 * 根元素（.work-item-form）自己也要宣告 transition：Vue 判斷動畫時長是看
 * Transition 套用 class 的那個元素（也就是這個元件的根節點）身上的
 * transition-duration，不會往子元素找。根元素本身沒有位移，這條純粹是
 * 讓 Vue 抓到正確的 0.25s，離場時才會等動畫播完再把元素移除 DOM，
 * 不然關閉會直接被瞬間拔掉，子元素的滑出動畫來不及播放。
 */
.work-item-form-enter-active,
.work-item-form-leave-active {
  transition: transform 0.25s ease;
}

.work-item-form-enter-active .work-item-form__panel,
.work-item-form-leave-active .work-item-form__panel {
  transition: transform 0.25s ease;
}

.work-item-form-enter-active .work-item-form__backdrop,
.work-item-form-leave-active .work-item-form__backdrop {
  transition: opacity 0.25s ease;
}

.work-item-form-enter-from .work-item-form__panel,
.work-item-form-leave-to .work-item-form__panel {
  transform: translateY(100%);
}

.work-item-form-enter-from .work-item-form__backdrop,
.work-item-form-leave-to .work-item-form__backdrop {
  opacity: 0;
}

@media (min-width: 768px) {
  .work-item-form-enter-from .work-item-form__panel,
  .work-item-form-leave-to .work-item-form__panel {
    transform: translateX(100%);
  }
}
</style>
