import { ref } from 'vue'

/**
 * 暫時 stub：GCP OAuth Client ID 還沒建立，先寫死已登入狀態，
 * 介面（isLoggedIn/userEmail）保持跟未來真的接 GIS 登入時一致，
 * 之後換成真的邏輯時呼叫端不用改。
 */
const isLoggedIn = ref(true)
const userEmail = ref('swzx00@gmail.com')

export function useGoogleAuth() {
  return { isLoggedIn, userEmail }
}
