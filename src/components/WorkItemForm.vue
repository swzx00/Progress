<script setup lang="ts">
import { NSelect, type SelectOption } from 'naive-ui';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';

import AppLoading from '@/components/AppLoading.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useOptions } from '@/composables/useOptions';
import { fetchDaySummary } from '@/composables/useWorkItems';
import { LEAVE_STATUS, STATUS_OPTIONS, isLeaveItem, type WorkItem } from '@/types/work-item';
import { buildCopyPayload } from '@/utils/copy-work-item';
import {
  DAILY_HOURS_MAX,
  LEAVE_FIXED_VALUES,
  LEAVE_RULES,
  LEAVE_TYPES,
  WORK_ITEM_RULES,
  dailyHoursMessage,
  dateInputRange,
  validateLeave,
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
    /** 新增請假（從「請假」按鈕開啟）；編輯時看 item 本身是不是請假紀錄，不看這個 */
    leave?: boolean;
    /** 複製：用這筆紀錄預填「新增」表單，存檔時新增一筆，原紀錄不動（item 有值時忽略） */
    copySource?: WorkItem | null;
  }>(),
  {
    saving: false,
    defaultDate: undefined,
    leave: false,
    copySource: null,
  },
);

/**
 * 請假模式：只顯示工作日期、假別、請假時數、備註四個欄位，其餘欄位送出時一律寫入
 * 固定值（LEAVE_FIXED_VALUES）。請假跟工作紀錄共用同一個 Drawer，未儲存確認、
 * 送出中遮罩、項次顯示等行為都一樣
 */
// 新增時可以在表單上方切換「工作項目／請假」，初始值看是從哪個按鈕開啟的（複製時看來源紀錄）；
// 表單每次開啟都重新掛載（HomeView 用 v-if），所以只需要在這裡取一次初始值
const creatingLeave = ref(props.copySource ? isLeaveItem(props.copySource) : props.leave);
// 是否為複製模式（標題用）；切換工作項目／請假後欄位重設，就不算複製了
const copying = ref(!props.item && !!props.copySource);
const isLeaveMode = computed(() => (props.item ? isLeaveItem(props.item) : creatingLeave.value));

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
const leaveTypeOptions = toSelectOptions(LEAVE_TYPES);

// 預設值來自 shared/validation-schema.json
const DEFAULT_HOURS = Number(WORK_ITEM_RULES.今日工時.default);
const DEFAULT_PROGRESS = Number(WORK_ITEM_RULES.完成度.default);
const DEFAULT_STATUS = String(WORK_ITEM_RULES.狀態.default);
const DEFAULT_LEAVE_HOURS = Number(LEAVE_RULES.今日工時.default);

const workDateRange = dateInputRange('工作日期');
const deadlineRange = dateInputRange('預計期限');

// 必填標示（紅色＊）跟著 schema 的 required 走，改規則時標示會自動同步
const isRequired = (field: WorkItemFieldName): boolean => WORK_ITEM_RULES[field].required;
const isLeaveRequired = (field: keyof typeof LEAVE_RULES): boolean => LEAVE_RULES[field].required;

/**
 * 當天其他紀錄（編輯時排除自己）的今日工時合計，由下方 updateDaySummary 查詢。
 * 查詢中或失敗時是 null：即時驗證先不檢查每日上限，送出時 onSubmit 會補查，查不到就擋下
 */
const otherHours = ref<number | null>(null);

const hoursOf = (values: WorkItemFormValues): number => {
  if (values.今日工時 !== '') return values.今日工時;
  return isLeaveMode.value ? DEFAULT_LEAVE_HOURS : DEFAULT_HOURS;
};

