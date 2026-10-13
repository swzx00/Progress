import { defineConfig, devices } from '@playwright/test';

/**
 * 瀏覽器測試（Playwright）：在真的瀏覽器排版，測 happy-dom 量不到的東西（RWD、深色模式、文字截斷）。
 * 起 npm run dev（MSW 假後端），不打真的 Apps Script；三個專案對應手機／平板／桌面斷點。
 * 第一次在本機跑要先 npx playwright install chromium；
 * 已經有 Chromium 的環境（例如雲端容器）可以用 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定執行檔。
 * iphone／desktop-safari 兩個專案用 WebKit（Safari 的核心）跑同一套測試，npm run test:e2e 不跑，
 * 要另外 npm run test:e2e:safari（第一次先 npx playwright install webkit）
 * WebKit 攔不到 MSW Service Worker 轉發的請求，fixtures.ts 的假資源不會生效，依賴假資料的檢查在 WebKit 跳過
 */
// 跟開發用的 5310 分開（使用者決定），開著 npm run dev 也能跑；用假的登入，不需要在 Google Cloud 登記
const PORT = 5320;
const DESKTOP_ONLY = ['**/flows.e2e.ts', '**/a11y.e2e.ts'];
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    // 手機 < 768、平板 768–1023、桌面 ≥ 1024（CLAUDE.md「RWD 斷點」）；
    // 操作流程、無障礙跟版面寬度無關，只在桌面跑
    {
      name: 'mobile',
      testIgnore: DESKTOP_ONLY,
      use: { ...devices['Pixel 7'], launchOptions: { executablePath } },
    },
    {
      name: 'tablet',
      testIgnore: DESKTOP_ONLY,
      use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    // Safari：手機用 iPhone（只跑版面，同 mobile），桌面跑全部（含操作流程、無障礙）
    {
      name: 'iphone',
      testIgnore: DESKTOP_ONLY,
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'desktop-safari',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // 不吃本機 .env：固定打 MSW 假後端
    env: {
      VITE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/e2e/exec',
      VITE_GOOGLE_CLIENT_ID: 'e2e-client-id',
      VITE_ENABLE_MSW: 'true',
    },
  },
});
