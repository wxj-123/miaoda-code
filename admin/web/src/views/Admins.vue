<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">账号与权限</h2>
        <p class="page-sub">三种角色：超管（全部）、运营（内容与配置）、审核员（审核与举报）</p>
      </div>
      <a-button type="primary" @click="openCreate">新增账号</a-button>
    </div>

    <div class="panel">
      <a-table :columns="columns" :data-source="list" :loading="loading" row-key="id" size="middle" :pagination="false">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'username'">
            <div class="title-cell">
              <span class="title-main">{{ record.name || record.username }}</span>
              <span class="muted">{{ record.username }}</span>
            </div>
          </template>
          <template v-else-if="column.key === 'role'">
            <a-tag :color="roleColor(record.role_code)">{{ roleName(record.role_code) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="record.status === 0 ? 'green' : 'default'">{{ record.status === 0 ? '正常' : '停用' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a @click="openEdit(record)">编辑</a>
              <a-popconfirm title="删除该账号？" @confirm="remove(record)">
                <a style="color: #d9534f">删除</a>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <div class="panel" style="margin-top: 14px">
      <h3 class="page-title" style="font-size: 15px; margin-bottom: 10px">角色权限对照</h3>
      <div class="list-row" v-for="role in roles" :key="role.code">
        <span class="title-main">{{ role.name }}</span>
        <span class="muted">{{ role.permissions.join('、') }}</span>
      </div>
    </div>

    <a-modal v-model:open="visible" :title="currentId ? '编辑账号' : '新增账号'" :confirm-loading="saving" @ok="save">
      <a-form layout="vertical">
        <a-form-item label="登录账号">
          <a-input v-model:value="form.username" :disabled="!!currentId" placeholder="至少 3 位" />
        </a-form-item>
        <a-form-item :label="currentId ? '重置密码（留空则不修改）' : '初始密码'">
          <a-input-password v-model:value="form.password" placeholder="至少 8 位" />
        </a-form-item>
        <a-form-item label="显示名称">
          <a-input v-model:value="form.name" placeholder="例如：审核员小李" />
        </a-form-item>
        <a-form-item label="角色">
          <a-select v-model:value="form.role_code">
            <a-select-option v-for="role in roles" :key="role.code" :value="role.code">
              {{ role.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="状态">
          <a-radio-group v-model:value="form.status">
            <a-radio :value="0">正常</a-radio>
            <a-radio :value="1">停用</a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import api from '../api'

const loading = ref(false)
const saving = ref(false)
const list = ref([])
const roles = ref([])
const visible = ref(false)
const currentId = ref(0)
const form = reactive({ username: '', password: '', name: '', role_code: 'auditor', status: 0 })

const columns = [
  { title: '账号', key: 'username', width: '30%' },
  { title: '角色', key: 'role', width: 130 },
  { title: '状态', key: 'status', width: 100 },
  { title: '最后登录', dataIndex: 'last_login_at', width: 160 },
  { title: '操作', key: 'action', width: 130 },
]

function roleName(code) {
  return roles.value.find((item) => item.code === code)?.name || code
}

function roleColor(code) {
  return { super: 'red', ops: 'orange', auditor: 'blue' }[code] || 'default'
}

async function reload() {
  loading.value = true
  try {
    const [adminData, roleData] = await Promise.all([api.admins(), api.roles()])
    list.value = adminData.list
    roles.value = roleData
  } finally {
    loading.value = false
  }
}

function openCreate() {
  currentId.value = 0
  Object.assign(form, { username: '', password: '', name: '', role_code: 'auditor', status: 0 })
  visible.value = true
}

function openEdit(record) {
  currentId.value = record.id
  Object.assign(form, {
    username: record.username,
    password: '',
    name: record.name,
    role_code: record.role_code,
    status: record.status,
  })
  visible.value = true
}

async function save() {
  if (!currentId.value) {
    if (form.username.trim().length < 3) {
      message.warning('账号至少 3 位')
      return
    }
    if (form.password.length < 8) {
      message.warning('密码至少 8 位')
      return
    }
  }
  saving.value = true
  try {
    if (currentId.value) {
      await api.updateAdmin(currentId.value, { ...form })
    } else {
      await api.createAdmin({ ...form })
    }
    message.success('已保存')
    visible.value = false
    reload()
  } finally {
    saving.value = false
  }
}

async function remove(record) {
  await api.deleteAdmin(record.id)
  message.success('已删除')
  reload()
}

onMounted(reload)
</script>
