// Thiết lập chung (095, 096): KDI đặt mặc định cho toàn hệ thống, trường tự chỉnh phần của trường.
// Đọc một lần cho cả phiên (org_settings của KDI + đơn vị đang làm việc), làm mới khi có sự kiện 'settings-changed'.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type MenuRole = { labels?: Record<string, string>; groups?: Record<string, string>; order?: Record<string, string[]>; hidden?: string[] }
export type MenuCfg = Record<string, MenuRole>
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'textarea'
export type CustomField = { key: string; label: string; type: FieldType; options?: string[]; required?: boolean; column?: boolean; detail?: boolean }
export type FieldsCfg = { library?: CustomField[]; program?: CustomField[] }
export type CatalogsCfg = Record<string, { items: string[]; labels?: Record<string, string> }>
export type CustomButton = { id: string; label: string; action: 'link' | 'page' | 'csv' | 'notify'; target?: string; primary?: boolean }
export type ButtonsCfg = Record<string, { hidden?: string[]; extra?: CustomButton[] }>
type Raw = { org_id: string; key: string; value: any }
export type Settings = { std: string | null; org: string | null; raw: Raw[] }

let cache: Promise<Settings> | null = null, cacheKey: string | null | undefined
async function load(): Promise<Settings> {
  const [{ data: std }, { data: u }] = await Promise.all([supabase.rpc('platform_org_id'), supabase.auth.getUser()])
  const prof = u.user ? (await supabase.from('profiles').select('org_id').eq('id', u.user.id).maybeSingle()).data as { org_id: string } | null : null
  const ids = [...new Set([std as string | null, prof?.org_id ?? null].filter(Boolean))] as string[]
  const { data } = ids.length ? await supabase.from('org_settings').select('org_id, key, value').in('org_id', ids) : { data: [] }
  return { std: (std as string) ?? null, org: prof?.org_id ?? null, raw: (data as Raw[]) ?? [] }
}
export function reloadSettings() { cache = null; window.dispatchEvent(new Event('settings-changed')) }

/** orgKey: đơn vị đang làm việc (đổi đơn vị thì đọc lại). */
export function useSettings(orgKey?: string | null) {
  const [s, setS] = useState<Settings>({ std: null, org: null, raw: [] })
  useEffect(() => {
    let live = true
    if (orgKey !== undefined && orgKey !== cacheKey) { cache = null; cacheKey = orgKey }
    const go = () => { cache ??= load().catch(() => ({ std: null, org: null, raw: [] })); cache.then(v => { if (live) setS(v) }) }
    go(); window.addEventListener('settings-changed', go)
    return () => { live = false; window.removeEventListener('settings-changed', go) }
  }, [orgKey])
  return s
}

/** Giá trị của KDI và của đơn vị (đơn vị là KDI thì "own" = null). */
export function layers<T>(s: Settings, key: string): { std: T | null; own: T | null } {
  const std = s.raw.find(r => r.org_id === s.std && r.key === key)?.value ?? null
  const own = s.org && s.org !== s.std ? s.raw.find(r => r.org_id === s.org && r.key === key)?.value ?? null : null
  return { std, own }
}

// Nhóm menu đã đổi tên (đổi thứ tự phân hệ 1 ↔ 2): tên đặt lại / thứ tự mục đã lưu theo tên cũ vẫn dùng được
const RENAMED_GROUPS: Record<string, string> = {
  '1. Đào tạo & đánh giá năng lực nhà giáo': '2. Đào tạo & đánh giá năng lực nhà giáo',
  '2. Chương trình & học liệu': '1. Chương trình & học liệu',
}
function renameKeys<T>(m: Record<string, T> | undefined): Record<string, T> {
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(m ?? {})) { const n = RENAMED_GROUPS[k]; if (!n) out[k] = v; else if (!(n in (m ?? {}))) out[n] = v }
  return out
}

/** Menu hiệu lực của một cổng: mục trường đặt đè lên mặc định KDI. */
export function menuOf(s: Settings, role: string): Required<MenuRole> {
  const { std, own } = layers<MenuCfg>(s, 'menu')
  const a = std?.[role] ?? {}, b = own?.[role] ?? {}
  return {
    labels: { ...a.labels, ...b.labels }, groups: { ...renameKeys(a.groups), ...renameKeys(b.groups) }, order: { ...renameKeys(a.order), ...renameKeys(b.order) },
    hidden: [...new Set([...(a.hidden ?? []), ...(b.hidden ?? [])])],
  }
}
/** Sắp mục theo thứ tự đã đặt (mục mới chưa có trong thứ tự giữ vị trí gốc, xếp sau). */
export function orderItems(items: string[], order?: string[]) {
  if (!order?.length) return items
  const pos = new Map(order.map((x, k) => [x, k]))
  return items.map((x, k) => ({ x, k: pos.get(x) ?? order.length + k })).sort((p, q) => p.k - q.k).map(v => v.x)
}

/** Danh mục: của trường nếu có, không thì của KDI, không thì mặc định trong mã. */
export function catalogOf(s: Settings, key: string, fallback: string[]): string[] {
  const { std, own } = layers<CatalogsCfg>(s, 'catalogs')
  return own?.[key]?.items?.length ? own[key].items : std?.[key]?.items?.length ? std[key].items : fallback
}
/** Danh mục có mã cố định (vd loại học liệu): đổi tên hiển thị và thứ tự. */
export function codedCatalog(s: Settings, key: string, base: Record<string, string>): [string, string][] {
  const { std, own } = layers<CatalogsCfg>(s, 'catalogs')
  const labels = { ...std?.[key]?.labels, ...own?.[key]?.labels }
  const order = own?.[key]?.items?.length ? own[key].items : std?.[key]?.items
  return orderItems(Object.keys(base), order).map(k => [k, labels[k] || base[k]])
}

/** Trường tùy chỉnh: của KDI rồi của trường. */
export function fieldsOf(s: Settings, entity: 'library' | 'program'): CustomField[] {
  const { std, own } = layers<FieldsCfg>(s, 'fields')
  return [...(std?.[entity] ?? []), ...(own?.[entity] ?? []).map(f => ({ ...f, own: true }))]
}

/** Nút của một trang: nút có sẵn bị ẩn, nút thêm mới. */
export function buttonsOf(s: Settings, page: string) {
  const { std, own } = layers<ButtonsCfg>(s, 'buttons')
  return { hidden: new Set([...(std?.[page]?.hidden ?? []), ...(own?.[page]?.hidden ?? [])]), extra: [...(std?.[page]?.extra ?? []), ...(own?.[page]?.extra ?? [])] }
}

export const slug = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'truong'

/** Quy tắc vận hành (số): trường → KDI → mặc định. */
export function ruleOf(s: Settings, key: string, def: number): number {
  const { std, own } = layers<Record<string, number>>(s, 'rules')
  const v = own?.[key] ?? std?.[key]
  return typeof v === 'number' ? v : def
}
