/* 文件檔案：上傳到 Supabase Storage 私有 bucket「case-files」、開啟時取得短時效網址（HANDOFF 3.2、8.2）。
 *
 * 檔案位置：<案件 id>/<文件 key>/v<版本>-<隨機 id>.<副檔名>
 *   版本號寫在檔名裡：資料庫的上傳 RPC 會確認位置與它要建立的版本相符，有人同時上傳時後到的人會被擋下，不會掛錯版本。
 * 權限由資料庫決定（storage policy 與資料表用同一套判斷，見 migrations/…000023）：
 *   上傳：家屬只能上傳自己案件、目前可以處理的文件；行政只能上傳機構提供的文件。
 *   讀取：一律先呼叫 open_document_file（行政打開醫療類文件時會寫一次操作紀錄），再取得 10 分鐘有效的網址。
 * 檔案只新增、不覆蓋（每次上傳都是新版本）。 */
import { supabase } from '../../api/supabase.js';

const BUCKET = 'case-files';
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
export const MAX_SIZE = 20 * 1024 * 1024;
/* AI 辨識可以讀的格式（Claude 支援的圖片與 PDF） */
export const OCR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];

/* 檢查使用者選的檔案；回傳錯誤訊息（空字串＝可以上傳） */
export function fileProblem(file){
  if (!file) return '請先選擇照片或 PDF';
  if (!/^image\/|^application\/pdf$/.test(file.type)) return '只能上傳照片或 PDF';
  if (!EXT[file.type]) return '這種照片格式無法上傳，請改用 JPG 或 PNG';
  if (file.size > MAX_SIZE) return '檔案超過 20 MB，請改用拍照上傳';
  return '';
}

/* 太大的照片（超過 4 MB）先縮小再上傳：手機原圖常超過 AI 辨識的單張上限（5 MB），也比較省流量。
 * 只縮小、不裁切；長邊最多 2400 像素、JPEG 品質 0.85，文字仍清楚。PDF 與小照片原樣上傳。 */
async function shrink(file){
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 4 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }   // 瀏覽器不支援縮圖時原樣上傳
}

/* 上傳一個檔案（還沒有建立版本）；回傳 { path, name }。失敗時丟出錯誤（訊息給使用者看） */
export async function uploadFile(caseId, docKey, nextV, file){
  const f = await shrink(file);
  const path = `${caseId}/${docKey}/v${nextV}-${crypto.randomUUID()}.${EXT[f.type]}`;
  const { error } = await supabase().storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
  if (error) throw new Error(/row-level security|not authorized|Unauthorized/i.test(error.message) ? '沒有權限上傳這份文件（資料授權無效、案件已結案或文件不需要上傳）' : '檔案上傳失敗：' + error.message);
  return { path, name: file.name };
}

/* 開啟某份文件某個版本的檔案：回傳 { url, mime, name, removed }；沒有檔案時 url 為空 */
export async function openFile(docDbId, v){
  const { data, error } = await supabase().rpc('open_document_file', { p_doc: docDbId, p_v: v });
  if (error) throw error;
  if (!data || !data.path) return { url: '', removed: !!(data && data.removed) };
  const s = await supabase().storage.from(BUCKET).createSignedUrl(data.path, 600);
  if (s.error) throw s.error;
  return { url: s.data.signedUrl, mime: data.mime || '', name: data.name || '', removed: false };
}
