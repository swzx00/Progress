import { http, HttpResponse } from 'msw'

import type { WorkItem, WorkItemOptions } from '@/types/work-item'

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
    交辦單位: '資訊部',
    交辦人員: '王小明',
    專案名稱: '官網改版',
    專案Repo: ['AAA', 'BBBB'],
    工作目標: '首頁切版',
    處理內容: '完成首頁 RWD 調整',
    今日工時: 4,
    預計期限: toDateString(addDays(new Date(), -2)),
    完成度: 70,
    狀態: '',
    工作日期: today,
    已刪除: false,
  },
  {
    id: 'wi-2',
    項次: 2,
    交辦單位: '資訊部',
    交辦人員: '李小華',
    專案名稱: '會員系統優化',
    專案Repo: ['member-web'],
    工作目標: '登入流程重構',
    處理內容: '完成單元測試',
    今日工時: 3,
    預計期限: toDateString(addDays(new Date(), 5)),
    完成度: 100,
    狀態: '已上線',
    工作日期: today,
    已刪除: false,
  },
  {
    id: 'wi-3',
    項次: 3,
    交辦單位: '業務部',
    交辦人員: '陳大文',
    專案名稱: '年度報告',
    專案Repo: [],
    工作目標: '資料彙整',
    處理內容: '等待業務部提供數據',
    今日工時: 1,
    預計期限: toDateString(addDays(new Date(), -5)),
    完成度: 20,
    狀態: '',
    工作日期: today,
    已刪除: false,
  },
  {
    id: 'wi-4',
    項次: 1,
    交辦單位: '資訊部',
    交辦人員: '王小明',
    專案名稱: '官網改版',
    專案Repo: ['AAA'],
    工作目標: '首頁切版',
    處理內容: '完成版面規劃',
    今日工時: 5,
    預計期限: toDateString(addDays(new Date(), -2)),
    完成度: 50,
    狀態: '',
    工作日期: yesterday,
    已刪除: false,
  },
]

let options: WorkItemOptions = {
  交辦單位: ['資訊部', '業務部', '行銷部', '人資部'],
  交辦人員: ['王小明', '李小華', '陳大文'],
  專案名稱: ['官網改版', '會員系統優化', '年度報告'],
  專案Repo: ['AAA', 'BBBB', 'member-web'],
}

const addOptionIfNew = (category: keyof WorkItemOptions, value: string): void => {
  if (!value) return
  if (!options[category].includes(value)) {
    options = { ...options, [category]: [...options[category], value] }
  }
}

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

    if (url.searchParams.get('type') === 'options') {
      return HttpResponse.json({ options })
    }

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
      addOptionIfNew('交辦單位', created.交辦單位)
      addOptionIfNew('交辦人員', created.交辦人員)
      addOptionIfNew('專案名稱', created.專案名稱)
      created.專案Repo.forEach((repo) => addOptionIfNew('專案Repo', repo))
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
