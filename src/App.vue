<script setup lang="ts">
import { NConfigProvider, dateZhTW, zhTW, type GlobalThemeOverrides } from 'naive-ui'

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
    borderColor: '#E4E7EC',
    borderRadius: '8px',
    // 跟 src/style.scss 的 body font-family 保持一致
    fontFamily:
      "Roboto, 'Noto Sans TC', 'PingFang TC', 'Heiti TC', 'Microsoft JhengHei', Arial, sans-serif",
  },
}
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhTW" :date-locale="dateZhTW">
    <router-view />
  </n-config-provider>
</template>
