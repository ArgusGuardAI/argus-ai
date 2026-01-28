/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_HELIUS_API_KEY?: string;
  readonly VITE_VAULT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
