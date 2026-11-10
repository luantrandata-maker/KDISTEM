// Học liệu theo chương trình (Phân hệ 2, theo video demo 23/10): chương trình → môn học → bài học → trang bài học 5 thẻ.
// Bài học là bộ học liệu (library_items kind 'unit', 077/080): bài trong cây chương trình hoặc bài tạo thêm bằng "Tạo giáo án".
// Cần chuẩn bị theo chương trình hoặc theo trường: tự tổng hợp vật tư / công cụ / thiết bị từ định mức của các bài × số nhóm.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { SchoolPicker } from '../../components/SchoolPicker'
import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { NameLink } from '../../components/TableSel'
import { KIT, kitDone } from './common'
import { kitOf } from './lesson/model'
import { KIT_SEL, errMsg, type KitRow } from './lesson/save'
import { CreateLesson, kitSubject } from './lesson/Create'
import { LessonPage } from './lesson/LessonPage'
import { fmtGrades, progGrades } from '../../lib/eduLevels'
import { useGradeTree, MultiTag } from '../../components/GradeTree'
import { DataTable } from '../../components/DataTable'
import { downloadXlsx } from '../../lib/sheet'

type Prog = { id: string; title: string; version_no: number; status: string; org_id: string; ct_code: string | null; code: string | null
  grade_from: number | null; grade_to: number | null; grades?: number[] | null; main_subject: string | null }
type U = { id: string; program_id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; title: string; periods: number
  objectives: string | null; grade: number | null; subject?: string | null }

const PSTATUS: Record<string, string> = { draft: 'Nháp', pending: 'Nháp · chờ duyệt', approved: 'Nháp · đã duyệt', rejected: 'Nháp · bị trả lại', published: 'Đã phát hành' }
const KSTATUS: Record<KitRow['status'], [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], archived: ['Đã thu hồi', 'off'], inactive: ['Ngừng dùng', 'off'] }
const grades = (p: Prog) => fmtGrades(progGrades(p))
const lc = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const progName = (p: Prog) => (p.code ? p.code + ' · ' : '') + p.title

