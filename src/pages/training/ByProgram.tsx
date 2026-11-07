// Học liệu theo chương trình đào tạo: giống Học liệu theo chương trình giáo dục.
// Chương trình đào tạo → các môn (thu gọn được) với nội dung và bài giảng (training_lessons, bộ 5 thẻ) ngay bên dưới;
// mỗi dòng có + Thêm nội dung / Sửa nội dung / Xóa.
import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { LessonPage } from '../library/lesson/LessonPage'
import { CreateLesson, type ProgRef } from '../library/lesson/Create'
import { errMsg, type KitRow } from '../library/lesson/save'
import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { NameLink } from '../../components/TableSel'

type TProg = ProgRef & { status: string; version_no: number | null }
type TUnit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; hours?: number | null }
type TLesson = KitRow & { org_id: string }
const PST: Record<string, string> = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', published: 'Đã phát hành', rejected: 'Bị trả lại' }
const LST: Record<string, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], inactive: ['Ngừng dùng', 'off'], archived: ['Đã thu hồi', 'off'] }
const pName = (p: TProg) => (p.code ? p.code + ' · ' : '') + p.title
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
  const [open, setOpen] = useState<{ id: string; edit?: boolean } | null>(null)
  const [create, setCreate] = useState<{ unit?: TUnit; subject?: TUnit } | null>(null)
  const [closed, setClosed] = useState<string[]>([])   // môn đang thu gọn
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [view, setView] = useViewMode('hoc-lieu-ctdt', 'cards')
  const reload = () => setTick(t => t + 1)

  // Ba lượt tải chạy song song; nội dung và bài giảng tải theo trang (không bị cắt ở 1.000 dòng)
  useEffect(() => {
    Promise.all([
      supabase.from('training_programs').select('id, code, title, ct_code, status, version_no').neq('status', 'archived').order('code'),
      fetchAll(() => supabase.from('training_program_units').select('id, program_id, parent_id, kind, seq, title, hours').order('id')),
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

  // Xóa bài giảng (không xóa nội dung trong chương trình); quyền do CSDL kiểm tra
  async function removeLesson(l: TLesson) {
    if (!confirm(`Xóa bài giảng “${l.title}”? Nội dung trong chương trình đào tạo vẫn giữ nguyên.`)) return
    const { data, error } = await supabase.from('training_lessons').delete().eq('id', l.id).select('id')
    if (error) setMsg(errMsg(error.message))
    else if (!data?.length) setMsg('Bạn không có quyền xóa bài giảng này.')
    else { setMsg(`Đã xóa “${l.title}”.`); reload() }
  }

  if (!progs) return <p className="sub">Đang tải…</p>
  const prog = progs.find(p => p.id === pid)
  const openL = open ? lessons.find(l => l.id === open.id) : undefined
  const crumbs = <nav className="crumbs lcrumbs" aria-label="Vị trí">
    <button type="button" className="linkbtn" onClick={() => { setPid(null); setOpen(null) }}>Học liệu theo chương trình đào tạo</button>
    {prog && <button type="button" className="linkbtn" onClick={() => setOpen(null)}>{pName(prog)}</button>}
    {open && <span className="sub">› {openL?.title}</span>}
  </nav>
  const firstLabel = (sj?: TUnit) => { const c = sj ? contentsOf(sj.id)[0] : undefined; return c ? labelOf(c) : prog ? subjectsOf(prog.id)[0] ?? '' : '' }
  const createBox = create && prog && <CreateLesson orgId={orgId} store="training" unitOf={unitOf} programs={refs} subjectsOf={subjectsOf}
    program={refs.find(r => r.id === prog.id)!} subject={create.unit ? labelOf(create.unit) : firstLabel(create.subject)} pickPlace={!create.unit}
    preset={create.unit ? { title: create.unit.title, unitId: create.unit.id } : null} kits={lessons}
    onClose={() => setCreate(null)} onCreated={(id, m) => { setCreate(null); setMsg(m); reload(); setOpen({ id }) }} />

  // ----- Trang bài giảng -----
  if (open) return <>{crumbs}
    <LessonPage key={open.id} orgId={openL?.org_id ?? orgId} id={open.id} store="training" unitOf={unitOf} startEdit={open.edit}
      programs={refs} subjectsOf={subjectsOf} code="" backLabel="← Danh sách nội dung" onBack={() => { setOpen(null); reload() }} onChanged={reload} /></>

  // ----- Các môn của chương trình, mỗi môn liệt kê nội dung và bài giảng -----
  if (prog) {
    const subs = subjectsOfP(prog.id), loose = idx.loose.get(prog.id) ?? []
    type Row = { key: string; title: string; unit?: TUnit; l?: TLesson; first: boolean }
    const rowsOf = (cs: TUnit[]): Row[] => cs.flatMap((c): Row[] => { const ls = idx.byUnit.get(c.id) ?? []
      return ls.length ? ls.map((l, i) => ({ key: c.id + l.id, title: c.title, unit: c, l, first: i === 0 })) : [{ key: c.id, title: c.title, unit: c, first: true }] })
    const toggle = (k: string, isOpen: boolean) => setClosed(isOpen ? [...closed, k] : closed.filter(x => x !== k))
    const group = (k: string, name: string, rows: Row[], sj?: TUnit) => {
      const isOpen = !closed.includes(k)
      const ls = rows.map(r => r.l).filter(Boolean) as TLesson[]
      const units = rows.filter(r => r.first).length
      let n = 0
      return <div key={k} className="ugroup" style={{ marginBottom: 12 }}>
        <div className="ughead" role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => toggle(k, isOpen)} onKeyDown={e => { if (e.key === 'Enter') toggle(k, isOpen) }}>
          <span className={'ugchev' + (isOpen ? ' on' : '')} aria-hidden="true">›</span><small>MÔN</small> <b>{name}</b>
          <small className="sub">{units} nội dung · {ls.length} bài giảng · {ls.filter(full).length} chốt đủ thẻ bắt buộc</small>
          <span className="ugbadge">Đã phát hành {ls.filter(l => l.status === 'published').length}/{units}</span>
          <button type="button" onClick={e => { e.stopPropagation(); setMsg(''); setCreate({ subject: sj }) }}>+ Tạo bài giảng</button>
        </div>
        {isOpen && (rows.length === 0 ? <p className="sub" style={{ padding: '10px 16px', margin: 0 }}>Môn này chưa có nội dung. Thêm nội dung ở Chương trình đào tạo.</p> : <div className="wrap"><table className="libtable utable">
          <thead><tr><th style={{ width: 40 }}>#</th><th>Nội dung</th><th>Bài giảng</th><th>Thẻ đã chốt</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>{rows.map(r => {
            if (r.first) n++
            return <tr key={r.key}>
              <td className="sub">{r.first ? n : ''}</td>
              <td>{r.first ? <b>{r.title}</b> : null}{r.first && r.unit && Number(r.unit.hours) > 0 && <><br /><small className="sub">{String(r.unit.hours).replace('.', ',')} giờ</small></>}</td>
              <td>{r.l ? <NameLink onClick={() => { setMsg(''); setOpen({ id: r.l!.id }) }}>{r.l.title}</NameLink> : <small className="sub">Chưa có</small>}</td>
              <td>{r.l ? `${done4(r.l)}/4 thẻ bắt buộc` : '—'}</td>
              <td>{r.l ? <span className={'distchip2 ' + (LST[r.l.status]?.[1] ?? '')}>{LST[r.l.status]?.[0] ?? r.l.status}</span> : <small className="sub">Chưa tạo</small>}</td>
              <td><span className="tools" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                {r.l ? <><button type="button" onClick={() => { setMsg(''); setOpen({ id: r.l!.id, edit: true }) }}>Sửa nội dung</button>
                  <button type="button" className="danger" onClick={() => removeLesson(r.l!)}>Xóa</button></>
                  : <button type="button" className="primary" onClick={() => { setMsg(''); setCreate({ unit: r.unit }) }}>+ Thêm nội dung</button>}</span></td>
            </tr>
          })}</tbody></table></div>)}
      </div>
    }
    return <>{crumbs}
      <button type="button" className="ghostbtn" onClick={() => setPid(null)}>← Danh sách chương trình đào tạo</button>
      <div className="lheadrow"><div><h2>{prog.title}</h2>
        <p className="sub">{[prog.code, prog.version_no ? `v${prog.version_no}` : '', PST[prog.status] ?? prog.status, `${subs.length} môn`].filter(Boolean).join(' · ')}</p></div></div>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      {subs.map(sj => group(sj.id, sj.title, rowsOf(contentsOf(sj.id)), sj))}
      {loose.length > 0 && group('__loose', 'Bài giảng chưa gắn nội dung', loose.map(l => ({ key: l.id, title: l.title, l, first: true })))}
      {!subs.length && !loose.length && <p className="sub">Chương trình chưa có môn. Thêm môn và nội dung ở Chương trình đào tạo.</p>}
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
