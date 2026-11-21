<template>
  <a-layout class="app-shell">
    <a-layout-sider :width="216" theme="light" class="app-sider">
      <div class="sider-inner">
        <div class="brand">
          <div class="brand-logo">🍚</div>
          <div>
            <div class="brand-name">今天吃什么</div>
            <div class="brand-role">{{ store.roleName }}</div>
          </div>
        </div>

        <a-menu mode="inline" :selected-keys="[current]" class="side-menu" @click="onMenu">
          <a-menu-item v-for="item in menus" :key="item.path">{{ item.title }}</a-menu-item>
        </a-menu>
      </div>
    </a-layout-sider>

    <a-layout class="app-main">
      <a-layout-header class="header">
        <div class="header-left">
          <span class="header-mark"></span>
          <span class="header-title">{{ currentTitle }}</span>
          <span class="header-crumb">今天吃什么 / {{ currentTitle }}</span>
        </div>
        <div class="header-right">
          <span class="user-chip">
            <span class="user-dot">{{ (store.admin?.name || store.admin?.username || '管').slice(0, 1) }}</span>
            {{ store.admin?.name || store.admin?.username }}
          </span>
          <a class="header-link" @click="passwordVisible = true">改密码</a>
          <a-divider type="vertical" />
          <a class="header-link header-logout" @click="logout">退出</a>
        </div>
      </a-layout-header>

      <a-layout-content class="app-content">
        <router-view />
      </a-layout-content>
    </a-layout>

    <a-modal v-model:open="passwordVisible" title="修改密码" :confirm-loading="saving" @ok="savePassword">
      <a-form layout="vertical">
        <a-form-item label="原密码">
          <a-input-password v-model:value="pwd.old_password" />
        </a-form-item>
        <a-form-item label="新密码（至少 8 位）">
          <a-input-password v-model:value="pwd.new_password" />
        </a-form-item>
      </a-form>
    </a-modal>
  </a-layout>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { api, tokenStore } from '../api'
import { clearAuth, hasPerm, store } from '../store'

const route = useRoute()
const router = useRouter()

const allMenus = [
  { path: '/dashboard', title: '数据大盘', perm: 'stats:view' },
  { path: '/audit', title: '审核中心', perm: 'audit:review' },
  { path: '/reports', title: '举报工单', perm: 'report:handle' },
  { path: '/recipes', title: '菜谱管理', perm: 'content:manage' },
  { path: '/posts', title: '帖子管理', perm: 'content:manage' },
  { path: '/comments', title: '评论管理', perm: 'content:manage' },
  { path: '/users', title: '用户管理', perm: 'user:manage' },
  { path: '/notices', title: '公告管理', perm: 'notice:manage' },
  { path: '/drinks', title: '品牌池', perm: 'notice:manage' },
  { path: '/words', title: '敏感词库', perm: 'word:manage' },
  { path: '/admins', title: '账号与权限', perm: 'admin:manage' },
  { path: '/logs', title: '操作日志', perm: 'admin:manage' },
]

const menus = computed(() => allMenus.filter((item) => hasPerm(item.perm)))
const current = computed(() => route.path)
const currentTitle = computed(() => allMenus.find((item) => item.path === route.path)?.title || '')

const passwordVisible = ref(false)
const saving = ref(false)
const pwd = reactive({ old_password: '', new_password: '' })

function onMenu({ key }) {
  router.push(key)
}

async function savePassword() {
  saving.value = true
  try {
    await api.changePassword(pwd)
    message.success('密码已修改')
    passwordVisible.value = false
    pwd.old_password = ''
    pwd.new_password = ''
  } finally {
    saving.value = false
  }
}

function logout() {
  tokenStore.clear()
  clearAuth()
  router.replace('/login')
}
</script>

<style scoped>
/* 外壳固定高度：侧栏与顶栏不动，只有内容区滚动 */
.app-shell {
  height: 100vh;
  overflow: hidden;
}

.app-sider {
  height: 100vh;
  overflow-y: auto;
  overflow-x: hidden;
  flex-shrink: 0;
  border-right: 1px solid var(--line) !important;
  background: #fff !important;
  z-index: 20;
}

.app-sider :deep(.ant-layout-sider-children) {
  height: auto;
  min-height: 100%;
}

.sider-inner {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.app-main {
  min-width: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 顶栏固定在内容滚动容器之上 */
.header {
  position: sticky;
  top: 0;
  z-index: 15;
  flex: 0 0 60px;
  height: 60px;
  line-height: 60px;
  padding: 0 26px;
  background: #ffffff;
  border-bottom: 1px solid var(--line);
  box-shadow: 0 2px 12px rgba(70, 45, 25, 0.05);
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 2px 12px rgba(70, 45, 25, 0.04);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.header-mark {
  width: 4px;
  height: 18px;
  border-radius: 4px;
  background: linear-gradient(180deg, #ff8b54, #ef4e19);
  flex-shrink: 0;
}

.header-title {
  font-weight: 700;
  font-size: 16px;
  color: var(--ink-900);
  white-space: nowrap;
}

.header-crumb {
  font-size: 12px;
  color: var(--ink-300);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.user-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px 4px 4px;
  border-radius: 999px;
  background: var(--brand-50);
  color: var(--brand-700);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.user-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffb085, #ef4e19);
  color: #fff;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-link {
  color: var(--ink-600);
  font-size: 13px;
  transition: color 0.2s ease;
}

.header-link:hover {
  color: var(--brand-600);
}

.header-logout:hover {
  color: var(--danger);
}

/* 只有这里滚动 */
.app-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 22px 26px 34px;
  background: var(--bg);
  scrollbar-width: thin;
  scrollbar-color: #dcd4ca transparent;
}

.app-content::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.app-content::-webkit-scrollbar-thumb {
  background: #ddd5cb;
  border-radius: 8px;
}

.app-content::-webkit-scrollbar-track {
  background: transparent;
}

/* 品牌区与菜单 */
.brand {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 20px 18px 18px;
  border-bottom: 1px solid var(--line-soft);
  flex-shrink: 0;
}

.brand-logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: linear-gradient(135deg, #ff8b54, #ef4e19);
  box-shadow: 0 6px 14px rgba(239, 78, 25, 0.22);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 21px;
}

.brand-name {
  font-weight: 700;
  font-size: 15px;
  color: var(--ink-900);
  letter-spacing: 0.5px;
}

.brand-role {
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-400);
}

.side-menu {
  border-inline-end: none !important;
  background: transparent !important;
  padding: 10px 8px;
  flex: 1;
}

.side-menu :deep(.ant-menu-item) {
  height: 40px;
  line-height: 40px;
  margin-bottom: 3px;
  border-radius: 9px;
  color: var(--ink-600);
  font-size: 13px;
}

.side-menu :deep(.ant-menu-item-selected) {
  color: var(--brand-600) !important;
  font-weight: 600;
  background: var(--brand-50) !important;
}

.side-menu :deep(.ant-menu-item-selected::after) {
  display: none;
}

.side-menu :deep(.ant-menu-item:not(.ant-menu-item-selected):hover) {
  color: var(--brand-600);
  background: var(--surface-soft) !important;
}

@media (max-width: 900px) {
  .header-crumb { display: none; }
  .app-content { padding: 16px; }
}
</style>