// Chương trình đã phát hành + chương trình nháp của đơn vị mình
export function usePrograms(orgId: string | null) { return useProgramList(orgId) ?? [] }
/** null khi đang tải */
function useProgramList(orgId: string | null) {
  const [progs, setProgs] = useState<Prog[] | null>(null)
  useEffect(() => {
    supabase.from('edu_programs').select('id, title, version_no, status, org_id, ct_code, code, grade_from, grade_to, grades, main_subject')
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
    {KIT.map(([c]) => <i key={c} className={ck.includes(c) ? 'on' : ''} />)} {kitDone(k.content)}/{KIT.length} thẻ đã chốt</span>
}

type LRow = { key: string; title: string; unit?: U & { subj: string }; kit?: KitRow; code: string }

/** Dữ liệu chung của trang Học liệu: chương trình, bài trong cây chương trình, bộ học liệu (bài học) của đơn vị */
export function useLessonData(orgId: string | null, tick: number) {
  const list = useProgramList(orgId)
  const progs = useMemo(() => list ?? [], [list])
  const [units, setUnits] = useState<U[]>([])
  const [kits, setKits] = useState<KitRow[]>([])

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
    return { lessons: rows.length, kits: ks.length, done: ks.filter(k => kitDone(k.content) === KIT.length).length, published: ks.filter(k => k.status === 'published').length }
  }
  const progRefs = progs.map(p => ({ id: p.id, code: p.code, title: p.title, ct_code: p.ct_code }))
  return { loaded: list !== null, progs, kits, rowsOf, subjectsOf, stat, progRefs }
}


export function LibraryByProgram({ orgId, onChanged }: { orgId: string | null; onChanged?: () => void }) {
  const [pid, setPid] = useState<string | null>(null)
  const [subj, setSubj] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string; edit?: boolean } | null>(null)
  const [create, setCreate] = useState<{ subject: string; preset?: { title: string; unitId: string } } | null>(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [view, setView] = useViewMode('hoc-lieu-ct', 'cards')
  const [tick, setTick] = useState(0)
  const [closed, setClosed] = useState<string[]>([])   // môn đang thu gọn
  const reload = () => { setTick(t => t + 1); onChanged?.() }
  const { progs, kits, rowsOf, subjectsOf, stat, progRefs } = useLessonData(orgId, tick)
  const found = progs.filter(p => !q || progName(p).toLowerCase().includes(q.toLowerCase()))
  const gt = useGradeTree('hoc-lieu-ct', found, progGrades)

  // Xóa bộ học liệu của một bài (không xóa bài trong chương trình); quyền do CSDL kiểm tra
  async function removeKit(k: KitRow) {
    if (!confirm(`Xóa bộ học liệu “${k.title}”? Giáo án, bài giảng, học liệu đã tạo trong danh mục vẫn giữ nguyên.`)) return
    const { data, error } = await supabase.from('library_items').delete().eq('id', k.id).select('id')
    if (error) setMsg(errMsg(error.message))
    else if (!data?.length) setMsg('Bạn không có quyền xóa bộ học liệu này.')
    else { setMsg(`Đã xóa “${k.title}”.`); reload() }
  }
  if (!orgId) return <p className="sub">Đang tải…</p>
  const prog = progs.find(p => p.id === pid)
  const crumbs = <nav className="crumbs lcrumbs" aria-label="Vị trí">
    <button type="button" className="linkbtn" onClick={() => { setPid(null); setSubj(null); setOpen(null) }}>Học liệu theo chương trình</button>
    {prog && <button type="button" className="linkbtn" onClick={() => { setSubj(null); setOpen(null) }}>{progName(prog)}</button>}
    {prog && subj && open && <span className="sub">› {subj}</span>}
    {open && <span className="sub">› {kits.find(k => k.id === open.id)?.title}</span>}
  </nav>

  // ----- Trang bài học -----
  if (prog && subj && open) {
    const r = rowsOf(prog, subj).find(x => x.kit?.id === open.id)
    return <>{crumbs}
      <LessonPage key={open.id} orgId={orgId} id={open.id} programs={progRefs} subjectsOf={subjectsOf} code={r?.code ?? ''} startEdit={open.edit}
        onBack={() => { setOpen(null); setSubj(null) }} onChanged={reload} /></>
  }

  // ----- Danh sách môn của chương trình -----
  if (prog) {
    const subs = subjectsOf(prog.id)
    return <>{crumbs}
      <button type="button" className="ghostbtn" onClick={() => setPid(null)}>← Danh sách chương trình</button>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      {create && <CreateLesson orgId={orgId} programs={progRefs} subjectsOf={subjectsOf} program={progRefs.find(p => p.id === prog.id)!} subject={create.subject}
        preset={create.preset} kits={kits} onClose={() => setCreate(null)}
        onCreated={(id, m) => { const sj = create.subject; setCreate(null); setMsg(m); reload(); setSubj(sj); setOpen({ id }) }} />}
      <div className="lheadrow"><div><h2>{prog.title}</h2>
        <p className="sub">{[prog.code, grades(prog), `v${prog.version_no}`, PSTATUS[prog.status] ?? prog.status, `${subs.length} môn học`].filter(Boolean).join(' · ')}</p></div></div>
      {subs.map(s => {
        const rows = rowsOf(prog, s); const ks = rows.map(r => r.kit).filter(Boolean) as KitRow[]
        const isOpen = !closed.includes(s)
        const go = (r: LRow, edit?: boolean) => { setMsg(''); if (r.kit) { setSubj(s); setOpen({ id: r.kit.id, edit }) } else if (r.unit) setCreate({ subject: s, preset: { title: r.unit.title, unitId: r.unit.id } }) }
        return <div key={s} className="ugroup" style={{ marginBottom: 12 }}>
          <div className="ughead" role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => setClosed(isOpen ? [...closed, s] : closed.filter(x => x !== s))}
            onKeyDown={e => { if (e.key === 'Enter') setClosed(isOpen ? [...closed, s] : closed.filter(x => x !== s)) }}>
            <span className={'ugchev' + (isOpen ? ' on' : '')} aria-hidden="true">›</span><small>MÔN</small> <b>{s}</b>
            <small className="sub">{rows.length} bài · {ks.length} bộ học liệu · {ks.filter(k => kitDone(k.content) === KIT.length).length} chốt đủ 5 thẻ</small>
            <span className="ugbadge">Đã phát hành {ks.filter(k => k.status === 'published').length}/{rows.length}</span>
            <button type="button" onClick={e => { e.stopPropagation(); setMsg(''); setCreate({ subject: s }) }}>+ Tạo bài học</button>
          </div>
          {isOpen && (rows.length === 0 ? <p className="sub" style={{ padding: '10px 16px', margin: 0 }}>Môn này chưa có bài học.</p> : <div className="wrap"><table className="libtable utable">
            <thead><tr><th style={{ width: 40 }}>#</th><th>Bài học</th><th>Thời lượng</th><th>Bộ học liệu</th><th>Trạng thái</th><th></th></tr></thead>
            <tbody>{rows.map((r, i) => {
              const k = kitOf(r.kit?.content.kit); const per = r.kit?.content.periods ?? r.unit?.periods
              return <tr key={r.key}>
                <td className="sub">{i + 1}</td>
                <td><NameLink onClick={() => go(r)}>{r.title}</NameLink>{r.code && <><br /><small className="sub">{r.code}</small></>}</td>
                <td>{per ? `${per} tiết` : '—'}{r.kit && k.sessions.length > 0 && <><br /><small className="sub">{k.sessions.length} buổi</small></>}</td>
                <td><KitDots k={r.kit} /></td>
                <td>{r.kit ? <span className={'distchip2 ' + KSTATUS[r.kit.status][1]}>{KSTATUS[r.kit.status][0]}</span> : <small className="sub">Chưa tạo</small>}</td>
                <td><span className="tools" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                  {r.kit ? <><button type="button" onClick={() => go(r, true)}>Sửa nội dung</button>
                    <button type="button" className="danger" onClick={() => removeKit(r.kit!)}>Xóa</button></>
                    : <button type="button" className="primary" onClick={() => go(r)}>+ Thêm nội dung</button>}</span></td>
              </tr>
            })}</tbody></table></div>)}
        </div>
      })}
    </>
  }

  // ----- Danh sách chương trình (cây Cấp → Khối bên trái) -----
  const shown = gt.filter(found)
  const search = <input placeholder="Tìm chương trình…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chương trình" />
  const toggle = <ViewToggle value={view} onChange={setView} />
  const empty = <small className="sub">{progs.length ? 'Không có chương trình nào khớp.' : 'Chưa có chương trình nào. Tạo và phát hành chương trình ở Chương trình giáo dục.'}</small>
  return view === 'cards' ? <>
    <div className="tttools"><div className="ttleft">{search}</div>{toggle}</div>
    {!found.length ? <p className="sub">{empty}</p> : <div className="ttbody"><div className="ttaside">{gt.tree}</div><div className="gtcards"><div className="tilegrid sq">
      {shown.map(p => { const s = stat(p); return (
        <button key={p.id} type="button" className="tile" onClick={() => setPid(p.id)}>
          <div className="tilebody">
            <b>{p.title}</b>
            <small>{[p.code ?? p.ct_code, grades(p), `v${p.version_no}`, PSTATUS[p.status] ?? p.status].filter(Boolean).join(' · ')}</small>
            <MultiTag grades={progGrades(p)} />
            <div className="tilemeta"><span>{subjectsOf(p.id).length} môn</span><span>{s.lessons} bài</span><span>{s.kits} bộ học liệu</span></div>
          </div>
        </button>) })}
    </div></div></div>}
  </> : <DataTable id="hoc-lieu-ct" rows={shown} rowKey={p => p.id} left={search} right={toggle} empty={empty} aside={found.length ? gt.tree : undefined}
    cols={[
      { key: 'name', label: 'Chương trình', fixed: true, values: p => [progName(p)], text: p => progName(p),
        cell: p => <><NameLink onClick={() => setPid(p.id)}>{progName(p)}</NameLink> <small className="sub">v{p.version_no} · {PSTATUS[p.status] ?? p.status}</small></> },
      { key: 'ct', label: 'Nhóm', text: p => p.ct_code ?? '', cell: p => p.ct_code ?? '—' },
      { key: 'grade', label: 'Khối', text: p => grades(p), cell: p => <>{grades(p) || '—'}<br /><MultiTag grades={progGrades(p)} /></> },
      { key: 'subj', label: 'Môn', cell: p => subjectsOf(p.id).length },
      { key: 'lessons', label: 'Bài', cell: p => stat(p).lessons },
      { key: 'kits', label: 'Bộ học liệu', cell: p => `${stat(p).kits}/${stat(p).lessons}` },
      { key: 'done', label: 'Chốt đủ 5 thẻ', cell: p => stat(p).done },
      { key: 'pub', label: 'Đã phát hành', cell: p => stat(p).published },
    ]} />
}

