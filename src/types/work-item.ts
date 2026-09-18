export interface WorkItem {
  id: string
  項次: number
  交辦單位: string
  交辦人員: string
  專案名稱: string
  專案Repo: string[]
  工作目標: string
  處理內容: string
  今日工時: number
  預計期限: string
  完成度: number
  狀態: string
  工作日期: string
  已刪除: boolean
}

export const isOverdue = (item: WorkItem, today: string): boolean =>
  item.完成度 < 100 && item.預計期限 < today

export interface WorkItemOptions {
  交辦單位: string[]
  交辦人員: string[]
  專案名稱: string[]
  專案Repo: string[]
}

export const STATUS_OPTIONS = ['進行中', '前端完成', '返修', '待辦', '確認上線', '暫緩'] as const
