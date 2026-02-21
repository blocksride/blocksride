/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL: string
  readonly VITE_WS_URL: string
  readonly VITE_PRIVY_APP_ID: string
  readonly VITE_ETH_LOGO_URL: string
  readonly VITE_BTC_LOGO_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
