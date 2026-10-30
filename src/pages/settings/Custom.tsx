// Thiết lập chung đợt 2 (096): Tên & menu · Trường tùy chỉnh · Danh mục · Nút.
// KDI (platform) sửa mặc định toàn hệ thống; quản trị trường sửa phần của trường (đè lên mặc định KDI).
import { LEVEL_CATALOGS } from '../../lib/levels'
import { Fragment, lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { NAV, ROLE_LABEL, labelOf, type RoleKey } from '../../lib/nav'
import { layers, reloadSettings, slug, useSettings, orderItems, type CatalogsCfg, type CustomButton, type CustomField, type FieldsCfg, type FieldType, type MenuCfg, type MenuRole, type ButtonsCfg } from '../../lib/settings'
import { BUILTIN, ACTIONS } from '../../components/PageButtons'
import { MAT_TYPE } from '../library/common'
import { DEFAULT_TITLE, PLATFORM_TITLE } from '../../lib/branding'

const BrandingPage = lazy(() => import('../branding').then(m => ({ default: m.BrandingPage })))
const errText = (m: string) => /schema cache|does not exist|check constraint|org_settings_key/i.test(m) ? 'Hãy chạy migration 096 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Bạn không có quyền thay đổi mục này.' : m

/** Đọc / ghi một khoá thiết lập của phạm vi đang sửa (KDI hoặc trường). */
function useOwn<T>(scope: string | null, key: string, empty: T) {
  const [v, setV] = useState<T>(empty)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!scope) return
    supabase.from('org_settings').select('value').eq('org_id', scope).eq('key', key).maybeSingle().then(({ data }) => { setV(((data as { value: T } | null)?.value) ?? empty); setDirty(false) })
  }, [scope, key])
  const set = (x: T) => { setV(x); setDirty(true) }
  async function save(note: string, value: T = v) {
    if (!scope) return
    const { error } = await supabase.from('org_settings').upsert({ org_id: scope, key, value, updated_at: new Date().toISOString() })
    if (error) { setErr(errText(error.message)); setMsg(''); return }
    setErr(''); setMsg(note); setDirty(false); reloadSettings()
  }
  const status = <>{err && <p className="msg">{err}</p>}{msg && !dirty && <p className="sub"><b>{msg}</b></p>}</>
  return { v, set, save, dirty, status }
}
const Arrows = ({ k, n, move }: { k: number; n: number; move: (a: number, b: number) => void }) => <span className="setarrows">
  <button type="button" aria-label="Lên" disabled={k === 0} onClick={() => move(k, k - 1)}>↑</button>
  <button type="button" aria-label="Xuống" disabled={k === n - 1} onClick={() => move(k, k + 1)}>↓</button></span>
const moved = <X,>(xs: X[], a: number, b: number) => { const n = [...xs]; const [m] = n.splice(a, 1); n.splice(b, 0, m); return n }

