<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">公告管理</h2>
        <p class="page-sub">展示中的公告会出现在小程序首页顶部</p>
      </div>
      <a-button type="primary" @click="openCreate">新建公告</a-button>
    </div>

    <div class="panel">
      <a-table :columns="columns" :data-source="list" :loading="loading" row-key="id" size="middle" :pagination="false">
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
            <div class="title-cell">
              <span class="title-main">{{ record.title }}</span>
              <span class="muted">{{ record.content }}</span>
            </div>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="record.is_active ? 'green' : 'default'">{{ record.is_active ? '展示中' : '已隐藏' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a @click="openEdit(record)">编辑</a>
              <a @click="toggle(record)">{{ record.is_active ? '隐藏' : '展示' }}</a>
              <a-popconfirm title="删除这条公告？" @confirm="remove(record)">
                <a style="color: #d9534f">删除</a>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal v-model:open="visible" :title="currentId ? '编辑公告' : '新建公告'" :confirm-loading="saving" @ok="save">
      <a-form layout="vertical">
        <a-form-item label="标题">
          <a-input v-model:value="form.title" :maxlength="40" />
        </a-form-item>
        <a-form-item label="内容">
          <a-textarea v-model:value="form.content" :rows="4" :maxlength="300" />
        </a-form-item>
        <a-form-item label="是否展示">
          <a-switch v-model:checked="form.is_active" />
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
const visible = ref(false)
const currentId = ref(0)
const form = reactive({ title: '', content: '', is_active: true })

const columns = [
  { title: '公告', key: 'title', width: '58%' },
  { title: '状态', key: 'status', width: 110 },
  { title: '发布时间', dataIndex: 'created_at', width: 160 },
  { title: '操作', key: 'action', width: 170 },
]

async function reload() {
  loading.value = true
  try {
    const data = await api.notices()
    list.value = data.list
  } finally {
    loading.value = false
  }
}

function openCreate() {
  currentId.value = 0
  Object.assign(form, { title: '', content: '', is_active: true })
  visible.value = true
}

function openEdit(record) {
  currentId.value = record.id
  Object.assign(form, { title: record.title, content: record.content, is_active: record.is_active })
  visible.value = true
}

async function save() {
  if (!form.title.trim()) {
    message.warning('标题不能为空')
    return
  }
  saving.value = true
  try {
    if (currentId.value) {
      await api.updateNotice(currentId.value, { ...form })
    } else {
      await api.createNotice({ ...form })
    }
    message.success('已保存')
    visible.value = false
    reload()
  } finally {
    saving.value = false
  }
}

async function toggle(record) {
  await api.updateNotice(record.id, { title: record.title, content: record.content, is_active: !record.is_active })
  message.success('已更新')
  reload()
}

async function remove(record) {
  await api.deleteNotice(record.id)
  message.success('已删除')
  reload()
}

onMounted(reload)
</script>
