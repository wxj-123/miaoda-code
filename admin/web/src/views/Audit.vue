<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">审核中心</h2>
        <p class="page-sub">所有投稿需审核通过后才会对外展示，驳回必须填写理由</p>
      </div>
      <a-space>
        <a-radio-group v-model:value="kind" button-style="solid" @change="load">
          <a-radio-button value="all">全部</a-radio-button>
          <a-radio-button value="recipe">菜谱</a-radio-button>
          <a-radio-button value="post">帖子</a-radio-button>
        </a-radio-group>
        <a-button @click="load">刷新</a-button>
      </a-space>
    </div>

    <div class="panel">
      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="{ pageSize: 10 }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
            <div style="display: flex; gap: 10px; align-items: center">
              <img v-if="record.cover_img || (record.media && record.media.length)" class="cover-thumb"
                   :src="record.cover_img || record.media[0]" alt="" />
              <div v-else class="cover-thumb cover-empty">无图</div>
              <div class="title-cell">
                <span class="title-main">{{ record.title }}</span>
                <span class="muted">{{ record.summary || record.content }}</span>
              </div>
            </div>
          </template>
          <template v-else-if="column.key === 'kind'">
            <a-tag :color="record.kind === 'recipe' ? 'orange' : 'blue'">{{ record.kind_text }}</a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a @click="view(record)">查看</a>
              <a style="color: #2f9e69" @click="approve(record)">通过</a>
              <a style="color: #d9534f" @click="openReject(record)">驳回</a>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <div class="panel" style="margin-top: 14px">
      <h3 class="page-title" style="font-size: 15px; margin-bottom: 8px">审核日志</h3>
      <div class="list-row" v-for="item in logs" :key="item.id">
        <span><b>{{ item.admin_name }}</b> {{ item.action }} {{ item.target }}</span>
        <span class="muted">{{ item.detail }} · {{ item.created_at }}</span>
      </div>
      <a-empty v-if="!logs.length" description="还没有审核记录" />
    </div>

    <a-modal v-model:open="rejectVisible" title="驳回理由" :confirm-loading="saving" @ok="confirmReject">
      <a-textarea v-model:value="rejectReason" :rows="4" placeholder="写清楚原因，作者会在「消息-审核」里看到" />
    </a-modal>

    <a-modal v-model:open="detailVisible" :title="detail.title" :footer="null" width="640px">
      <div v-if="detail.cover" style="margin-bottom: 12px">
        <img :src="detail.cover" style="width: 100%; border-radius: 8px" alt="" />
      </div>
      <p style="color: #595959; line-height: 1.8; white-space: pre-wrap">{{ detail.summary || detail.content }}</p>
      <div class="muted">作者：{{ detail.owner_name }} · 提交时间：{{ detail.created_at }}</div>
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import api from '../api'

const kind = ref('all')
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const logs = ref([])

const rejectVisible = ref(false)
const rejectReason = ref('')
const rejectTarget = ref(null)

const detailVisible = ref(false)
const detail = reactive({ title: '', summary: '', content: '', cover: '', owner_name: '', created_at: '' })

const columns = [
  { title: '内容', key: 'title', width: '46%' },
  { title: '类型', key: 'kind', width: 90 },
  { title: '作者', dataIndex: 'owner_name', width: 120 },
  { title: '提交时间', dataIndex: 'created_at', width: 150 },
  { title: '操作', key: 'action', width: 160 },
]

async function load() {
  loading.value = true
  try {
    const data = await api.pending({ kind: kind.value, page: 1, page_size: 100 })
    list.value = data.list
  } finally {
    loading.value = false
  }
  const logData = await api.auditLogs({ page: 1, page_size: 8 })
  logs.value = logData.list
}

async function approve(record) {
  await api.decide({ kind: record.kind, id: record.id, passed: true })
  message.success('已通过')
  load()
}

function openReject(record) {
  rejectTarget.value = record
  rejectReason.value = ''
  rejectVisible.value = true
}

async function confirmReject() {
  if (!rejectReason.value.trim()) {
    message.warning('驳回理由必填')
    return
  }
  saving.value = true
  try {
    await api.decide({
      kind: rejectTarget.value.kind,
      id: rejectTarget.value.id,
      passed: false,
      reason: rejectReason.value.trim(),
    })
    message.success('已驳回')
    rejectVisible.value = false
    load()
  } finally {
    saving.value = false
  }
}

function view(record) {
  Object.assign(detail, {
    title: record.title,
    summary: record.summary,
    content: record.content,
    cover: record.cover_img,
    owner_name: record.owner_name,
    created_at: record.created_at,
  })
  detailVisible.value = true
}

onMounted(load)
</script>
