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
  };
});
