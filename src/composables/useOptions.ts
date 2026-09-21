import { ref } from 'vue'

import type { WorkItemOptions } from '@/types/work-item'

interface DoGetOptionsResponse {
  options: WorkItemOptions
  error?: string
}

// 跟 useWorkItems.ts 同一套規則：本機關掉 MSW 時走 dev server proxy 繞開 CORS，
// 而且 Apps Script 回應一律 HTTP 200，成功/失敗要看回應內容的 error 欄位，不能看 res.ok。
const shouldUseDevProxy = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === 'false'
const API_BASE_URL = shouldUseDevProxy ? '/apps-script-proxy' : import.meta.env.VITE_APPS_SCRIPT_URL

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
      const url = new URL(API_BASE_URL, window.location.origin)
      url.searchParams.set('type', 'options')
      const res = await fetch(url.toString())
      const data = (await res.json()) as DoGetOptionsResponse
      if (data.error) {
        throw new Error(data.error)
      }
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
