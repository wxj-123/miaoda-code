<template>
  <a-config-provider :locale="zhCN" :theme="{ token: { colorPrimary: '#ff6b35', borderRadius: 8, fontFamily: '-apple-system, BlinkMacSystemFont, PingFang SC, sans-serif' } }">
    <router-view />
  </a-config-provider>
</template>

<script setup>
import zhCN from 'ant-design-vue/es/locale/zh_CN'
</script>
