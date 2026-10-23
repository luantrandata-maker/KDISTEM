// Học liệu theo chương trình (Phân hệ 2, theo video demo 23/10): chương trình → môn học → bài học → trang bài học 4 thẻ.
// Bài học là bộ học liệu (library_items kind 'unit', 077/080): bài trong cây chương trình hoặc bài tạo thêm bằng "Tạo giáo án".
// Cần chuẩn bị theo chương trình: tự tổng hợp vật tư / công cụ / thiết bị từ định mức của các bài × số nhóm.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { useRowSel, SelTh, SelTd, SelBar, NameLink } from '../../components/TableSel'
import { KIT, kitDone } from './common'
import { kitOf } from './lesson/model'
import { KIT_SEL, errMsg, type KitRow } from './lesson/save'
import { CreateLesson, kitSubject } from './lesson/Create'
import { LessonPage, useColsLocal } from './lesson/LessonPage'

type Prog = { id: string; title: string; version_no: number; status: string; org_id: string; ct_code: string | null; code: string | null
  grade_from: number | null; grade_to: number | null; main_subject: string | null }
type U = { id: string; program_id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; title: string; periods: number
  objectives: string | null; grade: number | null; subject?: string | null }

const PSTATUS: Record<string, string> = { draft: 'Nháp', pending: 'Nháp · chờ duyệt', approved: 'Nháp · đã duyệt', rejected: 'Nháp · bị trả lại', published: 'Đã phát hành' }
const KSTATUS: Record<KitRow['status'], [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], archived: ['Đã thu hồi', 'off'] }
const grades = (p: Prog) => p.grade_from ? (p.grade_to && p.grade_to !== p.grade_from ? `Khối ${p.grade_from}–${p.grade_to}` : `Khối ${p.grade_from}`) : ''
const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const progName = (p: Prog) => (p.code ? p.code + ' · ' : '') + p.title

// Chương trình đã phát hành + chương trình nháp của đơn vị mình
export function usePrograms(orgId: string | null) {
  const [progs, setProgs] = useState<Prog[]>([])
  useEffect(() => {
    supabase.from('edu_programs').select('id, title, version_no, status, org_id, ct_code, code, grade_from, grade_to, main_subject')
      .in('status', ['published', 'draft', 'pending', 'approved', 'rejected']).order('title')
      .then(({ data }) => setProgs(((data as Prog[]) ?? []).filter(p => p.status === 'published' || p.org_id === orgId)))
  }, [orgId])
  return progs
}

/** Bài của chương trình theo thứ tự cây, kèm môn trong chương trình (môn của học phần gần nhất, không có thì môn chủ đạo) */
function lessonsWithSubject(units: U[], p: Prog): (U & { subj: string })[] {
  const mine = units.filter(u => u.program_id === p.id)
  const kids = (id: string | null) => mine.filter(u => u.parent_id === id).sort((a, b) => a.seq - b.seq)
  const out: (U & { subj: string })[] = []
  const walk = (id: string | null, s: string | null) => kids(id).forEach(u => {
    const us = u.subject?.trim() || s
    if (u.unit_type === 'lesson') out.push({ ...u, subj: us || p.main_subject || 'Chưa có môn' })
    else if (u.unit_type === 'topic') walk(u.id, us)
  })
  walk(null, null)
  return out
}

function KitDots({ k }: { k: KitRow | undefined }) {
  if (!k) return <small className="sub">Chưa có bộ học liệu</small>
  const ck = k.content.checked ?? []
  return <span className="ldots" title={KIT.map(([c, l]) => `${l}: ${ck.includes(c) ? 'đã chốt' : 'cần kiểm tra'}`).join('\n')}>
    {KIT.map(([c]) => <i key={c} className={ck.includes(c) ? 'on' : ''} />)} {kitDone(k.content)}/4 thẻ đã chốt</span>
}

type LRow = { key: string; title: string; unit?: U & { subj: string }; kit?: KitRow; code: string }

