// Học liệu theo chương trình (Phân hệ 2): chương trình → học phần → bài, mỗi bài một bộ học liệu 4 thẻ (bài học trong kho, 065/077).
// Cần chuẩn bị theo chương trình: tự tổng hợp vật tư / công cụ / thiết bị từ định mức của các bài × số nhóm.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { LibraryManage, type UnitStart } from './Manage'
import { KIT, kitDone, StatusChip, type Item, type KitCard } from './common'

type Prog = { id: string; title: string; version_no: number; status: string; org_id: string; ct_code: string | null; grade_from: number | null; grade_to: number | null }
type U = { id: string; program_id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; title: string; periods: number; objectives: string | null; grade: number | null }
type Kit = Pick<Item, 'id' | 'title' | 'status' | 'version' | 'owner_org_id' | 'content'> & { program_id: string | null; unit_id: string | null }

const PSTATUS: Record<string, string> = { draft: 'Nháp', pending: 'Nháp · chờ duyệt', approved: 'Nháp · đã duyệt', rejected: 'Nháp · bị trả lại', published: 'Đã phát hành' }
const grades = (p: Prog) => p.grade_from ? (p.grade_to && p.grade_to !== p.grade_from ? `Khối ${p.grade_from}–${p.grade_to}` : `Khối ${p.grade_from}`) : ''

// Chương trình đã phát hành + chương trình nháp của đơn vị mình
function usePrograms(orgId: string | null) {
  const [progs, setProgs] = useState<Prog[]>([])
  useEffect(() => {
    supabase.from('edu_programs').select('id, title, version_no, status, org_id, ct_code, grade_from, grade_to')
      .in('status', ['published', 'draft', 'pending', 'approved', 'rejected']).order('title')
      .then(({ data }) => setProgs(((data as Prog[]) ?? []).filter(p => p.status === 'published' || p.org_id === orgId)))
  }, [orgId])
  return progs
}

// Bài của chương trình theo cây: [học phần, các bài của học phần]; bài không thuộc học phần nào đứng ở nhóm cuối
function lessonTree(units: U[]): [U | null, U[]][] {
  const kids = (id: string | null) => units.filter(u => u.parent_id === id).sort((a, b) => a.seq - b.seq)
  const out: [U | null, U[]][] = []
  const walk = (t: U) => {
    const ls = kids(t.id).filter(u => u.unit_type === 'lesson')
    if (ls.length) out.push([t, ls])
    kids(t.id).filter(u => u.unit_type === 'topic').forEach(walk)
  }
  kids(null).filter(u => u.unit_type === 'topic').forEach(walk)
  const loose = kids(null).filter(u => u.unit_type === 'lesson')
  if (loose.length) out.push([null, loose])
  return out
}

function KitPill({ k }: { k: Kit | undefined }) {
  if (!k) return <span className="gpill"><i aria-hidden="true">·</i>Bài chờ</span>
  const n = kitDone(k.content)
  return <span className={'gpill ' + (n === 4 ? 'good' : 'warn')}><i aria-hidden="true">{n === 4 ? '✓' : n}</i>{n}/4 thẻ đã chốt</span>
}

