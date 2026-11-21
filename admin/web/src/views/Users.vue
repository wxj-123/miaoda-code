<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">用户管理</h2>
        <p class="page-sub">查看用户内容量，封禁后该账号无法发布内容与评论</p>
      </div>
      <a-space>
        <a-input-search v-model:value="keyword" placeholder="搜昵称 / UID / 邮箱" allow-clear style="width: 240px" @search="onFilter" />
        <a-select v-model:value="status" style="width: 120px" @change="onFilter">
          <a-select-option :value="null">全部状态</a-select-option>
          <a-select-option :value="0">正常</a-select-option>
          <a-select-option :value="1">已封禁</a-select-option>
        </a-select>
      </a-space>
    </div>

    <div class="panel">
      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="{ pageSize: 15, total, onChange: onPage }"
        row-key="uid"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'nickname'">
            <div class="title-cell">
              <span class="title-main">{{ record.nickname || '未设置昵称' }}</span>
              <span class="muted">{{ record.uid }}</span>
            </div>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="record.status === 1 ? 'red' : 'green'">{{ record.status === 1 ? '已封禁' : '正常' }}</a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a @click="detail(record)">详情</a>
              <a v-if="record.status === 1" style="color: #2f9e69" @click="unban(record)">解封</a>
              <a v-else style="color: #d9534f" @click="openBan(record)">封禁</a>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal v-model:open="banVisible" title="封禁账号" :confirm-loading="saving" @ok="confirmBan">
      <p class="muted" style="margin-top: 0">账号：{{ current?.nickname }}（{{ current?.uid }}）</p>
      <a-textarea v-model:value="reason" :rows="3" placeholder="封禁原因（必填），用户会被告知已封禁" />
    </a-modal>

    <a-drawer v-model:open="detailVisible" title="用户详情" width="380">
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="昵称">{{ detailData.nickname || '未设置' }}</a-descriptions-item>
        <a-descriptions-item label="UID">{{ detailData.uid }}</a-descriptions-item>
        <a-descriptions-item label="邮箱">{{ detailData.email || '—' }}</a-descriptions-item>
        <a-descriptions-item label="状态">
          {{ detailData.status === 1 ? '已封禁（' + detailData.ban_reason + '）' : '正常' }}
        </a-descriptions-item>
        <a-descriptions-item label="注册时间">{{ detailData.created_at }}</a-descriptions-item>
        <a-descriptions-item label="内容">
          菜谱 {{ detailData.stats?.recipe }} · 帖子 {{ detailData.stats?.post }} · 评论 {{ detailData.stats?.comment }}
        </a-descriptions-item>
      </a-descriptions>
    </a-drawer>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import api from '../api'

const keyword = ref('')
const status = ref(null)
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)

const banVisible = ref(false)
const reason = ref('')
const current = ref(null)

const detailVisible = ref(false)
const detailData = reactive({})

const columns = [
  { title: '用户', key: 'nickname', width: '30%' },
  { title: '邮箱', dataIndex: 'email', width: 180 },
  { title: '状态', key: 'status', width: 100 },
  { title: '注册时间', dataIndex: 'created_at', width: 150 },
  { title: '操作', key: 'action', width: 140 },
]

function onFilter() {
  page.value = 1
  reload()
}

async function reload() {
  loading.value = true
  try {
    const data = await api.users({ keyword: keyword.value, status: status.value, page: page.value, page_size: 15 })
    list.value = data.list
    total.value = data.total
  } finally {
    loading.value = false
  }
}

function onPage(next) {
  page.value = next
  reload()
}

function openBan(record) {
  current.value = record
  reason.value = ''
  banVisible.value = true
}

async function confirmBan() {
  if (!reason.value.trim()) {
    message.warning('封禁原因必填')
    return
  }
  saving.value = true
  try {
    await api.banUser(current.value.uid, reason.value.trim())
    message.success('已封禁')
    banVisible.value = false
    reload()
  } finally {
    saving.value = false
  }
}

async function unban(record) {
  await api.unbanUser(record.uid)
  message.success('已解封')
  reload()
}

async function detail(record) {
  const data = await api.userDetail(record.uid)
  Object.assign(detailData, data)
  detailVisible.value = true
}

onMounted(reload)
</script>