export function LibraryByProgram({ orgId, onChanged }: { orgId: string | null; onChanged?: () => void }) {
  const progs = usePrograms(orgId)
  const [units, setUnits] = useState<U[]>([])
  const [kits, setKits] = useState<KitRow[]>([])
  const [pid, setPid] = useState<string | null>(null)
  const [subj, setSubj] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string; edit?: boolean } | null>(null)
  const [create, setCreate] = useState<{ preset?: { title: string; unitId: string } } | null>(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [view, setView] = useViewMode('hoc-lieu-ct', 'cards')
  const [tick, setTick] = useState(0)
  const reload = () => { setTick(t => t + 1); onChanged?.() }

  useEffect(() => {
    if (!orgId) return
    supabase.from('library_items').select(KIT_SEL).eq('kind', 'unit').eq('owner_org_id', orgId).order('created_at')
      .then(({ data }) => setKits((data as KitRow[]) ?? []))
  }, [orgId, tick])
  useEffect(() => {
    const ids = progs.map(p => p.id)
    if (!ids.length) return
    const sel = 'id, program_id, parent_id, unit_type, seq, title, periods, objectives, grade'
    supabase.from('edu_program_units').select(sel + ', subject').in('program_id', ids).in('unit_type', ['topic', 'lesson'])
      .then(async r => {
        // CSDL chưa có cột môn của học phần: đọc không có môn
        const x = r.error ? await supabase.from('edu_program_units').select(sel).in('program_id', ids).in('unit_type', ['topic', 'lesson']) : r
        setUnits((x.data as unknown as U[]) ?? [])
      })
  }, [progs])

  const kitOfUnit = useMemo(() => {
    const m = new Map<string, KitRow>()
    kits.forEach(k => { if (k.unit_id && (!m.has(k.unit_id) || (k.status === 'published' && m.get(k.unit_id)!.status !== 'published'))) m.set(k.unit_id, k) })
    return m
  }, [kits])
  const lessonsBy = useMemo(() => new Map(progs.map(p => [p.id, lessonsWithSubject(units, p)])), [progs, units])
  /** Các bài của một môn trong chương trình: bài trong cây chương trình (kèm bộ nếu có) + bộ tạo thêm không gắn bài */
  const rowsOf = (p: Prog, s: string): LRow[] => {
    const ls = lessonsBy.get(p.id) ?? []
    const ids = new Set(ls.map(l => l.id))
    const a: Omit<LRow, 'code'>[] = ls.filter(l => lc(l.subj) === lc(s)).map(l => ({ key: l.id, title: kitOfUnit.get(l.id)?.title ?? l.title, unit: l, kit: kitOfUnit.get(l.id) }))
    const b = kits.filter(k => k.program_id === p.id && !(k.unit_id && ids.has(k.unit_id)) && lc(kitSubject(k) || p.main_subject) === lc(s))
      .map(k => ({ key: k.id, title: k.title, kit: k }))
    return [...a, ...b].map((r, i) => ({ ...r, code: 'BH-' + String(i + 1).padStart(3, '0') }))
  }
  const subjectsOf = (id: string): string[] => {
    const p = progs.find(x => x.id === id); if (!p) return []
    const ls = lessonsBy.get(id) ?? []; const ids = new Set(ls.map(l => l.id))
    const names = [...ls.map(l => l.subj), ...kits.filter(k => k.program_id === id && !(k.unit_id && ids.has(k.unit_id))).map(k => kitSubject(k) || p.main_subject || '')]
    const out: string[] = []
    for (const n of names) if (n.trim() && !out.some(o => lc(o) === lc(n))) out.push(n.trim())
    return out.length ? out : [p.main_subject || 'Chưa có môn']
  }
  const stat = (p: Prog) => {
    const rows = subjectsOf(p.id).flatMap(s => rowsOf(p, s)); const ks = rows.map(r => r.kit).filter(Boolean) as KitRow[]
    return { lessons: rows.length, kits: ks.length, done: ks.filter(k => kitDone(k.content) === 4).length, published: ks.filter(k => k.status === 'published').length }
  }
  const progRefs = progs.map(p => ({ id: p.id, code: p.code, title: p.title, ct_code: p.ct_code }))

  if (!orgId) return <p className="sub">Đang tải…</p>
  const prog = progs.find(p => p.id === pid)
  const crumbs = <nav className="crumbs lcrumbs" aria-label="Vị trí">
    <button type="button" className="linkbtn" onClick={() => { setPid(null); setSubj(null); setOpen(null) }}>Học liệu theo chương trình</button>
    {prog && <button type="button" className="linkbtn" onClick={() => { setSubj(null); setOpen(null) }}>{progName(prog)}</button>}
    {prog && subj && <button type="button" className="linkbtn" onClick={() => setOpen(null)}>{subj}</button>}
    {open && <span className="sub">› {kits.find(k => k.id === open.id)?.title}</span>}
  </nav>

  // ----- Trang bài học -----
  if (prog && subj && open) {
    const r = rowsOf(prog, subj).find(x => x.kit?.id === open.id)
    return <>{crumbs}
      <LessonPage key={open.id} orgId={orgId} id={open.id} programs={progRefs} subjectsOf={subjectsOf} code={r?.code ?? ''} startEdit={open.edit}
        onBack={() => setOpen(null)} onChanged={reload} /></>
  }

  // ----- Danh sách bài học của một môn -----
  if (prog && subj) return <>{crumbs}
    <LessonList key={prog.id + subj} prog={prog} subj={subj} rows={rowsOf(prog, subj)} msg={msg}
      onBack={() => { setSubj(null); setMsg('') }} onOpen={(id, edit) => { setMsg(''); setOpen({ id, edit }) }} onCreate={preset => setCreate({ preset })}
      onDeleted={m => { setMsg(m); reload() }} />
    {create && <CreateLesson orgId={orgId} programs={progRefs} subjectsOf={subjectsOf} program={progRefs.find(p => p.id === prog.id)!} subject={subj}
      preset={create.preset} kits={kits} onClose={() => setCreate(null)}
      onCreated={(id, m) => { setCreate(null); setMsg(m); reload(); setOpen({ id }) }} />}
  </>

  // ----- Danh sách môn của chương trình -----
  if (prog) {
    const subs = subjectsOf(prog.id)
    return <>{crumbs}
      <button type="button" className="ghostbtn" onClick={() => setPid(null)}>← Danh sách chương trình</button>
      <div className="lheadrow"><div><h2>{prog.title}</h2>
        <p className="sub">{[prog.code, grades(prog), `v${prog.version_no}`, PSTATUS[prog.status] ?? prog.status, `${subs.length} môn học`].filter(Boolean).join(' · ')}</p></div></div>
      <div className="panel"><h3 style={{ marginTop: 0 }}>Môn học</h3>
        <div className="wrap"><table className="libtable">
          <thead><tr><th>Môn học</th><th>Bài học</th><th>Có bộ học liệu</th><th>Chốt đủ 4 thẻ</th><th>Đã phát hành</th></tr></thead>
          <tbody>{subs.map(s => {
            const rows = rowsOf(prog, s); const ks = rows.map(r => r.kit).filter(Boolean) as KitRow[]
            return <tr key={s}>
              <td><NameLink onClick={() => setSubj(s)}>{s}</NameLink></td><td>{rows.length}</td><td>{ks.length}</td>
              <td>{ks.filter(k => kitDone(k.content) === 4).length}</td><td>{ks.filter(k => k.status === 'published').length}</td></tr>
          })}</tbody></table></div></div>
    </>
  }

  // ----- Danh sách chương trình -----
  const shown = progs.filter(p => !q || progName(p).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="bar">
        <div className="tools"><input placeholder="Tìm chương trình…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chương trình" /></div>
        <div className="tools"><ViewToggle value={view} onChange={setView} /></div>
      </div>
      {shown.length === 0 && <p className="sub">{progs.length ? 'Không có chương trình nào khớp.' : 'Chưa có chương trình nào. Tạo và phát hành chương trình ở Chương trình giáo dục.'}</p>}
      {view === 'cards' ? <div className="tilegrid sq">
        {shown.map(p => { const s = stat(p); return (
          <button key={p.id} type="button" className="tile" onClick={() => setPid(p.id)}>
            <div className="tilebody">
              <b>{p.title}</b>
              <small>{[p.code ?? p.ct_code, grades(p), `v${p.version_no}`, PSTATUS[p.status] ?? p.status].filter(Boolean).join(' · ')}</small>
              <div className="tilemeta"><span>{subjectsOf(p.id).length} môn</span><span>{s.lessons} bài</span><span>{s.kits} bộ học liệu</span></div>
            </div>
          </button>) })}
      </div> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Chương trình</th><th>Nhóm</th><th>Khối</th><th>Môn</th><th>Bài</th><th>Bộ học liệu</th><th>Chốt đủ 4 thẻ</th><th>Đã phát hành</th></tr></thead>
        <tbody>{shown.map(p => { const s = stat(p); return (
          <tr key={p.id}>
            <td><NameLink onClick={() => setPid(p.id)}>{progName(p)}</NameLink> <small className="sub">v{p.version_no} · {PSTATUS[p.status] ?? p.status}</small></td><td>{p.ct_code ?? '—'}</td><td>{grades(p) || '—'}</td>
            <td>{subjectsOf(p.id).length}</td><td>{s.lessons}</td><td>{s.kits}/{s.lessons}</td><td>{s.done}</td><td>{s.published}</td>
          </tr>) })}</tbody>
      </table></div>}
    </>
  )
}

