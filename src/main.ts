import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import './styles/tokens.scss'
import './style.scss'

async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV) {
    const { worker } = await import('./mocks/browser')
    await worker.start({ onUnhandledRequest: 'bypass' })
  }
  createApp(App).use(router).mount('#app')
}

bootstrap()
