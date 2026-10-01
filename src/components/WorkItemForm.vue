<script setup lang="ts">
import { NSelect, type SelectOption } from 'naive-ui';
import { computed, onMounted, reactive, watch } from 'vue';

import { useOptions } from '@/composables/useOptions';
import { STATUS_OPTIONS, type WorkItem } from '@/types/work-item';

const props = withDefaults(
  defineProps<{
    item?: WorkItem | null;
    saving?: boolean;
  }>(),
  {
    saving: false,
  },
);

const emit = defineEmits<{
  save: [payload: Omit<WorkItem, 'id' | '項次' | '已刪除'>];
  cancel: [];
}>();

const toDateString = (d: Date): string => d.toISOString().slice(0, 10);

const { options, fetchOptions } = useOptions();
onMounted(fetchOptions);

const toSelectOptions = (values: string[] | undefined): SelectOption[] =>
  (values ?? []).map((value) => ({ label: value, value }));

const unitOptions = computed(() => toSelectOptions(options.value?.交辦單位));
const assigneeOptions = computed(() => toSelectOptions(options.value?.交辦人員));
const projectOptions = computed(() => toSelectOptions(options.value?.專案名稱));
const repoOptions = computed(() => toSelectOptions(options.value?.專案Repo));
const statusOptions = computed(() => toSelectOptions([...STATUS_OPTIONS]));

const form = reactive({
  工作日期: toDateString(new Date()),
  交辦單位: '',
  交辦人員: '',
  專案名稱: '',
  專案Repo: [] as string[],
  工作目標: '',
  預計期限: '',
  處理內容: '',
  今日工時: 0,
  完成度: 0,
  狀態: '',
});

const resetForm = (item: WorkItem | null | undefined): void => {
  form.工作日期 = item?.工作日期 ?? toDateString(new Date());
  form.交辦單位 = item?.交辦單位 ?? '';
  form.交辦人員 = item?.交辦人員 ?? '';
  form.專案名稱 = item?.專案名稱 ?? '';
  form.專案Repo = item ? [...item.專案Repo] : [];
  form.工作目標 = item?.工作目標 ?? '';
  form.預計期限 = item?.預計期限 ?? '';
  form.處理內容 = item?.處理內容 ?? '';
  form.今日工時 = item?.今日工時 ?? 0;
  form.完成度 = item?.完成度 ?? 0;
  form.狀態 = item?.狀態 ?? '';
};

watch(() => props.item, resetForm, { immediate: true });

const title = computed(() => (props.item ? '編輯工作項目' : '新增工作項目'));

const onSubmit = (): void => {
  emit('save', {
    工作日期: form.工作日期,
    交辦單位: form.交辦單位,
    交辦人員: form.交辦人員,
    專案名稱: form.專案名稱,
    專案Repo: form.專案Repo,
    工作目標: form.工作目標,
    預計期限: form.預計期限,
    處理內容: form.處理內容,
    今日工時: Number(form.今日工時),
    完成度: Number(form.完成度),
    狀態: form.狀態,
  });
};
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
        <label class="work-item-form__field work-item-form__field--highlight">
          工作日期
          <input v-model="form.工作日期" type="date" required />
        </label>

        <div class="work-item-form__row">
          <label class="work-item-form__field">
            交辦單位
            <NSelect
              v-model:value="form.交辦單位"
              filterable
              tag
              :options="unitOptions"
              placeholder="搜尋或輸入新單位"
            />
          </label>
          <label class="work-item-form__field">
            交辦人員
            <NSelect
              v-model:value="form.交辦人員"
              filterable
              tag
              :options="assigneeOptions"
              placeholder="搜尋或輸入新人員"
            />
          </label>
        </div>

        <label class="work-item-form__field">
          專案名稱
          <NSelect
            v-model:value="form.專案名稱"
            filterable
            tag
            :options="projectOptions"
            placeholder="搜尋或輸入新專案名稱"
          />
        </label>

        <label class="work-item-form__field">
          專案 Repo（選填，可多個）
          <NSelect
            v-model:value="form.專案Repo"
            filterable
            multiple
            tag
            :options="repoOptions"
            placeholder="搜尋或輸入 repo 名稱"
          />
        </label>

        <label class="work-item-form__field">
          工作目標
          <textarea v-model="form.工作目標" rows="2" required />
        </label>

        <label class="work-item-form__field">
          處理內容
          <textarea v-model="form.處理內容" rows="2" required />
        </label>

        <label class="work-item-form__field">
          今日工時
          <input v-model.number="form.今日工時" type="number" min="0" required />
        </label>

        <label class="work-item-form__field">
          預計期限
          <input v-model="form.預計期限" type="date" required />
        </label>

        <label class="work-item-form__field">
          完成度 (0–100)
          <input v-model.number="form.完成度" type="number" min="0" max="100" required />
        </label>

        <label class="work-item-form__field">
          狀態
          <NSelect
            v-model:value="form.狀態"
            clearable
            :options="statusOptions"
            placeholder="請選擇狀態（選填）"
          />
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
  position: absolute;
  inset: 0;
  display: none;
  background: rgb(27 31 39 / 35%);

  @media (min-width: 768px) {
    display: block;
  }
}

