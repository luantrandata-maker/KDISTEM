// Chế độ ngoại tuyến: lớp fetch đặt dưới Supabase client.
// - Đọc dữ liệu (GET REST và các RPC chỉ đọc): có mạng → lưu bản sao vào IndexedDB của trình duyệt (theo từng tài khoản);
//   mất mạng → trả lại bản đã lưu lần gần nhất. Nhờ vậy màn đã mở trước đó (lịch dạy, danh sách lớp…) vẫn xem được.
// - Ghi điểm danh (RPC mark_teaching_session) khi mất mạng → xếp hàng trên máy, tự gửi khi có mạng lại.
// - Các lệnh ghi khác khi mất mạng: báo lỗi như bình thường (không giả vờ thành công).
// - Đăng xuất → xoá toàn bộ dữ liệu ngoại tuyến trên máy.

const DB = 'kschool-offline', VER = 1
const MAX_BODY = 2_000_000, MAX_AGE = 14 * 864e5
const READ_RPC = /^(my_[a-z_]+|mfa_required|parent_children|parent_child|login_branding|branding_of|ai_status|stem_index_config|teacher_competency_profile)$/
const QUEUE_RPC = new Set(['mark_teaching_session'])
// RPC chỉ có tác dụng phụ "chuẩn bị dữ liệu" (sinh buổi dạy tuần): mất mạng thì bỏ qua, không báo lỗi
const SKIP_RPC = new Set(['generate_teaching_sessions'])

type Cached = { key: string; uid: string; status: number; type: string | null; range: string | null; body: string; at: number }
export type Queued = { id?: number; uid: string; name: string; args: unknown; label: string; at: number; error?: string | null }

let dbp: Promise<IDBDatabase> | null = null
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('cache')) d.createObjectStore('cache', { keyPath: 'key' }).createIndex('uid', 'uid')
      if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { keyPath: 'id', autoIncrement: true })
    }
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  return dbp
}
async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  return new Promise((res, rej) => { const q = fn(d.transaction(store, mode).objectStore(store)); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) })
}

// ---------- Trạng thái cho giao diện ----------
type State = { online: boolean; fromCache: boolean; queued: number; failed: number; lastSync: number | null }
let state: State = { online: typeof navigator === 'undefined' ? true : navigator.onLine, fromCache: false, queued: 0, failed: 0, lastSync: null }
const subs = new Set<(s: State) => void>()
function emit(p: Partial<State>) { state = { ...state, ...p }; subs.forEach(f => f(state)) }
export const offlineState = () => state
export function subscribeOffline(f: (s: State) => void) { subs.add(f); return () => { subs.delete(f) } }

function uidOf(headers: Headers) {
  const a = headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  try { const p = JSON.parse(atob(a!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.role === 'authenticated' ? String(p.sub) : null } catch { return null }
}
const isNetErr = (e: unknown) => e instanceof TypeError || (e as Error)?.name === 'TypeError'

export function offlineFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const req = new Request(input as RequestInfo, init)
    const url = new URL(req.url)
    const rest = url.pathname.includes('/rest/v1/')
    const rpc = rest && url.pathname.includes('/rest/v1/rpc/') ? url.pathname.split('/rest/v1/rpc/')[1] : null
    const uid = rest ? uidOf(req.headers) : null
    const readable = !!uid && (req.method === 'GET' || (req.method === 'POST' && rpc !== null && READ_RPC.test(rpc))) && !req.headers.get('Prefer')?.includes('count=exact')
    const body = req.method === 'POST' ? await req.clone().text() : ''
    const key = `${uid}|${req.method}|${url.pathname}${url.search}|${body}`
    try {
      if (!navigator.onLine && (readable || (rpc && (QUEUE_RPC.has(rpc) || SKIP_RPC.has(rpc))))) throw new TypeError('offline')
      const res = await base(req)
      if (!state.online || state.fromCache) emit({ online: true, fromCache: false })
      if (readable && res.ok) {
        res.clone().text().then(text => {
          if (text.length <= MAX_BODY) tx('cache', 'readwrite', s => s.put({ key, uid, status: res.status, type: res.headers.get('content-type'), range: res.headers.get('content-range'), body: text, at: Date.now() } as Cached)).catch(() => {})
        })
      }
      return res
    } catch (e) {
      if (!isNetErr(e)) throw e
      emit({ online: false })
      if (rpc && SKIP_RPC.has(rpc)) return new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })
      if (rpc && QUEUE_RPC.has(rpc) && uid) {
        let args: unknown = null; try { args = JSON.parse(body) } catch { /* giữ null */ }
        await tx('queue', 'readwrite', s => s.add({ uid, name: rpc, args, label: labelOf(rpc, args), at: Date.now() } as Queued))
        await refreshCounts()
        window.dispatchEvent(new CustomEvent('offline-queued', { detail: rpc }))
        return new Response('null', { status: 200, headers: { 'content-type': 'application/json', 'x-offline-queued': '1' } })
      }
      if (readable) {
        const hit = await tx<Cached | undefined>('cache', 'readonly', s => s.get(key)).catch(() => undefined)
        if (hit) {
          emit({ fromCache: true })
          const h: Record<string, string> = { 'x-offline-cache': String(hit.at) }
          if (hit.type) h['content-type'] = hit.type
          if (hit.range) h['content-range'] = hit.range
          return new Response(hit.body, { status: hit.status, headers: h })
        }
      }
      throw e
    }
  }
}

