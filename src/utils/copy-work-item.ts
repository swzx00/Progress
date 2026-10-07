import { LEAVE_STATUS, isLeaveItem, type WorkItem } from '@/types/work-item';
import { LEAVE_FIXED_VALUES, WORK_ITEM_RULES } from '@/validation/work-item';

export type CopyPayload = Omit<WorkItem, 'id' | '項次' | '已刪除'>;

const DEFAULT_HOURS = Number(WORK_ITEM_RULES.今日工時.default);
const DEFAULT_STATUS = String(WORK_ITEM_RULES.狀態.default);

/**
 * 複製規則（單項複製、單日複製共用，改這裡兩邊一起生效）：
 * - 工作紀錄：帶入交辦單位、交辦人員、專案名稱、專案Repo、工作目標、預計期限、完成度、狀態
 *   （舊資料狀態為空時帶預設的「待辦」）；處理內容、今日工時是「當天」的內容，清空成空白、0
 * - 請假紀錄：帶入假別、請假時數、備註，固定欄位寫入 LEAVE_FIXED_VALUES（後端也會覆蓋）
 * 工作日期一律換成 date；項次不在這裡決定，由後端照新日期的每日編號規則接續
 */
export const buildCopyPayload = (source: WorkItem, date: string): CopyPayload => {
  if (isLeaveItem(source)) {
    return {
      ...LEAVE_FIXED_VALUES,
      專案Repo: [...LEAVE_FIXED_VALUES.專案Repo],
      工作日期: date,
      工作目標: source.工作目標,
      處理內容: source.處理內容,
      今日工時: source.今日工時,
      狀態: LEAVE_STATUS,
    };
  }
  return {
    工作日期: date,
    交辦單位: source.交辦單位,
    交辦人員: source.交辦人員,
    專案名稱: source.專案名稱,
    專案Repo: [...source.專案Repo],
    工作目標: source.工作目標,
    預計期限: source.預計期限,
    完成度: source.完成度,
    狀態: source.狀態 || DEFAULT_STATUS,
    處理內容: '',
    今日工時: DEFAULT_HOURS,
  };
};
