<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">品牌池</h2>
        <p class="page-sub">小程序「今日想喝 · 摇一摇」的品牌数据，改完保存即生效</p>
      </div>
      <a-space>
        <a-popconfirm title="恢复成内置默认 50 家品牌？当前列表会被覆盖并立即对小程序生效。" @confirm="resetDefault">
          <a-button :loading="resetting">恢复默认 50 家</a-button>
        </a-popconfirm>
        <a-button @click="reload">重新加载</a-button>
        <a-button type="primary" :loading="saving" @click="save">保存</a-button>
      </a-space>
    </div>

    <div class="panel">
      <div class="drinks-toolbar">
        <span class="count">共 {{ rows.length }} 家品牌</span>
        <a-button size="small" @click="addRow">新增一行</a-button>
      </div>

      <a-table
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        row-key="_key"
        size="small"
        :pagination="false"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'">
            <a-input v-model:value="record.name" placeholder="品牌名" />
          </template>
          <template v-else-if="column.key === 'kind'">
            <a-select v-model:value="record.kind" :options="kindOptions" style="width: 100%" />
          </template>
          <template v-else-if="column.key === 'star'">
            <a-input v-model:value="record.star" placeholder="招牌饮品" />
          </template>
          <template v-else-if="column.key === 'price'">
            <a-input v-model:value="record.price" placeholder="如 12-20" style="width: 100%" />
          </template>
          <template v-else-if="column.key === 'note'">
            <a-input v-model:value="record.note" placeholder="一句话点评" />
          </template>
          <template v-else-if="column.key === 'action'">
            <a-popconfirm title="删除这家品牌？" @confirm="removeRow(record)">
              <a style="color: #d9534f">删除</a>
            </a-popconfirm>
          </template>
        </template>
      </a-table>

      <a-alert
        v-if="rows.length === 0 && !loading"
        type="info"
        show-icon
        message="品牌池是空的"
        description="点「新增一行」添加品牌，或把小程序内置的默认品牌先同步过来。"
        style="margin-top: 16px"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import api from '../api'

const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const rows = ref([])
let seq = 0

const kindOptions = [
  { value: '奶茶', label: '奶茶' },
  { value: '柠檬茶', label: '柠檬茶' },
  { value: '咖啡', label: '咖啡' },
]

const columns = [
  { title: '品牌', key: 'name', width: 150 },
  { title: '分类', key: 'kind', width: 110 },
  { title: '招牌', key: 'star', width: 170 },
  { title: '参考价', key: 'price', width: 120 },
  { title: '点评', key: 'note' },
  { title: '操作', key: 'action', width: 70 },
]

function decorate(list) {
  return (list || []).map((item) => ({
    _key: 'r' + ++seq,
    name: item.name || '',
    kind: item.kind || '奶茶',
    star: item.star || '',
    price: item.price || '',
    note: item.note || '',
  }))
}

async function reload() {
  loading.value = true
  try {
    const data = await api.drinks()
    rows.value = decorate(data.brands || [])
  } finally {
    loading.value = false
  }
}

function addRow() {
  rows.value.push({ _key: 'r' + ++seq, name: '', kind: '奶茶', star: '', price: '', note: '' })
}

function removeRow(record) {
  rows.value = rows.value.filter((item) => item._key !== record._key)
}

async function resetDefault() {
  resetting.value = true
  try {
    const data = await api.resetDrinks()
    rows.value = decorate(data.brands || [])
    message.success(`已恢复 ${data.count} 家默认品牌`)
  } finally {
    resetting.value = false
  }
}

async function save() {
  const brands = rows.value
    .filter((item) => (item.name || '').trim())
    .map((item) => ({
      name: item.name.trim(),
      kind: item.kind || '奶茶',
      star: (item.star || '').trim(),
      price: (item.price || '').trim(),
      note: (item.note || '').trim(),
    }))
  if (!brands.length) {
    message.warning('至少保留一家品牌')
    return
  }
  saving.value = true
  try {
    const data = await api.saveDrinks(brands)
    message.success(`已保存 ${data.count} 家品牌`)
  } finally {
    saving.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.drinks-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.count {
  color: #999;
  font-size: 13px;
}
</style>