export function LibraryByProgram({ orgId }: { orgId: string | null }) {
  const progs = usePrograms(orgId)
  const [units, setUnits] = useState<U[]>([])
  const [kits, setKits] = useState<Kit[]>([])
  const [pid, setPid] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [view, setView] = useViewMode('hoc-lieu-ct', 'cards')
  const [start, setStart] = useState<UnitStart | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!orgId) return
    supabase.from('library_items').select('id, title, status, version, owner_org_id, content, program_id, unit_id').eq('kind', 'unit').eq('owner_org_id', orgId)
      .then(({ data }) => setKits((data as Kit[]) ?? []))
  }, [orgId, tick])
  useEffect(() => {
    const ids = progs.map(p => p.id)
    if (!ids.length) return
    supabase.from('edu_program_units').select('id, program_id, parent_id, unit_type, seq, title, periods, objectives, grade').in('program_id', ids).in('unit_type', ['topic', 'lesson'])
      .then(({ data }) => setUnits((data as U[]) ?? []))
  }, [progs])

  const kitOf = useMemo(() => {
    const m = new Map<string, Kit>()
    // Ưu tiên bộ đã phát hành, rồi bộ cập nhật gần nhất
    kits.forEach(k => { if (k.unit_id && (!m.has(k.unit_id) || (k.status === 'published' && m.get(k.unit_id)!.status !== 'published'))) m.set(k.unit_id, k) })
    return m
  }, [kits])
  const lessonsOf = (id: string) => units.filter(u => u.program_id === id && u.unit_type === 'lesson')
  const stat = (id: string) => {
    const ls = lessonsOf(id); const ks = ls.map(l => kitOf.get(l.id)).filter(Boolean) as Kit[]
    return { lessons: ls.length, kits: ks.length, done: ks.filter(k => kitDone(k.content) === 4).length, published: ks.filter(k => k.status === 'published').length }
  }

  if (!orgId) return <p className="sub">Đang tải…</p>
  const editor = start && <LibraryManage key={start.editId ?? start.preset?.unit_id} orgId={orgId} only="unit" start={start} onDone={() => { setStart(null); setTick(t => t + 1) }} />
  const prog = progs.find(p => p.id === pid)

  if (prog) {
    const s = stat(prog.id)
    const open = (l: U) => {
      const k = kitOf.get(l.id)
      setStart(k ? { editId: k.id } : { preset: { program_id: prog.id, unit_id: l.id, title: l.title, periods: l.periods || null, objectives: l.objectives, program: prog.ct_code, grades: l.grade ? String(l.grade) : prog.grade_from && prog.grade_from === prog.grade_to ? String(prog.grade_from) : null } })
    }
    return (
      <>
        <nav className="crumbs" aria-label="Vị trí"><button type="button" className="linkbtn" onClick={() => setPid(null)}>← Danh sách chương trình</button> <span className="sub">/ {prog.title}</span></nav>
        <div className="bar">
          <div><h3 style={{ margin: 0 }}>{prog.title} <small className="sub">v{prog.version_no} · {PSTATUS[prog.status] ?? prog.status}</small></h3>
            <p className="sub" style={{ margin: '4px 0 0' }}>{s.lessons} bài · {s.kits} bộ học liệu · {s.done} bộ chốt đủ 4 thẻ · {s.published} bộ đã phát hành</p></div>
        </div>
        {s.lessons === 0 && <p className="sub">Chương trình chưa có bài học. Thêm bài ở Chương trình giáo dục → tab Nội dung.</p>}
        {s.lessons > 0 && <div className="wrap"><table className="libtable">
          <thead><tr><th>Bài</th><th>Số tiết</th>{KIT.map(([k, l]) => <th key={k}>{l.slice(3)}</th>)}<th>Bộ học liệu</th><th>Trạng thái</th><th aria-label="Tác vụ" /></tr></thead>
          <tbody>
            {lessonTree(units.filter(u => u.program_id === prog.id)).map(([t, ls]) => <Fragment key={t?.id ?? 'loose'}>
              <tr className="grouprow"><th colSpan={9}>{t ? t.title : 'Bài chưa thuộc học phần'}</th></tr>
              {ls.map(l => {
                const k = kitOf.get(l.id); const ck: KitCard[] = k?.content.checked ?? []
                return <tr key={l.id} className="rowlink" tabIndex={0} onClick={() => open(l)} onKeyDown={e => { if (e.key === 'Enter') open(l) }}>
                  <td><b>{l.title}</b>{k && k.title !== l.title && <div className="sub" style={{ fontSize: 12 }}>{k.title}</div>}</td>
                  <td>{l.periods || '—'}</td>
                  {KIT.map(([c]) => <td key={c} style={{ textAlign: 'center' }}>{k ? (ck.includes(c) ? <span title="Đã chốt" aria-label="Đã chốt">✓</span> : <small className="sub" title="Cần kiểm tra">cần kiểm tra</small>) : <small className="sub">—</small>}</td>)}
                  <td><KitPill k={k} /></td>
                  <td>{k ? <StatusChip s={k.status} /> : <small className="sub">Chưa có</small>}</td>
                  <td style={{ textAlign: 'right' }}><button type="button" className={k ? '' : 'primary'} onClick={e => { e.stopPropagation(); open(l) }}>{k ? 'Mở' : 'Tạo bộ học liệu'}</button></td>
                </tr>
              })}
            </Fragment>)}
          </tbody>
        </table></div>}
        {editor}
      </>
    )
  }

  const shown = progs.filter(p => !q || p.title.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <p className="sub">Quy trình: <b>1</b> tạo bộ học liệu 4 thẻ cho từng bài (bước nhập duy nhất) → <b>2</b> Cần chuẩn bị tự tổng hợp từ định mức → <b>3</b> Danh mục học liệu để tra cứu, phát hành.</p>
      <div className="bar">
        <div className="tools"><input placeholder="Tìm chương trình…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chương trình" /></div>
        <div className="tools"><ViewToggle value={view} onChange={setView} /></div>
      </div>
      {shown.length === 0 && <p className="sub">{progs.length ? 'Không có chương trình nào khớp.' : 'Chưa có chương trình nào. Tạo và phát hành chương trình ở Chương trình giáo dục.'}</p>}
      {view === 'cards' ? <div className="tilegrid sq">
        {shown.map(p => { const s = stat(p.id); return (
          <button key={p.id} type="button" className="tile" onClick={() => setPid(p.id)}>
            <div className="tilebody">
              <b>{p.title}</b>
              <small>{[p.ct_code, grades(p), `v${p.version_no}`, PSTATUS[p.status] ?? p.status].filter(Boolean).join(' · ')}</small>
              <div className="tilemeta"><span>{s.lessons} bài</span><span>{s.kits} bộ học liệu</span><span>{s.done} chốt đủ</span></div>
            </div>
          </button>) })}
      </div> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Chương trình</th><th>Nhóm</th><th>Khối</th><th>Bài</th><th>Bộ học liệu</th><th>Chốt đủ 4 thẻ</th><th>Đã phát hành</th></tr></thead>
        <tbody>{shown.map(p => { const s = stat(p.id); return (
          <tr key={p.id} className="rowlink" tabIndex={0} onClick={() => setPid(p.id)} onKeyDown={e => { if (e.key === 'Enter') setPid(p.id) }}>
            <td><b>{p.title}</b> <small className="sub">v{p.version_no} · {PSTATUS[p.status] ?? p.status}</small></td><td>{p.ct_code ?? '—'}</td><td>{grades(p) || '—'}</td>
            <td>{s.lessons}</td><td>{s.kits}/{s.lessons}</td><td>{s.done}</td><td>{s.published}</td>
          </tr>) })}</tbody>
      </table></div>}
    </>
  )
}