// ===== Tên & menu =====
const SCHOOL_ROLES: RoleKey[] = ['school_admin', 'teacher', 'student', 'parent']
export function MenuTab({ scope, platform, orgId }: { scope: string | null; platform: boolean; orgId: string }) {
  const roles = platform ? (Object.keys(NAV) as RoleKey[]) : SCHOOL_ROLES
  const [role, setRole] = useState<RoleKey>(platform ? 'platform' : 'school_admin')
  const own = useOwn<MenuCfg>(scope, 'menu', {})
  const s = useSettings()
  const base: MenuRole = platform ? {} : layers<MenuCfg>(s, 'menu').std?.[role] ?? {}
  const cur: MenuRole = own.v[role] ?? {}
  const put = (patch: Partial<MenuRole>) => own.set({ ...own.v, [role]: { ...cur, ...patch } })
  const hidden = new Set(cur.hidden ?? [])
  const baseHidden = new Set(base.hidden ?? [])
  return <>
    <details className="panel setbrand"><summary><b>Thương hiệu</b> <small className="sub">tên hệ thống, logo, màu chủ đạo, màu thanh menu</small></summary>
      <Suspense fallback={<p className="sub">Đang tải…</p>}><BrandingPage orgId={orgId} platform={platform} /></Suspense></details>
    <div className="panel">
      <div className="bar"><h3 style={{ margin: 0, flex: 1 }}>Menu: tên, thứ tự, ẩn/hiện</h3>
        <label className="field" style={{ margin: 0 }}><span>Cổng</span><select value={role} onChange={e => setRole(e.target.value as RoleKey)}>
          {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label></div>
      <p className="sub">Để trống ô “Tên hiển thị” là giữ tên gốc. {platform ? 'Đây là mặc định cho mọi trường; trường có thể tự chỉnh phần của trường.' : 'Chỉ áp cho người dùng của trường. Ô mờ là tên KDI đang đặt.'}</p>
      {own.status}
      <label className="field setapptitle"><span>Tên hệ thống của cổng {ROLE_LABEL[role]}</span>
        <input value={cur.title ?? ''} maxLength={80} placeholder={base.title || (role === 'platform' ? PLATFORM_TITLE : DEFAULT_TITLE)} aria-label="Tên hệ thống"
          onChange={e => put({ title: e.target.value })} />
        <small className="sub">Hiện ở thanh trên cùng{role === 'platform' ? ' và đầu thanh menu' : ''}. Để trống là dùng tên mặc định.{role !== 'platform' ? ' Đơn vị có thương hiệu riêng thì dùng tên trong thương hiệu.' : ''}</small></label>
      {NAV[role].map(g => {
        const items = orderItems(g.items, cur.order?.[g.title] ?? base.order?.[g.title])
        return <div key={g.title} className="setmenugroup">
          <label className="setmenuhead"><span>Tên nhóm</span><input value={cur.groups?.[g.title] ?? ''} placeholder={base.groups?.[g.title] || g.title} maxLength={80}
            onChange={e => put({ groups: { ...cur.groups, [g.title]: e.target.value } })} /></label>
          {items.map((i, k) => <div key={i} className={'setmenuitem' + (hidden.has(i) || baseHidden.has(i) ? ' off' : '')}>
            <Arrows k={k} n={items.length} move={(a, b) => put({ order: { ...cur.order, [g.title]: moved(items, a, b) } })} />
            <span className="orig">{labelOf(role, i)}</span>
            <input value={cur.labels?.[i] ?? ''} placeholder={base.labels?.[i] || labelOf(role, i)} maxLength={80} aria-label={'Tên hiển thị ' + i}
              onChange={e => put({ labels: { ...cur.labels, [i]: e.target.value } })} />
            <label className="inl"><input type="checkbox" disabled={i === 'Thiết lập chung' || baseHidden.has(i)} checked={!hidden.has(i) && !baseHidden.has(i)}
              onChange={e => { const h = new Set(hidden); if (e.target.checked) h.delete(i); else h.add(i); put({ hidden: [...h] }) }} /> Hiện</label>
          </div>)}
        </div>
      })}
      <div className="formactions setsave">
        <button type="button" onClick={() => own.save('Đã khôi phục menu mặc định của cổng này.', { ...own.v, [role]: {} })}>Khôi phục menu cổng này</button>
        <button type="button" className="primary" disabled={!own.dirty} onClick={() => own.save('Đã lưu menu. Menu bên trái cập nhật ngay.')}>Lưu menu</button></div>
    </div>
  </>
}

// ===== Trường tùy chỉnh =====
const FTYPES: [FieldType, string][] = [['text', 'Chữ'], ['textarea', 'Đoạn văn'], ['number', 'Số'], ['date', 'Ngày'], ['select', 'Chọn từ danh sách']]
export function FieldsTab({ scope, platform }: { scope: string | null; platform: boolean }) {
  const [ent, setEnt] = useState<'library' | 'program'>('library')
  const own = useOwn<FieldsCfg>(scope, 'fields', {})
  const s = useSettings()
  const kdi = platform ? [] : layers<FieldsCfg>(s, 'fields').std?.[ent] ?? []
  const list = own.v[ent] ?? []
  const put = (xs: CustomField[]) => own.set({ ...own.v, [ent]: xs })
  const upd = (k: number, p: Partial<CustomField>) => put(list.map((f, j) => j === k ? { ...f, ...p } : f))
  function add() {
    const label = `Trường mới ${list.length + 1}`
    let key = slug(label); const used = new Set([...list, ...kdi].map(f => f.key)); let n = 2
    while (used.has(key)) key = slug(label) + '_' + n++
    put([...list, { key, label, type: 'text', column: false, detail: true }])
  }
  function save() {
    const bad = list.find(f => !f.label.trim() || (f.type === 'select' && !(f.options ?? []).length))
    if (bad) return alert(`${bad.label || 'Một trường'}: cần tên${bad.type === 'select' ? ' và các lựa chọn' : ''}.`)
    own.save('Đã lưu trường tùy chỉnh. Form thêm / sửa và trang chi tiết hiện các trường này.')
  }
  return <div className="panel">
    <div className="bar"><h3 style={{ margin: 0, flex: 1 }}>Trường tùy chỉnh</h3>
      <div className="segmented" role="group">{([['library', 'Học liệu'], ['program', 'Chương trình']] as const).map(([k, l]) =>
        <button type="button" key={k} className={ent === k ? 'on' : ''} aria-pressed={ent === k} onClick={() => setEnt(k)}>{l}</button>)}</div></div>
    <p className="sub">Trường thêm vào cuối form Thêm / Sửa {ent === 'library' ? 'học liệu' : 'chương trình'}, hiện ở trang chi tiết, và có thể hiện thành cột trong danh sách.</p>
    {own.status}
    {kdi.length > 0 && <p className="sub">Trường của KDI (áp cho mọi trường): {kdi.map(f => f.label).join(', ')}.</p>}
    <div className="wrap"><table className="libtable setfields">
      <thead><tr><th style={{ width: 70 }} /><th>Tên trường</th><th>Kiểu</th><th>Lựa chọn (cách nhau bởi dấu phẩy)</th><th>Bắt buộc</th><th>Hiện thành cột</th><th>Ở chi tiết</th><th /></tr></thead>
      <tbody>{list.map((f, k) => <tr key={f.key}>
        <td><Arrows k={k} n={list.length} move={(a, b) => put(moved(list, a, b))} /></td>
        <td><input value={f.label} maxLength={80} aria-label="Tên trường" onChange={e => upd(k, { label: e.target.value })} /><div><small className="sub">mã: {f.key}</small></div></td>
        <td><select value={f.type} aria-label="Kiểu" onChange={e => upd(k, { type: e.target.value as FieldType })}>{FTYPES.map(([t, l]) => <option key={t} value={t}>{l}</option>)}</select></td>
        <td>{f.type === 'select' ? <input value={(f.options ?? []).join(', ')} aria-label="Lựa chọn" placeholder="vd Cơ bản, Nâng cao"
          onChange={e => upd(k, { options: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} /> : <small className="sub">—</small>}</td>
        <td><input type="checkbox" aria-label="Bắt buộc" checked={!!f.required} onChange={e => upd(k, { required: e.target.checked })} /></td>
        <td><input type="checkbox" aria-label="Hiện thành cột" checked={!!f.column} onChange={e => upd(k, { column: e.target.checked })} /></td>
        <td><input type="checkbox" aria-label="Ở chi tiết" checked={f.detail !== false} onChange={e => upd(k, { detail: e.target.checked })} /></td>
        <td><button type="button" className="danger" onClick={() => put(list.filter((_, j) => j !== k))}>Xóa</button></td></tr>)}
        {!list.length && <tr><td colSpan={8} className="sub">Chưa có trường nào.</td></tr>}</tbody></table></div>
    <div className="formactions setsave"><button type="button" onClick={add}>+ Thêm trường</button>
      <button type="button" className="primary" disabled={!own.dirty} onClick={save}>Lưu</button></div>
  </div>
}

// ===== Danh mục =====
export const CATALOGS: { key: string; name: string; note: string; base?: string[]; coded?: Record<string, string> }[] = [
  { key: 'material_type', name: 'Loại học liệu', note: 'Đổi tên hiển thị và thứ tự (loại gắn với dữ liệu nên không thêm / xoá).', coded: Object.fromEntries(Object.entries(MAT_TYPE).filter(([k]) => k !== 'lesson_plan')) },
  { key: 'units', name: 'Đơn vị tính', note: 'Gợi ý khi nhập vật tư, định mức, kho.', base: ['Bộ', 'Chiếc', 'Cái', 'Gói', 'Hộp', 'Lọ', 'Cuộn', 'Tờ', 'Miếng', 'Sợi', 'Quyển', 'm', 'Cm'] },
  { key: 'supply_category', name: 'Nhóm vật tư', note: 'Gợi ý ô “Nhóm” của vật tư tiêu hao.', base: ['Vật tư tiêu hao', 'Công cụ', 'Linh kiện điện tử', 'Hóa chất', 'Văn phòng phẩm'] },
]
export function CatalogTab({ scope, platform }: { scope: string | null; platform: boolean }) {
  const own = useOwn<CatalogsCfg>(scope, 'catalogs', {})
  const s = useSettings()
  const kdi = platform ? {} : layers<CatalogsCfg>(s, 'catalogs').std ?? {}
  const [add, setAdd] = useState<Record<string, string>>({})
  return <div className="panel">
    <h3 style={{ marginTop: 0 }}>Danh mục</h3>
    <p className="sub">{platform ? 'Danh mục mặc định cho toàn hệ thống.' : 'Trường sửa danh mục thì dùng danh mục của trường thay cho của KDI.'}</p>
    {own.status}
    <div className="setcats">{([...CATALOGS, ...(platform ? LEVEL_CATALOGS : [])] as typeof CATALOGS).map(c => {
      const cur = own.v[c.key]
      if (c.coded) {
        const order = orderItems(Object.keys(c.coded), cur?.items?.length ? cur.items : kdi[c.key]?.items)
        const labels = cur?.labels ?? {}
        const put = (p: { items?: string[]; labels?: Record<string, string> }) => own.set({ ...own.v, [c.key]: { items: order, labels, ...p } })
        return <div key={c.key} className="setcat"><b>{c.name}</b> <small className="sub">{c.note}</small>
          <ul>{order.map((k, j) => <li key={k}><Arrows k={j} n={order.length} move={(a, b) => put({ items: moved(order, a, b) })} />
            <input value={labels[k] ?? ''} placeholder={kdi[c.key]?.labels?.[k] || c.coded![k]} maxLength={60} aria-label={'Tên ' + c.coded![k]}
              onChange={e => put({ labels: { ...labels, [k]: e.target.value } })} /></li>)}</ul></div>
      }
      const items = cur?.items?.length ? cur.items : kdi[c.key]?.items?.length ? kdi[c.key].items : c.base!
      const put = (xs: string[]) => own.set({ ...own.v, [c.key]: { items: xs } })
      return <div key={c.key} className="setcat"><b>{c.name}</b> <small className="sub">{c.note}</small>
        <ul>{items.map((x, j) => <li key={x + j}><Arrows k={j} n={items.length} move={(a, b) => put(moved(items, a, b))} />
          <span className="v">{x}</span><button type="button" className="linkbtn" onClick={() => put(items.filter((_, i) => i !== j))}>Xóa</button></li>)}</ul>
        <form className="addrow" onSubmit={e => { e.preventDefault(); const v = (add[c.key] ?? '').trim(); if (!v || items.includes(v)) return; put([...items, v]); setAdd({ ...add, [c.key]: '' }) }}>
          <input value={add[c.key] ?? ''} maxLength={60} placeholder="Thêm giá trị mới" aria-label={'Thêm ' + c.name} onChange={e => setAdd({ ...add, [c.key]: e.target.value })} />
          <button>Thêm</button></form></div>
    })}</div>
    <div className="formactions setsave">
      <button type="button" onClick={() => own.save('Đã khôi phục danh mục mặc định.', {})}>Khôi phục mặc định</button>
      <button type="button" className="primary" disabled={!own.dirty} onClick={() => own.save('Đã lưu danh mục.')}>Lưu danh mục</button></div>
  </div>
}

// Tên các mức (KDI): dùng ngay trong Khung năng lực và Ngân hàng câu hỏi, lưu chung vào danh mục của KDI
export function LevelNames({ keys }: { keys: string[] }) {
  const s = useSettings()
  const own = useOwn<CatalogsCfg>(s.std, 'catalogs', {})
  return <div className="panel" style={{ marginTop: 14 }}>
    {LEVEL_CATALOGS.filter(c => keys.includes(c.key)).map(c => {
      const labels = own.v[c.key]?.labels ?? {}
      const put = (k: string, v: string) => own.set({ ...own.v, [c.key]: { items: own.v[c.key]?.items ?? [], labels: { ...labels, [k]: v } } })
      return <div key={c.key}><b>{c.name}</b> <small className="sub">{c.note}</small>
        <div className="formgrid" style={{ marginTop: 8 }}>{Object.entries(c.coded).map(([k, base], i) => <label key={k} className="field"><span>Mức {i + 1}</span>
          <input value={labels[k] ?? ''} placeholder={base} maxLength={60} aria-label={`${c.name} mức ${i + 1}`} onChange={e => put(k, e.target.value)} /></label>)}</div></div>
    })}
    {own.status}
    <div className="formactions"><button type="button" className="primary" disabled={!own.dirty} onClick={() => own.save('Đã lưu tên các mức.')}>Lưu tên các mức</button></div>
  </div>
}

// ===== Nút =====
export function ButtonsTab({ scope, platform }: { scope: string | null; platform: boolean }) {
  const pages = [...new Set([...Object.keys(BUILTIN), ...Object.values(NAV).flatMap(g => g.flatMap(x => x.items))])]
  const [page, setPage] = useState('Học liệu')
  const own = useOwn<ButtonsCfg>(scope, 'buttons', {})
  const s = useSettings()
  const kdi = platform ? {} : layers<ButtonsCfg>(s, 'buttons').std ?? {}
  const cur = own.v[page] ?? {}
  const hidden = new Set(cur.hidden ?? [])
  const extra = cur.extra ?? []
  const put = (p: { hidden?: string[]; extra?: CustomButton[] }) => own.set({ ...own.v, [page]: { ...cur, ...p } })
  const upd = (k: number, p: Partial<CustomButton>) => put({ extra: extra.map((b, j) => j === k ? { ...b, ...p } : b) })
  return <div className="panel">
    <div className="bar"><h3 style={{ margin: 0, flex: 1 }}>Nút trên trang</h3>
      <label className="field" style={{ margin: 0, minWidth: 280 }}><span>Trang</span><select value={page} onChange={e => setPage(e.target.value)}>
        {Object.keys(BUILTIN).map(p => <option key={p} value={p}>{p}</option>)}
        <optgroup label="Trang khác (chỉ thêm nút)">{pages.filter(p => !BUILTIN[p]).sort().map(p => <option key={p} value={p}>{p}</option>)}</optgroup></select></label></div>
    {own.status}
    <h4 className="distsec">Nút có sẵn trên trang</h4>
    {BUILTIN[page] ? <div className="setbtns">{BUILTIN[page].map(([id, label]) => {
      const byKdi = !!kdi[page]?.hidden?.includes(id)
      return <label key={id} className="inl"><input type="checkbox" disabled={byKdi} checked={!hidden.has(id) && !byKdi}
        onChange={e => { const h = new Set(hidden); if (e.target.checked) h.delete(id); else h.add(id); put({ hidden: [...h] }) }} /> {label}{byKdi && <small className="sub"> (KDI đã ẩn)</small>}</label>
    })}</div> : <p className="sub">Trang này chưa hỗ trợ ẩn nút có sẵn.</p>}
    <h4 className="distsec">Nút thêm mới · {extra.length}</h4>
    {(kdi[page]?.extra ?? []).length > 0 && <p className="sub">Nút của KDI trên trang này: {kdi[page]!.extra!.map(b => b.label).join(', ')}.</p>}
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Tên nút</th><th>Hành động</th><th>Liên kết / trang / nội dung</th><th>Nút chính</th><th /></tr></thead>
      <tbody>{extra.map((b, k) => <tr key={b.id}>
        <td><input value={b.label} maxLength={40} aria-label="Tên nút" onChange={e => upd(k, { label: e.target.value })} /></td>
        <td><select value={b.action} aria-label="Hành động" onChange={e => upd(k, { action: e.target.value as CustomButton['action'] })}>{ACTIONS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select></td>
        <td>{b.action === 'csv' ? <small className="sub">Xuất bảng đầu tiên trên trang</small>
          : b.action === 'page' ? <select value={b.target ?? ''} aria-label="Trang" onChange={e => upd(k, { target: e.target.value })}><option value="">— chọn trang —</option>{pages.sort().map(p => <option key={p} value={p}>{p}</option>)}</select>
          : <input value={b.target ?? ''} maxLength={500} aria-label="Nội dung" placeholder={b.action === 'link' ? 'https://…' : 'Nội dung thông báo'} onChange={e => upd(k, { target: e.target.value })} />}</td>
        <td><input type="checkbox" aria-label="Nút chính" checked={!!b.primary} onChange={e => upd(k, { primary: e.target.checked })} /></td>
        <td><button type="button" className="danger" onClick={() => put({ extra: extra.filter((_, j) => j !== k) })}>Xóa</button></td></tr>)}
        {!extra.length && <tr><td colSpan={5} className="sub">Chưa có nút thêm mới.</td></tr>}</tbody></table></div>
    <div className="formactions setsave">
      <button type="button" disabled={extra.length >= 6} onClick={() => put({ extra: [...extra, { id: 'b' + Date.now().toString(36), label: 'Nút mới', action: 'link', target: '' }] })}>+ Thêm nút</button>
      <button type="button" className="primary" disabled={!own.dirty} onClick={() => {
        const bad = extra.find(b => !b.label.trim() || (b.action === 'link' && !/^https?:\/\//i.test(b.target ?? '')) || (b.action === 'page' && !b.target))
        if (bad) return alert(`Nút “${bad.label || '…'}”: cần tên${bad.action === 'link' ? ' và liên kết bắt đầu bằng http(s)://' : bad.action === 'page' ? ' và trang' : ''}.`)
        own.save('Đã lưu nút. Nút mới hiện cạnh tiêu đề trang.')
      }}>Lưu nút</button></div>
  </div>
}

// ===== Xuất / nhập / khôi phục cấu hình =====
const KEYS = ['menu', 'catalogs', 'fields', 'buttons', 'rules', 'periods']
export function ConfigTools({ scope }: { scope: string | null }) {
  const [msg, setMsg] = useState('')
  async function exp() {
    const { data } = await supabase.from('org_settings').select('key, value').eq('org_id', scope!)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(Object.fromEntries(((data as { key: string; value: unknown }[]) ?? []).map(r => [r.key, r.value])), null, 2)], { type: 'application/json' }))
    a.download = 'thiet-lap-chung.json'; a.click()
  }
  async function imp(file: File) {
    let j: Record<string, unknown>
    try { j = JSON.parse(await file.text()) } catch { return setMsg('Tệp không phải cấu hình hợp lệ.') }
    const rows = Object.entries(j).filter(([k, v]) => KEYS.includes(k) && v && typeof v === 'object').map(([key, value]) => ({ org_id: scope, key, value, updated_at: new Date().toISOString() }))
    if (!rows.length) return setMsg('Tệp không có mục cấu hình nào.')
    if (!confirm(`Nhập ${rows.length} mục cấu hình (${rows.map(r => r.key).join(', ')})? Cấu hình hiện tại của các mục này bị thay.`)) return
    const { error } = await supabase.from('org_settings').upsert(rows)
    if (error) return setMsg(errText(error.message))
    setMsg(`Đã nhập ${rows.length} mục. Tải lại trang để xem.`); reloadSettings()
  }
  async function reset() {
    if (!confirm('Khôi phục mặc định: xoá tên & menu, danh mục, trường tùy chỉnh, nút đã đặt? (Năm học, ngày nghỉ, quy tắc giữ nguyên.)')) return
    const { error } = await supabase.from('org_settings').delete().eq('org_id', scope!).in('key', ['menu', 'catalogs', 'fields', 'buttons'])
    if (error) return setMsg(errText(error.message))
    setMsg('Đã khôi phục mặc định. Tải lại trang để xem.'); reloadSettings()
  }
  return <span className="settools">
    {msg && <small className="sub">{msg}</small>}
    <button type="button" disabled={!scope} onClick={exp}>Xuất cấu hình</button>
    <label className="btnlike">Nhập cấu hình<input type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) imp(f); e.target.value = '' }} /></label>
    <button type="button" disabled={!scope} onClick={reset}>Khôi phục mặc định</button>
  </span>
}