.work-item-form__panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--color-black-000);

  @media (min-width: 768px) {
    inset: 0 0 0 auto;
    width: min(440px, 100%);
    box-shadow: -8px 0 24px rgb(0 0 0 / 12%);
  }
}

.work-item-form__mobile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-black-100);

  @media (min-width: 768px) {
    display: none;
  }
}

.work-item-form__mobile-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-black-800);
}

.work-item-form__text-btn {
  padding: 4px;
  font-size: 14px;
  color: var(--color-black-500);
  cursor: pointer;
  background: transparent;
  border: none;

  &--accent {
    font-weight: 700;
    color: var(--color-blue-500);
  }
}

.work-item-form__desktop-header {
  display: none;

  @media (min-width: 768px) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid var(--color-black-100);
  }
}

.work-item-form__desktop-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--color-black-800);
}

.work-item-form__close-btn {
  font-size: 18px;
  line-height: 1;
  color: var(--color-black-500);
  cursor: pointer;
  background: transparent;
  border: none;
}

.work-item-form__body {
  display: flex;
  flex-grow: 1;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow: auto;

  @media (min-width: 768px) {
    padding: 20px 24px;
  }
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
  color: var(--color-black-500);

  input,
  textarea {
    padding: 8px 10px;
    font-family: inherit;
    font-size: 13px;
    color: var(--color-black-800);
    border: 1px solid var(--color-black-100);
    border-radius: 6px;
  }

  textarea {
    resize: vertical;
  }

  &--highlight {
    padding: 10px 12px;
    font-size: 13px;
    font-weight: 600;
    color: var(--color-blue-500);
    background: var(--color-black-050);
    border: 1px solid var(--color-blue-500);
    border-radius: 8px;

    input {
      font-size: 15px;
      font-weight: 700;
      border-color: var(--color-blue-500);
    }
  }
}

.work-item-form__desktop-footer {
  display: none;

  @media (min-width: 768px) {
    display: flex;
    gap: 10px;
    padding: 16px 24px;
    border-top: 1px solid var(--color-black-100);
  }
}

.work-item-form__btn {
  flex: 1;
  padding: 9px;
  font-size: 14px;
  color: var(--color-black-800);
  cursor: pointer;
  background: var(--color-black-000);
  border: 1px solid var(--color-black-100);
  border-radius: 6px;

  &--primary {
    font-weight: 600;
    color: var(--color-black-000);
    background: var(--color-blue-500);
    border: none;
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

  @media (min-width: 768px) {
    transform: translateX(100%);
  }
}

.work-item-form-enter-from .work-item-form__backdrop,
.work-item-form-leave-to .work-item-form__backdrop {
  opacity: 0;
}
</style>
