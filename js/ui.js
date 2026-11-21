/* 共用畫面工具：跳脫、toast、對話框容器。之後的階段會加上表單錯誤、儲存中／失敗重試、日期與民國年轉換。 */
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function toast(msg){
  const box = document.getElementById('toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  box.appendChild(el); setTimeout(() => el.remove(), 4500);
}
