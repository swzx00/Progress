import { http, HttpResponse } from 'msw'

import type { WorkItem } from '@/types/work-item'

const toDateString = (d: Date): string => d.toISOString().slice(0, 10)

const addDays = (base: Date, days: number): Date => {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

const today = toDateString(new Date())
const yesterday = toDateString(addDays(new Date(), -1))

let items: WorkItem[] = [
  {
    id: 'wi-1',
    項次: 1,
    單位: '資訊部',
    專案名稱: '官網改版',
    repo: ['AAA', 'BBBB'],
    工作內容: '首頁切版',
    交辦人員: '王小明',
    預計完成期限: toDateString(addDays(new Date(), -2)),
    工作日期: today,
    今日處理情形: '完成首頁 RWD 調整',
    今日工時: 4,
    '完成%': 70,
    完成回報: '',
    列管內容: '',
    已刪除: false,
  },
  {
    id: 'wi-2',
    項次: 2,
    單位: '資訊部',
    專案名稱: '會員系統優化',
    repo: ['member-web'],
    工作內容: '登入流程重構',
    交辦人員: '李小華',
    預計完成期限: toDateString(addDays(new Date(), 5)),
    工作日期: today,
    今日處理情形: '完成單元測試',
    今日工時: 3,
    '完成%': 100,
    完成回報: '已上線',
    列管內容: '',
    已刪除: false,
  },
  {
    id: 'wi-3',
    項次: 3,
    單位: '業務部',
    專案名稱: '年度報告',
    repo: [],
    工作內容: '資料彙整',
    交辦人員: '陳大文',
    預計完成期限: toDateString(addDays(new Date(), -5)),
    工作日期: today,
    今日處理情形: '等待業務部提供數據',
    今日工時: 1,
    '完成%': 20,
    完成回報: '',
    列管內容: '進度落後，需追蹤',
    已刪除: false,
  },
  {
    id: 'wi-4',
    項次: 1,
    單位: '資訊部',
    專案名稱: '官網改版',
    repo: ['AAA'],
    工作內容: '首頁切版',
    交辦人員: '王小明',
    預計完成期限: toDateString(addDays(new Date(), -2)),
    工作日期: yesterday,
    今日處理情形: '完成版面規劃',
    今日工時: 5,
    '完成%': 50,
    完成回報: '',
    列管內容: '',
    已刪除: false,
  },
]

interface CreatePayload {
  action: 'create'
  item: Omit<WorkItem, 'id' | '項次' | '已刪除'>
}

interface UpdatePayload {
  action: 'update'
  id: string
  item: Partial<Omit<WorkItem, 'id'>>
}

interface DeletePayload {
  action: 'delete'
  id: string
}

type DoPostPayload = CreatePayload | UpdatePayload | DeletePayload

export const handlers = [
  http.get('*/exec', ({ request }) => {
    const url = new URL(request.url)
    const date = url.searchParams.get('date') ?? today
    const dayItems = items.filter((item) => item.工作日期 === date && !item.已刪除)
    return HttpResponse.json({ items: dayItems })
  }),

  http.post('*/exec', async ({ request }) => {
    const body = (await request.json()) as DoPostPayload

    if (body.action === 'create') {
      const sameDayCount = items.filter((item) => item.工作日期 === body.item.工作日期).length
      const created: WorkItem = {
        ...body.item,
        id: crypto.randomUUID(),
        項次: sameDayCount + 1,
        已刪除: false,
      }
      items = [...items, created]
      return HttpResponse.json({ item: created })
    }

    if (body.action === 'update') {
      let updated: WorkItem | undefined
      items = items.map((item) => {
        if (item.id !== body.id) return item
        updated = { ...item, ...body.item }
        return updated
      })
      return HttpResponse.json({ item: updated })
    }

    if (body.action === 'delete') {
      items = items.map((item) => (item.id === body.id ? { ...item, 已刪除: true } : item))
      return HttpResponse.json({ ok: true })
    }

    return HttpResponse.json({ error: 'unknown action' }, { status: 400 })
  }),
]
