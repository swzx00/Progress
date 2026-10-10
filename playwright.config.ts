import { defineConfig, devices } from '@playwright/test';

/**
 * 瀏覽器測試（Playwright）：在真的瀏覽器排版，測 happy-dom 量不到的東西（RWD、深色模式、文字截斷）。
 * 起 npm run dev（MSW 假後端），不打真的 Apps Script；三個專案對應手機／平板／桌面斷點。
 * 第一次在本機跑要先 npx playwright install chromium；
 * 已經有 Chromium 的環境（例如雲端容器）可以用 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定執行檔
 */
const PORT = 5174;
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
