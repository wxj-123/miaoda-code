<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">举报工单</h2>
        <p class="page-sub">判定违规会自动下架内容（评论直接删除），判定合规只关闭工单</p>
      </div>
      <a-space>
        <a-radio-group v-model:value="status" button-style="solid" @change="onFilter">
          <a-radio-button :value="0">待处理</a-radio-button>
          <a-radio-button :value="1">已处理</a-radio-button>
          <a-radio-button :value="null">全部</a-radio-button>
        </a-radio-group>
        <a-button @click="reload">刷新</a-button>
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
          <template v-if="column.key === 'target'">
            <div class="title-cell">
              <span class="title-main">{{ record.target_title || '内容已删除' }}</span>
              <span class="muted">{{ typeText(record.target_type) }} #{{ record.target_id }}</span>
            </div>
          </template>
          <template v-else-if="column.key === 'reason'">
            <a-tag color="red">{{ record.reason }}</a-tag>
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag v-if="record.status === 0" color="gold">待处理</a-tag>
            <a-tag v-else :color="record.result === 1 ? 'red' : 'green'">
              {{ record.result === 1 ? '违规下架' : '判定合规' }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space v-if="record.status === 0">
              <a style="color: #2f9e69" @click="open(record, false)">判定合规</a>
              <a style="color: #d9534f" @click="open(record, true)">违规下架</a>
            </a-space>
            <span v-else class="muted">{{ record.handled_by }} · {{ record.handle_remark }}</span>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal
      v-model:open="visible"
      :title="violate ? '违规下架' : '判定合规'"
      :confirm-loading="saving"
      @ok="submit"
    >
      <p class="muted" style="margin-top: 0">
        工单 #{{ current?.id }} · {{ current?.target_title }}
      </p>
      <a-textarea
        v-model:value="remark"
        :rows="4"
        :placeholder="violate ? '处理备注（必填），例如：含引流广告，已下架' : '处理备注（选填）'"
      />
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import api from '../api'

const status = ref(0)
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const total = ref(0)
const page = ref(1)

const visible = ref(false)
const violate = ref(false)
const remark = ref('')
const current = ref(null)

const columns = [
  { title: '被举报内容', key: 'target', width: '30%' },
  { title: '原因', key: 'reason', width: 110 },
  { title: '举报人', dataIndex: 'reporter_name', width: 110 },
  { title: '说明', dataIndex: 'detail', ellipsis: true },
  { title: '状态', key: 'status', width: 110 },
  { title: '操作', key: 'action', width: 170 },
]

function typeText(type) {
  return type === 'recipe' ? '菜谱' : type === 'post' ? '帖子' : '评论'
}

function onFilter() {
  page.value = 1
  reload()
}

async function reload() {
  loading.value = true
  try {
    const data = await api.reports({ status: status.value, page: page.value, page_size: 10 })
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

function open(record, isViolate) {
  current.value = record
  violate.value = isViolate
  remark.value = ''
  visible.value = true
}

async function submit() {
  if (violate.value && !remark.value.trim()) {
    message.warning('下架需要填写处理备注')
    return
  }
  saving.value = true
  try {
    await api.handleReport(current.value.id, { violate: violate.value, remark: remark.value.trim() })
    message.success('工单已处理')
    visible.value = false
    reload()
  } finally {
    saving.value = false
  }
}

onMounted(reload)
</script>