const validate = (values: WorkItemFormValues): WorkItemErrors => {
  const result = isLeaveMode.value ? validateLeave(values) : validateWorkItem(values);
  // 欄位本身已經有錯（例如超過單筆上限）就先顯示那個，不疊加每日合計的訊息
  if (!result.今日工時 && otherHours.value !== null) {
    const hours = hoursOf(values);
    if (otherHours.value + hours > DAILY_HOURS_MAX) {
      result.今日工時 = dailyHoursMessage(otherHours.value, hours);
    }
  }
  return result;
};

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
const selectModel = (field: '交辦單位' | '交辦人員' | '專案名稱' | '狀態' | '工作目標') =>
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
// 請假模式的假別存在「工作目標」
const leaveTypeModel = selectModel('工作目標');

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
  if (isLeaveMode.value) {
    // 請假的固定欄位不顯示在表單上，送出時再補；這裡只設定請假自己的預設值
    form.今日工時 = item?.今日工時 ?? DEFAULT_LEAVE_HOURS;
    form.狀態 = LEAVE_STATUS;
  }
  errors.value = {};
  submitAttempted = false;
  snapshot.value = JSON.stringify(form);
  blankSnapshot.value = snapshot.value;
};

/**
 * 複製：用來源紀錄預填，工作日期維持 DateNav 選到的那天（resetForm 已設定）。
 * 哪些欄位帶入、哪些清空，規則在 utils/copy-work-item.ts 的 buildCopyPayload（跟「複製本日」共用）；
 * 這裡只把該模式表單上看得到的欄位填進去，請假的固定值一樣送出時才補。
 * 快照取預填後的狀態，打開後沒改就關閉不會跳未儲存確認
 */
