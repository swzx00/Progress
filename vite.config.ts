/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * 本機開發、且關掉 MSW（VITE_ENABLE_MSW=false）時，讓瀏覽器打 /apps-script-proxy，
 * 由這個 middleware 在 Node 端把整個請求（含 Apps Script 的 302 轉址）都做完，
 * 只把最終結果回給瀏覽器。
 *
 * 不能用 Vite 內建的 server.proxy（底層 http-proxy）：它不會自動跟著 redirect 走，
 * 只是把 Apps Script 回的 302 轉發給瀏覽器，瀏覽器自己再去跟那個轉址目標
 * （script.googleusercontent.com）要資料時又是一次跨網域請求，等於繞了一圈
 * 還是會撞到同一個 CORS 問題（見 CLAUDE.md）。改用這個手寫 middleware，
 * 靠 Node 18+ 內建 fetch 預設就會自動跟著 redirect 走，瀏覽器全程只跟自己的
 * origin 講話，完全不會有跨網域請求。
 */
function appsScriptDevProxyPlugin(appsScriptUrl: string): Plugin {
  return {
    name: 'apps-script-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/apps-script-proxy', (req, res) => {
        void (async () => {
          try {
            const targetUrl = new URL(appsScriptUrl);
            const incomingUrl = new URL(req.url ?? '', 'http://localhost');
            targetUrl.search = incomingUrl.search;

            let body: string | undefined;
            if (req.method === 'POST') {
              const chunks: Buffer[] = [];
              for await (const chunk of req) chunks.push(chunk as Buffer);
              body = Buffer.concat(chunks).toString('utf-8');
            }

            const upstreamRes = await fetch(targetUrl, {
              method: req.method,
              headers: req.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
              body,
            });
            const text = await upstreamRes.text();
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(text);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: String(err) }));
          }
        })();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appsScriptUrl = env.VITE_APPS_SCRIPT_URL ?? '';
  const isRealAppsScriptUrl = /^https:\/\/script\.google\.com\//.test(appsScriptUrl);

  return {
    plugins: [vue(), isRealAppsScriptUrl ? appsScriptDevProxyPlugin(appsScriptUrl) : null],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    test: {
      // 測試檔一律放在 tests/（單元、元件測試在 tests/unit/，結構照 src/），不跟正式程式碼混在一起
      include: ['tests/**/*.spec.ts'],
      // 日期相關的測試要固定在台灣時區，換機器（CI 是 UTC）結果才一致
      globalSetup: ['./vitest.global-setup.ts'],
      // 第一次載入元件（例如 DateNav 的 beforeEach）在 Windows 上可能超過預設的 10 秒
      hookTimeout: 30_000,
      // npm run test:coverage：看哪些程式沒被測到（不設門檻，只當參考）
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        exclude: ['src/testing/**', 'src/main.ts', 'src/mocks/browser.ts'],
        reporter: ['text-summary', 'html'],
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // 第三方套件拆成獨立檔案：單一檔案不超過 500 kB 警告門檻，
          // 而且套件沒升級時檔名（hash）不變，改專案程式碼後瀏覽器仍可沿用快取
          codeSplitting: {
            groups: [
              // Naive UI 連同它依賴的日期、工具函式庫會超過 500 kB，所以相依套件另外拆一包。
              // 預設會把群組的相依一起收進去，所以用 priority 讓 Vue、相依套件先被各自的群組認領
              { name: 'vendor-naive-ui', test: /node_modules\/naive-ui\//, priority: 1 },
              {
                name: 'vendor-naive-ui-deps',
                test: /node_modules\/(vueuc|vooks|css-render|@css-render|seemly|evtd|treemate|vdirs|date-fns|date-fns-tz|lodash-es|async-validator|@juggle)\//,
                priority: 2,
              },
              { name: 'vendor-vue', test: /node_modules\/(@vue|vue|vue-router)\//, priority: 3 },
              { name: 'vendor-sortable', test: /node_modules\/(sortablejs|vue-draggable-plus)\// },
              // 匯出 Excel 才用到，ExportModal 用動態 import() 載入，平常不會下載這包
              { name: 'vendor-exceljs', test: /node_modules\/exceljs\// },
            ],
          },
        },
      },
    },
  };
});
