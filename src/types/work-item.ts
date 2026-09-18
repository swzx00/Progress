export interface WorkItem {
  id: string
  項次: number
  單位: string
  專案名稱: string
  工作內容: string
  交辦人員: string
  預計完成期限: string
  工作日期: string
  今日處理情形: string
  今日工時: number
  '完成%': number
  完成回報: string
  列管內容: string
  已刪除: boolean
}

export const isOverdue = (item: WorkItem, today: string): boolean =>
  item['完成%'] < 100 && item.預計完成期限 < today
