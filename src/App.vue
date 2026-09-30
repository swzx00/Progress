<script setup lang="ts">
import { NConfigProvider, dateZhTW, zhTW, type GlobalThemeOverrides } from 'naive-ui'

// 色值取自 src/styles/tokens.scss 的色階。Naive UI 會在 JS 裡運算顏色（例如自動推算淡色），
// 吃不了 CSS 變數，只能寫 hex；註解標出對應的色階，改 tokens.scss 時這裡要手動同步
const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#1a66ff', // --color-blue-500
    primaryColorHover: '#1259e5', // --color-blue-600
    primaryColorPressed: '#0f47b8', // --color-blue-700
    primaryColorSuppl: '#1a66ff', // --color-blue-500
    errorColor: '#cd2742', // --color-red-600
    errorColorHover: '#a51028', // --color-red-700
    errorColorPressed: '#820f21', // --color-red-800
    borderColor: '#e9ecef', // --color-black-100
    borderRadius: '8px',
    // 跟 src/style.scss 的 body font-family 保持一致
    fontFamily:
      "Roboto, 'Noto Sans TC', 'PingFang TC', 'Heiti TC', 'Microsoft JhengHei', Arial, sans-serif",
    // 跟 src/style.scss 的 body line-height 保持一致（Naive UI 預設 1.6）；
    // fontSize 刻意不同步，控制項維持 Naive UI 預設的 14px
    lineHeight: '1.5',
  },
}
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides" :locale="zhTW" :date-locale="dateZhTW">
    <router-view />
  </n-config-provider>
</template>
