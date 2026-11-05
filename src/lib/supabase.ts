import { createClient } from '@supabase/supabase-js'
import { offlineFetch, clearOfflineData, flushQueue, pruneCache, refreshCounts } from './offline'

// fetch có lớp ngoại tuyến (lib/offline.ts): đọc lại bản đã lưu khi mất mạng, xếp hàng điểm danh để gửi sau
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? '',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  { global: { fetch: offlineFetch((input, init) => fetch(input, init)) } },
)

// Đăng xuất: xoá dữ liệu ngoại tuyến của máy này (máy dùng chung)
supabase.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') clearOfflineData() })

export async function flushOffline() {
  const { data } = await supabase.auth.getSession()
  await flushQueue((name, args) => supabase.rpc(name, args as Record<string, unknown>) as unknown as Promise<{ error: { message: string } | null }>, data.session?.user.id ?? null)
}
if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  window.addEventListener('online', () => { flushOffline() })
  setTimeout(() => { pruneCache(); refreshCounts().catch(() => {}); flushOffline() }, 3000)
}

// Supabase trả tối đa 1000 dòng mỗi lần (Max rows của API). Bảng/hàm có thể vượt mức đó (đơn vị, trường, thống kê theo trường)
// thì tải theo từng trang. make() phải tạo truy vấn mới mỗi lần gọi; nên có order ổn định để không sót/trùng dòng giữa các trang.
type Page<T> = { data: T[] | null; error: { message: string } | null }
export async function fetchAll<T = any>(make: () => { range: (from: number, to: number) => PromiseLike<Page<T>> }, size = 1000): Promise<Page<T>> {
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const r = await make().range(from, from + size - 1)
    if (r.error) return { data: out.length ? out : null, error: r.error }
    out.push(...(r.data ?? []))
    if ((r.data ?? []).length < size) return { data: out, error: null }
  }
}
