/* Vitest 設定：單元測試（tests/unit）與 RLS 測試（tests/rls）共用。
 * RLS 測試會連本機 Supabase 並改動測試資料，所以不平行執行測試檔，避免互相干擾。 */
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { testTimeout: 20000, hookTimeout: 30000, fileParallelism: false } });