const labelOf = (name: string, args: any) => name === 'mark_teaching_session'
  ? `Điểm danh ${Array.isArray(args?.p_marks) ? args.p_marks.length + ' học sinh' : ''}`.trim() : name

// ---------- Hàng đợi ----------
export const listQueue = () => tx<Queued[]>('queue', 'readonly', s => s.getAll()).catch(() => [] as Queued[])
export const dropQueued = async (id: number) => { await tx('queue', 'readwrite', s => s.delete(id)); await refreshCounts() }
export async function refreshCounts() {
  const q = await listQueue()
  emit({ queued: q.filter(x => !x.error).length, failed: q.filter(x => x.error).length })
}

let flushing = false
// Gửi lại các thao tác đã xếp hàng bằng phiên đăng nhập hiện tại. send: hàm gọi RPC (truyền supabase.rpc để tránh vòng import).
export async function flushQueue(send: (name: string, args: unknown) => Promise<{ error: { message: string } | null }>, uid: string | null) {
  if (flushing || !navigator.onLine || !uid) return
  flushing = true
  try {
    for (const it of await listQueue()) {
      if (it.uid !== uid || it.error) continue
      let r: { error: { message: string } | null }
      try { r = await send(it.name, it.args) } catch { break }   // mất mạng giữa chừng: thử lại lần sau
      if (r.error && /Failed to fetch|NetworkError|network/i.test(r.error.message)) break
      if (r.error) await tx('queue', 'readwrite', s => s.put({ ...it, error: r.error!.message }))
      else await tx('queue', 'readwrite', s => s.delete(it.id!))
    }
    emit({ lastSync: Date.now() })
  } finally { flushing = false; await refreshCounts() }
}

export async function cacheStats(uid: string | null) {
  const all = await tx<Cached[]>('cache', 'readonly', s => s.getAll()).catch(() => [] as Cached[])
  const mine = all.filter(c => c.uid === uid)
  return { entries: mine.length, bytes: mine.reduce((n, c) => n + c.body.length, 0), oldest: mine.reduce((m, c) => Math.min(m, c.at), Infinity) }
}
// Bỏ bản lưu quá cũ (14 ngày) — gọi khi mở ứng dụng
export async function pruneCache() {
  const all = await tx<Cached[]>('cache', 'readonly', s => s.getAll()).catch(() => [] as Cached[])
  const old = all.filter(c => Date.now() - c.at > MAX_AGE)
  for (const c of old) await tx('cache', 'readwrite', s => s.delete(c.key)).catch(() => {})
}
export async function clearOfflineData() {
  await tx('cache', 'readwrite', s => s.clear()).catch(() => {})
  await tx('queue', 'readwrite', s => s.clear()).catch(() => {})
  await refreshCounts().catch(() => {})
}

// ---------- Cài ứng dụng (PWA) ----------
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let installEvt: BIP | null = null
const installSubs = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e as BIP; installSubs.forEach(f => f()) })
  window.addEventListener('appinstalled', () => { installEvt = null; installSubs.forEach(f => f()) })
  window.addEventListener('online', () => emit({ online: true }))
  window.addEventListener('offline', () => emit({ online: false }))
}
export const canInstall = () => !!installEvt
export const onInstallChange = (f: () => void) => { installSubs.add(f); return () => { installSubs.delete(f) } }
export async function promptInstall() { if (!installEvt) return false; await installEvt.prompt(); const c = await installEvt.userChoice; installEvt = null; installSubs.forEach(f => f()); return c.outcome === 'accepted' }
export const isStandalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true)
