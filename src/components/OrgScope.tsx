// Quản trị hệ thống thao tác thay một đơn vị ngay trong trang (phương án B, 26/10): chọn trường / Sở / Phòng rồi dùng
// đúng màn của đơn vị đó. Nhớ lựa chọn theo từng trang (localStorage). Quyền ghi kiểm tra ở CSDL (is_platform_admin).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

export type ScopeOrg = { id: string; name: string; type: string; parent_id: string | null; is_platform?: boolean | null }
/** kind: 'school' = chỉ trường; 'unit' = KDI và cơ quan quản lý (Bộ, Tỉnh, Sở, Phòng); 'any' = tất cả */
export type ScopeKind = 'school' | 'unit' | 'any'
export type Scope = { orgId: string; org: ScopeOrg; scope: string[] }

const TYPE: Record<string, string> = { ministry: 'Bộ', province: 'Tỉnh', department: 'Sở / Phòng', district: 'Phòng', school: 'Trường', provider: 'Đơn vị' }
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

let cache: Promise<ScopeOrg[]> | null = null
export function useAllOrgs() {
  const [list, setList] = useState<ScopeOrg[] | null>(null)
  useEffect(() => {
    cache ??= Promise.resolve(supabase.from('organizations').select('id, name, type, parent_id, is_platform').order('name'))
      .then(({ data }) => (data as ScopeOrg[]) ?? [])
    cache.then(setList)
  }, [])
  return list
}

/** Thanh chọn đơn vị + nội dung trang của đơn vị đó */
export function OrgScope({ kind, storeKey, children, hint }: { kind: ScopeKind; storeKey: string; children: (s: Scope) => ReactNode; hint?: string }) {
  const all = useAllOrgs()
  const key = 'orgscope:' + storeKey
  const [id, setId] = useState<string>(() => { try { return localStorage.getItem(key) ?? '' } catch { return '' } })
  const [q, setQ] = useState('')
  // Cây đơn vị: thứ tự cha → con, kèm độ sâu để thụt lề
  const rows = useMemo(() => {
    if (!all) return []
    const kids = new Map<string | null, ScopeOrg[]>()
    all.forEach(o => { const p = o.parent_id && all.some(x => x.id === o.parent_id) ? o.parent_id : null; kids.set(p, [...(kids.get(p) ?? []), o]) })
    const out: (ScopeOrg & { depth: number; path: string })[] = []
    const walk = (p: string | null, depth: number, path: string) => (kids.get(p) ?? [])
      .sort((a, b) => Number(!!b.is_platform) - Number(!!a.is_platform) || (a.type === 'school' ? 1 : 0) - (b.type === 'school' ? 1 : 0) || a.name.localeCompare(b.name, 'vi'))
      .forEach(o => { out.push({ ...o, depth, path }); walk(o.id, depth + 1, path ? `${path} › ${o.name}` : o.name) })
    walk(null, 0, '')
    return out
  }, [all])
  const fits = (o: ScopeOrg) => kind === 'any' || (kind === 'school' ? o.type === 'school' : o.type !== 'school')
  const shown = rows.filter(o => fits(o) && (!q || fold(`${o.name} ${o.path}`).includes(fold(q.trim()))))
  const cur = rows.find(o => o.id === id && fits(o)) ?? (kind !== 'school' ? rows.find(o => o.is_platform) : undefined)
  useEffect(() => { if (cur && cur.id !== id) setId(cur.id) }, [cur?.id])
  const pick = (v: string) => { setId(v); setQ(''); try { localStorage.setItem(key, v) } catch { /* bỏ qua */ } }
  const scope = useMemo(() => {
    if (!cur || !all) return []
    const s = [cur.id]; let p = cur.parent_id
    while (p && !s.includes(p)) { s.push(p); p = all.find(o => o.id === p)?.parent_id ?? null }
    return s
  }, [cur?.id, all])
  if (!all) return <p className="sub">Đang tải danh sách đơn vị…</p>
  return <>
    <div className="panel orgscope">
      <div className="orgscopebar">
        <b>Thao tác cho</b>
        <input placeholder={kind === 'school' ? 'Tìm trường…' : 'Tìm đơn vị…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm đơn vị" />
        <select value={cur?.id ?? ''} onChange={e => pick(e.target.value)} aria-label="Đơn vị thao tác">
          {!cur && <option value="">— Chọn {kind === 'school' ? 'trường' : 'đơn vị'} —</option>}
          {cur && !shown.some(o => o.id === cur.id) && <option value={cur.id}>{cur.name}</option>}
          {shown.slice(0, 400).map(o => <option key={o.id} value={o.id}>{' '.repeat(o.depth * 2)}{o.depth ? '└ ' : ''}{o.name}{o.type !== 'school' && !o.is_platform ? ` (${TYPE[o.type] ?? o.type})` : ''}</option>)}
        </select>
        {q && <small className="sub">{shown.length} kết quả</small>}
      </div>
      <small className="sub">{cur ? <>Bạn đang thao tác với quyền Quản trị hệ thống trên dữ liệu của <b>{cur.name}</b>{rows.find(o => o.id === cur.id)?.path ? ` (${rows.find(o => o.id === cur.id)!.path})` : ''}.</>
        : hint ?? 'Chọn đơn vị để xem và thao tác như người quản lý của đơn vị đó.'}</small>
    </div>
    {cur && <div key={cur.id}>{children({ orgId: cur.id, org: cur, scope })}</div>}
  </>
}
