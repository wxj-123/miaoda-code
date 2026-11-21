<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">评论管理</h2>
        <p class="page-sub">全量评论，可删除违规评论（其子回复一并删除）</p>
      </div>
      <a-space>
        <a-input-search v-model:value="keyword" placeholder="搜评论内容" allow-clear style="width: 220px" @search="onFilter" />
        <a-select v-model:value="targetType" style="width: 130px" @change="onFilter">
          <a-select-option value="">全部类型</a-select-option>
          <a-select-option value="recipe">菜谱评论</a-select-option>
          <a-select-option value="post">帖子评论</a-select-option>
        </a-select>
      </a-space>
    </div>

    <div class="panel">
      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="{ pageSize: 15, total, onChange: onPage }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'target'">
            <a-tag>{{ record.target_type === 'recipe' ? '菜谱' : '帖子' }}</a-tag>
            <span class="muted">#{{ record.target_id }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-popconfirm title="删除这条评论？" @confirm="remove(record)">
              <a style="color: #d9534f">删除</a>
            </a-popconfirm>
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
const targetType = ref('')
const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)

const columns = [
  { title: '内容', dataIndex: 'content', ellipsis: true },
  { title: '所属', key: 'target', width: 130 },
  { title: '评论者', dataIndex: 'owner_name', width: 130 },
  { title: '时间', dataIndex: 'created_at', width: 150 },
  { title: '操作', key: 'action', width: 90 },
]

function onFilter() {
  page.value = 1
  reload()
}

async function reload() {
  loading.value = true
  try {
    const data = await api.comments({
      keyword: keyword.value,
      target_type: targetType.value,
      page: page.value,
      page_size: 15,
    })
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

async function remove(record) {
  await api.deleteComment(record.id)
  message.success('已删除')
  reload()
}

onMounted(reload)
</script>
