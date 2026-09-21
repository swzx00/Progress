import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import './styles/tokens.scss'
import './style.scss'

async function bootstrap(): Promise<void> {
  // VITE_ENABLE_MSW 沒設定時預設啟用（維持原本行為）；
  // 在 .env 設成 'false' 可以在 dev 模式下關掉 MSW，改打真的 Apps Script 網址。
  const shouldMockApi = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW !== 'false'
  if (shouldMockApi) {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }
  createApp(App).use(router).mount('#app')
}

bootstrap()
