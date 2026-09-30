import { ref } from 'vue'

import type { WorkItem } from '@/types/work-item'

interface DoGetResponse {
  items: WorkItem[]
  error?: string
}

interface DoPostResponse {
  error?: string
}

type CreateInput = Omit<WorkItem, 'id' | '項次' | '已刪除'>
type UpdateInput = Partial<Omit<WorkItem, 'id'>>

/**
 * 前端內部（表單、DateNav、逾期比對）一律用 ISO 的 YYYY-MM-DD，因為
 * <input type="date"> 規格就是吃這個格式；Apps Script／Google Sheet 那端存的
 * 是 YYYY/MM/DD。轉換集中在這裡，其他地方不用知道 API 實際傳輸格式是什麼。
 */
const toApiDate = (date: string): string => date.replaceAll('-', '/')
const fromApiDate = (date: string): string => date.replaceAll('/', '-')

const toApiItem = <T extends Partial<Pick<WorkItem, '工作日期' | '預計期限'>>>(item: T): T => ({
  ...item,
  ...(item.工作日期 !== undefined && { 工作日期: toApiDate(item.工作日期) }),
  ...(item.預計期限 !== undefined && { 預計期限: toApiDate(item.預計期限) }),
})

/**
 * 本機開發、且關掉 MSW（VITE_ENABLE_MSW=false）時，改打 /apps-script-proxy，
 * 由 vite.config.ts 的 dev server proxy 轉發，繞開 Apps Script 對 localhost 來源的
 * CORS 限制（見 CLAUDE.md）。MSW 開著時維持原本網址，讓 MSW 的「結尾 exec」攔截規則正常比對。
 */
const shouldUseDevProxy = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === 'false'
const API_BASE_URL = shouldUseDevProxy ? '/apps-script-proxy' : import.meta.env.VITE_APPS_SCRIPT_URL

/**
 * Apps Script 網頁應用程式的回應一律是 HTTP 200（平台限制，沒辦法自訂 status code），
 * 所以不能靠 res.ok 判斷成功/失敗，錯誤訊息一律看回應內容裡的 error 欄位。
 */
const postAction = async (idToken: string, payload: object): Promise<void> => {
  const res = await fetch(API_BASE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, ...payload }),
  })
  const data = (await res.json()) as DoPostResponse
  if (data.error) {
    throw new Error(data.error)
  }
}

export function useWorkItems() {
  const items = ref<WorkItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fetchByDate = async (date: string): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const url = new URL(API_BASE_URL, window.location.origin)
      url.searchParams.set('date', toApiDate(date))
      const res = await fetch(url.toString())
      const data = (await res.json()) as DoGetResponse
      if (data.error) {
        throw new Error(data.error)
      }
      items.value = data.items
        .filter((item) => !item.已刪除)
        .map((item) => ({
          ...item,
          工作日期: fromApiDate(item.工作日期),
          預計期限: fromApiDate(item.預計期限),
        }))
    } catch (e) {
      error.value = e instanceof Error ? e.message : '讀取資料時發生未知錯誤'
      items.value = []
    } finally {
      loading.value = false
    }
  }

  const createItem = (idToken: string, item: CreateInput): Promise<void> =>
    postAction(idToken, { action: 'create', item: toApiItem(item) })

  /**
   * originalDate：這筆紀錄「修改前」的工作日期，用來換算它原本在哪個月份分頁，
   * 後端才找得到列。item.工作日期 可能跟 originalDate 不同（使用者把工作日期改到別的月份），
   * 這種情況後端會從舊分頁刪除、在新分頁新增。
   */
  const updateItem = (
    idToken: string,
    id: string,
    originalDate: string,
    item: UpdateInput,
  ): Promise<void> =>
    postAction(idToken, {
      action: 'update',
      id,
      originalDate: toApiDate(originalDate),
      item: toApiItem(item),
    })

  const deleteItem = (idToken: string, id: string, originalDate: string): Promise<void> =>
    postAction(idToken, { action: 'delete', id, originalDate: toApiDate(originalDate) })

  return { items, loading, error, fetchByDate, createItem, updateItem, deleteItem }
}