// ===== Cần chuẩn bị theo chương trình / theo trường =====
type NItem = { name: string; unit: string; kind: 'supply' | 'tool' | 'equipment'; qty: number; reusable: boolean }
type Norm = { id: string; family_id: string; status: string; version_no: number; basis: 'product' | 'group' | 'student'; group_size: number; sessions: number
  unit_id: string | null; library_item_id: string | null; program_id: string | null; material_norm_items: NItem[] }
const MKIND: Record<NItem['kind'], string> = { supply: 'Vật tư tiêu hao', tool: 'Công cụ', equipment: 'Thiết bị' }
type Need = { key: string; name: string; unit: string; kind: NItem['kind']; reusable: boolean; total: number; uses: { lesson: string; qty: number }[] }
type NormData = { units: U[]; norms: (Norm & { uid?: string })[] }
const fmtN = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')

/** Định mức vật tư của các bài thuộc các chương trình: mỗi định mức lấy một bản (đã ban hành, chưa có thì bản nháp), kèm bài gắn với định mức */
async function loadNorms(pids: string[]): Promise<NormData> {
  if (!pids.length) return { units: [], norms: [] }
  const [u, k] = await Promise.all([
    supabase.from('edu_program_units').select('id, program_id, parent_id, unit_type, seq, title, periods, objectives, grade').in('program_id', pids),
    supabase.from('library_items').select('id, unit_id').eq('kind', 'unit').in('program_id', pids),
  ])
  const ks = ((k.data as { id: string; unit_id: string | null }[]) ?? [])
  const kitUnit = new Map(ks.filter(x => x.unit_id).map(x => [x.id, x.unit_id!]))
  const sel = 'id, family_id, status, version_no, basis, group_size, sessions, unit_id, library_item_id, program_id, material_norm_items(name, unit, kind, qty, reusable)'
  const [a, b] = await Promise.all([
    supabase.from('material_norms').select(sel).in('program_id', pids).in('status', ['published', 'draft']),
    ks.length ? supabase.from('material_norms').select(sel).in('library_item_id', ks.map(x => x.id)).in('status', ['published', 'draft']) : Promise.resolve({ data: [] }),
  ])
  const all = [...((a.data as unknown as Norm[]) ?? []), ...((b.data as unknown as Norm[]) ?? [])]
  const best = new Map<string, Norm>()
  all.forEach(n => { const cur = best.get(n.family_id); if (!cur || (n.status === 'published' && cur.status !== 'published')) best.set(n.family_id, n) })
  return { units: (u.data as U[]) ?? [], norms: [...best.values()].map(n => ({ ...n, uid: n.unit_id ?? (n.library_item_id ? kitUnit.get(n.library_item_id) : undefined) })) }
}

