// Học liệu theo chương trình đào tạo: giống Học liệu theo chương trình giáo dục.
// Chương trình đào tạo → Môn → Nội dung → bài giảng (training_lessons, bộ 5 thẻ). Bấm nội dung chưa có bài giảng để tạo.
import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { LessonPage } from '../library/lesson/LessonPage'
import { CreateLesson, type ProgRef } from '../library/lesson/Create'
import type { KitRow } from '../library/lesson/save'
import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { NameLink } from '../../components/TableSel'

type TProg = ProgRef & { status: string; version_no: number | null }
type TUnit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string }
type TLesson = KitRow & { org_id: string }
const PST: Record<string, string> = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', published: 'Đã phát hành', rejected: 'Bị trả lại' }
const LST: Record<string, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], inactive: ['Ngừng dùng', 'off'], archived: ['Đã thu hồi', 'off'] }
const pName = (p: TProg) => (p.code ? p.code + ' · ' : '') + p.title
const NONE = '__none__'
const SEL = 'id, org_id, owner_org_id:org_id, title, subject, grades, program_id, unit_id, status, version, updated_at, content'
// Bài giảng đào tạo: 4 thẻ bắt buộc (Kho hoạt động tuỳ chọn)
const done4 = (l: TLesson) => (l.content?.checked ?? []).filter(k => k !== 'bank').length
const full = (l: TLesson) => done4(l) >= 4

