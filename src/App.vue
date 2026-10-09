<script setup lang="ts">
import { computed } from 'vue';
import { NConfigProvider, darkTheme, dateZhTW, zhTW, type GlobalThemeOverrides } from 'naive-ui';

import { useTheme } from '@/composables/useTheme';

const { isDark } = useTheme();

// 淺色、深色共用：跟 src/style.scss 的 body font-family／line-height 保持一致
const commonOverrides: GlobalThemeOverrides['common'] = {
  borderRadius: '8px',
  fontFamily:
    "Roboto, 'Noto Sans TC', 'PingFang TC', 'Heiti TC', 'Microsoft JhengHei', Arial, sans-serif",
  // Naive UI 預設 1.6；fontSize 刻意不同步，控制項維持 Naive UI 預設的 14px
  lineHeight: '1.5',
};

// 色值取自 src/styles/tokens.scss 的色階。Naive UI 會在 JS 裡運算顏色（例如自動推算淡色），
// 吃不了 CSS 變數，只能寫 hex；註解標出對應的色階，改 tokens.scss 時這裡要手動同步
const lightOverrides: GlobalThemeOverrides = {
  common: {
    ...commonOverrides,
    primaryColor: '#1a66ff', // --color-blue-500
    primaryColorHover: '#1259e5', // --color-blue-600
    primaryColorPressed: '#0f47b8', // --color-blue-700
    primaryColorSuppl: '#1a66ff', // --color-blue-500
    errorColor: '#cd2742', // --color-red-600
    errorColorHover: '#a51028', // --color-red-700
    errorColorPressed: '#820f21', // --color-red-800
    borderColor: '#e9ecef', // --color-black-100
  },
};

// 深色模式：Naive UI 的 darkTheme ＋ 同一組色階在深色模式下的值（tokens.scss 的 [data-theme='dark']）
const darkOverrides: GlobalThemeOverrides = {
  common: {
    ...commonOverrides,
    primaryColor: '#4d88ff', // --color-blue-500（深色）
    primaryColorHover: '#69f', // --color-blue-600（深色）
    primaryColorPressed: '#9bf', // --color-blue-700（深色）
    primaryColorSuppl: '#4d88ff', // --color-blue-500（深色）
    errorColor: '#f293a3', // --color-red-600（深色）
    errorColorHover: '#f7b7c1', // --color-red-700（深色）
    errorColorPressed: '#f9c9d1', // --color-red-800（深色）
    borderColor: '#212529', // --color-black-100（深色）
  },
};

const theme = computed(() => (isDark.value ? darkTheme : null));
const themeOverrides = computed(() => (isDark.value ? darkOverrides : lightOverrides));
</script>

<template>
  <n-config-provider
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="zhTW"
    :date-locale="dateZhTW"
  >
    <router-view />
  </n-config-provider>
</template>
