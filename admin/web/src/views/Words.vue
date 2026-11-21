<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">敏感词库</h2>
        <p class="page-sub">命中词库的内容会在提交时被直接拦截，无法绕过</p>
      </div>
      <a-space>
        <a-input v-model:value="newWord" placeholder="输入要拦截的词" style="width: 200px" @press-enter="add" />
        <a-button type="primary" @click="add">添加</a-button>
        <a-button @click="importVisible = true">批量导入</a-button>
      </a-space>
    </div>

    <div class="panel">
      <a-table
        :columns="columns"
        :data-source="list"
        :loading="loading"
        :pagination="{ pageSize: 20 }"
        row-key="id"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'word'">
            <a-tag color="red">{{ record.word }}</a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-popconfirm title="从词库移除？" @confirm="remove(record)">
              <a style="color: #d9534f">移除</a>
            </a-popconfirm>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal v-model:open="importVisible" title="批量导入" :confirm-loading="saving" @ok="doImport">
      <p class="muted" style="margin-top: 0">多个词用逗号或换行分隔，已存在的会自动跳过</p>
      <a-textarea v-model:value="importText" :rows="6" placeholder="加微信,代购,刷单" />
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import api from '../api'

const loading = ref(false)
const saving = ref(false)
const list = ref([])
const newWord = ref('')
const importVisible = ref(false)
const importText = ref('')

const columns = [
  { title: '敏感词', key: 'word', width: '60%' },
  { title: '加入时间', dataIndex: 'created_at', width: 170 },
  { title: '操作', key: 'action', width: 100 },
]

async function reload() {
  loading.value = true
  try {
    const data = await api.words()
    list.value = data.list
  } finally {
    loading.value = false
  }
}

async function add() {
  if (!newWord.value.trim()) {
    message.warning('请输入敏感词')
    return
  }
  await api.addWord(newWord.value.trim())
  message.success('已加入词库')
  newWord.value = ''
  reload()
}

async function doImport() {
  if (!importText.value.trim()) {
    message.warning('请输入要导入的词')
    return
  }
  saving.value = true
  try {
    const data = await api.importWords(importText.value)
    message.success(`导入完成：新增 ${data.added} 个，跳过 ${data.skipped} 个`)
    importVisible.value = false
    importText.value = ''
    reload()
  } finally {
    saving.value = false
  }
}

async function remove(record) {
  await api.deleteWord(record.id)
  message.success('已移除')
  reload()
}

onMounted(reload)
</script>
