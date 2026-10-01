/** @type {import('stylelint').Config} */
export default {
  extends: [
    'stylelint-config-standard-scss',
    'stylelint-config-recommended-vue/scss',
    'stylelint-config-recess-order',
  ],
  ignoreFiles: ['dist/**', 'node_modules/**'],
  rules: {
    // 專案 class 命名採 BEM（block__element--modifier），standard 預設只允許純 kebab-case
    'selector-class-pattern': [
      '^[a-z][a-z0-9]*(-[a-z0-9]+)*(__[a-z0-9]+(-[a-z0-9]+)*)?(--[a-z0-9]+(-[a-z0-9]+)*)?$',
      { message: 'class 名稱請用 BEM：block__element--modifier（各段 kebab-case）' },
    ],
    // 維持 @media (min-width: 768px) 寫法，跟 CLAUDE.md「RWD 斷點」的 mobile-first 慣例一致
    'media-feature-range-notation': 'prefix',
  },
};
