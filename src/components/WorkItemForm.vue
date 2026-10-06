<script setup lang="ts">
import { NSelect, type SelectOption } from 'naive-ui';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';

import AppLoading from '@/components/AppLoading.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useOptions } from '@/composables/useOptions';
import { fetchNextIndex } from '@/composables/useWorkItems';
import { STATUS_OPTIONS, type WorkItem } from '@/types/work-item';
import {
  WORK_ITEM_RULES,
  dateInputRange,
  validateWorkItem,
  type WorkItemErrors,
  type WorkItemFieldName,
  type WorkItemFormValues,
} from '@/validation/work-item';

const props = withDefaults(
  defineProps<{
    item?: WorkItem | null;
    saving?: boolean;
    /** 新增時「工作日期」的預設值：使用者在 DateNav 選到的那天 */
    defaultDate?: string;
  }>(),
  {
    saving: false,
    defaultDate: undefined,
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

// 預設值來自 shared/validation-schema.json
const DEFAULT_HOURS = Number(WORK_ITEM_RULES.今日工時.default);
const DEFAULT_PROGRESS = Number(WORK_ITEM_RULES.完成度.default);
const DEFAULT_STATUS = String(WORK_ITEM_RULES.狀態.default);

const workDateRange = dateInputRange('工作日期');
const deadlineRange = dateInputRange('預計期限');

// 必填標示（紅色＊）跟著 schema 的 required 走，改規則時標示會自動同步
const isRequired = (field: WorkItemFieldName): boolean => WORK_ITEM_RULES[field].required;

const form = reactive<WorkItemFormValues>({
  工作日期: toDateString(new Date()),
  交辦單位: '',
  交辦人員: '',
  專案名稱: '',
  專案Repo: [],
  工作目標: '',
  預計期限: '',
  處理內容: '',
  今日工時: DEFAULT_HOURS,
  完成度: DEFAULT_PROGRESS,
  狀態: DEFAULT_STATUS,
});

/**
 * 單選 NSelect 的 v-model：NSelect 只有值是 null 時才顯示 placeholder，空字串會被當成
 * 「選了一個空的值」，placeholder 就不見了。表單內部（驗證、送出、快照比對）維持用空字串
 * 代表「沒選」，只在跟 NSelect 交接的這一層互轉。多選的專案 Repo 是空陣列，本來就正常顯示。
 */
const selectModel = (field: '交辦單位' | '交辦人員' | '專案名稱' | '狀態') =>
  computed<string | null>({
    get: () => form[field] || null,
    set: (value) => {
      form[field] = value ?? '';
    },
  });

const unitModel = selectModel('交辦單位');
const assigneeModel = selectModel('交辦人員');
const projectModel = selectModel('專案名稱');
const statusModel = selectModel('狀態');

const resetForm = (item: WorkItem | null | undefined): void => {
  form.工作日期 = item?.工作日期 ?? props.defaultDate ?? toDateString(new Date());
  form.交辦單位 = item?.交辦單位 ?? '';
  form.交辦人員 = item?.交辦人員 ?? '';
  form.專案名稱 = item?.專案名稱 ?? '';
  form.專案Repo = item ? [...item.專案Repo] : [];
  form.工作目標 = item?.工作目標 ?? '';
  form.預計期限 = item?.預計期限 ?? '';
  form.處理內容 = item?.處理內容 ?? '';
  form.今日工時 = item?.今日工時 ?? DEFAULT_HOURS;
  form.完成度 = item?.完成度 ?? DEFAULT_PROGRESS;
  // 既有紀錄的狀態可能是空的（舊資料），編輯時一樣預設帶「待辦」（使用者決定）
  form.狀態 = item?.狀態 || DEFAULT_STATUS;
  errors.value = {};
  submitAttempted = false;
  snapshot.value = JSON.stringify(form);
};

/**
 * 驗證規則見 src/validation/work-item.ts（規則來源是 shared/validation-schema.json）。
 * 第一次按儲存才開始顯示錯誤；之後每次修改都即時重新驗證，修正後錯誤訊息馬上消失。
 * 不用瀏覽器內建驗證（form 加了 novalidate）：交辦單位、狀態這些 NSelect 不是原生
 * 欄位，內建 required 檢查不到，全部統一走自訂驗證，錯誤樣式才一致。
 */
const errors = ref<WorkItemErrors>({});
let submitAttempted = false;

watch(
  form,
  () => {
    if (submitAttempted) errors.value = validateWorkItem(form);
  },
  { deep: true },
);

const formEl = ref<HTMLFormElement | null>(null);

const scrollToFirstError = async (): Promise<void> => {
  await nextTick();
  const field = formEl.value?.querySelector<HTMLElement>('.work-item-form__field--invalid');
  field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  field?.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
};

/**
 * 關閉前的未儲存確認：表單打開（resetForm）時存一份快照，關閉時跟目前的值比對。
 * 改了又改回原值視為沒有修改，直接關閉；有修改才跳確認對話框。
 * 存檔成功、登入錯誤這兩種關閉是 HomeView 直接關掉表單，不經過這裡，不會跳確認。
 */
const snapshot = ref('');
const isDirty = computed(() => JSON.stringify(form) !== snapshot.value);
const discardConfirmOpen = ref(false);

const requestClose = (): void => {
  // 送出中不能關閉；遮罩是 div 沒辦法 disabled，點遮罩關閉要靠這裡擋
  if (props.saving) return;
  if (isDirty.value) {
    discardConfirmOpen.value = true;
  } else {
    emit('cancel');
  }
};

/**
 * 按「放棄變更」：先關確認對話框，等它的離場動畫播完（Transition 的 after-leave）
 * 才通知外層關閉表單。如果同一時間關掉兩者，表單會在對話框還沒消失前就開始滑出，
 * 對話框跟著表單一起被帶走，順序看起來是反的。
 */
let discardAfterDialogLeave = false;

const confirmDiscard = (): void => {
  discardAfterDialogLeave = true;
  discardConfirmOpen.value = false;
};

const onDiscardDialogAfterLeave = (): void => {
  if (!discardAfterDialogLeave) return;
  discardAfterDialogLeave = false;
  emit('cancel');
};

watch(() => props.item, resetForm, { immediate: true });

/**
 * 項次欄（唯讀，只負責顯示；項次一律由後端決定，送出的資料不含項次，後端也會忽略
 * 前端送來的值，就算用開發者工具改了欄位也不會影響 Sheet）：
 * - 編輯且工作日期沒改：顯示這筆紀錄目前的項次
 * - 新增，或編輯時把工作日期改到別天：顯示那一天的預計項次
 * 查詢中或失敗時留空（顯示 placeholder「項次」）。連續改日期時只採用最後一次查詢的結果，
 * 避免較早的回應晚到、蓋掉新的值。
 */
const indexValue = ref<number | null>(null);
let latestIndexRequest = 0;

const updateIndexValue = async (): Promise<void> => {
  const requestId = ++latestIndexRequest;
  const date = form.工作日期;
  if (props.item && date === props.item.工作日期) {
    indexValue.value = props.item.項次;
    return;
  }
  indexValue.value = null;
  if (!date) return;
  try {
    const nextIndex = await fetchNextIndex(date);
    if (requestId === latestIndexRequest) indexValue.value = nextIndex;
  } catch {
    // 查不到就維持空白，不影響存檔（實際項次本來就是後端寫入時才決定）
  }
};

watch([() => form.工作日期, () => props.item], updateIndexValue, { immediate: true });

const title = computed(() => (props.item ? '編輯工作項目' : '新增工作項目'));

const onSubmit = (): void => {
  // 按鈕停用只擋得住畫面操作，這裡再擋一次，避免重複送出兩筆
  if (props.saving) return;
  submitAttempted = true;
  errors.value = validateWorkItem(form);
  if (Object.keys(errors.value).length > 0) {
    void scrollToFirstError();
    return;
  }
  // 文字欄位去掉前後空白；選填數字欄位清空（空字串）時用預設值
  emit('save', {
    工作日期: form.工作日期,
    交辦單位: form.交辦單位.trim(),
    交辦人員: form.交辦人員.trim(),
    專案名稱: form.專案名稱.trim(),
    專案Repo: form.專案Repo.map((repo) => repo.trim()).filter((repo) => repo),
    工作目標: form.工作目標.trim(),
    預計期限: form.預計期限,
    處理內容: form.處理內容.trim(),
    今日工時: form.今日工時 === '' ? DEFAULT_HOURS : form.今日工時,
    完成度: form.完成度 === '' ? DEFAULT_PROGRESS : form.完成度,
    狀態: form.狀態,
  });
};
</script>

<template>
  <div class="work-item-form">
    <div class="work-item-form__backdrop" @click="requestClose" />
    <div class="work-item-form__panel" role="dialog" aria-modal="true">
      <div class="work-item-form__header">
        <h2 class="work-item-form__title">{{ title }}</h2>
        <button
          type="button"
          aria-label="關閉"
          class="work-item-form__close-btn"
          :disabled="saving"
          @click="requestClose"
        >
          ✕
        </button>
      </div>

      <form
        id="work-item-form-body"
        ref="formEl"
        class="work-item-form__body"
        novalidate
        @submit.prevent="onSubmit"
      >
        <div class="work-item-form__row work-item-form__row--highlight">
          <label
            class="work-item-form__field"
            :class="{ 'work-item-form__field--invalid': errors.工作日期 }"
          >
            <span class="work-item-form__label">
              工作日期
              <span
                v-if="isRequired('工作日期')"
                class="work-item-form__required"
                aria-hidden="true"
                >＊</span
              >
            </span>
            <input
              v-model="form.工作日期"
              type="date"
              placeholder="請選擇工作日期"
              required
              :min="workDateRange.min"
              :max="workDateRange.max"
              :disabled="saving"
            />
            <span v-if="errors.工作日期" class="work-item-form__error">{{ errors.工作日期 }}</span>
          </label>
          <!-- 項次只負責顯示，刻意不用 input（不是表單控制項，使用者無從輸入），外層也就不用 label -->
          <div class="work-item-form__field work-item-form__field--index">
            項次
            <div
              class="work-item-form__readonly"
              :class="{ 'work-item-form__readonly--placeholder': indexValue === null }"
            >
              {{ indexValue ?? '...' }}
            </div>
          </div>
        </div>

        <div class="work-item-form__row">
          <label
            class="work-item-form__field"
            :class="{ 'work-item-form__field--invalid': errors.交辦單位 }"
          >
            <span class="work-item-form__label">
              交辦單位
              <span
                v-if="isRequired('交辦單位')"
                class="work-item-form__required"
                aria-hidden="true"
                >＊</span
              >
            </span>
            <NSelect
              v-model:value="unitModel"
              filterable
              tag
              :options="unitOptions"
              :status="errors.交辦單位 ? 'error' : undefined"
              placeholder="請選擇交辦單位"
              :disabled="saving"
            />
            <span v-if="errors.交辦單位" class="work-item-form__error">{{ errors.交辦單位 }}</span>
          </label>
          <label
            class="work-item-form__field"
            :class="{ 'work-item-form__field--invalid': errors.交辦人員 }"
          >
            <span class="work-item-form__label">
              交辦人員
              <span
                v-if="isRequired('交辦人員')"
                class="work-item-form__required"
                aria-hidden="true"
                >＊</span
              >
            </span>
            <NSelect
              v-model:value="assigneeModel"
              filterable
              tag
              :options="assigneeOptions"
              :status="errors.交辦人員 ? 'error' : undefined"
              placeholder="請選擇交辦人員"
              :disabled="saving"
            />
            <span v-if="errors.交辦人員" class="work-item-form__error">{{ errors.交辦人員 }}</span>
          </label>
        </div>

        <label
          class="work-item-form__field"
          :class="{ 'work-item-form__field--invalid': errors.專案名稱 }"
        >
          <span class="work-item-form__label">
            專案名稱
            <span v-if="isRequired('專案名稱')" class="work-item-form__required" aria-hidden="true"
              >＊</span
            >
          </span>
          <NSelect
            v-model:value="projectModel"
            filterable
            tag
            :options="projectOptions"
            :status="errors.專案名稱 ? 'error' : undefined"
            placeholder="請選擇專案名稱"
            :disabled="saving"
          />
          <span v-if="errors.專案名稱" class="work-item-form__error">{{ errors.專案名稱 }}</span>
        </label>

        <label
          class="work-item-form__field"
          :class="{ 'work-item-form__field--invalid': errors.專案Repo }"
        >
          專案 Repo（可多個）
          <NSelect
            v-model:value="form.專案Repo"
            filterable
            multiple
            tag
            :options="repoOptions"
            :status="errors.專案Repo ? 'error' : undefined"
            placeholder="請選擇專案 Repo (選填)"
            :disabled="saving"
          />
          <span v-if="errors.專案Repo" class="work-item-form__error">{{ errors.專案Repo }}</span>
        </label>

        <label
          class="work-item-form__field"
          :class="{ 'work-item-form__field--invalid': errors.工作目標 }"
        >
          <span class="work-item-form__label">
            工作目標
            <span v-if="isRequired('工作目標')" class="work-item-form__required" aria-hidden="true"
              >＊</span
            >
          </span>
          <textarea
            v-model="form.工作目標"
            rows="2"
            placeholder="請填寫工作目標"
            required
            :maxlength="WORK_ITEM_RULES.工作目標.maxLength"
            :disabled="saving"
          />
          <span v-if="errors.工作目標" class="work-item-form__error">{{ errors.工作目標 }}</span>
        </label>

        <label
          class="work-item-form__field"
          :class="{ 'work-item-form__field--invalid': errors.處理內容 }"
        >
          處理內容
          <textarea
            v-model="form.處理內容"
            rows="2"
            placeholder="請填寫處理內容"
            :maxlength="WORK_ITEM_RULES.處理內容.maxLength"
            :disabled="saving"
          />
          <span v-if="errors.處理內容" class="work-item-form__error">{{ errors.處理內容 }}</span>
        </label>

        <label
          class="work-item-form__field"
          :class="{ 'work-item-form__field--invalid': errors.今日工時 }"
        >
          今日工時
          <input
            v-model.number="form.今日工時"
            type="number"
            placeholder="請填寫今日工時"
            :min="WORK_ITEM_RULES.今日工時.min"
            :max="WORK_ITEM_RULES.今日工時.max"
            :step="WORK_ITEM_RULES.今日工時.step"
            :disabled="saving"
          />
          <span v-if="errors.今日工時" class="work-item-form__error">{{ errors.今日工時 }}</span>
        </label>

        <label
          class="work-item-form__field"
          :class="{ 'work-item-form__field--invalid': errors.完成度 }"
        >
          完成度 (0–100)
          <input
            v-model.number="form.完成度"
            type="number"
            placeholder="請填寫完成度(%)"
            :min="WORK_ITEM_RULES.完成度.min"
            :max="WORK_ITEM_RULES.完成度.max"
            :step="WORK_ITEM_RULES.完成度.step"
            :disabled="saving"
          />
          <span v-if="errors.完成度" class="work-item-form__error">{{ errors.完成度 }}</span>
        </label>

        <label
          class="work-item-form__field"
          :class="{ 'work-item-form__field--invalid': errors.預計期限 }"
        >
          預計期限
          <input
            v-model="form.預計期限"
            type="date"
            placeholder="請選擇預計期限"
            :min="deadlineRange.min"
            :max="deadlineRange.max"
            :disabled="saving"
          />
          <span v-if="errors.預計期限" class="work-item-form__error">{{ errors.預計期限 }}</span>
        </label>

        <label
          class="work-item-form__field"
          :class="{ 'work-item-form__field--invalid': errors.狀態 }"
        >
          <span class="work-item-form__label">
            狀態
            <span v-if="isRequired('狀態')" class="work-item-form__required" aria-hidden="true"
              >＊</span
            >
          </span>
          <NSelect
            v-model:value="statusModel"
            :options="statusOptions"
            :status="errors.狀態 ? 'error' : undefined"
            placeholder="請選擇狀態"
            :disabled="saving"
          />
          <span v-if="errors.狀態" class="work-item-form__error">{{ errors.狀態 }}</span>
        </label>
      </form>

      <div class="work-item-form__footer">
        <button type="button" class="work-item-form__btn" :disabled="saving" @click="requestClose">
          取消
        </button>
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

    <!-- 送出中蓋一層滿版遮罩，擋住所有點擊，避免重複送出或誤操作；欄位與按鈕本身也都停用 -->
    <div v-if="saving" class="work-item-form__loading-mask">
      <AppLoading label="儲存中" />
    </div>

    <Transition name="confirm-dialog" @after-leave="onDiscardDialogAfterLeave">
      <ConfirmDialog
        v-if="discardConfirmOpen"
        title="要放棄變更嗎？"
        message="關閉後，這次填寫或修改的內容都不會被儲存。"
        confirm-label="放棄變更"
        cancel-label="繼續編輯"
        danger
        @confirm="confirmDiscard"
        @cancel="discardConfirmOpen = false"
      />
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.work-item-form {
  position: fixed;
  inset: 0;
  z-index: 100;

  &__backdrop {
    position: absolute;
    inset: 0;
    display: none;
    background: rgb(27 31 39 / 35%);

    @media (min-width: 768px) {
      display: block;
    }
  }

  &__panel {
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

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid var(--color-black-100);

    @media (min-width: 768px) {
      padding: 20px 24px;
    }
  }

  &__title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: var(--color-black-800);
  }

  &__close-btn {
    font-size: 18px;
    line-height: 1;
    color: var(--color-black-500);
    cursor: pointer;
    background: transparent;
    border: none;

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }

  &__body {
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

  &__row {
    display: flex;
    gap: 10px;

    .work-item-form__field {
      flex: 1;
      min-width: 0;

      // 項次只放幾位數字，固定窄欄，剩下的寬度都給同一行的工作日期
      &--index {
        flex: 0 0 36px;
      }
    }

    // 工作日期＋項次這一行整個框起來，作為表單最醒目的區塊
    &--highlight {
      padding: 8px 16px;
      margin-top: -16px;
      margin-right: -16px;
      margin-left: -16px;
      background: var(--color-black-050);
      border-top: 1px solid var(--color-blue-200);
      border-bottom: 1px solid var(--color-blue-200);

      @media (min-width: 768px) {
        padding: 10px 24px;
        margin-top: -20px;
        margin-right: -24px;
        margin-left: -24px;
      }

      .work-item-form__field {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-blue-500);
      }

      input {
        font-size: 15px;
        font-weight: 700;
        border-color: var(--color-blue-500);
      }
    }
  }

  &__field {
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

      // 送出中停用（NSelect 用自己的 disabled 樣式）
      &:disabled {
        color: var(--color-black-500);
        cursor: not-allowed;
        background: var(--color-black-050);
      }
    }

    textarea {
      resize: vertical;
    }

    // 驗證錯誤：原生 input／textarea 邊框變紅（NSelect 用自己的 status="error"）。
    // 同樣寫在 .work-item-form__row--highlight 之後，才蓋得過工作日期的藍色邊框
    &--invalid {
      input,
      textarea {
        border-color: var(--color-red-600);
      }
    }
  }

  // 假的唯讀輸入框（項次）：外觀模仿停用的 input（灰底灰框），但只是一般的 div，
  // 不是表單控制項。line-height: normal 讓高度跟同一行的原生日期 input 對齊；
  // 欄寬只有 36px，左右不留內距，兩位數才放得下
  &__readonly {
    padding: 7px 0;
    font-size: 15px;
    font-weight: 700;
    line-height: normal;
    color: var(--color-black-500);
    text-align: center;
    cursor: not-allowed;
    background: var(--color-black-100);
    border: 1px solid var(--color-black-200);
    border-radius: 6px;

    // 字級維持一樣，取得項次前後高度才不會跳動
    &--placeholder {
      font-weight: 400;
      color: var(--color-black-300);
    }
  }

  &__error {
    font-size: 12px;
    font-weight: 400;
    color: var(--color-red-600);
  }

  // 欄位名稱＋必填標示包成一段，label 本身是 flex column，不包的話＊會被擠到下一行
  &__label {
    display: flex;
    gap: 2px;
    align-items: baseline;
  }

  &__required {
    color: var(--color-red-600);
  }

  &__footer {
    display: flex;
    gap: 10px;
    padding: 16px;
    border-top: 1px solid var(--color-black-100);

    @media (min-width: 768px) {
      padding: 16px 24px;
    }
  }

  &__btn {
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

    &:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  }

  // 送出中的滿版遮罩：疊在 panel 與背景之上（同一個 .work-item-form 內，DOM 順序在後），
  // Toast（z-index 200）仍在它上方，存檔失敗的訊息看得到。
  // 半透明白無法用色階 token（CSS 變數的 hex 不能加透明度），同 __backdrop 寫死 rgb()
  &__loading-mask {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: wait;
    background: rgb(255 255 255 / 70%);
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
  &-enter-active,
  &-leave-active {
    transition: transform 0.25s ease;
  }

  &-enter-active &__panel,
  &-leave-active &__panel {
    transition: transform 0.25s ease;
  }

  &-enter-active &__backdrop,
  &-leave-active &__backdrop {
    transition: opacity 0.25s ease;
  }

  &-enter-from &__panel,
  &-leave-to &__panel {
    transform: translateY(100%);

    @media (min-width: 768px) {
      transform: translateX(100%);
    }
  }

  &-enter-from &__backdrop,
  &-leave-to &__backdrop {
    opacity: 0;
  }
}
</style>
