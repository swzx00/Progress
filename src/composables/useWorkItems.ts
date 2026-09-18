import { ref } from 'vue'

import type { WorkItem } from '@/types/work-item'

interface DoGetResponse {
  items: WorkItem[]
}

type CreateInput = Omit<WorkItem, 'id' | '項次' | '已刪除'>
type UpdateInput = Partial<Omit<WorkItem, 'id'>>

const postAction = async (idToken: string, payload: object): Promise<void> => {
  const res = await fetch(import.meta.env.VITE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, ...payload }),
  })
  if (!res.ok) {
    throw new Error(`API 回應錯誤（${res.status}）`)
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
      const url = new URL(import.meta.env.VITE_APPS_SCRIPT_URL)
      url.searchParams.set('date', date)
      const res = await fetch(url.toString())
      if (!res.ok) {
        throw new Error(`API 回應錯誤（${res.status}）`)
      }
      const data = (await res.json()) as DoGetResponse
      items.value = data.items.filter((item) => !item.已刪除)
    } catch (e) {
      error.value = e instanceof Error ? e.message : '讀取資料時發生未知錯誤'
      items.value = []
    } finally {
      loading.value = false
    }
  }

  const createItem = (idToken: string, item: CreateInput): Promise<void> =>
    postAction(idToken, { action: 'create', item })

  const updateItem = (idToken: string, id: string, item: UpdateInput): Promise<void> =>
    postAction(idToken, { action: 'update', id, item })

  const deleteItem = (idToken: string, id: string): Promise<void> =>
    postAction(idToken, { action: 'delete', id })

  return { items, loading, error, fetchByDate, createItem, updateItem, deleteItem }
}
