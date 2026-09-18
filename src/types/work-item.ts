export interface WorkItem {
  id: string
  項次: number
  單位: string
  專案名稱: string
  repo: string[]
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

export const parseRepoInput = (input: string): string[] =>
  input
    .split(',')
    .map((repo) => repo.trim())
    .filter((repo) => repo.length > 0)

export interface WorkItemOptions {
  交辦單位: string[]
  交辦人員: string[]
  專案名稱: string[]
  專案Repo: string[]
}

export const STATUS_OPTIONS = ['進行中', '前端完成', '返修', '待辦', '確認上線', '暫緩'] as const