/** Cộng một dòng định mức vào bảng cần chuẩn bị. Đồ dùng lại: lấy mức cần nhiều nhất giữa các bài; vật tư tiêu hao: cộng dồn */
function addNeed(m: Map<string, Need>, i: NItem, lesson: string, qty: number) {
  const key = `${i.name.trim().toLowerCase()}|${i.unit}|${i.kind}`
  const x = m.get(key) ?? { key, name: i.name.trim(), unit: i.unit, kind: i.kind, reusable: i.reusable, total: 0, uses: [] }
  x.uses.push({ lesson, qty })
  x.total = i.reusable ? Math.max(x.total, qty) : x.total + qty
  m.set(key, x)
}
const sortNeeds = (m: Map<string, Need>) => [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'vi'))

function NeedsTable({ needs }: { needs: Need[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return <div className="wrap"><table className="libtable">
    <thead><tr><th>Tên</th><th>Loại</th><th>Đơn vị</th><th>Dùng ở</th><th style={{ textAlign: 'right' }}>Cần chuẩn bị</th></tr></thead>
    <tbody>{needs.map(x => <Fragment key={x.key}>
      <tr className={'rowlink' + (open === x.key ? ' on' : '')} tabIndex={0} onClick={() => setOpen(open === x.key ? null : x.key)} onKeyDown={e => { if (e.key === 'Enter') setOpen(open === x.key ? null : x.key) }}>
        <td><b>{x.name}</b>{x.reusable && <small className="sub"> · dùng lại</small>}</td><td>{MKIND[x.kind]}</td><td>{x.unit}</td>
        <td>{new Set(x.uses.map(u => u.lesson)).size} bài</td><td style={{ textAlign: 'right' }}><b>{fmtN(x.total)}</b></td>
      </tr>
      {open === x.key && x.uses.map((u, k) => <tr key={k} className="subrow"><td colSpan={4} style={{ paddingLeft: 28 }}><small>{u.lesson}</small></td><td style={{ textAlign: 'right' }}><small>{fmtN(u.qty)}</small></td></tr>)}
    </Fragment>)}</tbody>
  </table></div>
}

function exportNeeds(file: string, needs: Need[]) {
  downloadXlsx(file, [{ key: 'n', label: 'Tên', width: 34 }, { key: 'k', label: 'Loại', width: 16 }, { key: 'u', label: 'Đơn vị', width: 10 },
    { key: 'b', label: 'Số bài dùng', width: 12 }, { key: 'q', label: 'Cần chuẩn bị', width: 14 }],
    needs.map(x => [x.name + (x.reusable ? ' (dùng lại)' : ''), MKIND[x.kind], x.unit, new Set(x.uses.map(u => u.lesson)).size, Number(fmtN(x.total))]), 'Cần chuẩn bị')
}

export function LibraryNeeds({ orgId }: { orgId: string | null }) {
  const [mode, setMode] = useState<'prog' | 'school'>('prog')
  return <>
    <div className="distfilter">{([['prog', 'Theo chương trình'], ['school', 'Theo trường']] as const).map(([k, l]) =>
      <button key={k} type="button" className={`distfchip${mode === k ? ' on' : ''}`} onClick={() => setMode(k)}>{l}</button>)}</div>
    {mode === 'prog' ? <NeedsByProgram orgId={orgId} /> : <NeedsBySchool orgId={orgId} />}
  </>
}

function NeedsByProgram({ orgId }: { orgId: string | null }) {
  const progs = usePrograms(orgId)
  const [pid, setPid] = useState('')
  const [groups, setGroups] = useState(6)
  const [d, setD] = useState<NormData>({ units: [], norms: [] })
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (!pid && progs.length) setPid((progs.find(p => p.status === 'published') ?? progs[0]).id) }, [progs, pid])
  useEffect(() => {
    if (!pid) return
    setLoading(true)
    loadNorms([pid]).then(x => { setD(x); setLoading(false) })
  }, [pid])

  const needs = useMemo(() => {
    const m = new Map<string, Need>()
    d.norms.forEach(n => {
      const lesson = d.units.find(u => u.id === n.uid)?.title ?? 'Cả chương trình'
      const per = n.basis === 'student' ? groups * n.group_size : groups
      n.material_norm_items.forEach(i => addNeed(m, i, lesson, i.qty * per * (i.reusable ? 1 : n.sessions)))
    })
    return sortNeeds(m)
  }, [d, groups])
  const p = progs.find(x => x.id === pid)

  return (
    <>
      <div className="bar">
        <div className="tools">
          <select value={pid} onChange={e => setPid(e.target.value)} aria-label="Chương trình">
            {progs.map(p => <option key={p.id} value={p.id}>{p.title} (v{p.version_no}){p.status !== 'published' ? ' · nháp' : ''}</option>)}</select>
          <label className="tools">Số nhóm <input type="number" min={1} max={200} value={groups} onChange={e => setGroups(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} style={{ width: 80 }} aria-label="Số nhóm" /></label>
        </div>
        {needs.length > 0 && <div className="tools"><button type="button" onClick={() => exportNeeds(`Can-chuan-bi-${p?.code ?? 'chuong-trinh'}.xlsx`, needs)}>Xuất Excel</button></div>}
      </div>
      <p className="sub">Tự tổng hợp từ định mức vật tư của các bài (thẻ 04): định mức × số nhóm (định mức theo học sinh thì × số học sinh mỗi nhóm), vật tư tiêu hao nhân thêm số buổi. Công cụ, thiết bị dùng lại được lấy mức cần nhiều nhất giữa các bài.</p>
      {loading ? <p className="sub">Đang tải…</p> : needs.length === 0 ? <p className="sub">{pid ? 'Các bài của chương trình chưa có định mức vật tư. Nhập ở thẻ 04 của bộ học liệu.' : 'Chọn chương trình.'}</p>
        : <NeedsTable key={pid} needs={needs} />}
    </>
  )
}

// Theo trường: chương trình gán cho trường (edu_program_assignments, khối áp dụng) × lớp của năm học hiện tại × sĩ số, số nhóm thật.
// Lớp chưa chia nhóm: số nhóm = sĩ số ÷ số học sinh mỗi nhóm (mặc định 4).
// Đồ dùng lại (công cụ, thiết bị): đủ cho số lớp học cùng lúc (mặc định = số phòng STEM đang dùng), lấy các lớp đông nhất; vật tư tiêu hao cộng cho tất cả lớp, tất cả buổi.
type SProg = Prog & { aGrades: number[] }
type SClass = { id: string; name: string; grade: number; students: number; groups: number }
function NeedsBySchool({ orgId }: { orgId: string | null }) {
  const [schools, setSchools] = useState<{ id: string; name: string }[] | null>(null)
  const [sid, setSid] = useState('')
  const [perGroup, setPerGroup] = useState(4)
  const [conc, setConc] = useState<number | null>(null)
  const [data, setData] = useState<{ progs: SProg[]; classes: SClass[]; rooms: number; year: string | null; norms: NormData } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchAll(() => supabase.from('organizations').select('id, name').eq('type', 'school').order('name').order('id')).then(({ data }) => {
      const xs = (data as { id: string; name: string }[]) ?? []
      setSchools(xs); setSid(s => s || (xs.find(x => x.id === orgId) ?? xs[0])?.id || '')
    })
  }, [orgId])

  useEffect(() => {
    if (!sid) return
    setLoading(true); setConc(null)
    ;(async () => {
      const [as, ys, rs] = await Promise.all([
        supabase.from('edu_program_assignments').select('program_id, grades').eq('org_id', sid),
        supabase.from('academic_years').select('id, name, is_current').eq('org_id', sid),
        supabase.from('stem_rooms').select('id', { count: 'exact', head: true }).eq('org_id', sid).eq('status', 'active'),
      ])
      const asg = (as.data as { program_id: string; grades: number[] | null }[]) ?? []
      const yrs = (ys.data as { id: string; name: string; is_current: boolean | null }[]) ?? []
      const cur = yrs.find(y => y.is_current)?.name ?? null
      const yids = cur ? yrs.filter(y => y.name === cur).map(y => y.id) : []
      const [ps, cs, st, gr] = await Promise.all([
        asg.length ? supabase.from('edu_programs').select('id, title, version_no, status, org_id, ct_code, code, grade_from, grade_to, grades, main_subject').in('id', asg.map(a => a.program_id)) : Promise.resolve({ data: [] }),
        (yids.length ? supabase.from('classes').select('id, name, grade, year_id').eq('org_id', sid).in('year_id', yids) : supabase.from('classes').select('id, name, grade, year_id').eq('org_id', sid)),
        supabase.from('students').select('class_id').eq('org_id', sid).eq('status', 'studying').not('class_id', 'is', null),
        supabase.from('student_groups').select('class_id').eq('org_id', sid),
      ])
      const count = (rows: { class_id: string }[] | null) => { const m = new Map<string, number>(); (rows ?? []).forEach(r => m.set(r.class_id, (m.get(r.class_id) ?? 0) + 1)); return m }
      const nSt = count(st.data as { class_id: string }[]), nGr = count(gr.data as { class_id: string }[])
      const progs = ((ps.data as Prog[]) ?? []).map(p => {
        const a = asg.find(x => x.program_id === p.id)?.grades, pg = progGrades(p)
        return { ...p, aGrades: a?.length ? a.filter(g => !pg.length || pg.includes(g)) : pg }
      }).sort((a, b) => progName(a).localeCompare(progName(b), 'vi'))
      const classes = ((cs.data as { id: string; name: string; grade: number }[]) ?? []).map(c => ({ id: c.id, name: c.name, grade: c.grade, students: nSt.get(c.id) ?? 0, groups: nGr.get(c.id) ?? 0 }))
      const norms = await loadNorms(progs.map(p => p.id))
      setData({ progs, classes, rooms: rs.count ?? 0, year: cur, norms })
      setLoading(false)
    })()
  }, [sid])

  // Số nhóm của lớp: nhóm đã chia, chưa chia thì sĩ số ÷ số học sinh mỗi nhóm
  const groupsOf = (c: SClass) => c.groups || Math.ceil(c.students / perGroup)
  const k = conc ?? Math.max(1, data?.rooms ?? 1)
  const rows = useMemo(() => (data?.progs ?? []).map(p => {
    const cls = (data?.classes ?? []).filter(c => p.aGrades.includes(c.grade))
    return { p, grades: [...new Set(cls.map(c => c.grade))].sort((a, b) => a - b), cls, students: cls.reduce((s, c) => s + c.students, 0), groups: cls.reduce((s, c) => s + groupsOf(c), 0) }
  }), [data, perGroup]) // eslint-disable-line react-hooks/exhaustive-deps

  const needs = useMemo(() => {
    const m = new Map<string, Need>()
    if (!data) return []
    rows.forEach(({ p, cls }) => data.norms.norms.filter(n => {
      const u = data.norms.units.find(x => x.id === n.uid)
      return (u ? u.program_id : n.program_id) === p.id
    }).forEach(n => {
      const u = data.norms.units.find(x => x.id === n.uid)
      const on = u?.grade ? cls.filter(c => c.grade === u.grade) : cls
      if (!on.length) return
      // Mức cần của từng lớp cho định mức này: theo nhóm, hoặc theo học sinh
      const per = on.map(c => n.basis === 'student' ? c.students : groupsOf(c)).sort((a, b) => b - a)
      const all = per.reduce((s, v) => s + v, 0), top = per.slice(0, k).reduce((s, v) => s + v, 0)
      const lesson = `${p.code ?? p.title} · ${u?.title ?? 'Cả chương trình'} · ${fmtGrades([...new Set(on.map(c => c.grade))].sort((a, b) => a - b))}`
      n.material_norm_items.forEach(i => addNeed(m, i, lesson, i.qty * (i.reusable ? top : all * n.sessions)))
    }))
    return sortNeeds(m)
  }, [data, rows, k]) // eslint-disable-line react-hooks/exhaustive-deps

  const allCls = new Map(rows.flatMap(r => r.cls).map(c => [c.id, c]))
  const tot = { progs: rows.length, grades: new Set([...allCls.values()].map(c => c.grade)).size, cls: allCls.size,
    students: [...allCls.values()].reduce((s, c) => s + c.students, 0), groups: [...allCls.values()].reduce((s, c) => s + groupsOf(c), 0) }
  const guessed = [...allCls.values()].filter(c => !c.groups).length
  const school = schools?.find(s => s.id === sid)?.name ?? ''

  return (
    <>
      <div className="bar">
        <div className="tools">
          <SchoolPicker single value={sid ? [sid] : []} onChange={v => v[0] && setSid(v[0])} options={schools ?? []} style={{ flex: '1 1 520px' }}
            placeholder={schools ? 'Gõ để tìm trường…' : 'Đang tải…'} />
          <label className="tools">Học sinh/nhóm <input type="number" min={1} max={20} value={perGroup} onChange={e => setPerGroup(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} style={{ width: 64 }} aria-label="Số học sinh mỗi nhóm" /></label>
          <label className="tools">Lớp học cùng lúc <input type="number" min={1} max={50} value={k} onChange={e => setConc(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} style={{ width: 64 }} aria-label="Số lớp học cùng lúc" /></label>
        </div>
        {needs.length > 0 && <div className="tools"><button type="button" onClick={() => exportNeeds(`Can-chuan-bi-${school || 'truong'}.xlsx`, needs)}>Xuất Excel</button></div>}
      </div>
      {loading || !data ? <p className="sub">{sid || !schools ? 'Đang tải…' : 'Chưa có trường nào.'}</p> : !rows.length ? <p className="sub">Trường chưa được gán chương trình nào. Gán ở Chương trình giáo dục › Gán cho đơn vị.</p> : <>
        <p className="sub"><b>{tot.progs} chương trình · {tot.grades} khối · {tot.cls} lớp · {tot.students} học sinh · {tot.groups} nhóm</b>
          {data.year ? ` · năm học ${data.year}` : ''}{guessed ? ` · ${guessed} lớp chưa chia nhóm, tạm tính ${perGroup} học sinh/nhóm` : ''}</p>
        <div className="wrap"><table className="libtable">
          <thead><tr><th>Chương trình</th><th>Khối</th><th>Lớp</th><th>Học sinh</th><th>Nhóm</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.p.id}>
            <td>{progName(r.p)} <small className="sub">v{r.p.version_no} · {PSTATUS[r.p.status] ?? r.p.status}</small></td>
            <td>{fmtGrades(r.grades) || <small className="sub">Chưa có lớp ở {fmtGrades(r.p.aGrades) || 'khối áp dụng'}</small>}</td>
            <td>{r.cls.length}</td><td>{r.students}</td><td>{r.groups}</td></tr>)}</tbody>
        </table></div>
        <p className="sub">Vật tư tiêu hao: định mức × số nhóm của tất cả lớp áp dụng × số buổi. Công cụ, thiết bị dùng lại: đủ cho {k} lớp học cùng lúc (mặc định bằng số phòng STEM đang dùng{data.rooms ? `: ${data.rooms}` : ''}; cộng thêm nếu có lớp học tại lớp), tính theo các lớp đông nhất, lấy mức cần nhiều nhất giữa các bài.</p>
        {needs.length === 0 ? <p className="sub">{tot.cls ? 'Các bài của những chương trình này chưa có định mức vật tư. Nhập ở thẻ 04 của bộ học liệu.' : 'Trường chưa có lớp ở các khối áp dụng.'}</p> : <NeedsTable key={sid} needs={needs} />}
      </>}
    </>
  )
}

