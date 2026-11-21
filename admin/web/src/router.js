import { createRouter, createWebHashHistory } from 'vue-router'
import { api, tokenStore } from './api'
import { clearAuth, hasPerm, setAuth, store } from './store'

const routes = [
  { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true, title: '登录' } },
  {
    path: '/',
    component: () => import('./views/Layout.vue'),
    redirect: '/dashboard',
    children: [
      { path: 'dashboard', component: () => import('./views/Dashboard.vue'), meta: { title: '数据大盘', perm: 'stats:view' } },
      { path: 'audit', component: () => import('./views/Audit.vue'), meta: { title: '审核中心', perm: 'audit:review' } },
      { path: 'reports', component: () => import('./views/Reports.vue'), meta: { title: '举报工单', perm: 'report:handle' } },
      { path: 'recipes', component: () => import('./views/Recipes.vue'), meta: { title: '菜谱管理', perm: 'content:manage' } },
      { path: 'posts', component: () => import('./views/Posts.vue'), meta: { title: '帖子管理', perm: 'content:manage' } },
      { path: 'comments', component: () => import('./views/Comments.vue'), meta: { title: '评论管理', perm: 'content:manage' } },
      { path: 'users', component: () => import('./views/Users.vue'), meta: { title: '用户管理', perm: 'user:manage' } },
      { path: 'notices', component: () => import('./views/Notices.vue'), meta: { title: '公告管理', perm: 'notice:manage' } },
      { path: 'words', component: () => import('./views/Words.vue'), meta: { title: '敏感词库', perm: 'word:manage' } },
      { path: 'drinks', component: () => import('./views/Drinks.vue'), meta: { title: '品牌池', perm: 'notice:manage' } },
      { path: 'admins', component: () => import('./views/Admins.vue'), meta: { title: '账号与权限', perm: 'admin:manage' } },
      { path: 'logs', component: () => import('./views/Logs.vue'), meta: { title: '操作日志', perm: 'admin:manage' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({ history: createWebHashHistory(), routes })

router.beforeEach(async (to) => {
  if (to.meta.public) return true
  if (!tokenStore.get()) return '/login'
  if (!store.loaded) {
    try {
      const data = await api.me()
      setAuth(data)
    } catch (error) {
      clearAuth()
      tokenStore.clear()
      return '/login'
    }
  }
  if (to.meta.perm && !hasPerm(to.meta.perm)) return '/dashboard'
  return true
})

export default router
