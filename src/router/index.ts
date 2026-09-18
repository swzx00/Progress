import { createRouter, createWebHistory } from 'vue-router'

import ManageView from '@/pages/ManageView.vue'
import PublicView from '@/pages/PublicView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'public', component: PublicView },
    { path: '/manage', name: 'manage', component: ManageView },
  ],
})

export default router