export function TrainingByProgram({ orgId }: { orgId: string }) {
  const [progs, setProgs] = useState<TProg[] | null>(null)
  const [units, setUnits] = useState<TUnit[]>([])
  const [lessons, setLessons] = useState<TLesson[]>([])
  const [tick, setTick] = useState(0)
  const [pid, setPid] = useState<string | null>(null)
  const [sid, setSid] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [create, setCreate] = useState<{ unit?: TUnit } | null>(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [view, setView] = useViewMode('hoc-lieu-ctdt', 'cards')
  const reload = () => setTick(t => t + 1)

  // Ba lượt tải chạy song song; nội dung và bài giảng tải theo trang (không bị cắt ở 1.000 dòng)
  useEffect(() => {
    Promise.all([
      supabase.from('training_programs').select('id, code, title, ct_code, status, version_no').neq('status', 'archived').order('code'),
      fetchAll(() => supabase.from('training_program_units').select('id, program_id, parent_id, kind, seq, title').order('id')),
    ]).then(([p, u]) => { setProgs((p.data as TProg[]) ?? []); setUnits(((u.data ?? []) as TUnit[]).sort((a, b) => a.seq - b.seq)) })
  }, [])
  useEffect(() => {
    fetchAll(() => supabase.from('training_lessons').select(SEL).order('id'))
      .then(({ data }) => setLessons((data ?? []) as unknown as TLesson[]))
  }, [tick])

  // Chỉ mục để không phải lọc lại cả danh sách ở mỗi lần vẽ
  const idx = useMemo(() => {
    const subjects = new Map<string, TUnit[]>(), contents = new Map<string, TUnit[]>(), byUnit = new Map<string, TLesson[]>(), loose = new Map<string, TLesson[]>()
    for (const u of units) {
      if (u.kind === 'subject') subjects.set(u.program_id, [...(subjects.get(u.program_id) ?? []), u])
      else if (u.parent_id) contents.set(u.parent_id, [...(contents.get(u.parent_id) ?? []), u])
    }
    const unitIds = new Set(units.map(u => u.id))
    for (const l of lessons) {
      if (l.unit_id && unitIds.has(l.unit_id)) byUnit.set(l.unit_id, [...(byUnit.get(l.unit_id) ?? []), l])
      else if (l.program_id) loose.set(l.program_id, [...(loose.get(l.program_id) ?? []), l])
    }
    return { subjects, contents, byUnit, loose }
  }, [units, lessons])
  const subjectsOfP = (p: string) => idx.subjects.get(p) ?? []
  const contentsOf = (s: string) => idx.contents.get(s) ?? []
  const lessonsOfS = (s: string) => contentsOf(s).flatMap(c => idx.byUnit.get(c.id) ?? [])
  const statP = (p: string) => {
    const subs = subjectsOfP(p), cs = subs.flatMap(s => contentsOf(s.id))
    const ls = [...cs.flatMap(c => idx.byUnit.get(c.id) ?? []), ...(idx.loose.get(p) ?? [])]
    return { subs: subs.length, contents: cs.length, covered: cs.filter(c => idx.byUnit.has(c.id)).length, lessons: ls.length, published: ls.filter(l => l.status === 'published').length }
  }
  // Nhãn "Môn › Nội dung" mà hộp tạo bài giảng dùng để gắn nội dung
  const labelOf = (c: TUnit) => { const s = units.find(x => x.id === c.parent_id); return s ? `${s.title} › ${c.title}` : c.title }
  const subjectsOf = (p: string) => subjectsOfP(p).flatMap(s => contentsOf(s.id).map(labelOf))
  const unitOf = (p: string, label: string) => subjectsOfP(p).flatMap(s => contentsOf(s.id)).find(c => labelOf(c) === label)?.id ?? null
  const refs: ProgRef[] = (progs ?? []).map(p => ({ id: p.id, code: p.code, title: p.title, ct_code: p.ct_code }))

  if (!progs) return <p className="sub">Đang tải…</p>
  const prog = progs.find(p => p.id === pid)
  const subj = sid && sid !== NONE ? units.find(u => u.id === sid) : null
  const crumbs = <nav className="crumbs lcrumbs" aria-label="Vị trí">
    <button type="button" className="linkbtn" onClick={() => { setPid(null); setSid(null); setOpen(null) }}>Học liệu theo chương trình đào tạo</button>
    {prog && <button type="button" className="linkbtn" onClick={() => { setSid(null); setOpen(null) }}>{pName(prog)}</button>}
    {prog && sid && <button type="button" className="linkbtn" onClick={() => setOpen(null)}>{subj?.title ?? 'Chưa gắn nội dung'}</button>}
    {open && <span className="sub">› {lessons.find(l => l.id === open)?.title}</span>}
  </nav>
  const createBox = create && prog && <CreateLesson orgId={orgId} store="training" unitOf={unitOf} programs={refs} subjectsOf={subjectsOf}
    program={refs.find(r => r.id === prog.id)!} subject={create.unit ? labelOf(create.unit) : subjectsOf(prog.id)[0] ?? ''} pickPlace={!create.unit}
    preset={create.unit ? { title: create.unit.title, unitId: create.unit.id } : null} kits={lessons}
    onClose={() => setCreate(null)} onCreated={(id, m) => { setCreate(null); setMsg(m); reload(); setOpen(id) }} />

  // ----- Trang bài giảng -----
  if (open) return <>{crumbs}
    <LessonPage key={open} orgId={lessons.find(l => l.id === open)?.org_id ?? orgId} id={open} store="training" unitOf={unitOf}
      programs={refs} subjectsOf={subjectsOf} code="" backLabel="← Danh sách nội dung" onBack={() => { setOpen(null); reload() }} onChanged={reload} /></>

  // ----- Nội dung của một môn (hoặc bài giảng chưa gắn nội dung) -----
  if (prog && sid) {
    const rows: { key: string; title: string; unit?: TUnit; ls: TLesson[] }[] = subj
      ? contentsOf(subj.id).map(c => ({ key: c.id, title: c.title, unit: c, ls: idx.byUnit.get(c.id) ?? [] }))
      : (idx.loose.get(prog.id) ?? []).map(l => ({ key: l.id, title: l.title, ls: [l] }))
    return <>{crumbs}
      <button type="button" className="ghostbtn" onClick={() => setSid(null)}>← Danh sách môn</button>
      <div className="lheadrow"><div><h2>{subj?.title ?? 'Bài giảng chưa gắn nội dung'}</h2>
        <p className="sub">{pName(prog)} · {rows.filter(r => r.ls.length).length}/{rows.length} nội dung đã có bài giảng</p></div>
        <button type="button" className="primary" onClick={() => setCreate({})}>+ Tạo bài giảng</button></div>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      <div className="panel"><div className="wrap"><table className="libtable">
        <thead><tr><th>Nội dung</th><th>Bài giảng</th><th>Thẻ đã chốt</th><th>Trạng thái</th></tr></thead>
        <tbody>{rows.map(r => !r.ls.length
          ? <tr key={r.key}><td><b>{r.title}</b></td><td colSpan={3}><button type="button" className="linkbtn" onClick={() => setCreate({ unit: r.unit })}>+ Tạo bài giảng cho nội dung này</button></td></tr>
          : r.ls.map((l, i) => <tr key={r.key + l.id}>
            <td>{i === 0 ? <b>{r.title}</b> : null}</td>
            <td><NameLink onClick={() => { setMsg(''); setOpen(l.id) }}>{l.title}</NameLink></td>
            <td>{done4(l)}/4 thẻ bắt buộc</td>
            <td><span className={'distchip2 ' + (LST[l.status]?.[1] ?? '')}>{LST[l.status]?.[0] ?? l.status}</span></td></tr>))}
          {!rows.length && <tr><td colSpan={4}><small className="sub">Môn này chưa có nội dung. Thêm nội dung ở Chương trình đào tạo.</small></td></tr>}</tbody>
      </table></div></div>
      {createBox}
    </>
  }

  // ----- Môn của chương trình -----
  if (prog) {
    const subs = subjectsOfP(prog.id), loose = idx.loose.get(prog.id) ?? []
    return <>{crumbs}
      <button type="button" className="ghostbtn" onClick={() => setPid(null)}>← Danh sách chương trình đào tạo</button>
      <div className="lheadrow"><div><h2>{prog.title}</h2>
        <p className="sub">{[prog.code, prog.version_no ? `v${prog.version_no}` : '', PST[prog.status] ?? prog.status, `${subs.length} môn`].filter(Boolean).join(' · ')}</p></div>
        <button type="button" className="primary" onClick={() => setCreate({})}>+ Tạo bài giảng</button></div>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      <div className="panel"><h3 style={{ marginTop: 0 }}>Môn</h3>
        <div className="wrap"><table className="libtable">
          <thead><tr><th>Môn</th><th>Nội dung</th><th>Có bài giảng</th><th>Chốt đủ thẻ</th><th>Đã phát hành</th></tr></thead>
          <tbody>{subs.map(s => { const cs = contentsOf(s.id), ls = lessonsOfS(s.id)
            return <tr key={s.id}><td><NameLink onClick={() => setSid(s.id)}>{s.title}</NameLink></td><td>{cs.length}</td>
              <td>{cs.filter(c => idx.byUnit.has(c.id)).length}/{cs.length}</td><td>{ls.filter(full).length}</td>
              <td>{ls.filter(l => l.status === 'published').length}</td></tr> })}
            {loose.length > 0 && <tr><td><NameLink onClick={() => setSid(NONE)}>Bài giảng chưa gắn nội dung</NameLink></td><td>—</td><td>{loose.length} bài</td>
              <td>{loose.filter(full).length}</td><td>{loose.filter(l => l.status === 'published').length}</td></tr>}
            {!subs.length && !loose.length && <tr><td colSpan={5}><small className="sub">Chương trình chưa có môn. Thêm môn và nội dung ở Chương trình đào tạo.</small></td></tr>}</tbody>
        </table></div></div>
      {createBox}
    </>
  }

  // ----- Danh sách chương trình đào tạo -----
  const shown = progs.filter(p => !q || pName(p).toLowerCase().includes(q.toLowerCase()))
  return <>
    <div className="bar">
      <div className="tools"><input type="search" placeholder="Tìm chương trình đào tạo…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chương trình đào tạo" /></div>
      <div className="tools"><ViewToggle value={view} onChange={setView} /></div>
    </div>
    {!shown.length && <p className="sub">{progs.length ? 'Không có chương trình nào khớp.' : 'Chưa có chương trình đào tạo nào.'}</p>}
    {view === 'cards' ? <div className="tilegrid sq">
      {shown.map(p => { const s = statP(p.id); return <button key={p.id} type="button" className="tile" onClick={() => setPid(p.id)}>
        <div className="tilebody"><b>{p.title}</b>
          <small>{[p.code ?? p.ct_code, p.version_no ? `v${p.version_no}` : '', PST[p.status] ?? p.status].filter(Boolean).join(' · ')}</small>
          <div className="tilemeta"><span>{s.subs} môn</span><span>{s.contents} nội dung</span><span>{s.lessons} bài giảng</span></div></div></button> })}
    </div> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Chương trình đào tạo</th><th>Môn</th><th>Nội dung</th><th>Có bài giảng</th><th>Bài giảng</th><th>Đã phát hành</th></tr></thead>
      <tbody>{shown.map(p => { const s = statP(p.id); return <tr key={p.id}>
        <td><NameLink onClick={() => setPid(p.id)}>{pName(p)}</NameLink> <small className="sub">{PST[p.status] ?? p.status}</small></td>
        <td>{s.subs}</td><td>{s.contents}</td><td>{s.covered}/{s.contents}</td><td>{s.lessons}</td><td>{s.published}</td></tr> })}</tbody>
    </table></div>}
  </>
}