function LessonList({ prog, subj, rows, msg, onBack, onOpen, onCreate, onDeleted }: {
  prog: Prog; subj: string; rows: LRow[]; msg: string
  onBack: () => void; onOpen: (kitId: string, edit?: boolean) => void; onCreate: (preset?: { title: string; unitId: string }) => void; onDeleted: (m: string) => void
}) {
  const sel = useRowSel(rows, r => r.key)
  const { has, menu } = useColsLocal('lib.lessons.cols', [['dur', 'Thời lượng'], ['kit', 'Bộ học liệu'], ['status', 'Trạng thái']])
  const withKit = rows.filter(r => r.kit).length
  const go = (r: LRow, edit?: boolean) => (r.kit ? onOpen(r.kit.id, edit) : onCreate({ title: r.unit!.title, unitId: r.unit!.id }))
  async function remove(r: LRow) {
    if (!r.kit || !confirm(`Xóa bộ học liệu “${r.kit.title}”? Giáo án, bài giảng, học liệu đã tạo trong danh mục vẫn giữ nguyên.`)) return
    const { error } = await supabase.from('library_items').delete().eq('id', r.kit.id)
    if (error) alert(errMsg(error.message)); else { sel.clear(); onDeleted(`Đã xóa “${r.kit.title}”.`) }
  }
  return <>
    <button type="button" className="ghostbtn" onClick={onBack}>← Danh sách môn học</button>
    <div className="lheadrow">
      <div><h2>{subj}</h2><p className="sub">{progName(prog)} · {withKit} bài đã có bộ học liệu</p></div>
      <button type="button" className="primary" onClick={() => onCreate()}>+ Tạo giáo án</button>
    </div>
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    <div className="panel">
      <SelBar picked={sel.cur?.title ?? null} left={<h3 style={{ margin: 0 }}>Bài học</h3>}>
        <small className="sub">Tick chọn dòng để thao tác</small>
        <button type="button" disabled={!sel.cur} onClick={() => sel.cur && go(sel.cur, true)}>Sửa</button>
        <button type="button" disabled={!sel.cur?.kit} onClick={() => sel.cur && remove(sel.cur)}>Xóa</button>
        {menu}
      </SelBar>
      {rows.length === 0 ? <p className="sub">Môn này chưa có bài học. Bấm “+ Tạo giáo án” để tạo bài đầu tiên.</p>
        : <div className="wrap"><table className="libtable">
          <thead><tr><SelTh /><th>Bài học</th>{has('dur') && <th>Thời lượng</th>}{has('kit') && <th>Bộ học liệu</th>}{has('status') && <th>Trạng thái</th>}</tr></thead>
          <tbody>{rows.map(r => {
            const k = kitOf(r.kit?.content.kit); const per = r.kit?.content.periods ?? r.unit?.periods
            const src = k.source.docx ?? k.source.pptx ?? k.source.xlsx
            return <tr key={r.key} className={sel.is(r) ? 'picked' : ''}>
              <SelTd on={sel.is(r)} onToggle={() => sel.toggle(r)} label={r.title} />
              <td><NameLink onClick={() => go(r)}>{r.title}</NameLink><br /><small className="sub">{[r.code, src].filter(Boolean).join(' · ')}</small></td>
              {has('dur') && <td>{per ? `${per} tiết` : '—'}{r.kit && k.sessions.length > 0 && <><br /><small className="sub">{k.sessions.length} buổi</small></>}</td>}
              {has('kit') && <td><KitDots k={r.kit} /></td>}
              {has('status') && <td>{r.kit ? <span className={'distchip2 ' + KSTATUS[r.kit.status][1]}>{KSTATUS[r.kit.status][0]}</span> : <small className="sub">Chưa tạo</small>}</td>}
            </tr>
          })}</tbody></table></div>}
    </div>
  </>
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
