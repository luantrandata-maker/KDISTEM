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
