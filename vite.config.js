import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/* 8 個 HTML 頁面（HANDOFF 第 6 節）。reference/ 只是對照資料，不打包。 */
const PAGES = ['login', 'dashboard', 'application', 'cases', 'documents', 'assessment', 'care-summary', 'settings'];

export default defineConfig({
  build: {
    rollupOptions: {
      /* index.html 只負責轉到 login.html */
      input: Object.fromEntries(['index', ...PAGES].map(p => [p, resolve(import.meta.dirname, `${p}.html`)]))
    }
  },
  server: { open: '/login.html' }
});
