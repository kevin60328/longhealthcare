/* 環境設定：由 .env（Vite 的 import.meta.env）帶入。這裡只能有公開值，不放任何秘密。 */
const env = import.meta.env;

export const CONFIG = Object.freeze({
  supabaseUrl: env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',
  appEnv: env.VITE_APP_ENV === 'production' ? 'production' : 'test',
  /* 頁尾環境說明文字：HANDOFF 第 15 節第 1 項，待使用者確認 */
  envNote: env.VITE_ENV_NOTE || '',
  /* org_settings 讀到之前的顯示名稱 */
  orgNameFallback: '康和長照中心'
});

export const isTestEnv = () => CONFIG.appEnv === 'test';
