<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">菜谱管理</h2>
        <p class="page-sub">全量菜谱（含未通过与草稿），可置顶、下架、编辑基础信息</p>
      </div>
      <a-space>
        <a-input-search v-model:value="keyword" placeholder="搜菜名或作者" allow-clear style="width: 220px" @search="onFilter" />
        <a-select v-model:value="status" style="width: 120px" @change="onFilter">
          <a-select-option :value="null">全部状态</a-select-option>
          <a-select-option :value="2">已通过</a-select-option>
          <a-select-option :value="1">审核中</a-select-option>
          <a-select-option :value="3">已驳回</a-select-option>
          <a-select-option :value="0">草稿</a-select-option>
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
              <img v-if="record.cover_img" class="cover-thumb" :src="record.cover_img" alt="" />
              <div v-else class="cover-thumb cover-empty"></div>
              <div class="title-cell">
                <span class="title-main">
                  <a-tag v-if="record.is_top" color="orange">置顶</a-tag>
                  {{ record.name }}
                </span>
                <span class="muted">{{ record.cuisine }} · {{ record.difficulty }} · {{ record.cost_time }} 分钟</span>
              </div>
            </div>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="statusColor(record.audit_status)">{{ statusText(record.audit_status) }}</a-tag>
          </template>
          <template v-else-if="column.key === 'data'">
            <span class="muted">浏览 {{ record.view_count }} · 收藏 {{ record.collect_count }}</span>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space wrap>
              <a @click="openEdit(record)">编辑</a>
              <a @click="top(record)">{{ record.is_top ? '取消置顶' : '置顶' }}</a>
              <a v-if="record.audit_status === 2" style="color: #d9534f" @click="takeDown(record)">下架</a>
              <a v-else style="color: #2f9e69" @click="restore(record)">恢复上架</a>
              <a-popconfirm title="删除后不可恢复，确定删除？" @confirm="remove(record)">
                <a style="color: #d9534f">删除</a>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal v-model:open="editVisible" title="编辑菜谱" :confirm-loading="saving" @ok="save">
      <a-form layout="vertical">
        <a-form-item label="菜名">
          <a-input v-model:value="form.name" />
        </a-form-item>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="菜系"><a-input v-model:value="form.cuisine" /></a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="地区"><a-input v-model:value="form.region" /></a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="8">
            <a-form-item label="口味"><a-input v-model:value="form.taste" /></a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="难度"><a-input v-model:value="form.difficulty" /></a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="耗时（分钟）">
              <a-input-number v-model:value="form.cost_time" :min="1" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="推荐权重（越大越靠前）">
          <a-input-number v-model:value="form.weight" :min="0" style="width: 100%" />
        </a-form-item>
        <a-form-item label="简介">
          <a-textarea v-model:value="form.summary" :rows="3" />
        </a-form-item>
      </a-form>
    </a-modal>
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

const editVisible = ref(false)
const currentId = ref(0)
const form = reactive({
  name: '',
  cuisine: '',
  region: '',
  taste: '',
  difficulty: '',
  cost_time: 30,
  weight: 0,
  summary: '',
})

const columns = [
  { title: '菜谱', key: 'title', width: '38%' },
  { title: '状态', key: 'status', width: 100 },
  { title: '作者', dataIndex: 'owner_name', width: 120 },
  { title: '数据', key: 'data', width: 180 },
  { title: '操作', key: 'action', width: 220 },
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
    const data = await api.recipes({
      keyword: keyword.value,
      status: status.value,
      page: page.value,
      page_size: 10,
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

function openEdit(record) {
  currentId.value = record.id
  Object.assign(form, {
    name: record.name,
    cuisine: record.cuisine,
    region: record.region,
    taste: record.taste,
    difficulty: record.difficulty,
    cost_time: record.cost_time,
    weight: record.weight,
    summary: record.summary,
  })
  editVisible.value = true
}

async function save() {
  saving.value = true
  try {
    await api.updateRecipe(currentId.value, { ...form })
    message.success('已保存')
    editVisible.value = false
    reload()
  } finally {
    saving.value = false
  }
}

async function top(record) {
  await api.topRecipe(record.id, !record.is_top)
  message.success(record.is_top ? '已取消置顶' : '已置顶')
  reload()
}

async function takeDown(record) {
  await api.recipeStatus(record.id, 3, '管理员下架')
  message.success('已下架')
  reload()
}

async function restore(record) {
  await api.recipeStatus(record.id, 2)
  message.success('已恢复上架')
  reload()
}

async function remove(record) {
  await api.deleteRecipe(record.id)
  message.success('已删除')
  reload()
}

onMounted(reload)
</script>
