<script setup lang="ts">
import { NConfigProvider, type GlobalThemeOverrides } from 'naive-ui'

// 對齊 src/styles/tokens.css 的色彩，讓 Naive UI 元件跟自訂樣式視覺一致
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#0f6fa3',
    primaryColorHover: '#1580b8',
    primaryColorPressed: '#0c5883',
    primaryColorSuppl: '#0f6fa3',
    errorColor: '#c0392b',
    errorColorHover: '#d1483a',
    errorColorPressed: '#a3301f',
    borderRadius: '6px',
  },
}
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <router-view />
  </n-config-provider>
</template>
