import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx, importSummary, norm, type Column } from '../lib/sheet'
import ImportExcel from '../components/ImportExcel'
import { Tiles } from './department/charts'
import { Tabs } from './teacher/common'
import { useProgramOptions, unitTree, progLabel } from './library/common'
import { GradePicker, SubjectPicker } from '../components/Pickers'
import { Drawer } from '../components/Drawer'

// Định mức vật tư (migration 059): danh mục vật tư / công cụ / thiết bị, định mức theo sản phẩm / nhóm / học sinh gắn bài,
// phiên bản & ban hành, sao chép về trường, dự trù cho lớp so với tồn kho, đề xuất điều chỉnh.
type Basis = 'product' | 'group' | 'student'
type NStatus = 'draft' | 'published' | 'superseded' | 'archived'
type MKind = 'supply' | 'tool' | 'equipment'
const NOEV = { preventDefault() {} } as React.FormEvent
type Norm = {
  id: string; org_id: string; family_id: string; version_no: number; title: string; basis: Basis; group_size: number; sessions: number
  program_id: string | null; unit_id: string | null; library_item_id: string | null; subject: string | null; grade: number | null
  status: NStatus; scope: 'own' | 'children'; source_id: string | null; replaced_by: string | null; published_at: string | null
  note: string | null; updated_at: string
  organizations?: { name: string } | null; owner_name?: string | null; edu_programs?: { title: string; version_no: number } | null
  edu_program_units?: { title: string } | null; library_items?: { title: string } | null; material_norm_items?: { count: number }[]
}
type NItem = { id: string; norm_id: string; seq: number; catalog_id: string | null; name: string; unit: string; kind: MKind; qty: number; reusable: boolean; note: string | null }
type Cat = {
  id: string; org_id: string; code: string | null; name: string; kind: MKind; unit: string; spec: string | null; unit_price: number | null
  reusable: boolean; scope: 'own' | 'children'; active: boolean; note: string | null; organizations?: { name: string } | null; owner_name?: string | null
}
type Est = {
  item_id: string; name: string; unit: string; kind: MKind; reusable: boolean; per_qty: number; multiplier: number; need: number
  stock: number | null; shortage: number; unit_price: number | null; cost: number | null
}
type PItem = { item_id?: string | null; catalog_id?: string | null; name: string; unit: string; qty: number; note?: string }
type Proposal = {
  id: string; norm_id: string; org_id: string; proposed_by: string | null; reason: string; items: PItem[]; status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
  response: string | null; new_norm_id: string | null; decided_at: string | null; created_at: string
  material_norms?: { title: string; version_no: number; org_id: string } | null; organizations?: { name: string } | null
  profiles?: { full_name: string | null } | null
}
type Klass = { id: string; name: string; grade: number | null }
type LibOpt = { id: string; title: string }

export const BASIS: Record<Basis, string> = { product: '1 sản phẩm', group: '1 nhóm', student: '1 học sinh' }
export const MKIND: Record<MKind, string> = { supply: 'Vật tư tiêu hao', tool: 'Công cụ', equipment: 'Thiết bị' }
const NSTATUS: Record<NStatus, [string, string]> = {
  draft: ['Nháp', ''], published: ['Đang ban hành', 'good'], superseded: ['Đã thay thế', ''], archived: ['Lưu trữ', ''],
}
const PSTAT: Record<Proposal['status'], [string, string]> = {
  pending: ['Chờ xử lý', 'warn'], accepted: ['Đã chấp nhận', 'good'], rejected: ['Bị từ chối', 'bad'], withdrawn: ['Đã rút', ''],
}
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 059 trên Supabase.'
  : /row-level|42501/i.test(m) ? 'Bạn không có quyền thực hiện thao tác này.' : m)
const fmtD = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')
const num = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('vi-VN', { maximumFractionDigits: 2 }))
const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('vi-VN') + ' đ')
const toNum = (s: string) => Number(String(s).replace(/\s/g, '').replace(',', '.'))

function Pill({ s }: { s: NStatus }) {
  const [label, tone] = NSTATUS[s]
  return tone ? <span className={'gpill ' + tone}>{label}</span> : <span className="pill">{label}</span>
}

function useRights(orgId: string | null) {
  const [orgType, setOrgType] = useState<string | null>(null)
  const [canWrite, setCanWrite] = useState(false)
  useEffect(() => {
    if (!orgId) return
    supabase.from('organizations').select('type').eq('id', orgId).maybeSingle().then(async ({ data }) => {
      const t = (data as { type: string } | null)?.type ?? null
      setOrgType(t)
      if (t !== 'school') return setCanWrite(true)
      const [a, p] = await Promise.all([supabase.rpc('is_admin'), supabase.rpc('has_perm', { p_module: 'library', p_action: 'edit' })])
      setCanWrite(!!a.data || !!p.data)
    })
  }, [orgId])
  return { orgType, canWrite, isSchool: orgType === 'school' }
}

type Tab = 'norms' | 'catalog' | 'proposals'
export function MaterialNorms({ orgId, sharedOnly }: { orgId: string | null; sharedOnly?: boolean }) {
  const rights = useRights(orgId)
  const [tab, setTab] = useState<Tab>('norms')
  const [openId, setOpenId] = useState<string | null>(null)
  const [ver, setVer] = useState(0)
  // Kho học liệu dùng chung: chỉ danh sách định mức KDI / cấp trên ban hành, không có tab danh mục và đề xuất
  if (sharedOnly) return <>
    <NormList orgId={orgId} rights={rights} onOpen={setOpenId} openId={openId} ver={ver} sharedOnly />
    {openId && <NormDetail id={openId} orgId={orgId} rights={rights} onOpen={setOpenId} onChanged={() => setVer(v => v + 1)} onClose={() => setOpenId(null)} />}
  </>
  return (
    <>
      <div className="bar">
        <Tabs<Tab> items={[['norms', 'Định mức theo bài / học phần'], ['catalog', 'Danh mục vật tư, công cụ, thiết bị'], ['proposals', 'Đề xuất điều chỉnh']]}
          value={tab} onChange={t => { setTab(t); setOpenId(null) }} />
      </div>
      {tab === 'norms' && <NormList orgId={orgId} rights={rights} onOpen={setOpenId} openId={openId} ver={ver} />}
      {tab === 'norms' && openId && <NormDetail id={openId} orgId={orgId} rights={rights} onOpen={setOpenId} onChanged={() => setVer(v => v + 1)} onClose={() => setOpenId(null)} />}
      {tab === 'catalog' && <CatalogTab orgId={orgId} rights={rights} />}
      {tab === 'proposals' && <ProposalsTab orgId={orgId} rights={rights} onOpenNorm={id => { setTab('norms'); setOpenId(id) }} />}
    </>
  )
}
type Rights = ReturnType<typeof useRights>

