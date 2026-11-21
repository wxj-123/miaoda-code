import { reactive } from 'vue'

export const store = reactive({
  admin: null,
  permissions: [],
  roleName: '',
  loaded: false,
})

export function setAuth(payload) {
  store.admin = payload.admin
  store.permissions = payload.permissions || []
  store.roleName = payload.role_name || ''
  store.loaded = true
}

export function clearAuth() {
  store.admin = null
  store.permissions = []
  store.roleName = ''
  store.loaded = false
}

export function hasPerm(code) {
  return store.permissions.includes(code)
}
