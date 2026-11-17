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

// ===== Ảnh slide (bucket công khai "slide-images", migration 146) =====
// Ảnh được thu nhỏ còn cạnh dài tối đa 1600px trước khi tải lên để slide mở nhanh.
export const SLIDE_IMAGE_BUCKET = 'slide-images'
const MAX_SLIDE_IMG_MB = 10

async function shrinkImage(file: File, max = 1600): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file
  try {
    const bmp = await createImageBitmap(file)
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
    if (k === 1 && file.size < 1.5 * 1024 * 1024) { bmp.close?.(); return file }
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.()
    const out = await new Promise<Blob | null>(r => c.toBlob(r, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85))
    return out && out.size < file.size ? out : file
  } catch { return file }
}

/** Tải một ảnh lên kho ảnh slide, trả về đường dẫn công khai để gắn vào slide */
export async function uploadSlideImage(orgId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Chỉ nhận tệp ảnh (PNG, JPG, WEBP, GIF, SVG).')
  const blob = await shrinkImage(file)
  if (blob.size > MAX_SLIDE_IMG_MB * 1024 * 1024) throw new Error(`Ảnh lớn hơn ${MAX_SLIDE_IMG_MB} MB.`)
  const type = blob.type || file.type
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' } as Record<string, string>)[type] ?? 'img'
  const path = `${orgId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(SLIDE_IMAGE_BUCKET).upload(path, blob, { contentType: type, upsert: false })
  if (error) throw new Error(/bucket|not found/i.test(error.message) ? 'Kho ảnh slide chưa sẵn sàng — cần chạy migration 146 trên Supabase.' : error.message)
  return supabase.storage.from(SLIDE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
}