// ===== Cần chuẩn bị theo chương trình =====
type NItem = { name: string; unit: string; kind: 'supply' | 'tool' | 'equipment'; qty: number; reusable: boolean }
type Norm = { id: string; family_id: string; status: string; version_no: number; basis: 'product' | 'group' | 'student'; group_size: number; sessions: number
  unit_id: string | null; library_item_id: string | null; program_id: string | null; material_norm_items: NItem[] }
const MKIND: Record<NItem['kind'], string> = { supply: 'Vật tư tiêu hao', tool: 'Công cụ', equipment: 'Thiết bị' }
type Need = { key: string; name: string; unit: string; kind: NItem['kind']; reusable: boolean; total: number; uses: { lesson: string; qty: number }[] }

export function LibraryNeeds({ orgId }: { orgId: string | null }) {
  const progs = usePrograms(orgId)
  const [pid, setPid] = useState('')
  const [groups, setGroups] = useState(6)
  const [units, setUnits] = useState<U[]>([])
  const [norms, setNorms] = useState<Norm[]>([])
  const [kitUnit, setKitUnit] = useState<Map<string, string>>(new Map())
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (!pid && progs.length) setPid((progs.find(p => p.status === 'published') ?? progs[0]).id) }, [progs, pid])
  useEffect(() => {
    if (!pid) return
    setLoading(true)
    ;(async () => {
      const [u, k] = await Promise.all([
        supabase.from('edu_program_units').select('id, program_id, parent_id, unit_type, seq, title, periods, objectives, grade').eq('program_id', pid),
        supabase.from('library_items').select('id, unit_id').eq('kind', 'unit').eq('program_id', pid),
      ])
      const ks = ((k.data as { id: string; unit_id: string | null }[]) ?? [])
      const sel = 'id, family_id, status, version_no, basis, group_size, sessions, unit_id, library_item_id, program_id, material_norm_items(name, unit, kind, qty, reusable)'
      const [a, b] = await Promise.all([
        supabase.from('material_norms').select(sel).eq('program_id', pid).in('status', ['published', 'draft']),
        ks.length ? supabase.from('material_norms').select(sel).in('library_item_id', ks.map(x => x.id)).in('status', ['published', 'draft']) : Promise.resolve({ data: [] }),
      ])
      // Mỗi định mức lấy một bản: bản đã ban hành, chưa có thì bản nháp
      const all = [...((a.data as unknown as Norm[]) ?? []), ...((b.data as unknown as Norm[]) ?? [])]
      const best = new Map<string, Norm>()
      all.forEach(n => { const cur = best.get(n.family_id); if (!cur || (n.status === 'published' && cur.status !== 'published')) best.set(n.family_id, n) })
      setUnits((u.data as U[]) ?? []); setNorms([...best.values()])
      setKitUnit(new Map(ks.filter(x => x.unit_id).map(x => [x.id, x.unit_id!])))
      setLoading(false)
    })()
  }, [pid])

  const needs = useMemo(() => {
    const m = new Map<string, Need>()
    norms.forEach(n => {
      const uid = n.unit_id ?? (n.library_item_id ? kitUnit.get(n.library_item_id) : undefined)
      const lesson = units.find(u => u.id === uid)?.title ?? 'Cả chương trình'
      const per = n.basis === 'student' ? groups * n.group_size : groups
      n.material_norm_items.forEach(i => {
        const qty = i.qty * per * (i.reusable ? 1 : n.sessions)
        const key = `${i.name.trim().toLowerCase()}|${i.unit}|${i.kind}`
        const x = m.get(key) ?? { key, name: i.name.trim(), unit: i.unit, kind: i.kind, reusable: i.reusable, total: 0, uses: [] }
        x.uses.push({ lesson, qty })
        // Đồ dùng lại được (công cụ, thiết bị) dùng chung giữa các bài: lấy mức cần nhiều nhất; vật tư tiêu hao cộng dồn
        x.total = i.reusable ? Math.max(x.total, qty) : x.total + qty
        m.set(key, x)
      })
    })
    return [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'vi'))
  }, [norms, units, kitUnit, groups])
  const fmt = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')

  return (
    <>
      <div className="bar">
        <div className="tools">
          <select value={pid} onChange={e => { setPid(e.target.value); setOpen(null) }} aria-label="Chương trình">
            {progs.map(p => <option key={p.id} value={p.id}>{p.title} (v{p.version_no}){p.status !== 'published' ? ' · nháp' : ''}</option>)}</select>
          <label className="tools">Số nhóm <input type="number" min={1} max={200} value={groups} onChange={e => setGroups(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} style={{ width: 80 }} aria-label="Số nhóm" /></label>
        </div>
      </div>
      <p className="sub">Tự tổng hợp từ định mức vật tư của các bài (thẻ 04): định mức × số nhóm (định mức theo học sinh thì × số học sinh mỗi nhóm), vật tư tiêu hao nhân thêm số buổi. Công cụ, thiết bị dùng lại được lấy mức cần nhiều nhất giữa các bài.</p>
      {loading ? <p className="sub">Đang tải…</p> : needs.length === 0 ? <p className="sub">{pid ? 'Các bài của chương trình chưa có định mức vật tư. Nhập ở thẻ 04 của bộ học liệu.' : 'Chọn chương trình.'}</p> : (
        <div className="wrap"><table className="libtable">
          <thead><tr><th>Tên</th><th>Loại</th><th>Đơn vị</th><th>Dùng ở</th><th style={{ textAlign: 'right' }}>Cần chuẩn bị</th></tr></thead>
          <tbody>{needs.map(x => <Fragment key={x.key}>
            <tr className={'rowlink' + (open === x.key ? ' on' : '')} tabIndex={0} onClick={() => setOpen(open === x.key ? null : x.key)} onKeyDown={e => { if (e.key === 'Enter') setOpen(open === x.key ? null : x.key) }}>
              <td><b>{x.name}</b>{x.reusable && <small className="sub"> · dùng lại</small>}</td><td>{MKIND[x.kind]}</td><td>{x.unit}</td>
              <td>{new Set(x.uses.map(u => u.lesson)).size} bài</td><td style={{ textAlign: 'right' }}><b>{fmt(x.total)}</b></td>
            </tr>
            {open === x.key && x.uses.map((u, k) => <tr key={k} className="subrow"><td colSpan={4} style={{ paddingLeft: 28 }}><small>{u.lesson}</small></td><td style={{ textAlign: 'right' }}><small>{fmt(u.qty)}</small></td></tr>)}
          </Fragment>)}</tbody>
        </table></div>
      )}
    </>
  )
}