const applyCopySource = (source: WorkItem): void => {
  const copied = buildCopyPayload(source, form.工作日期);
  if (isLeaveMode.value) {
    form.工作目標 = copied.工作目標;
    form.今日工時 = copied.今日工時;
    form.處理內容 = copied.處理內容;
  } else {
    form.交辦單位 = copied.交辦單位;
    form.交辦人員 = copied.交辦人員;
    form.專案名稱 = copied.專案名稱;
    form.專案Repo = copied.專案Repo;
    form.工作目標 = copied.工作目標;
    form.預計期限 = copied.預計期限;
    form.狀態 = copied.狀態;
    form.完成度 = copied.完成度;
    form.處理內容 = copied.處理內容;
    form.今日工時 = copied.今日工時;
  }
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
  [form, otherHours],
  () => {
    if (submitAttempted) errors.value = validate(form);
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
// 該模式的空白預設值（不含複製預填），切換工作項目／請假時判斷「有沒有填內容」用
const blankSnapshot = ref('');
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

/**
 * 新增時切換「工作項目／請假」（編輯既有紀錄不能切換，也不顯示切換按鈕，使用者決定）：
 * 切換後保留工作日期，其他欄位整份重設成該模式的預設值。請假的固定值（人事室、休假…）
 * 不存在表單欄位裡，送出時才補，所以切換不會有殘留；反過來切回工作項目時，狀態（休假→待辦）
 * 跟工時預設（8→0）也靠重設處理。
 * 除了工作日期以外有填任何內容，就先跳確認，避免不小心清掉
 */
const switchConfirmOpen = ref(false);

const withoutDate = (json: string): string => JSON.stringify({ ...JSON.parse(json), 工作日期: '' });

const hasEnteredContent = computed(
  () => withoutDate(JSON.stringify(form)) !== withoutDate(blankSnapshot.value),
);

const applyModeSwitch = (): void => {
  const date = form.工作日期;
  creatingLeave.value = !creatingLeave.value;
  copying.value = false;
  // 快照維持「預設值＋原本的預設日期」，改過的日期關閉時仍會被視為未儲存的修改
  resetForm(null);
  form.工作日期 = date;
};

const requestModeSwitch = (toLeave: boolean): void => {
  if (props.item || props.saving || checkingDayHours.value || toLeave === creatingLeave.value) {
    return;
  }
  if (hasEnteredContent.value) {
    switchConfirmOpen.value = true;
  } else {
    applyModeSwitch();
  }
};

const confirmModeSwitch = (): void => {
  switchConfirmOpen.value = false;
  applyModeSwitch();
};

watch(
  () => props.item,
  (item) => {
    resetForm(item);
    if (!item && props.copySource) applyCopySource(props.copySource);
  },
  { immediate: true },
);

/**
 * 項次欄（唯讀，只負責顯示；項次一律由後端決定，送出的資料不含項次，後端也會忽略
 * 前端送來的值，就算用開發者工具改了欄位也不會影響 Sheet）：
 * - 編輯且工作日期沒改：顯示這筆紀錄目前的項次
 * - 新增，或編輯時把工作日期改到別天：顯示那一天的預計項次
 * 查詢中或失敗時留空（顯示 placeholder「項次」）。
 * 同一次查詢也算出當天其他紀錄的工時合計（otherHours），編輯且日期沒改時也要查。
 * 連續改日期時只採用最後一次查詢的結果，避免較早的回應晚到、蓋掉新的值。
 */
const indexValue = ref<number | null>(null);
let latestDayRequest = 0;

const updateDaySummary = async (): Promise<void> => {
  const requestId = ++latestDayRequest;
  const date = form.工作日期;
  // 編輯且工作日期沒改：沿用這筆紀錄自己的項次
  const ownIndex = props.item && date === props.item.工作日期 ? props.item.項次 : null;
  indexValue.value = ownIndex;
  otherHours.value = null;
  if (!date) return;
  try {
    const summary = await fetchDaySummary(date, props.item?.id);
    if (requestId !== latestDayRequest) return;
    if (ownIndex === null) indexValue.value = summary.nextIndex;
    otherHours.value = summary.otherHours;
  } catch {
    // 查不到就維持空白，不影響存檔（實際項次與每日工時上限都由後端寫入時把關）
  }
};

watch([() => form.工作日期, () => props.item], updateDaySummary, { immediate: true });

const title = computed(() => {
  const subject = isLeaveMode.value ? '請假' : '工作項目';
  if (props.item) return `編輯${subject}`;
  return copying.value ? `複製${subject}` : `新增${subject}`;
});

/**
 * 送出前補查當天工時合計的期間（「儲存」按鈕顯示「檢查中…」並停用）。
 * 跟父層的 saving（已送出、等後端回應）是不同階段，分開管理
 */
const checkingDayHours = ref(false);

const onSubmit = async (): Promise<void> => {
  // 按鈕停用只擋得住畫面操作，這裡再擋一次，避免重複送出兩筆
  if (props.saving || checkingDayHours.value) return;
  submitAttempted = true;
  errors.value = validate(form);
  if (Object.keys(errors.value).length > 0) {
    void scrollToFirstError();
    return;
  }
  // 送出前一定要先算出當天合計：還沒查到（查詢中或先前失敗）就當場再查一次，
  // 查不到就擋下，不放行（後端也會檢查）
  if (otherHours.value === null) {
    checkingDayHours.value = true;
    try {
      await updateDaySummary();
    } finally {
      checkingDayHours.value = false;
    }
    if (otherHours.value === null) {
      errors.value = { ...errors.value, 今日工時: '無法確認當天工時合計，請稍後再試' };
      void scrollToFirstError();
      return;
    }
    errors.value = validate(form);
    if (Object.keys(errors.value).length > 0) {
      void scrollToFirstError();
      return;
    }
  }
  if (isLeaveMode.value) {
    emit('save', {
      ...LEAVE_FIXED_VALUES,
      專案Repo: [...LEAVE_FIXED_VALUES.專案Repo],
      工作日期: form.工作日期,
      工作目標: form.工作目標,
      處理內容: form.處理內容.trim(),
      今日工時: form.今日工時 === '' ? DEFAULT_LEAVE_HOURS : form.今日工時,
      狀態: LEAVE_STATUS,
    });
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

      <div v-if="!item" class="work-item-form__mode" role="group" aria-label="紀錄類型">
        <button
          type="button"
          class="work-item-form__mode-btn"
          :class="{ 'work-item-form__mode-btn--active': !isLeaveMode }"
          :aria-pressed="!isLeaveMode"
          :disabled="saving || checkingDayHours"
          @click="requestModeSwitch(false)"
        >
          工作項目
        </button>
        <button
          type="button"
          class="work-item-form__mode-btn work-item-form__mode-btn--leave"
          :class="{ 'work-item-form__mode-btn--active': isLeaveMode }"
          :aria-pressed="isLeaveMode"
          :disabled="saving || checkingDayHours"
          @click="requestModeSwitch(true)"
        >
          請假
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
              {{ isLeaveMode ? LEAVE_RULES.工作日期.label : '工作日期' }}
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

        <template v-if="isLeaveMode">
          <label
            class="work-item-form__field"
            :class="{ 'work-item-form__field--invalid': errors.工作目標 }"
          >
            <span class="work-item-form__label">
              {{ LEAVE_RULES.工作目標.label }}
              <span
                v-if="isLeaveRequired('工作目標')"
                class="work-item-form__required"
                aria-hidden="true"
                >＊</span
              >
            </span>
            <NSelect
              v-model:value="leaveTypeModel"
              :options="leaveTypeOptions"
              :status="errors.工作目標 ? 'error' : undefined"
              placeholder="請選擇假別"
              :disabled="saving"
            />
            <span v-if="errors.工作目標" class="work-item-form__error">{{ errors.工作目標 }}</span>
          </label>

          <label
            class="work-item-form__field"
            :class="{ 'work-item-form__field--invalid': errors.今日工時 }"
          >
            <span class="work-item-form__label">
              {{ LEAVE_RULES.今日工時.label }}
              <span
                v-if="isLeaveRequired('今日工時')"
                class="work-item-form__required"
                aria-hidden="true"
                >＊</span
              >
            </span>
            <input
              v-model.number="form.今日工時"
              type="number"
              placeholder="請填寫請假時數"
              :min="LEAVE_RULES.今日工時.min"
              :max="LEAVE_RULES.今日工時.max"
              :step="LEAVE_RULES.今日工時.step"
              :disabled="saving"
            />
            <span v-if="errors.今日工時" class="work-item-form__error">{{ errors.今日工時 }}</span>
          </label>

          <label
            class="work-item-form__field"
            :class="{ 'work-item-form__field--invalid': errors.處理內容 }"
          >
            {{ LEAVE_RULES.處理內容.label }}
            <textarea
              v-model="form.處理內容"
              rows="2"
              placeholder="請填寫請假備註"
              :maxlength="LEAVE_RULES.處理內容.maxLength"
              :disabled="saving"
            />
            <span v-if="errors.處理內容" class="work-item-form__error">{{ errors.處理內容 }}</span>
          </label>
        </template>

        <div v-if="!isLeaveMode" class="work-item-form__row">
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
          v-if="!isLeaveMode"
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
          v-if="!isLeaveMode"
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
          v-if="!isLeaveMode"
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
          v-if="!isLeaveMode"
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
          v-if="!isLeaveMode"
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
          v-if="!isLeaveMode"
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
          v-if="!isLeaveMode"
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
          v-if="!isLeaveMode"
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
          :disabled="saving || checkingDayHours"
        >
          {{ saving ? '儲存中…' : checkingDayHours ? '檢查中…' : '儲存' }}
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

    <Transition name="confirm-dialog">
      <ConfirmDialog
        v-if="switchConfirmOpen"
        :title="isLeaveMode ? '要改填工作項目嗎？' : '要改填請假嗎？'"
        message="切換後，除了日期以外已填寫的內容都會清空。"
        confirm-label="切換"
        cancel-label="繼續編輯"
        danger
        @confirm="confirmModeSwitch"
        @cancel="switchConfirmOpen = false"
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

  // 新增時的「工作項目／請假」兩段式切換
  &__mode {
    display: flex;
    gap: 4px;
    padding: 4px;
    margin: 12px 16px;
    background: var(--color-black-050);
    border: 1px solid var(--color-black-100);
    border-radius: 8px;

    @media (min-width: 768px) {
      margin: 16px 24px;
    }

    &-btn {
      flex: 1;
      padding: 6px 12px;
      font-size: 14px;
      font-weight: 500;
      color: var(--color-black-500);
      cursor: pointer;
      background: transparent;
      border: none;
      border-radius: 6px;

      &--active {
        font-weight: 600;
        color: var(--color-blue-700);
        background: var(--color-black-000);
        box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
      }

      // 「請假」那一段選到時用 teal，跟請假按鈕、表格請假列同一個色系
      &--leave.work-item-form__mode-btn--active {
        color: var(--color-teal-700);
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
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
