import { ref } from 'vue'

import type { WorkItemOptions } from '@/types/work-item'

interface DoGetOptionsResponse {
  options: WorkItemOptions
}

const options = ref<WorkItemOptions | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
let fetchPromise: Promise<void> | null = null

const fetchOptions = async (): Promise<void> => {
  if (options.value) return
  if (fetchPromise) return fetchPromise

  loading.value = true
  error.value = null
  fetchPromise = (async () => {
    try {
      const url = new URL(import.meta.env.VITE_APPS_SCRIPT_URL)
      url.searchParams.set('type', 'options')
      const res = await fetch(url.toString())
      if (!res.ok) {
        throw new Error(`API 回應錯誤（${res.status}）`)
      }
      const data = (await res.json()) as DoGetOptionsResponse
      options.value = data.options
    } catch (e) {
      error.value = e instanceof Error ? e.message : '讀取選項清單時發生未知錯誤'
    } finally {
      loading.value = false
      fetchPromise = null
    }
  })()

  return fetchPromise
}

export function useOptions() {
  return { options, loading, error, fetchOptions }
}
