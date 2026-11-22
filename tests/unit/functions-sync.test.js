/* Edge Function 用的共用程式副本（supabase/functions/_shared）必須與原始檔一致。
 * 改了 js/modules/rules/core.js 或 model-build.js 後，請執行 npm run functions:sync，否則這個測試會失敗，
 * 伺服器端算出的案件階段也會和畫面不一致。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SHARED, HEAD } from '../../scripts/sync-functions.mjs';

describe('Edge Function 共用程式與原始檔一致', () => {
  for (const [src, dst] of SHARED){
    it(dst, () => {
      const want = HEAD + readFileSync(src, 'utf8').replace(/from '\.\.\/rules\/core\.js'/g, "from './core.js'");
      expect(readFileSync(dst, 'utf8')).toBe(want);
    });
  }
});
