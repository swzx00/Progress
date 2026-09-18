import { createRouter, createWebHistory } from 'vue-router'

import PublicView from '@/pages/PublicView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [{ path: '/', name: 'public', component: PublicView }],
})

export default router
