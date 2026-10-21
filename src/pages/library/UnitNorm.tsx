import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Vật tư của bài học: nhập thẳng trong form Bài học (Phát hành học liệu). Lưu thành một định mức vật tư
// (material_norms, 059) gắn với bài học qua library_item_id; định mức đã ban hành thì lưu sẽ tạo phiên bản mới.
type MKind = 'supply' | 'tool' | 'equipment'
type Basis = 'product' | 'group' | 'student'
const MKIND: Record<MKind, string> = { supply: 'Vật tư tiêu hao', tool: 'Công cụ', equipment: 'Thiết bị' }
const BASIS: Record<Basis, string> = { group: '1 nhóm', student: '1 học sinh', product: '1 sản phẩm' }
type Cat = { id: string; name: string; unit: string; kind: MKind; reusable: boolean; code: string | null }
export type NormRow = { key: string; catalog_id: string | null; name: string; unit: string; kind: MKind; qty: string; reusable: boolean }
export type UnitNorm = { id: string | null; status: string | null; basis: Basis; group_size: number; rows: NormRow[]; dirty: boolean }

export const EMPTY_NORM: UnitNorm = { id: null, status: null, basis: 'group', group_size: 4, rows: [], dirty: false }
const key = () => Math.random().toString(36).slice(2, 10)

/** Định mức của bài học (ưu tiên bản nháp, rồi bản đang ban hành) */
export async function loadUnitNorm(itemId: string, orgId: string): Promise<UnitNorm> {
  const { data } = await supabase.from('material_norms').select('id, status, basis, group_size, version_no, material_norm_items(catalog_id, name, unit, kind, qty, reusable, seq)')
    .eq('library_item_id', itemId).eq('org_id', orgId).in('status', ['draft', 'published']).order('version_no', { ascending: false })
  type R = { id: string; status: string; basis: Basis; group_size: number; material_norm_items: (Omit<NormRow, 'key' | 'qty'> & { qty: number; seq: number })[] }
  const list = (data ?? []) as R[]
  const n = list.find(x => x.status === 'draft') ?? list[0]
  if (!n) return EMPTY_NORM
  return {
    id: n.id, status: n.status, basis: n.basis, group_size: n.group_size, dirty: false,
    rows: [...n.material_norm_items].sort((a, b) => a.seq - b.seq).map(i => ({ key: key(), catalog_id: i.catalog_id, name: i.name, unit: i.unit, kind: i.kind, qty: String(i.qty), reusable: i.reusable })),
  }
}

/** Lưu vật tư của bài học; trả về mã định mức đang dùng (null nếu bài không có vật tư) */
export async function saveUnitNorm(d: UnitNorm, ctx: { itemId: string; orgId: string; title: string; subject: string | null; grade: number | null; publish: boolean }): Promise<{ id: string | null; error?: string }> {
  const rows = d.rows.filter(r => r.name.trim() && Number(r.qty.replace(',', '.')) > 0)
  let id = d.id
  if (d.dirty) {
    if (!rows.length) {
      // Bỏ hết vật tư: xoá bản nháp; bản đã ban hành giữ nguyên nhưng không gắn vào bài nữa
      if (id && d.status === 'draft') await supabase.from('material_norms').delete().eq('id', id)
      return { id: null }
    }
    if (id && d.status !== 'draft') {
      const v = await supabase.rpc('material_norm_new_version', { p_norm: id })
      if (v.error) return { id, error: v.error.message }
      id = v.data as string
    }
    const header = { title: `Vật tư: ${ctx.title}`.slice(0, 200), basis: d.basis, group_size: d.group_size, library_item_id: ctx.itemId, subject: ctx.subject, grade: ctx.grade }
    if (id) {
      const u = await supabase.from('material_norms').update(header).eq('id', id)
      if (u.error) return { id, error: u.error.message }
      const del = await supabase.from('material_norm_items').delete().eq('norm_id', id)
      if (del.error) return { id, error: del.error.message }
    } else {
      const ins = await supabase.from('material_norms').insert({ ...header, org_id: ctx.orgId }).select('id').single()
      if (ins.error) return { id: null, error: ins.error.message }
      id = (ins.data as { id: string }).id
    }
    const it = await supabase.from('material_norm_items').insert(rows.map((r, k) => ({
      norm_id: id, seq: k + 1, catalog_id: r.catalog_id, name: r.name.trim(), unit: r.unit.trim() || 'cái', kind: r.kind,
      qty: Number(r.qty.replace(',', '.')), reusable: r.reusable,
    })))
    if (it.error) return { id, error: it.error.message }
  }
  if (ctx.publish && id) {
    const { data } = await supabase.from('material_norms').select('status').eq('id', id).maybeSingle()
    if ((data as { status: string } | null)?.status === 'draft') {
      const p = await supabase.rpc('material_norm_set_status', { p_norm: id, p_status: 'published' })
      if (p.error) return { id, error: p.error.message }
    }
  }
  return { id }
}

