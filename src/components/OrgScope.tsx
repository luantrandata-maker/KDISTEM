// Quản trị hệ thống thao tác mọi đơn vị ngay trên màn hình như người dùng (26/10): một danh sách chung gồm dữ liệu của mọi
// đơn vị (kèm tên đơn vị), sửa thẳng từng dòng; thêm mới thì chọn đơn vị ngay trong form. Quyền ghi kiểm tra ở CSDL (099, 100).
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

export type ScopeOrg = { id: string; name: string; type: string; parent_id: string | null; is_platform?: boolean | null }
/** kind: 'school' = chỉ trường; 'unit' = KDI và cơ quan quản lý (Bộ, Tỉnh, Sở, Phòng); 'any' = tất cả */
export type ScopeKind = 'school' | 'unit' | 'any'

const TYPE: Record<string, string> = { ministry: 'Bộ', province: 'Tỉnh', department: 'Sở / Phòng', district: 'Phòng', school: 'Trường', provider: 'Đơn vị' }
export const fitsKind = (o: Pick<ScopeOrg, 'type'>, kind: ScopeKind) => kind === 'any' || (kind === 'school' ? o.type === 'school' : o.type !== 'school')

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

const Ctx = createContext<ScopeOrg[] | null>(null)
/** Bọc màn của Quản trị hệ thống: các màn bên trong hiện dữ liệu mọi đơn vị và cho sửa thẳng */
export function AllOrgs({ children }: { children: ReactNode }) {
  const all = useAllOrgs()
  return all ? <Ctx.Provider value={all}>{children}</Ctx.Provider> : <p className="sub">Đang tải…</p>
}
/** Danh sách mọi đơn vị khi đang ở màn của Quản trị hệ thống; null ở màn của người dùng thường */
export const useAllMode = () => useContext(Ctx)
/** Tên đơn vị theo id (rỗng khi không ở màn của Quản trị hệ thống) */
export function useOrgName() {
  const all = useAllMode()
  return (id?: string | null) => (id && all?.find(o => o.id === id)?.name) || ''
}

/** Tỉnh của một đơn vị: cấp trên gần nhất loại Tỉnh; không có thì Sở / Phòng cao nhất (vd. Sở GD&ĐT không gắn tỉnh) */
export function useProvinceOf() {
  // Ngoài màn "mọi đơn vị" vẫn dùng được (danh sách đơn vị đọc được theo quyền)
  const ctx = useAllMode(), loaded = useAllOrgs()
  const all = ctx ?? loaded
  return useMemo(() => {
    const byId = new Map((all ?? []).map(o => [o.id, o]))
    return (id?: string | null): ScopeOrg | null => {
      let top: ScopeOrg | null = null
      for (let o = id ? byId.get(id) : undefined, k = 0; o && k < 20; o = o.parent_id ? byId.get(o.parent_id) : undefined, k++) {
        if (o.type === 'province') return o
        if (o.type !== 'school' && !o.is_platform) top = o
      }
      return top
    }
  }, [all])
}

// Cây đơn vị: cha → con, kèm độ sâu để thụt lề
function useTree(kind: ScopeKind) {
  const all = useAllMode()
  return useMemo(() => {
    if (!all) return []
    const kids = new Map<string | null, ScopeOrg[]>()
    all.forEach(o => { const p = o.parent_id && all.some(x => x.id === o.parent_id) ? o.parent_id : null; kids.set(p, [...(kids.get(p) ?? []), o]) })
    const out: (ScopeOrg & { depth: number })[] = []
    const walk = (p: string | null, depth: number) => (kids.get(p) ?? [])
      .sort((a, b) => Number(!!b.is_platform) - Number(!!a.is_platform) || (a.type === 'school' ? 1 : 0) - (b.type === 'school' ? 1 : 0) || a.name.localeCompare(b.name, 'vi'))
      .forEach(o => { out.push({ ...o, depth }); walk(o.id, depth + 1) })
    walk(null, 0)
    return out.filter(o => fitsKind(o, kind))
  }, [all, kind])
}
const label = (o: ScopeOrg & { depth: number }) => `${' '.repeat(o.depth * 2)}${o.depth ? '└ ' : ''}${o.name}${o.type !== 'school' && !o.is_platform ? ` (${TYPE[o.type] ?? o.type})` : ''}`

/** Ô chọn đơn vị trong form thêm mới (chỉ hiện ở màn của Quản trị hệ thống) */
export function OrgPick({ kind, value, onChange, title = 'Đơn vị' }: { kind: ScopeKind; value: string; onChange: (id: string) => void; title?: string }) {
  const rows = useTree(kind)
  if (!useAllMode()) return null
  return <label className="field"><span>{title} *</span>
    <select required value={value} onChange={e => onChange(e.target.value)} aria-label={title}>
      <option value="">— Chọn {kind === 'school' ? 'trường' : 'đơn vị'} —</option>
      {rows.map(o => <option key={o.id} value={o.id}>{label(o)}</option>)}
    </select></label>
}

/** Bộ lọc "Mọi đơn vị" trên thanh công cụ (chỉ hiện ở màn của Quản trị hệ thống); ids = đơn vị có trong dữ liệu */
export function OrgFilter({ ids, value, onChange }: { ids: (string | null | undefined)[]; value: string; onChange: (id: string) => void }) {
  const rows = useTree('any')
  if (!useAllMode()) return null
  const has = new Set(ids.filter(Boolean))
  return <select value={value} onChange={e => onChange(e.target.value)} aria-label="Đơn vị">
    <option value="">Mọi đơn vị</option>
    {rows.filter(o => has.has(o.id)).map(o => <option key={o.id} value={o.id}>{label(o)}</option>)}
  </select>
}
