<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">操作日志</h2>
        <p class="page-sub">后台所有写操作留痕，用于审计追溯</p>
      </div>
      <a-button @click="reload">刷新</a-button>
    </div>

    <div class="panel">
      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="{ pageSize: 20, total, onChange: onPage }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'action'">
            <a-tag>{{ record.action }}</a-tag>
          </template>
        </template>
      </a-table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import api from '../api'

const loading = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)

const columns = [
  { title: '操作人', dataIndex: 'admin_name', width: 130 },
  { title: '动作', key: 'action', width: 140 },
  { title: '对象', dataIndex: 'target', width: 150 },
  { title: '详情', dataIndex: 'detail', ellipsis: true },
  { title: 'IP', dataIndex: 'ip', width: 130 },
  { title: '时间', dataIndex: 'created_at', width: 160 },
]

async function reload() {
  loading.value = true
  try {
    const data = await api.logs({ page: page.value, page_size: 20 })
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

onMounted(reload)
</script>
