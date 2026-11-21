import axios from 'axios'
import { message } from 'ant-design-vue'

const TOKEN_KEY = 'eat_admin_token'

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || '',
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

const http = axios.create({ baseURL: '/api', timeout: 15000 })

http.interceptors.request.use((config) => {
  const token = tokenStore.get()
  // 公网分享网关会覆盖 Authorization 头，改用自定义头透传 JWT；本地开发后端同样兼容。
  if (token) config.headers['X-Auth-Token'] = token
  return config
})

http.interceptors.response.use(
  (res) => res.data,
  (error) => {
    const detail = error?.response?.data?.detail || '请求失败，请稍后再试'
    if (error?.response?.status === 401) {
      tokenStore.clear()
      if (!location.hash.includes('/login')) location.hash = '#/login'
    }
    message.error(detail)
    return Promise.reject(new Error(detail))
  }
)

export const api = {
  login: (data) => http.post('/auth/login', data),
  me: () => http.get('/auth/me'),
  changePassword: (data) => http.post('/auth/password', data),

  overview: () => http.get('/stats/overview'),
  trend: (days = 7) => http.get('/stats/trend', { params: { days } }),
  top: () => http.get('/stats/top'),
  cuisine: () => http.get('/stats/cuisine'),

  pending: (params) => http.get('/audit/pending', { params }),
  decide: (data) => http.post('/audit/decide', data),
  auditLogs: (params) => http.get('/audit/logs', { params }),

  reports: (params) => http.get('/reports', { params }),
  handleReport: (id, data) => http.post(`/reports/${id}/handle`, data),

  recipes: (params) => http.get('/recipes', { params }),
  recipeDetail: (id) => http.get(`/recipes/${id}`),
  updateRecipe: (id, data) => http.put(`/recipes/${id}`, data),
  topRecipe: (id, is_top) => http.post(`/recipes/${id}/top`, { is_top }),
  recipeStatus: (id, audit_status, reason = '') => http.post(`/recipes/${id}/status`, { audit_status, reason }),
  deleteRecipe: (id) => http.delete(`/recipes/${id}`),

  posts: (params) => http.get('/posts', { params }),
  topPost: (id, is_top) => http.post(`/posts/${id}/top`, { is_top }),
  postStatus: (id, audit_status, reason = '') => http.post(`/posts/${id}/status`, { audit_status, reason }),
  deletePost: (id) => http.delete(`/posts/${id}`),

  comments: (params) => http.get('/comments', { params }),
  deleteComment: (id) => http.delete(`/comments/${id}`),

  users: (params) => http.get('/users', { params }),
  userDetail: (uid) => http.get(`/users/${uid}`),
  banUser: (uid, reason) => http.post(`/users/${uid}/ban`, { reason }),
  unbanUser: (uid) => http.post(`/users/${uid}/unban`),

  notices: () => http.get('/notices'),
  createNotice: (data) => http.post('/notices', data),
  updateNotice: (id, data) => http.put(`/notices/${id}`, data),
  deleteNotice: (id) => http.delete(`/notices/${id}`),

  words: () => http.get('/words'),
  addWord: (word) => http.post('/words', { word }),
  importWords: (text) => http.post('/words/import', { text }),
  deleteWord: (id) => http.delete(`/words/${id}`),

  drinks: () => http.get('/drinks'),
  saveDrinks: (brands) => http.put('/drinks', { brands }),
  resetDrinks: () => http.post('/drinks/reset'),

  roles: () => http.get('/roles'),
  admins: () => http.get('/admins'),
  createAdmin: (data) => http.post('/admins', data),
  updateAdmin: (id, data) => http.put(`/admins/${id}`, data),
  deleteAdmin: (id) => http.delete(`/admins/${id}`),
  logs: (params) => http.get('/logs', { params }),
}

export default api