// ================= Danh sách định mức =================
const NORM_SEL = '*, owner_name, organizations(name), edu_programs(title, version_no), edu_program_units(title), library_items(title), material_norm_items(count)'
async function selectNorms(filter?: (q: any) => any) {
  const run = (cols: string) => { let q = supabase.from('material_norms').select(cols); if (filter) q = filter(q); return q.order('title').order('version_no', { ascending: false }) }
  const r = await run(NORM_SEL)
  if (r.error && /relationship|schema cache/i.test(r.error.message) && !/material_norms/.test(r.error.message)) return run('*')
  return r
}
const ownerName = (n: Norm, orgId: string | null) => (n.org_id === orgId ? 'Đơn vị mình' : n.owner_name ?? n.organizations?.name ?? 'KDI / cấp trên')

function NormList({ orgId, rights, onOpen, openId, ver, sharedOnly }: { orgId: string | null; rights: Rights; onOpen: (id: string) => void; openId: string | null; ver: number; sharedOnly?: boolean }) {
  const [list, setList] = useState<Norm[] | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [q, setQ] = useState(''); const [subject, setSubject] = useState(''); const [basis, setBasis] = useState(''); const [old, setOld] = useState(false)
  const [form, setForm] = useState<{ title: string; basis: Basis; group_size: string; sessions: string; subject: string; grade: string; program_id: string; unit_id: string } | null>(null)
  const { programs, units } = useProgramOptions(orgId)

  async function load() {
    const { data, error } = await selectNorms()
    if (error) setMsg([errText(error.message), true])
    setList((data as unknown as Norm[]) ?? [])
  }
  useEffect(() => { load() }, [orgId, ver])
  const all = list ?? []
  const subjects = useMemo(() => [...new Set(all.map(n => n.subject).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi')), [list])
  const shown = all.filter(n => (old || !['superseded', 'archived'].includes(n.status)) && (!subject || n.subject === subject) && (!basis || n.basis === basis)
    && (!q || norm([n.title, n.subject, n.edu_programs?.title, n.edu_program_units?.title].join(' ')).includes(norm(q))))
  const own = shown.filter(n => n.org_id === orgId)
  const shared = shown.filter(n => n.org_id !== orgId)

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form || !orgId) return
    const row = {
      org_id: orgId, title: form.title.trim(), basis: form.basis, group_size: Number(form.group_size) || 4, sessions: Number(form.sessions) || 1,
      subject: form.subject.trim() || null, grade: Number(form.grade) || null, program_id: form.program_id || null,
      unit_id: form.program_id && form.unit_id ? form.unit_id : null, scope: rights.isSchool ? 'own' : 'children',
    }
    if (!row.title) return setMsg(['Nhập tên định mức.', true])
    const { data, error } = await supabase.from('material_norms').insert(row).select('id').single()
    if (error) return setMsg([errText(error.message), true])
    setForm(null); onOpen((data as { id: string }).id)
  }
  async function copy(n: Norm) {
    if (!confirm(`Sao chép định mức "${n.title}" (v${n.version_no}) về đơn vị thành bản nháp để điều chỉnh?`)) return
    const { data, error } = await supabase.rpc('material_norm_copy', { p_norm: n.id })
    if (error) return setMsg([errText(error.message), true])
    onOpen(data as string)
  }

  // Bấm vào dòng để mở chi tiết bên phải (thao tác nằm trong bảng chi tiết)
  const table = (rows: Norm[], mine: boolean) => (
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Định mức</th><th>Tính cho</th><th>Số vật tư</th><th>Gắn với</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
      <tbody>{rows.map(n => (
        <tr key={n.id} className={'rowlink' + (openId === n.id ? ' on' : '')} onClick={() => onOpen(n.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(n.id) }}>
          <td><b>{n.title}</b> <small className="sub">v{n.version_no}</small><div className="sub" style={{ fontSize: 12 }}>{[n.subject, n.grade && `Khối ${n.grade}`, !mine && ownerName(n, orgId)].filter(Boolean).join(' · ') || '—'}</div></td>
          <td>{BASIS[n.basis]}{n.basis === 'group' && <small className="sub"> ({n.group_size} HS)</small>}<div className="sub" style={{ fontSize: 12 }}>{n.sessions} buổi</div></td>
          <td>{n.material_norm_items?.[0]?.count ?? '—'}</td>
          <td><small>{n.edu_programs ? `${n.edu_programs.title}${n.edu_program_units ? ' › ' + n.edu_program_units.title : ''}` : ''}{n.library_items ? <>{n.edu_programs ? <br /> : null}Bài: {n.library_items.title}</> : null}{!n.edu_programs && !n.library_items ? '—' : null}</small></td>
          <td><Pill s={n.status} />{n.published_at && <div className="sub" style={{ fontSize: 12 }}>từ {fmtD(n.published_at)}</div>}</td>
          <td><small>{fmtD(n.updated_at)}</small></td>
        </tr>
      ))}</tbody>
    </table></div>
  )

  return (
    <>
      <p className="sub">Định mức vật tư cho 1 sản phẩm, 1 nhóm hoặc 1 học sinh, gắn với học phần / bài của chương trình. Định mức do KDI và cấp trên ban hành được dùng chung; trường sao chép về để điều chỉnh hoặc gửi đề xuất điều chỉnh.</p>
      <div className="bar small">
        <input className="search" placeholder="Tìm định mức…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm định mức" />
        <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Môn"><option value="">Mọi môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
        <select value={basis} onChange={e => setBasis(e.target.value)} aria-label="Tính cho"><option value="">Mọi cách tính</option>{(Object.keys(BASIS) as Basis[]).map(b => <option key={b} value={b}>Theo {BASIS[b]}</option>)}</select>
        <label><input type="checkbox" checked={old} onChange={e => setOld(e.target.checked)} /> Hiện bản cũ / lưu trữ</label>
        {rights.canWrite && !sharedOnly && <button className="primary" onClick={() => setForm({ title: '', basis: 'group', group_size: '4', sessions: '1', subject: '', grade: '', program_id: '', unit_id: '' })}>Thêm định mức</button>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}>{msg[0]}</p>}
      {form && (
        <Drawer title="Thêm định mức vật tư" closeOnOutside={false} onClose={() => setForm(null)}
          actions={<><button type="button" className="primary" onClick={() => create(NOEV)}>Tạo bản nháp</button><button type="button" onClick={() => setForm(null)}>Huỷ</button></>}>
        {msg && msg[1] && <p className="msg">{msg[0]}</p>}
        <form className="formgrid" onSubmit={create}>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Tên định mức *</span><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Robot dò line — lắp ráp" /></label>
          <label className="field"><span>Tính cho</span><select value={form.basis} onChange={e => setForm({ ...form, basis: e.target.value as Basis })}>{(Object.keys(BASIS) as Basis[]).map(b => <option key={b} value={b}>{BASIS[b]}</option>)}</select></label>
          {form.basis === 'group' && <label className="field"><span>Số HS mỗi nhóm</span><input type="number" min={1} max={20} value={form.group_size} onChange={e => setForm({ ...form, group_size: e.target.value })} /></label>}
          <label className="field"><span>Số buổi</span><input type="number" min={1} max={50} value={form.sessions} onChange={e => setForm({ ...form, sessions: e.target.value })} /></label>
          <label className="field"><span>Môn</span><SubjectPicker value={form.subject} onChange={v => setForm({ ...form, subject: v })} emptyLabel="— Không chọn —" /></label>
          <label className="field"><span>Khối</span><GradePicker value={form.grade ? Number(form.grade) : null} onChange={g => setForm({ ...form, grade: g ? String(g) : '' })} emptyLabel="—" /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Chương trình giáo dục</span><select value={form.program_id} onChange={e => setForm({ ...form, program_id: e.target.value, unit_id: '' })}>
            <option value="">— không gắn —</option>{programs.map(p => <option key={p.id} value={p.id}>{progLabel(p)}</option>)}</select></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Bài</span><select value={form.unit_id} disabled={!form.program_id} onChange={e => setForm({ ...form, unit_id: e.target.value })}>
            <option value="">— chọn bài —</option>{unitTree(units, form.program_id, 'lesson', form.unit_id).map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
        </form>
        </Drawer>
      )}
      {!list ? <p className="sub">Đang tải…</p> : <>
        {!sharedOnly && <><h3>Của đơn vị ({own.length})</h3>
        {own.length ? table(own, true) : <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có định mức nào của đơn vị.{rights.canWrite ? ' Bấm “Thêm định mức” hoặc sao chép định mức dùng chung bên dưới.' : ''}</p></div>}</>}
        <h3>Dùng chung từ KDI / cấp trên ({shared.length})</h3>
        {shared.length ? table(shared, false) : <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có định mức dùng chung.</p></div>}
      </>}
    </>
  )
}

// ================= Chi tiết định mức =================
function NormDetail({ id, orgId, rights, onOpen, onClose, onChanged }: { id: string; orgId: string | null; rights: Rights; onOpen: (id: string) => void; onClose: () => void; onChanged: () => void }) {
  const [n, setN] = useState<Norm | null>(null)
  const [items, setItems] = useState<NItem[]>([])
  const [family, setFamily] = useState<Norm[]>([])
  const [cat, setCat] = useState<Cat[]>([])
  const [libs, setLibs] = useState<LibOpt[]>([])
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [info, setInfo] = useState<Partial<Record<keyof Norm, any>> | null>(null)
  const [row, setRow] = useState<{ catalog_id: string; name: string; unit: string; kind: MKind; qty: string; note: string } | null>(null)
  const [propose, setPropose] = useState(false)
  const { programs, units } = useProgramOptions(orgId)

  async function load() {
    const { data, error } = await selectNorms(q => q.eq('id', id))
    if (error) setMsg([errText(error.message), true])
    const cur = ((data as unknown as Norm[]) ?? [])[0] ?? null
    setN(cur)
    if (!cur) return
    const [i, f] = await Promise.all([
      supabase.from('material_norm_items').select('*').eq('norm_id', id).order('seq').order('name'),
      supabase.from('material_norms').select('id, version_no, status, published_at, note, org_id, family_id, title').eq('family_id', cur.family_id).order('version_no', { ascending: false }),
    ])
    setItems((i.data as NItem[]) ?? []); setFamily((f.data as Norm[]) ?? [])
  }
  useEffect(() => { load(); setMsg(null); setInfo(null); setRow(null); setPropose(false) }, [id])
  useEffect(() => {
    supabase.from('material_catalog').select('*').eq('active', true).order('kind').order('name').then(({ data }) => setCat((data as Cat[]) ?? []))
    supabase.from('library_items').select('id, title').in('kind', ['material', 'lesson']).order('title').then(({ data }) => setLibs((data as LibOpt[]) ?? []))
  }, [orgId])
  if (!n) return <Drawer wide title="Định mức vật tư" onClose={onClose}>{msg ? <p className="msg">{msg[0]}</p> : <p className="sub">Đang tải…</p>}</Drawer>

  const mine = n.org_id === orgId
  const editable = mine && rights.canWrite && n.status === 'draft'
  const say = (m: string, err = false) => setMsg([m, err])

  async function act(p: Promise<{ error: { message: string } | null; data?: unknown }>, ok: string, then?: (d: unknown) => void) {
    const { error, data } = await p
    if (error) return say(errText(error.message), true)
    say(ok); onChanged(); if (then) then(data); else load()
  }
  const setStatus = (s: NStatus, ok: string) => act(supabase.rpc('material_norm_set_status', { p_norm: n.id, p_status: s }) as any, ok)
  async function saveInfo(e: React.FormEvent) {
    e.preventDefault(); if (!info) return
    const patch = {
      title: String(info.title ?? '').trim(), basis: info.basis, group_size: Number(info.group_size) || 4, sessions: Number(info.sessions) || 1,
      subject: String(info.subject ?? '').trim() || null, grade: Number(info.grade) || null, program_id: info.program_id || null,
      unit_id: info.program_id && info.unit_id ? info.unit_id : null, library_item_id: info.library_item_id || null,
      note: String(info.note ?? '').trim() || null, ...(rights.isSchool ? {} : { scope: info.scope }),
    }
    const { error } = await supabase.from('material_norms').update(patch).eq('id', n!.id)
    if (error) return say(errText(error.message), true)
    setInfo(null); say('Đã lưu thông tin định mức.'); onChanged(); load()
  }
  async function addRow(e: React.FormEvent) {
    e.preventDefault(); if (!row) return
    const qty = toNum(row.qty)
    if (!(qty > 0)) return say('Số lượng phải lớn hơn 0.', true)
    if (!row.catalog_id && !row.name.trim()) return say('Chọn vật tư trong danh mục hoặc nhập tên.', true)
    const { error } = await supabase.from('material_norm_items').insert({
      norm_id: n!.id, seq: (items.reduce((m, i) => Math.max(m, i.seq), 0) + 1), catalog_id: row.catalog_id || null,
      name: row.catalog_id ? 'x' : row.name.trim(), unit: row.unit.trim() || 'cái', kind: row.kind, qty, note: row.note.trim() || null,
      reusable: row.kind !== 'supply',
    })
    if (error) return say(errText(error.message), true)
    setRow({ catalog_id: '', name: '', unit: 'cái', kind: 'supply', qty: '1', note: '' }); load()
  }
  async function updQty(i: NItem, v: string) {
    const qty = toNum(v); if (!(qty > 0) || qty === Number(i.qty)) return
    const { error } = await supabase.from('material_norm_items').update({ qty }).eq('id', i.id)
    if (error) say(errText(error.message), true); else load()
  }
  async function delRow(i: NItem) {
    const { error } = await supabase.from('material_norm_items').delete().eq('id', i.id)
    if (error) say(errText(error.message), true); else load()
  }
  async function remove() {
    if (!confirm(`Xoá định mức "${n!.title}" v${n!.version_no}?`)) return
    const { error } = await supabase.from('material_norms').delete().eq('id', n!.id)
    if (error) return say(errText(error.message), true)
    onChanged(); onClose()
  }

  return (
    <Drawer wide title={`${n.title} · v${n.version_no}`} onClose={onClose} actions={<>
          {editable && <button onClick={() => setInfo({ ...n })}>Sửa thông tin</button>}
          {editable && <button className="primary" onClick={() => setStatus('published', 'Đã ban hành định mức.')}>Ban hành</button>}
          {mine && rights.canWrite && n.status === 'published' && <button onClick={() => act(supabase.rpc('material_norm_new_version', { p_norm: n.id }) as any, 'Đã tạo phiên bản mới (bản nháp).', d => onOpen(d as string))}>Tạo phiên bản mới</button>}
          {mine && rights.canWrite && (n.status === 'published' || n.status === 'superseded') && <button onClick={() => confirm('Lưu trữ định mức này?') && setStatus('archived', 'Đã lưu trữ.')}>Lưu trữ</button>}
          {mine && rights.canWrite && n.status === 'archived' && <button onClick={() => setStatus('draft', 'Đã mở lại thành bản nháp.')}>Mở lại</button>}
          {editable && <button className="danger" onClick={remove}>Xoá</button>}
          {!mine && n.status === 'published' && rights.canWrite && <button onClick={() => act(supabase.rpc('material_norm_copy', { p_norm: n.id }) as any, 'Đã sao chép về đơn vị.', d => onOpen(d as string))}>Sao chép về đơn vị</button>}
          {!mine && n.status === 'published' && <button onClick={() => setPropose(!propose)}>Đề xuất điều chỉnh</button>}
        </>}>
      <div className="drawermeta"><Pill s={n.status} /></div>
      <p className="sub" style={{ margin: 0 }}>{[`Tính cho ${BASIS[n.basis]}${n.basis === 'group' ? ` (${n.group_size} HS)` : ''}`, `${n.sessions} buổi`, n.subject, n.grade && `Khối ${n.grade}`, ownerName(n, orgId)].filter(Boolean).join(' · ')}</p>
          {(n.edu_programs || n.library_items) && <p className="sub" style={{ margin: 0 }}>{n.edu_programs && <>Chương trình: {n.edu_programs.title} (v{n.edu_programs.version_no}){n.edu_program_units ? ` › ${n.edu_program_units.title}` : ''}</>}{n.library_items && <>{n.edu_programs ? ' · ' : ''}Học liệu: {n.library_items.title}</>}</p>}
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {n.note && <p className="sub">Ghi chú: {n.note}</p>}
      {mine && n.status !== 'draft' && n.status !== 'archived' && <p className="sub">Định mức đã ban hành không sửa trực tiếp — tạo phiên bản mới để điều chỉnh.</p>}

      {info && (
        <form className="panel formgrid" onSubmit={saveInfo} style={{ marginBottom: 12 }}>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Tên định mức</span><input value={info.title ?? ''} onChange={e => setInfo({ ...info, title: e.target.value })} /></label>
          <label className="field"><span>Tính cho</span><select value={info.basis} onChange={e => setInfo({ ...info, basis: e.target.value })}>{(Object.keys(BASIS) as Basis[]).map(b => <option key={b} value={b}>{BASIS[b]}</option>)}</select></label>
          <label className="field"><span>Số HS mỗi nhóm</span><input type="number" min={1} max={20} value={info.group_size ?? 4} onChange={e => setInfo({ ...info, group_size: e.target.value })} /></label>
          <label className="field"><span>Số buổi</span><input type="number" min={1} max={50} value={info.sessions ?? 1} onChange={e => setInfo({ ...info, sessions: e.target.value })} /></label>
          <label className="field"><span>Môn</span><SubjectPicker value={info.subject} onChange={v => setInfo({ ...info, subject: v })} emptyLabel="— Không chọn —" /></label>
          <label className="field"><span>Khối</span><GradePicker value={info.grade ? Number(info.grade) : null} onChange={g => setInfo({ ...info, grade: g ? String(g) : '' })} emptyLabel="—" /></label>
          {!rights.isSchool && <label className="field"><span>Phạm vi</span><select value={info.scope} onChange={e => setInfo({ ...info, scope: e.target.value })}><option value="children">Dùng chung cho đơn vị trực thuộc</option><option value="own">Chỉ đơn vị mình</option></select></label>}
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Chương trình giáo dục</span><select value={info.program_id ?? ''} onChange={e => setInfo({ ...info, program_id: e.target.value, unit_id: '' })}>
            <option value="">— không gắn —</option>{programs.map(p => <option key={p.id} value={p.id}>{progLabel(p)}</option>)}</select></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Bài</span><select value={info.unit_id ?? ''} disabled={!info.program_id} onChange={e => setInfo({ ...info, unit_id: e.target.value })}>
            <option value="">— chọn bài —</option>{unitTree(units, info.program_id, 'lesson', info.unit_id).map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Học liệu / bài giảng</span><select value={info.library_item_id ?? ''} onChange={e => setInfo({ ...info, library_item_id: e.target.value })}>
            <option value="">— không gắn —</option>{libs.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú</span><input value={info.note ?? ''} onChange={e => setInfo({ ...info, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setInfo(null)}>Huỷ</button></div>
        </form>
      )}

      <div className="bar" style={{ marginTop: 8 }}><h3 style={{ margin: 0 }}>Vật tư cho {BASIS[n.basis]} ({items.length})</h3>
        <div className="actions">{items.length > 0 && <button onClick={() => downloadXlsx(`Dinh-muc ${n.title} v${n.version_no}`, [
          { key: 'n', label: 'Vật tư / công cụ', width: 32 }, { key: 'k', label: 'Loại' }, { key: 'q', label: `Số lượng / ${BASIS[n.basis]}` }, { key: 'u', label: 'Đơn vị tính' },
          { key: 'r', label: 'Dùng lại' }, { key: 'g', label: 'Ghi chú', width: 30 }],
          items.map(i => [i.name, MKIND[i.kind], Number(i.qty), i.unit, i.reusable ? 'Có' : '', i.note ?? '']))}>Xuất Excel</button>}
          {editable && !row && <button className="primary" onClick={() => setRow({ catalog_id: '', name: '', unit: 'cái', kind: 'supply', qty: '1', note: '' })}>Thêm vật tư</button>}</div></div>
      {row && (
        <form className="panel formgrid" onSubmit={addRow} style={{ marginBottom: 12 }}>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Chọn từ danh mục</span><select value={row.catalog_id} onChange={e => setRow({ ...row, catalog_id: e.target.value })} aria-label="Vật tư trong danh mục">
            <option value="">— nhập tên tự do —</option>
            {(Object.keys(MKIND) as MKind[]).map(k => <optgroup key={k} label={MKIND[k]}>{cat.filter(c => c.kind === k).map(c => <option key={c.id} value={c.id}>{c.name} ({c.unit}){c.code ? ` · ${c.code}` : ''}</option>)}</optgroup>)}
          </select></label>
          {!row.catalog_id && <>
            <label className="field"><span>Tên vật tư</span><input value={row.name} onChange={e => setRow({ ...row, name: e.target.value })} /></label>
            <label className="field"><span>Đơn vị tính</span><input list="cat-units" value={row.unit} onChange={e => setRow({ ...row, unit: e.target.value })} /></label>
            <label className="field"><span>Loại</span><select value={row.kind} onChange={e => setRow({ ...row, kind: e.target.value as MKind })}>{(Object.keys(MKIND) as MKind[]).map(k => <option key={k} value={k}>{MKIND[k]}</option>)}</select></label>
          </>}
          <label className="field"><span>Số lượng / {BASIS[n.basis]}</span><input value={row.qty} onChange={e => setRow({ ...row, qty: e.target.value })} inputMode="decimal" /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Ghi chú</span><input value={row.note} onChange={e => setRow({ ...row, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Thêm</button> <button type="button" onClick={() => setRow(null)}>Đóng</button></div>
        </form>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Vật tư / công cụ</th><th>Loại</th><th>Số lượng / {BASIS[n.basis]}</th><th>Đơn vị</th><th>Ghi chú</th>{editable && <th></th>}</tr></thead>
        <tbody>{items.map(i => (
          <tr key={i.id}><td><b>{i.name}</b>{i.reusable && <small className="sub"> · dùng lại</small>}</td><td>{MKIND[i.kind]}</td>
            <td>{editable ? <input key={`${i.id}-${i.qty}`} defaultValue={String(i.qty)} style={{ width: 80 }} aria-label={`Số lượng ${i.name}`} onBlur={e => updQty(i, e.target.value)} /> : num(i.qty)}</td>
            <td>{i.unit}</td><td><small>{i.note}</small></td>
            {editable && <td><button className="danger" onClick={() => delRow(i)}>Xoá</button></td>}</tr>
        ))}
        {items.length === 0 && <tr><td colSpan={6}><small className="sub">Chưa có vật tư nào.</small></td></tr>}</tbody>
      </table></div>

      {propose && <ProposeForm n={n} items={items} cat={cat} onDone={m => { setPropose(false); say(m) }} onError={m => say(m, true)} />}

      <Estimate n={n} orgId={orgId} isSchool={rights.isSchool} />

      {family.length > 1 && (
        <>
          <h3>Phiên bản</h3>
          <div className="wrap"><table>
            <thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Ban hành</th><th>Ghi chú</th><th></th></tr></thead>
            <tbody>{family.map(f => (
              <tr key={f.id}><td>v{f.version_no}{f.id === n.id && <small className="sub"> (đang xem)</small>}</td><td><Pill s={f.status} /></td><td>{fmtD(f.published_at)}</td>
                <td><small>{f.note}</small></td><td>{f.id !== n.id && <button onClick={() => onOpen(f.id)}>Mở</button>}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </Drawer>
  )
}

// Dự trù vật tư cho lớp / số học sinh, so với tồn kho của trường
function Estimate({ n, orgId, isSchool }: { n: Norm; orgId: string | null; isSchool: boolean }) {
  const [classes, setClasses] = useState<Klass[]>([])
  const [f, setF] = useState({ cls: '', students: '', groups: '', products: '', sessions: '' })
  const [rows, setRows] = useState<Est[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!isSchool || !orgId) return
    supabase.from('classes').select('id, name, grade').eq('org_id', orgId).order('grade').order('name').then(({ data }) => setClasses((data as Klass[]) ?? []))
  }, [orgId, isSchool])
  const opt = (s: string) => (s.trim() === '' ? null : Math.max(0, Math.round(toNum(s))))
  async function run(e: React.FormEvent) {
    e.preventDefault(); setErr('')
    if (!f.cls && !f.students) return setErr('Chọn lớp hoặc nhập số học sinh.')
    const { data, error } = await supabase.rpc('material_norm_estimate', {
      p_norm: n.id, p_class: f.cls || null, p_students: opt(f.students), p_groups: opt(f.groups), p_products: opt(f.products), p_sessions: opt(f.sessions),
    })
    if (error) return setErr(errText(error.message))
    setRows((data as Est[]) ?? [])
  }
  const list = rows ?? []
  const cost = list.reduce((s, r) => s + Number(r.cost ?? 0), 0)
  const short = list.filter(r => Number(r.shortage) > 0)
  const clsName = classes.find(c => c.id === f.cls)?.name
  function exportX() {
    downloadXlsx(`Du-tru ${n.title}${clsName ? ' ' + clsName : ''}`, [
      { key: 'n', label: 'Vật tư / công cụ', width: 32 }, { key: 'k', label: 'Loại' }, { key: 'p', label: 'Định mức' }, { key: 'm', label: 'Nhân' },
      { key: 'need', label: 'Cần' }, { key: 'u', label: 'Đơn vị' }, { key: 's', label: 'Tồn kho' }, { key: 'sh', label: 'Thiếu' },
      { key: 'up', label: 'Đơn giá' }, { key: 'c', label: 'Thành tiền' },
    ], list.map(r => [r.name, MKIND[r.kind], Number(r.per_qty), r.multiplier, Number(r.need), r.unit, r.stock == null ? '' : Number(r.stock), Number(r.shortage),
      r.unit_price == null ? '' : Number(r.unit_price), r.cost == null ? '' : Math.round(Number(r.cost))]))
  }
  return (
    <>
      <h3>Dự trù vật tư</h3>
      <form className="panel formgrid" onSubmit={run}>
        {isSchool && <label className="field"><span>Lớp</span><select value={f.cls} onChange={e => setF({ ...f, cls: e.target.value })} aria-label="Lớp dự trù">
          <option value="">— nhập số học sinh —</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
        <label className="field"><span>Số học sinh{f.cls ? ' (bỏ trống = sĩ số lớp)' : ''}</span><input value={f.students} onChange={e => setF({ ...f, students: e.target.value })} inputMode="numeric" /></label>
        {n.basis !== 'student' && <label className="field"><span>Số nhóm (bỏ trống = tự chia {n.group_size} HS/nhóm)</span><input value={f.groups} onChange={e => setF({ ...f, groups: e.target.value })} inputMode="numeric" /></label>}
        {n.basis === 'product' && <label className="field"><span>Số sản phẩm (bỏ trống = số nhóm)</span><input value={f.products} onChange={e => setF({ ...f, products: e.target.value })} inputMode="numeric" /></label>}
        <label className="field"><span>Số buổi (mặc định {n.sessions})</span><input value={f.sessions} onChange={e => setF({ ...f, sessions: e.target.value })} inputMode="numeric" /></label>
        <div className="formactions"><button className="primary" type="submit">Tính dự trù</button></div>
      </form>
      {err && <p className="msg">{err}</p>}
      {rows && (
        <>
          <Tiles items={[
            { label: 'Số loại vật tư', value: list.length },
            { label: 'Còn thiếu so với kho', value: short.length, tone: short.length ? 'warn' : 'good', sub: isSchool ? 'theo tồn kho của trường' : 'chỉ trường có tồn kho' },
            { label: 'Kinh phí ước tính', value: money(cost), sub: 'theo đơn giá trong danh mục' },
          ]} />
          <div className="bar small"><small className="sub">Vật tư tiêu hao nhân theo số buổi; công cụ, thiết bị dùng lại không nhân.</small>{list.length > 0 && <button onClick={exportX}>Xuất Excel</button>}</div>
          <div className="wrap"><table>
            <thead><tr><th>Vật tư / công cụ</th><th>Định mức</th><th>× Nhân</th><th>Cần</th><th>Tồn kho</th><th>Thiếu</th><th>Thành tiền</th></tr></thead>
            <tbody>{list.map(r => (
              <tr key={r.item_id}><td><b>{r.name}</b><br /><small className="sub">{MKIND[r.kind]}{r.reusable ? ' · dùng lại' : ''}</small></td>
                <td>{num(r.per_qty)} {r.unit}</td><td>{r.multiplier}</td><td><b>{num(r.need)}</b> {r.unit}</td>
                <td>{r.stock == null ? <small className="sub">Chưa có trong kho</small> : num(r.stock)}</td>
                <td>{Number(r.shortage) > 0 ? <span className="gpill warn">{num(r.shortage)}</span> : '—'}</td><td>{money(r.cost)}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </>
  )
}

// Đề xuất điều chỉnh một định mức dùng chung
function ProposeForm({ n, items, cat, onDone, onError }: { n: Norm; items: NItem[]; cat: Cat[]; onDone: (m: string) => void; onError: (m: string) => void }) {
  const [qty, setQty] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [extra, setExtra] = useState<{ catalog_id: string; name: string; unit: string; qty: string; note: string }[]>([])
  const [reason, setReason] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const out: PItem[] = []
    items.forEach(i => {
      const v = qty[i.id]
      if (v === undefined || v.trim() === '' || toNum(v) === Number(i.qty)) return
      out.push({ item_id: i.id, catalog_id: i.catalog_id, name: i.name, unit: i.unit, qty: Math.max(0, toNum(v)), note: notes[i.id] || undefined })
    })
    extra.forEach(x => {
      const c = cat.find(c => c.id === x.catalog_id)
      if (!(toNum(x.qty) > 0) || (!c && !x.name.trim())) return
      out.push({ item_id: null, catalog_id: c?.id ?? null, name: c?.name ?? x.name.trim(), unit: c?.unit ?? (x.unit.trim() || 'cái'), qty: toNum(x.qty), note: x.note || undefined })
    })
    if (!out.length) return onError('Chưa có dòng nào thay đổi.')
    if (!reason.trim()) return onError('Nhập lý do đề xuất.')
    const { error } = await supabase.from('material_norm_proposals').insert({ norm_id: n.id, reason: reason.trim(), items: out })
    if (error) return onError(errText(error.message))
    onDone('Đã gửi đề xuất điều chỉnh tới đơn vị ban hành.')
  }
  return (
    <form className="panel" onSubmit={submit} style={{ margin: '12px 0' }}>
      <h3 style={{ marginTop: 0 }}>Đề xuất điều chỉnh định mức</h3>
      <p className="sub">Nhập số lượng mới cho dòng cần đổi (0 = bỏ dòng), hoặc thêm vật tư. Đơn vị ban hành chấp nhận sẽ tạo phiên bản mới.</p>
      <div className="wrap"><table>
        <thead><tr><th>Vật tư</th><th>Hiện tại</th><th>Đề xuất</th><th>Ghi chú</th></tr></thead>
        <tbody>{items.map(i => (
          <tr key={i.id}><td>{i.name}</td><td>{num(i.qty)} {i.unit}</td>
            <td><input value={qty[i.id] ?? ''} onChange={e => setQty({ ...qty, [i.id]: e.target.value })} placeholder={String(Number(i.qty))} style={{ width: 80 }} aria-label={`Số lượng đề xuất ${i.name}`} /></td>
            <td><input value={notes[i.id] ?? ''} onChange={e => setNotes({ ...notes, [i.id]: e.target.value })} aria-label={`Ghi chú ${i.name}`} /></td></tr>
        ))}
        {extra.map((x, k) => (
          <tr key={'x' + k}>
            <td><select value={x.catalog_id} onChange={e => setExtra(extra.map((y, j) => j === k ? { ...y, catalog_id: e.target.value } : y))} aria-label="Vật tư thêm">
              <option value="">— nhập tên —</option>{cat.map(c => <option key={c.id} value={c.id}>{c.name} ({c.unit})</option>)}</select>
              {!x.catalog_id && <><input value={x.name} placeholder="Tên vật tư" onChange={e => setExtra(extra.map((y, j) => j === k ? { ...y, name: e.target.value } : y))} />
                <input list="cat-units" value={x.unit} placeholder="Đơn vị" style={{ width: 70 }} onChange={e => setExtra(extra.map((y, j) => j === k ? { ...y, unit: e.target.value } : y))} /></>}</td>
            <td>—</td>
            <td><input value={x.qty} style={{ width: 80 }} onChange={e => setExtra(extra.map((y, j) => j === k ? { ...y, qty: e.target.value } : y))} aria-label="Số lượng" /></td>
            <td><input value={x.note} onChange={e => setExtra(extra.map((y, j) => j === k ? { ...y, note: e.target.value } : y))} aria-label="Ghi chú" /></td></tr>
        ))}</tbody>
      </table></div>
      <button type="button" className="linkbtn" onClick={() => setExtra([...extra, { catalog_id: '', name: '', unit: 'cái', qty: '1', note: '' }])}>+ Thêm vật tư</button>
      <label className="field"><span>Lý do *</span><textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="formactions"><button className="primary" type="submit">Gửi đề xuất</button></div>
    </form>
  )
}

// ================= Danh mục vật tư, công cụ, thiết bị =================
const CAT_COLS: Column[] = [
  { key: 'code', label: 'Mã', width: 12 }, { key: 'name', label: 'Tên', required: true, width: 32, aliases: ['tên vật tư'] },
  { key: 'kind', label: 'Loại', aliases: ['phân loại'] }, { key: 'unit', label: 'Đơn vị tính', aliases: ['đvt', 'đơn vị'] },
  { key: 'spec', label: 'Quy cách', width: 30, aliases: ['thông số'] }, { key: 'price', label: 'Đơn giá', aliases: ['giá'] },
]
const kindFrom = (s: string): MKind => { const t = norm(s); return /thiet bi|equip/.test(t) ? 'equipment' : /cong cu|dung cu|tool/.test(t) ? 'tool' : 'supply' }

function CatalogTab({ orgId, rights }: { orgId: string | null; rights: Rights }) {
  const [list, setList] = useState<Cat[] | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [kind, setKind] = useState(''); const [src, setSrc] = useState(''); const [q, setQ] = useState('')
  const [form, setForm] = useState<Partial<Cat> & { price?: string } | null>(null)
  async function load() {
    let r = await supabase.from('material_catalog').select('*, owner_name, organizations(name)').order('kind').order('name')
    if (r.error && /relationship/i.test(r.error.message)) r = await supabase.from('material_catalog').select('*').order('kind').order('name')
    if (r.error) setMsg([errText(r.error.message), true])
    setList((r.data as Cat[]) ?? [])
  }
  useEffect(() => { load() }, [orgId])
  const all = list ?? []
  const srcName = (c: Cat) => (c.org_id === orgId ? 'Đơn vị mình' : c.owner_name ?? c.organizations?.name ?? 'KDI / cấp trên')
  const sources = [...new Set(all.map(srcName))]
  const shown = all.filter(c => (!kind || c.kind === kind) && (!src || srcName(c) === src) && (!q || norm([c.name, c.code, c.spec].join(' ')).includes(norm(q))))
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form || !orgId) return
    const row = {
      code: form.code?.trim() || null, name: (form.name ?? '').trim(), kind: form.kind ?? 'supply', unit: form.unit?.trim() || 'cái',
      spec: form.spec?.trim() || null, unit_price: form.price ? Math.round(toNum(form.price)) || null : null,
      reusable: form.reusable ?? (form.kind ?? 'supply') !== 'supply', active: form.active ?? true, note: form.note?.trim() || null,
      ...(rights.isSchool ? { scope: 'own' } : { scope: form.scope ?? 'children' }),
    }
    if (!row.name) return setMsg(['Nhập tên vật tư.', true])
    const r = form.id ? await supabase.from('material_catalog').update(row).eq('id', form.id) : await supabase.from('material_catalog').insert({ ...row, org_id: orgId })
    if (r.error) return setMsg([/duplicate|unique/i.test(r.error.message) ? 'Mã vật tư đã có trong danh mục.' : errText(r.error.message), true])
    setForm(null); setMsg(['Đã lưu.', false]); load()
  }
  async function remove(c: Cat) {
    if (!confirm(`Xoá "${c.name}" khỏi danh mục? Định mức đang dùng vẫn giữ tên vật tư.`)) return
    const { error } = await supabase.from('material_catalog').delete().eq('id', c.id)
    if (error) setMsg([errText(error.message), true]); else load()
  }
  async function importRows(rows: (Record<string, string> & { _line: number })[]) {
    let ok = 0; const bad: string[] = []
    for (const r of rows) {
      const kind = kindFrom(r.kind ?? '')
      const { error } = await supabase.from('material_catalog').insert({
        org_id: orgId, code: r.code?.trim() || null, name: r.name.trim(), kind, unit: r.unit?.trim() || 'cái', spec: r.spec?.trim() || null,
        unit_price: r.price ? Math.round(toNum(r.price)) || null : null, reusable: kind !== 'supply', scope: rights.isSchool ? 'own' : 'children',
      })
      if (error) bad.push(`Dòng ${r._line}: ${/duplicate|unique/i.test(error.message) ? 'trùng mã' : errText(error.message)}`); else ok++
    }
    load(); return importSummary(ok, 'vật tư', bad)
  }
  return (
    <>
      <p className="sub">Danh mục chuẩn để lập định mức. Danh mục của KDI và cấp trên dùng chung cho đơn vị trực thuộc. Khi dự trù, vật tư trong kho của trường được ghép với danh mục theo mã liên kết, mã vật tư trùng mã danh mục hoặc trùng tên để so tồn kho.</p>
      <div className="bar small">
        <input className="search" placeholder="Tìm vật tư…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm vật tư" />
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Loại vật tư"><option value="">Mọi loại</option>{(Object.keys(MKIND) as MKind[]).map(k => <option key={k} value={k}>{MKIND[k]}</option>)}</select>
        <select value={src} onChange={e => setSrc(e.target.value)} aria-label="Nguồn"><option value="">Mọi nguồn</option>{sources.map(s => <option key={s}>{s}</option>)}</select>
        <button onClick={() => downloadXlsx('Danh-muc-vat-tu', CAT_COLS, shown.map(c => [c.code ?? '', c.name, MKIND[c.kind], c.unit, c.spec ?? '', c.unit_price ?? '']))}>Xuất Excel</button>
        {rights.canWrite && <ImportExcel columns={CAT_COLS} template="Mau-danh-muc-vat-tu" sample={[['PIN-AA', 'Pin AA', 'Vật tư tiêu hao', 'viên', '1,5 V', '6000']]}
          onRecords={importRows} onMessage={(m, e) => setMsg([m, !!e])} />}
        {rights.canWrite && <button className="primary" onClick={() => setForm({ kind: 'supply', unit: 'cái', scope: 'children' })}>Thêm vật tư</button>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}>{msg[0]}</p>}
      {form && (
        <form className="panel formgrid" onSubmit={save} style={{ marginBottom: 12 }}>
          <label className="field"><span>Mã</span><input value={form.code ?? ''} onChange={e => setForm({ ...form, code: e.target.value })} /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Tên *</span><input required value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Loại</span><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as MKind, reusable: e.target.value !== 'supply' })}>{(Object.keys(MKIND) as MKind[]).map(k => <option key={k} value={k}>{MKIND[k]}</option>)}</select></label>
          <label className="field"><span>Đơn vị tính</span><input list="cat-units" value={form.unit ?? ''} onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
          <label className="field"><span>Đơn giá (đ)</span><input value={form.price ?? (form.unit_price != null ? String(form.unit_price) : '')} onChange={e => setForm({ ...form, price: e.target.value })} inputMode="numeric" /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Quy cách / thông số</span><input value={form.spec ?? ''} onChange={e => setForm({ ...form, spec: e.target.value })} /></label>
          <label className="field"><span>Dùng lại được</span><select value={(form.reusable ?? form.kind !== 'supply') ? '1' : '0'} onChange={e => setForm({ ...form, reusable: e.target.value === '1' })}><option value="1">Có (không nhân theo buổi)</option><option value="0">Không</option></select></label>
          {!rights.isSchool && <label className="field"><span>Phạm vi</span><select value={form.scope ?? 'children'} onChange={e => setForm({ ...form, scope: e.target.value as Cat['scope'] })}><option value="children">Dùng chung cho đơn vị trực thuộc</option><option value="own">Chỉ đơn vị mình</option></select></label>}
          {form.id && <label className="field"><span>Trạng thái</span><select value={form.active === false ? '0' : '1'} onChange={e => setForm({ ...form, active: e.target.value === '1' })}><option value="1">Đang dùng</option><option value="0">Ngừng dùng</option></select></label>}
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {!list ? <p className="sub">Đang tải…</p> : (
        <div className="wrap"><table>
          <thead><tr><th>Mã</th><th>Tên</th><th>Loại</th><th>Đơn vị</th><th>Quy cách</th><th>Đơn giá</th><th>Nguồn</th><th></th></tr></thead>
          <tbody>{shown.map(c => (
            <tr key={c.id} style={c.active ? undefined : { opacity: 0.55 }}><td><small>{c.code}</small></td><td><b>{c.name}</b>{c.reusable && <small className="sub"> · dùng lại</small>}{!c.active && <small className="sub"> · ngừng dùng</small>}</td>
              <td>{MKIND[c.kind]}</td><td>{c.unit}</td><td><small>{c.spec}</small></td><td>{c.unit_price != null ? money(c.unit_price) : '—'}</td><td><small>{srcName(c)}</small></td>
              <td className="actions">{c.org_id === orgId && rights.canWrite && <><button onClick={() => setForm({ ...c, price: c.unit_price != null ? String(c.unit_price) : '' })}>Sửa</button><button className="danger" onClick={() => remove(c)}>Xoá</button></>}</td></tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={8}><small className="sub">Chưa có vật tư nào.</small></td></tr>}</tbody>
        </table></div>
      )}
    </>
  )
}

// ================= Đề xuất điều chỉnh =================
function ProposalsTab({ orgId, rights, onOpenNorm }: { orgId: string | null; rights: Rights; onOpenNorm: (id: string) => void }) {
  const [list, setList] = useState<Proposal[] | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const { data: { user } } = await supabase.auth.getUser(); setMe(user?.id ?? null)
    let r = await supabase.from('material_norm_proposals').select('*, material_norms!material_norm_proposals_norm_id_fkey(title, version_no, org_id), organizations(name), profiles!material_norm_proposals_proposed_by_fkey(full_name)').order('created_at', { ascending: false })
    if (r.error && /relationship|schema cache/i.test(r.error.message)) r = await supabase.from('material_norm_proposals').select('*, material_norms!material_norm_proposals_norm_id_fkey(title, version_no, org_id)').order('created_at', { ascending: false })
    if (r.error) setMsg([errText(r.error.message), true])
    setList((r.data as Proposal[]) ?? [])
  }
  useEffect(() => { load() }, [orgId])
  const all = list ?? []
  const received = all.filter(p => p.material_norms?.org_id === orgId)
  const sent = all.filter(p => p.org_id === orgId && p.material_norms?.org_id !== orgId)
  async function decide(p: Proposal, accept: boolean) {
    const response = prompt(accept ? 'Ghi chú khi chấp nhận (sẽ tạo phiên bản nháp mới đã áp đề xuất):' : 'Lý do từ chối:', '')
    if (response === null) return
    const { data, error } = await supabase.rpc('material_norm_decide', { p_proposal: p.id, p_accept: accept, p_response: response, p_apply: true })
    if (error) return setMsg([errText(error.message), true])
    setMsg([accept ? 'Đã chấp nhận — đã tạo phiên bản nháp mới, kiểm tra rồi ban hành.' : 'Đã từ chối đề xuất.', false])
    if (accept && data) return onOpenNorm(data as string)
    load()
  }
  async function withdraw(p: Proposal) {
    if (!confirm('Rút lại đề xuất này?')) return
    const { error } = await supabase.from('material_norm_proposals').update({ status: 'withdrawn' }).eq('id', p.id)
    if (error) setMsg([errText(error.message), true]); else load()
  }
  const lines = (p: Proposal) => p.items.map((x, k) => <div key={k}><small>{x.name}: {Number(x.qty) === 0 ? <b>bỏ</b> : <b>{num(x.qty)} {x.unit}</b>}{x.item_id || x.catalog_id ? '' : ' (thêm mới)'}{x.note ? ` — ${x.note}` : ''}</small></div>)
  const table = (rows: Proposal[], incoming: boolean) => (
    <div className="wrap"><table>
      <thead><tr><th>Định mức</th>{incoming && <th>Đơn vị đề xuất</th>}<th>Điều chỉnh</th><th>Lý do</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>{rows.map(p => (
        <tr key={p.id}>
          <td><button className="linkbtn" onClick={() => onOpenNorm(p.norm_id)}>{p.material_norms?.title ?? 'Định mức'} v{p.material_norms?.version_no}</button><br /><small className="sub">{fmtD(p.created_at)}</small></td>
          {incoming && <td>{p.organizations?.name ?? '—'}{p.profiles?.full_name ? <><br /><small className="sub">{p.profiles.full_name}</small></> : null}</td>}
          <td>{lines(p)}</td><td><small>{p.reason}</small>{p.response && <><br /><small className="sub">Phản hồi: {p.response}</small></>}</td>
          <td><span className={'gpill ' + PSTAT[p.status][1]}>{PSTAT[p.status][0]}</span></td>
          <td className="actions">
            {incoming && p.status === 'pending' && rights.canWrite && <><button className="primary" onClick={() => decide(p, true)}>Chấp nhận</button><button onClick={() => decide(p, false)}>Từ chối</button></>}
            {!incoming && p.status === 'pending' && p.proposed_by === me && <button onClick={() => withdraw(p)}>Rút lại</button>}
            {p.new_norm_id && <button onClick={() => onOpenNorm(p.new_norm_id!)}>Xem phiên bản mới</button>}
          </td>
        </tr>
      ))}
      {rows.length === 0 && <tr><td colSpan={6}><small className="sub">Chưa có đề xuất nào.</small></td></tr>}</tbody>
    </table></div>
  )
  return (
    <>
      <p className="sub">Trường / giáo viên đề xuất điều chỉnh định mức dùng chung (mở định mức → “Đề xuất điều chỉnh”). Đơn vị ban hành chấp nhận thì hệ thống tạo phiên bản nháp mới đã áp số lượng đề xuất.</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {!list ? <p className="sub">Đang tải…</p> : <>
        {(!rights.isSchool || received.length > 0) && <><h3>Đề xuất gửi tới đơn vị ({received.filter(p => p.status === 'pending').length} chờ xử lý)</h3>{table(received, true)}</>}
        <h3>Đề xuất đơn vị đã gửi ({sent.length})</h3>
        {table(sent, false)}
      </>}
    </>
  )
}

export default MaterialNorms
