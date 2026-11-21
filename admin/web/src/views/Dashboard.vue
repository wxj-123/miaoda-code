<template>
  <div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">内容总量</div>
        <div class="stat-value">{{ overview.totals.recipe + overview.totals.post }}</div>
        <div class="stat-foot">菜谱 {{ overview.totals.recipe }} · 帖子 {{ overview.totals.post }}</div>
      </div>
      <div class="stat-card stat-accent">
        <div class="stat-label">待处理</div>
        <div class="stat-value">{{ overview.pending.all }}</div>
        <div class="stat-foot">举报工单 {{ overview.pending.report }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">注册用户</div>
        <div class="stat-value">{{ overview.totals.user }}</div>
        <div class="stat-foot">今日新增 {{ overview.today.user }} · 封禁 {{ overview.banned }}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">累计浏览</div>
        <div class="stat-value">{{ overview.totals.view }}</div>
        <div class="stat-foot">评论 {{ overview.totals.comment }} 条</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="page-head" style="margin-bottom: 12px">
          <h3 class="page-title" style="font-size: 15px">近 7 天投稿趋势</h3>
          <a-space :size="14">
            <span class="muted">■ 菜谱</span>
            <span class="muted">■ 帖子</span>
          </a-space>
        </div>
        <div class="chart">
          <div class="chart-col" v-for="(label, index) in trend.labels" :key="label">
            <div class="chart-bars">
              <div class="chart-bar bar-recipe" :style="{ height: heightOf(trend.recipes[index]) }"></div>
              <div class="chart-bar bar-post" :style="{ height: heightOf(trend.posts[index]) }"></div>
            </div>
            <div class="chart-label">{{ label }}</div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h3 class="page-title" style="font-size: 15px; margin-bottom: 10px">菜系分布</h3>
        <div class="bar-row" v-for="item in cuisineList" :key="item.cuisine">
          <div class="bar-label">{{ item.cuisine }}</div>
          <div class="bar-track">
            <div class="bar-fill" :style="{ width: percent(item.count) }"></div>
          </div>
          <div class="bar-value">{{ item.count }}</div>
        </div>
        <a-empty v-if="!cuisineList.length" description="还没有上架菜谱" />
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h3 class="page-title" style="font-size: 15px; margin-bottom: 10px">热门菜谱</h3>
        <div class="list-row" v-for="item in top.recipes" :key="item.id">
          <span class="title-main">{{ item.name }}</span>
          <span class="muted">浏览 {{ item.view }} · 收藏 {{ item.collect }}</span>
        </div>
      </div>
      <div class="panel">
        <h3 class="page-title" style="font-size: 15px; margin-bottom: 10px">活跃作者</h3>
        <div class="list-row" v-for="item in top.authors" :key="item.name">
          <span class="title-main">{{ item.name }}</span>
          <span class="muted">{{ item.count }} 篇</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import api from '../api'

const overview = reactive({
  totals: { recipe: 0, post: 0, user: 0, comment: 0, view: 0 },
  pending: { recipe: 0, post: 0, report: 0, all: 0 },
  today: { recipe: 0, post: 0, user: 0 },
  banned: 0,
})
const trend = reactive({ labels: [], recipes: [], posts: [] })
const top = reactive({ recipes: [], posts: [], authors: [] })
const cuisineList = ref([])

const maxTrend = computed(() => {
  const all = [...trend.recipes, ...trend.posts, 1]
  return Math.max(...all)
})

const maxCuisine = computed(() => Math.max(...cuisineList.value.map((item) => item.count), 1))

function heightOf(value) {
  return Math.max(4, Math.round((value / maxTrend.value) * 120)) + 'px'
}

function percent(value) {
  return Math.round((value / maxCuisine.value) * 100) + '%'
}

onMounted(async () => {
  const [ov, tr, tp, cu] = await Promise.all([api.overview(), api.trend(7), api.top(), api.cuisine()])
  Object.assign(overview, ov)
  Object.assign(trend, tr)
  Object.assign(top, tp)
  cuisineList.value = cu
})
</script>

<style scoped>
.chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 160px;
  padding-top: 8px;
}

.chart-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
}

.chart-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 120px;
}

.chart-bar {
  width: 12px;
  border-radius: 5px 5px 0 0;
  min-height: 3px;
}

.bar-recipe {
  background: linear-gradient(180deg, #ff8a4c, #ff6b35);
}

.bar-post {
  background: #ffd7c0;
}

.chart-label {
  margin-top: 6px;
  font-size: 11px;
  color: #a39e98;
}
</style>