/** Thêm / mở bài học từ nơi khác (Danh mục học liệu): hộp "Thêm bài học" 3 cách như "Tạo giáo án", rồi mở trang bài học 5 thẻ */
export function LessonFlow({ orgId, openId, onClose, onChanged }: { orgId: string; openId?: string; onClose: () => void; onChanged?: () => void }) {
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState<string | null>(openId ?? null)
  const [msg, setMsg] = useState('')
  const { loaded, kits, subjectsOf, progRefs } = useLessonData(orgId, tick)
  const reload = () => { setTick(t => t + 1); onChanged?.() }
  if (open) return <>
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    <LessonPage key={open} orgId={orgId} id={open} programs={progRefs} subjectsOf={subjectsOf} code="" backLabel="← Danh mục học liệu"
      onBack={onClose} onChanged={reload} />
  </>
  if (!loaded) return <p className="sub">Đang tải…</p>
  if (!progRefs.length) return <div className="panel"><p className="msg">Chưa có chương trình giáo dục nào để gắn bài học. Tạo hoặc phát hành chương trình ở mục Chương trình giáo dục trước.</p>
    <button type="button" onClick={onClose}>← Danh mục học liệu</button></div>
  const p0 = progRefs[0]
  return <CreateLesson orgId={orgId} programs={progRefs} subjectsOf={subjectsOf} program={p0} subject={subjectsOf(p0.id)[0] ?? ''} pickPlace
    kits={kits} onClose={onClose} onCreated={(id, m) => { setMsg(m); reload(); setOpen(id) }} />
}
