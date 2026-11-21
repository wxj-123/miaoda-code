<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">帖子管理</h2>
        <p class="page-sub">社区全部帖子，可置顶、下架、删除</p>
      </div>
      <a-space>
        <a-input-search v-model:value="keyword" placeholder="搜标题或作者" allow-clear style="width: 220px" @search="onFilter" />
        <a-select v-model:value="status" style="width: 120px" @change="onFilter">
          <a-select-option :value="null">全部状态</a-select-option>
          <a-select-option :value="2">已通过</a-select-option>
          <a-select-option :value="1">审核中</a-select-option>
          <a-select-option :value="3">已驳回</a-select-option>
        </a-select>
      </a-space>
    </div>

    <div class="panel">
      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="{ pageSize: 10, total, onChange: onPage }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
            <div style="display: flex; gap: 10px; align-items: center">
              <img v-if="record.media && record.media.length" class="cover-thumb" :src="record.media[0]" alt="" />
              <div v-else class="cover-thumb cover-empty"></div>
              <div class="title-cell">
                <span class="title-main">
                  <a-tag v-if="record.is_top" color="orange">置顶</a-tag>
                  <a-tag v-if="record.post_type === 'checkin'" color="blue">打卡</a-tag>
                  <a-tag v-if="record.video_url" color="purple">视频</a-tag>
                  {{ record.title }}
                </span>
                <span class="muted">{{ record.content }}</span>
              </div>
            </div>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="statusColor(record.audit_status)">{{ statusText(record.audit_status) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space wrap>
              <a @click="top(record)">{{ record.is_top ? '取消置顶' : '置顶' }}</a>
              <a v-if="record.audit_status === 2" style="color: #d9534f" @click="takeDown(record)">下架</a>
              <a v-else style="color: #2f9e69" @click="restore(record)">恢复</a>
              <a-popconfirm title="删除后不可恢复，确定删除？" @confirm="remove(record)">
                <a style="color: #d9534f">删除</a>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import api from '../api'

const keyword = ref('')
const status = ref(null)
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)

const columns = [
  { title: '帖子', key: 'title', width: '48%' },
  { title: '状态', key: 'status', width: 100 },
  { title: '作者', dataIndex: 'owner_name', width: 120 },
  { title: '数据', dataIndex: 'view_count', width: 90, customRender: ({ text }) => '浏览 ' + text },
  { title: '发布时间', dataIndex: 'created_at', width: 150 },
  { title: '操作', key: 'action', width: 190 },
]

function statusText(value) {
  return { 0: '草稿', 1: '审核中', 2: '已通过', 3: '已驳回' }[value] || '-'
}

function statusColor(value) {
  return { 0: 'default', 1: 'gold', 2: 'green', 3: 'red' }[value] || 'default'
}

function onFilter() {
  page.value = 1
  reload()
}

async function reload() {
  loading.value = true
  try {
    const data = await api.posts({ keyword: keyword.value, status: status.value, page: page.value, page_size: 10 })
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

async function top(record) {
  await api.topPost(record.id, !record.is_top)
  message.success(record.is_top ? '已取消置顶' : '已置顶')
  reload()
}

async function takeDown(record) {
  await api.postStatus(record.id, 3, '管理员下架')
  message.success('已下架')
  reload()
}

async function restore(record) {
  await api.postStatus(record.id, 2)
  message.success('已恢复')
  reload()
}

async function remove(record) {
  await api.deletePost(record.id)
  message.success('已删除')
  reload()
}

onMounted(reload)
</script>
