/* 建立 Supabase client。前端只用 URL 與 anon key，資料保護靠 RLS。 */
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';

let client = null;

export function supabase(){
  if (client) return client;
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey){
    throw new Error('尚未設定 Supabase 連線（請在 .env 填入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY）。');
  }
  client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return client;
}
