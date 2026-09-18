import { ref } from 'vue'

import type { WorkItem } from '@/types/work-item'

interface DoGetResponse {
  items: WorkItem[]
}

type CreateInput = Omit<WorkItem, 'id' | '項次' | '已刪除'>
type UpdateInput = Partial<Omit<WorkItem, 'id'>>

const postAction = async (payload: unknown): Promise<void> => {
  const res = await fetch(import.meta.env.VITE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
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

  const createItem = (item: CreateInput): Promise<void> => postAction({ action: 'create', item })

  const updateItem = (id: string, item: UpdateInput): Promise<void> =>
    postAction({ action: 'update', id, item })

  const deleteItem = (id: string): Promise<void> => postAction({ action: 'delete', id })

  return { items, loading, error, fetchByDate, createItem, updateItem, deleteItem }
}
