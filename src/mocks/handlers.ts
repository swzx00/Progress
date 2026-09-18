import { http, HttpResponse } from 'msw'

import type { WorkItem } from '@/types/work-item'

const toDateString = (d: Date): string => d.toISOString().slice(0, 10)

const addDays = (base: Date, days: number): Date => {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

const buildFixture = (date: string): WorkItem[] => {
  const today = toDateString(new Date())
  const yesterday = toDateString(addDays(new Date(), -1))

  if (date === today) {
    return [
      {
        id: 'wi-1',
        項次: 1,
        單位: '資訊部',
        專案名稱: '官網改版',
        工作內容: '首頁切版',
        交辦人員: '王小明',
        預計完成期限: toDateString(addDays(new Date(), -2)),
        工作日期: date,
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
        工作內容: '登入流程重構',
        交辦人員: '李小華',
        預計完成期限: toDateString(addDays(new Date(), 5)),
        工作日期: date,
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
        工作內容: '資料彙整',
        交辦人員: '陳大文',
        預計完成期限: toDateString(addDays(new Date(), -5)),
        工作日期: date,
        今日處理情形: '等待業務部提供數據',
        今日工時: 1,
        '完成%': 20,
        完成回報: '',
        列管內容: '進度落後，需追蹤',
        已刪除: false,
      },
    ]
  }

  if (date === yesterday) {
    return [
      {
        id: 'wi-4',
        項次: 1,
        單位: '資訊部',
        專案名稱: '官網改版',
        工作內容: '首頁切版',
        交辦人員: '王小明',
        預計完成期限: toDateString(addDays(new Date(), -2)),
        工作日期: date,
        今日處理情形: '完成版面規劃',
        今日工時: 5,
        '完成%': 50,
        完成回報: '',
        列管內容: '',
        已刪除: false,
      },
    ]
  }

  return []
}

export const handlers = [
  http.get('*/exec', ({ request }) => {
    const url = new URL(request.url)
    const date = url.searchParams.get('date') ?? toDateString(new Date())
    return HttpResponse.json({ items: buildFixture(date) })
  }),
]