/** Bảng nhập vật tư của bài học */
export function UnitNormEditor({ value, onChange }: { value: UnitNorm; onChange: (v: UnitNorm) => void }) {
  const [cat, setCat] = useState<Cat[]>([])
  useEffect(() => {
    supabase.from('material_catalog').select('id, name, unit, kind, reusable, code').eq('active', true).order('kind').order('name')
      .then(({ data }) => setCat((data as Cat[]) ?? []))
  }, [])
  const set = (p: Partial<UnitNorm>) => onChange({ ...value, ...p, dirty: true })
  const setRow = (k: string, p: Partial<NormRow>) => set({ rows: value.rows.map(r => (r.key === k ? { ...r, ...p } : r)) })
  const addCat = (id: string) => {
    const c = cat.find(x => x.id === id); if (!c) return
    set({ rows: [...value.rows, { key: key(), catalog_id: c.id, name: c.name, unit: c.unit, kind: c.kind, qty: '1', reusable: c.reusable }] })
  }
  const used = new Set(value.rows.map(r => r.catalog_id).filter(Boolean))
  return (
    <div className="field" style={{ gridColumn: '1 / -1' }}>
      <span>Vật tư của bài học{value.status === 'published' && <small className="sub"> — định mức đang ban hành; sửa và lưu sẽ tạo phiên bản mới</small>}</span>
      <div className="tools" style={{ marginBottom: 6 }}>
        <label>Tính cho <select value={value.basis} onChange={e => set({ basis: e.target.value as Basis })} aria-label="Tính cho">
          {(Object.keys(BASIS) as Basis[]).map(b => <option key={b} value={b}>{BASIS[b]}</option>)}</select></label>
        {value.basis === 'group' && <label>Số HS / nhóm <input type="number" min={1} max={20} value={value.group_size} style={{ width: 64 }}
          onChange={e => set({ group_size: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} aria-label="Số học sinh mỗi nhóm" /></label>}
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Vật tư / công cụ</th><th>Loại</th><th>Số lượng / {BASIS[value.basis]}</th><th>Đơn vị</th><th>Dùng lại</th><th></th></tr></thead>
        <tbody>
          {value.rows.map(r => (
            <tr key={r.key}>
              <td>{r.catalog_id ? <b>{r.name}</b>
                : <input value={r.name} onChange={e => setRow(r.key, { name: e.target.value })} placeholder="Tên vật tư" aria-label="Tên vật tư" style={{ minWidth: 180 }} />}</td>
              <td>{r.catalog_id ? MKIND[r.kind] : <select value={r.kind} onChange={e => setRow(r.key, { kind: e.target.value as MKind, reusable: e.target.value !== 'supply' })} aria-label="Loại">
                {(Object.keys(MKIND) as MKind[]).map(k => <option key={k} value={k}>{MKIND[k]}</option>)}</select>}</td>
              <td><input value={r.qty} inputMode="decimal" onChange={e => setRow(r.key, { qty: e.target.value })} aria-label={`Số lượng ${r.name}`} style={{ width: 80 }} /></td>
              <td>{r.catalog_id ? r.unit : <input value={r.unit} onChange={e => setRow(r.key, { unit: e.target.value })} aria-label="Đơn vị" style={{ width: 80 }} />}</td>
              <td><input type="checkbox" checked={r.reusable} onChange={e => setRow(r.key, { reusable: e.target.checked })} aria-label="Dùng lại được" /></td>
              <td><button type="button" className="x" aria-label={`Bỏ ${r.name}`} onClick={() => set({ rows: value.rows.filter(x => x.key !== r.key) })}>×</button></td>
            </tr>
          ))}
          {value.rows.length === 0 && <tr><td colSpan={6}><small className="sub">Chưa có vật tư. Chọn từ danh mục hoặc thêm vật tư khác bên dưới.</small></td></tr>}
        </tbody>
      </table></div>
      <div className="tools" style={{ marginTop: 6 }}>
        <select value="" onChange={e => e.target.value && addCat(e.target.value)} aria-label="Thêm vật tư từ danh mục">
          <option value="">+ Thêm từ danh mục vật tư…</option>
          {(Object.keys(MKIND) as MKind[]).map(k => <optgroup key={k} label={MKIND[k]}>{cat.filter(c => c.kind === k && !used.has(c.id)).map(c =>
            <option key={c.id} value={c.id}>{c.name} ({c.unit}){c.code ? ` · ${c.code}` : ''}</option>)}</optgroup>)}
        </select>
        <button type="button" onClick={() => set({ rows: [...value.rows, { key: key(), catalog_id: null, name: '', unit: 'cái', kind: 'supply', qty: '1', reusable: false }] })}>+ Vật tư khác</button>
      </div>
    </div>
  )
}
