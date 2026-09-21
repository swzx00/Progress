/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPS_SCRIPT_URL: string
  readonly VITE_GOOGLE_CLIENT_ID: string
  /** 選填，設成 'false' 可以在 dev 模式下關掉 MSW，改打真的 Apps Script 網址 */
  readonly VITE_ENABLE_MSW?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
