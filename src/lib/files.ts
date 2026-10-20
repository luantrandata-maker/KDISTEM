// Kho tệp học liệu / minh chứng (Supabase Storage, bucket riêng tư "learning-files", migration 058).
// Đường dẫn: <id đơn vị>/<thư mục>/<mã ngẫu nhiên>-<tên tệp>. Mở tệp bằng liên kết có hạn (1 giờ).
import { supabase } from './supabase'

export const FILE_BUCKET = 'learning-files'
export const MAX_FILE_MB = 50

const safeName = (n: string) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(-80)

export async function uploadLearningFile(orgId: string, folder: string, file: File): Promise<{ path: string; name: string; size: number; mime: string }> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Tệp lớn hơn ${MAX_FILE_MB} MB.`)
  const path = `${orgId}/${folder}/${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`
  const { error } = await supabase.storage.from(FILE_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Kho tệp chưa sẵn sàng — hãy chạy migration 058 trên Supabase.' : error.message)
  return { path, name: file.name, size: file.size, mime: file.type }
}

export async function fileUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(FILE_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

// Mở tệp ở tab mới (mở tab trước để trình duyệt không chặn cửa sổ bật lên)
export async function openFile(path: string) {
  const w = window.open('', '_blank')
  const url = await fileUrl(path)
  if (url && w) w.location.href = url
  else { w?.close(); alert('Không mở được tệp (không có quyền hoặc tệp đã bị xoá).') }
}

export const fmtSize = (n: number | null | undefined) => (n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)
