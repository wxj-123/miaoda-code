<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">今天吃什么 · 管理后台</div>
      <div class="login-sub">内容审核、举报处理与运营配置</div>

      <a-form layout="vertical" @finish="submit">
        <a-form-item label="账号">
          <a-input
            v-model:value="form.username"
            size="large"
            placeholder="请输入后台账号"
            autocomplete="username"
            @press-enter="submit"
          />
        </a-form-item>
        <a-form-item label="密码">
          <a-input-password
            v-model:value="form.password"
            size="large"
            placeholder="请输入密码"
            autocomplete="current-password"
            @press-enter="submit"
          />
        </a-form-item>
        <a-button type="primary" size="large" block html-type="button" :loading="loading" @click="submit">
          登录
        </a-button>
      </a-form>

      <div v-if="showDemoTip" class="login-tip">
        开发演示账号：admin / Admin@123456（超管）<br />
        ops / Ops@123456（运营）· auditor / Audit@123456（审核员）
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { api, tokenStore } from '../api'
import { setAuth } from '../store'

const router = useRouter()
const loading = ref(false)
// 演示账号提示/预填只在开发模式出现，生产构建不泄露超管凭据。
const showDemoTip = import.meta.env.DEV
const form = reactive({ username: '', password: '' })

async function submit() {
  if (!form.username.trim() || !form.password) {
    message.warning('请输入账号和密码')
    return
  }
  loading.value = true
  try {
    const data = await api.login({ username: form.username.trim(), password: form.password })
    tokenStore.set(data.token)
    setAuth(data)
    message.success('欢迎回来，' + (data.admin.name || data.admin.username))
    router.replace('/dashboard')
  } catch (error) {
    // 错误提示已由拦截器统一处理
  } finally {
    loading.value = false
  }
}
</script>
