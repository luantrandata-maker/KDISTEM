import { Icon } from '../../components/Icon'
// Thư viện STEM theo chương trình (063): chương trình → học phần → buổi học (bài giảng tương tác), tài liệu, thiết bị, mục tiêu;
// trình chiếu buổi học và đăng ký dạy STEM (phòng STEM → đăng ký phòng; lớp học → phiếu mượn thiết bị).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { asLesson, lessonStats, BlockView, LessonShow, type ILesson } from '../../lib/lessonBlocks'
import { useMyClasses, PROGRAM_COLOR } from '../teacher/common'
import { isStem } from '../../lib/rooms'

type Props = { orgId: string | null; teacherId?: string | null; go?: (p: string) => void }
type Prog = { id: string; code: string | null; title: string; ct_code: string | null; level: string; grade_from: number; grade_to: number; main_subject: string; integrated_subjects: string[]; objectives: string | null }
type Unit = { id: string; program_id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; title: string; periods: number; subject: string | null; grade: number | null; objectives?: string | null; content?: string | null; lesson?: any }
type Norm = { id: string; program_id: string | null; unit_id: string | null; material_norm_items: { id: string; name: string; unit: string; qty: number; kind: string; reusable: boolean }[] }
type MyPlan = { id: string; title: string; status: string; program: string | null; grades: string | null; subject: string | null; lesson: any; cover_url: string | null }
type Lib = { id: string; title: string; kind: string; content: { type?: string; url?: string }; unit_id: string | null; owner_name?: string | null; summary: string | null }
type Out = { id: string; unit_id: string | null; seq: number; code: string | null; content: string }

const ART: Record<string, [string, string]> = { CT1: ['art1', 'microscope'], CT2: ['art5', 'puzzle'], CT3: ['art2', 'bulb'], CT4: ['art3', 'bot'], CT5: ['art4', 'flask'] }
const art = (ct: string | null) => ART[ct ?? ''] ?? ['art0', 'book']
const Chip = ({ ct }: { ct: string | null }) => ct ? <span className="progchip" style={{ background: PROGRAM_COLOR[ct] ?? '#64748b', color: '#fff' }}>{ct}</span> : null
const grades = (p: Prog) => Array.from({ length: p.grade_to - p.grade_from + 1 }, (_, i) => p.grade_from + i)
const sessMinutes = (u: Unit) => { const l = asLesson(u.lesson); const m = l ? lessonStats(l).minutes : 0; return m || (u.periods || 1) * 45 }
// Các buổi dạy của một học phần: buổi học của từng bài; bài chưa chia buổi thì tính cả bài là một buổi
function teachables(all: Unit[], topicId: string): Unit[] {
  const kids = (id: string) => all.filter(u => u.parent_id === id).sort((a, b) => a.seq - b.seq)
  return kids(topicId).flatMap(u => u.unit_type === 'lesson' ? (kids(u.id).filter(x => x.unit_type === 'session').length ? kids(u.id).filter(x => x.unit_type === 'session') : [u]) : u.unit_type === 'session' ? [u] : [])
}
const heroSmall = { color: 'rgba(255,255,255,.85)' }
const MAT: Record<string, string> = { doc: 'Tài liệu', worksheet: 'Phiếu học tập', image: 'Hình ảnh', video: 'Video', guide: 'Hướng dẫn', link: 'Đường dẫn', plan: 'Giáo án' }

export function LibraryPrograms({ teacherId, go }: Props) {
  const [progs, setProgs] = useState<Prog[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [norms, setNorms] = useState<Norm[]>([])
  const [mine, setMine] = useState<MyPlan[]>([])
  const [q, setQ] = useState(''); const [g, setG] = useState(''); const [subj, setSubj] = useState('')
  const [pid, setPid] = useState<string | null>(null); const [tid, setTid] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: ps } = await supabase.from('edu_programs').select('id, code, title, ct_code, level, grade_from, grade_to, main_subject, integrated_subjects, objectives')
        .eq('kind', 'stem').eq('status', 'published').order('ct_code').order('grade_from')
      const list = (ps as Prog[]) ?? []; setProgs(list)
      const ids = list.map(p => p.id)
      if (ids.length) {
        const [u, n] = await Promise.all([
          supabase.from('edu_program_units').select('id, program_id, parent_id, unit_type, seq, title, periods, subject, grade').in('program_id', ids),
          supabase.from('material_norms').select('id, program_id, unit_id, material_norm_items(id, name, unit, qty, kind, reusable)').eq('status', 'published').in('program_id', ids),
        ])
        setUnits((u.data as Unit[]) ?? []); setNorms((n.data as unknown as Norm[]) ?? [])
      }
      setLoaded(true)
    })()
    if (teacherId) supabase.from('lesson_plans').select('id, title, status, program, grades, subject, lesson, cover_url').eq('teacher_id', teacherId).order('updated_at', { ascending: false })
      .then(({ data }) => setMine(((data as MyPlan[]) ?? []).filter(p => asLesson(p.lesson))))
  }, [teacherId])

  const devCount = (progId: string, unitIds?: Set<string>) => new Set(norms.filter(n => n.program_id === progId && (!unitIds || !n.unit_id || unitIds.has(n.unit_id)))
    .flatMap(n => n.material_norm_items.map(i => i.name.toLowerCase()))).size
  const subjects = [...new Set(progs.flatMap(p => [p.main_subject, ...(p.integrated_subjects ?? [])]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'))
  const shown = progs.filter(p => (!q || (p.title + ' ' + (p.code ?? '') + ' ' + p.main_subject).toLowerCase().includes(q.toLowerCase()))
    && (!g || grades(p).includes(Number(g))) && (!subj || p.main_subject === subj || p.integrated_subjects?.includes(subj)))
  const openPlan = (id: string) => { try { sessionStorage.setItem('kdi.openPlan', id) } catch { /* bỏ qua */ } go?.('Soạn bài giảng') }

  const prog = progs.find(p => p.id === pid)
  if (prog && tid) {
    const topic = units.find(u => u.id === tid)
    if (topic) return <TopicView prog={prog} topic={topic} units={units.filter(u => u.program_id === prog.id)} teacherId={teacherId ?? null}
      onHome={() => { setPid(null); setTid(null) }} onProgram={() => setTid(null)} />
  }
  if (prog) {
    const pu = units.filter(u => u.program_id === prog.id)
    const topics = pu.filter(u => u.unit_type === 'topic').sort((a, b) => a.seq - b.seq)
    const sessOf = (t: string) => teachables(pu, t).length
    return (
      <>
        <div className="libhero">
          <div className="crumbs" style={heroSmall}><button type="button" onClick={() => setPid(null)}>Thư viện STEM</button> / Chi tiết chương trình</div>
          <div><Chip ct={prog.ct_code} /> <span className="pill" style={{ background: 'rgba(255,255,255,.2)', color: '#fff' }}>Khối {grades(prog).join(', ')}</span></div>
          <h2>{prog.title}</h2>
          <small style={heroSmall}>{topics.length} học phần · {topics.reduce((n, t) => n + sessOf(t.id), 0)} buổi học · {devCount(prog.id)} thiết bị</small>
        </div>
        {prog.objectives && <p className="sub">{prog.objectives}</p>}
        <div className="sectionhead"><h3>Danh sách học phần</h3></div>
        {topics.length === 0 && <p className="sub">Chương trình chưa có học phần.</p>}
        <div className="tilegrid">
          {topics.map(t => (
            <button type="button" key={t.id} className="tile" onClick={() => setTid(t.id)}>
              <div className="tilebody"><div><Chip ct={prog.ct_code} />{t.grade && <small> Khối {t.grade}</small>}</div><b>{t.title}</b><small>{sessOf(t.id)} buổi{t.subject ? ` · ${t.subject}` : ''}</small><span className="tilemore">Xem chủ đề ›</span></div>
            </button>
          ))}
        </div>
      </>
    )
  }
  return (
    <>
      <p className="sub">{progs.length} chương trình · Bài giảng, tài liệu và thiết bị theo từng học phần</p>
      <div className="bar" style={{ margin: '0 0 12px' }}>
        <input className="search" style={{ margin: 0, flex: 1 }} placeholder="Tìm chương trình theo tên, khối, môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chương trình" />
        <div className="tools">
          <select value={g} onChange={e => setG(e.target.value)} aria-label="Khối"><option value="">Tất cả khối</option>{Array.from({ length: 12 }, (_, i) => i + 1).map(x => <option key={x} value={x}>Khối {x}</option>)}</select>
          <select value={subj} onChange={e => setSubj(e.target.value)} aria-label="Môn"><option value="">Tất cả môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
        </div>
      </div>
      {teacherId && (
        <div className="mylessons">
          <div className="bar" style={{ margin: 0 }}><b>Bài giảng tương tác của tôi <span className="pill">{mine.filter(m => m.status === 'published').length} đã xuất bản</span></b>
            {go && <button type="button" className="linkbtn" onClick={() => go('Soạn bài giảng')}>Mở trình soạn bài ›</button>}</div>
          {mine.length ? <div className="row">{mine.map(m => (
            <button type="button" key={m.id} onClick={() => openPlan(m.id)}><b className="ellipsis">{m.title}</b>
              <small className="sub">{[m.subject, m.grades && `Khối ${m.grades}`, `${lessonStats(asLesson(m.lesson)).blocks} khối`].filter(Boolean).join(' · ')}</small></button>
          ))}</div> : <small className="sub">Chưa có bài giảng tương tác nào — soạn ở "Soạn bài giảng", tab "Bài giảng tương tác".</small>}
        </div>
      )}
      {loaded && shown.length === 0 && <p className="sub">Không có chương trình STEM nào phù hợp. Chương trình hiện ở đây khi được ban hành và gán cho trường.</p>}
      <div className="tilegrid">
        {shown.map(p => {
          const [cls, icon] = art(p.ct_code)
          return (
            <button type="button" key={p.id} className="tile" onClick={() => setPid(p.id)}>
              <div className={'tileart ' + cls}><Chip ct={p.ct_code} /><span aria-hidden="true"><Icon n={icon} size={36} /></span></div>
              <div className="tilebody"><small>Khối {grades(p).join(', ')}</small><b>{p.title}</b>
                <small>{units.filter(u => u.program_id === p.id && u.unit_type === 'topic').reduce((n, t) => n + teachables(units, t.id).length, 0)} buổi · {devCount(p.id)} thiết bị</small></div>
            </button>
          )
        })}
      </div>
    </>
  )
}

function TopicView({ prog, topic, units, teacherId, onHome, onProgram }: { prog: Prog; topic: Unit; units: Unit[]; teacherId: string | null; onHome: () => void; onProgram: () => void }) {
  const [tab, setTab] = useState<'lessons' | 'docs' | 'devices' | 'goals'>('lessons')
  const [sess, setSess] = useState<Unit[]>([])
  const [libs, setLibs] = useState<Lib[]>([]); const [norms, setNorms] = useState<Norm[]>([]); const [outs, setOuts] = useState<Out[]>([])
  const [topicFull, setTopicFull] = useState<Unit>(topic)
  const [sel, setSel] = useState(0)
  const [show, setShow] = useState(false); const [reg, setReg] = useState(false); const [msg, setMsg] = useState('')
  const subtree = useMemo(() => { const s = new Set([topic.id]); let grow = true; while (grow) { grow = false; units.forEach(u => { if (u.parent_id && s.has(u.parent_id) && !s.has(u.id)) { s.add(u.id); grow = true } }) } return s }, [topic.id, units])
  useEffect(() => {
    const order = teachables(units, topic.id).map(u => u.id)
    Promise.all([
      supabase.from('edu_program_units').select('*').in('id', [topic.id, ...order]),
      supabase.from('library_items').select('id, title, kind, content, unit_id, owner_name, summary').eq('status', 'published').eq('program_id', prog.id),
      supabase.from('material_norms').select('id, program_id, unit_id, material_norm_items(id, name, unit, qty, kind, reusable)').eq('status', 'published').eq('program_id', prog.id),
      supabase.from('edu_outcomes').select('id, unit_id, seq, code, content').eq('program_id', prog.id).order('seq'),
    ]).then(([u, l, n, o]) => {
      const all = (u.data as Unit[]) ?? []
      const t = all.find(x => x.id === topic.id); if (t) setTopicFull(t)
      setSess(order.map(id => all.find(x => x.id === id)).filter(Boolean) as Unit[])
      setLibs(((l.data as Lib[]) ?? []).filter(x => !x.unit_id || subtree.has(x.unit_id)))
      setNorms(((n.data as unknown as Norm[]) ?? []).filter(x => !x.unit_id || subtree.has(x.unit_id)))
      setOuts(((o.data as Out[]) ?? []).filter(x => x.unit_id && subtree.has(x.unit_id)))
    })
  }, [topic.id])
  const items = [...new Map(norms.flatMap(n => n.material_norm_items).map(i => [i.name.toLowerCase(), i])).values()]
  const cur = sess[sel]
  const lesson = cur ? asLesson(cur.lesson) : null
  const lessonName = (u: Unit) => units.find(x => x.id === u.parent_id && x.unit_type === 'lesson')?.title
  const tabs: [typeof tab, string, number][] = [['lessons', 'Bài giảng', sess.length], ['docs', 'Tài liệu', libs.length], ['devices', 'Thiết bị', items.length], ['goals', 'Mục tiêu', outs.length + (topicFull.objectives ? 1 : 0)]]
  return (
    <>
      <div className="libhero">
        <div className="crumbs" style={heroSmall}><button type="button" onClick={onHome}>Thư viện STEM</button> / <button type="button" onClick={onProgram}>{prog.title}</button> / Chi tiết chủ đề</div>
        <div><Chip ct={prog.ct_code} /></div>
        <h2>{topic.title}</h2>
        <small style={heroSmall}>{[...new Set([topic.subject || prog.main_subject, ...(prog.integrated_subjects ?? [])].filter(Boolean))].join(', ')}</small>
      </div>
      <div className="segmented" style={{ marginBottom: 12 }}>
        {tabs.map(([k, l, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} {n}</button>)}
      </div>
      {msg && <p className="okline">{msg}</p>}
      {tab === 'lessons' && (sess.length === 0 ? <p className="sub">Học phần chưa có buổi học.</p> : (
        <div className="sessions">
          <div className="panel" style={{ margin: 0, padding: 6 }}>
            {sess.map((s, i) => {
              const l = asLesson(s.lesson)
              return <button type="button" key={s.id} className={'sessbtn' + (i === sel ? ' on' : '')} onClick={() => setSel(i)}>
                <span className="lnum">{i + 1}</span><span><b>{s.title}</b><small>{sessMinutes(s)} phút{l ? ` · ${lessonStats(l).blocks} phần` : ''}</small></span></button>
            })}
          </div>
          {cur && (
            <div className="panel" style={{ margin: 0 }}>
              <div className="bar" style={{ alignItems: 'flex-start' }}>
                <div><h3 style={{ margin: 0 }}>{/^buổi\s*\d/i.test(cur.title) ? cur.title : `Buổi ${sel + 1}: ${cur.title}`}</h3>
                  <small className="sub">{cur.periods || 1} tiết · {sessMinutes(cur)} phút{lesson ? ` · ${lessonStats(lesson).blocks} phần` : ''}{cur.unit_type === 'session' && lessonName(cur) ? ` · ${lessonName(cur)}` : ''}</small></div>
                <div className="tools">
                  {lesson && <button type="button" onClick={() => setShow(true)}><Icon n="monitor" /> Trình chiếu</button>}
                  <button type="button" className="primary" onClick={() => setReg(true)}>Đăng ký dạy</button>
                </div>
              </div>
              {lesson ? <SessionContent lesson={lesson} /> : (
                <div>
                  <p className="sub">Buổi học chưa có nội dung chi tiết.</p>
                  {cur.objectives && <p><b>Mục tiêu:</b> {cur.objectives}</p>}
                  {cur.content && cur.content.split('\n').map((l, i) => <p key={i}>{l}</p>)}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {tab === 'docs' && (libs.length === 0 ? <p className="sub">Chưa có tài liệu cho học phần này.</p> : (
        <div className="wrap"><table><thead><tr><th>Tài liệu</th><th>Loại</th><th>Nguồn</th><th></th></tr></thead><tbody>
          {libs.map(l => <tr key={l.id}><td><b>{l.title}</b>{l.summary && <><br /><small className="sub">{l.summary}</small></>}{!l.unit_id && <><br /><small className="sub">Dùng chung cả chương trình</small></>}</td>
            <td>{l.kind === 'material' ? MAT[l.content?.type ?? ''] ?? 'Học liệu' : l.kind === 'lesson' ? 'Bài giảng' : 'Chương trình'}</td><td><small>{l.owner_name}</small></td>
            <td>{l.content?.url && <a className="btnlink" href={l.content.url} target="_blank" rel="noreferrer">Mở ↗</a>}</td></tr>)}
        </tbody></table></div>
      ))}
      {tab === 'devices' && (items.length === 0 ? <p className="sub">Chưa có định mức thiết bị, vật tư cho học phần này.</p> : (
        <div className="wrap"><table><thead><tr><th>Thiết bị / vật tư</th><th>Đơn vị</th><th>Định mức</th><th>Loại</th></tr></thead><tbody>
          {items.map(i => <tr key={i.id}><td><b>{i.name}</b></td><td>{i.unit}</td><td>{Number(i.qty)}</td><td><small>{i.reusable ? 'Thiết bị (dùng lại)' : 'Vật tư tiêu hao'}</small></td></tr>)}
        </tbody></table></div>
      ))}
      {tab === 'goals' && (
        <div className="panel">
          {topicFull.objectives && <p><b>Mục tiêu học phần:</b> {topicFull.objectives}</p>}
          {outs.length > 0 && <><b>Yêu cầu cần đạt</b>{outs.map(o => <div key={o.id} style={{ marginTop: 4 }}>✓ {o.code && <b>{o.code} </b>}{o.content}</div>)}</>}
          {!topicFull.objectives && !outs.length && <p className="sub" style={{ margin: 0 }}>Chưa có mục tiêu.</p>}
        </div>
      )}
      {show && cur && lesson && <LessonShow title={cur.title} ct={prog.ct_code} sub={topic.title} lesson={lesson} onClose={() => setShow(false)} />}
      {reg && cur && <RegisterModal prog={prog} topic={topic} sess={cur} teacherId={teacherId} onClose={() => setReg(false)} onDone={m => { setReg(false); setMsg(m) }} />}
    </>
  )
}

function SessionContent({ lesson }: { lesson: ILesson }) {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>
      <div className="toc"><small className="sub">Mục lục:</small>{lesson.phases.map((p, i) => (
        <button type="button" key={p.key + i} onClick={() => document.getElementById('sph-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{i + 1}. {p.title} ({p.minutes} phút)</button>))}</div>
      {lesson.phases.map((p, i) => (
        <Fragment key={p.key + i}>
          <h3 id={'sph-' + i} style={{ margin: '8px 0 0' }}><span className="lnum c1" style={{ background: 'var(--primary)', marginRight: 8 }}>{i + 1}</span>{i + 1}. {p.title} ({p.minutes} phút)</h3>
          {p.blocks.length === 0 && <small className="sub">Chưa có nội dung.</small>}
          {p.blocks.map(b => <div key={b.id}><BlockView b={b} teacher /></div>)}
        </Fragment>
      ))}
    </div>
  )
}

type Period = { id: string; name: string; starts_at: string; ends_at: string }
type EqType = { id: string; name: string }
const localDate = (plus = 0) => { const d = new Date(Date.now() + plus * 86400000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }
const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']

function RegisterModal({ prog, topic, sess, teacherId, onClose, onDone }: { prog: Prog; topic: Unit; sess: Unit; teacherId: string | null; onClose: () => void; onDone: (m: string) => void }) {
  const classes = useMyClasses(teacherId)
  const [periods, setPeriods] = useState<Period[]>([]); const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]); const [types, setTypes] = useState<EqType[]>([])
  const [f, setF] = useState({ class_id: '', on_date: localDate(1), period_id: '', replaced: '', place: 'class' as 'class' | 'room', room_id: '' })
  const [qty, setQty] = useState<Record<string, number>>({})
  const [slots, setSlots] = useState<{ period_id: string; subject: string }[] | null>(null)
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('period_configs').select('id, name, starts_at, ends_at').order('starts_at').then(({ data }) => setPeriods((data as Period[]) ?? []))
    supabase.from('stem_rooms').select('*').order('name').then(({ data }) => setRooms(((data as any[]) ?? []).filter(r => r.status === 'active' && isStem(r))))
    supabase.from('equipment_types').select('id, name').order('name').then(({ data }) => setTypes((data as EqType[]) ?? []))
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  useEffect(() => { if (!f.class_id && classes[0]) setF(v => ({ ...v, class_id: classes[0].id })) }, [classes.length])
  const weekday = new Date(f.on_date + 'T00:00:00').getDay() + 1          // TKB lưu Thứ 2 = 2 … Thứ 7 = 7
  useEffect(() => {
    if (!teacherId || !f.class_id || !f.on_date) return setSlots(null)
    supabase.from('timetable_entries').select('period_id, subject').eq('teacher_id', teacherId).eq('class_id', f.class_id).eq('weekday', weekday)
      .then(({ data }) => setSlots((data as any[]) ?? []))
  }, [teacherId, f.class_id, f.on_date])
  const cls = classes.find(c => c.id === f.class_id)
  const picked = types.filter(t => (qty[t.id] ?? 0) > 0).map(t => ({ type_id: t.id, name: t.name, qty: qty[t.id] }))
  const missing = [!teacherId && 'tài khoản giáo viên', !f.class_id && 'lớp học', !f.on_date && 'ngày dạy', !f.period_id && 'tiết học',
    f.place === 'room' && !f.room_id && 'phòng STEM', f.place === 'class' && !picked.length && 'thiết bị cần mượn'].filter(Boolean) as string[]
  async function submit() {
    if (missing.length || !teacherId) return
    setBusy(true); setErr('')
    const orgId = (await supabase.from('classes').select('org_id').eq('id', f.class_id).single()).data?.org_id
    const summary = picked.map(i => `${i.name} × ${i.qty}`).join('; ')
    const lessonText = topic.title + (f.replaced.trim() ? ` (thay bài: ${f.replaced.trim()})` : '')
    const { error } = f.place === 'room'
      ? await supabase.from('stem_registrations').insert({ org_id: orgId, teacher_id: teacherId, class_id: f.class_id, room_id: f.room_id, period_id: f.period_id, on_date: f.on_date,
          topic: sess.title, program: prog.ct_code, lesson: lessonText, equipment_note: summary || null })
      : await supabase.from('borrow_requests').insert({ org_id: orgId, teacher_id: teacherId, class_id: f.class_id, title: 'Dạy STEM: ' + sess.title, on_date: f.on_date,
          period_id: f.period_id, mode: 'take_to_class', items: summary, item_list: picked })
    setBusy(false)
    if (error) return setErr('Không gửi được: ' + error.message)
    onDone(f.place === 'room' ? `Đã gửi đăng ký dạy STEM "${sess.title}" tại phòng STEM, chờ nhà trường duyệt.` : `Đã gửi phiếu mượn thiết bị để dạy "${sess.title}" tại lớp ${cls?.name ?? ''}, chờ duyệt.`)
  }
  const period = (id: string) => periods.find(p => p.id === id)
  return (
    <div className="modalbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Đăng ký dạy STEM">
        <div className="modalhead"><div><h3>Đăng ký dạy STEM</h3><small>Chọn học phần · buổi học · tiết trong thời khóa biểu cần đổi thành STEM</small></div>
          <button type="button" className="x" onClick={onClose} aria-label="Đóng">×</button></div>
        <div className="modalbody">
          {!teacherId && <p className="warnline">Chỉ giáo viên đăng ký dạy được. Tài khoản này chưa gắn với hồ sơ giáo viên.</p>}
          <div className="regcols">
            <div className="formgrid" style={{ gridTemplateColumns: '1fr', gap: 10, alignContent: 'start' }}>
              <div className="panel" style={{ margin: 0, background: 'var(--soft)' }}><b>{sess.title}</b><br /><small className="sub">{topic.title} · {prog.ct_code} · {sess.periods || 1} tiết</small></div>
              <label className="field"><span>Lớp học (kế hoạch giáo dục lớp – môn)</span><select value={f.class_id} onChange={e => setF({ ...f, class_id: e.target.value })} disabled={!teacherId}>
                {!classes.length && <option value="">Chưa có lớp được phân công</option>}
                {classes.map(c => <option key={c.id} value={c.id}>{c.name} · {c.subjects.join(', ')}</option>)}</select></label>
              <label className="field"><span>Ngày dạy</span><input type="date" value={f.on_date} min={localDate(0)} onChange={e => setF({ ...f, on_date: e.target.value })} /></label>
              <label className="field"><span>Bài trong kế hoạch được thay thế (nếu có)</span><input value={f.replaced} onChange={e => setF({ ...f, replaced: e.target.value })} placeholder="VD: Bài 5 — Thực hành" /></label>
            </div>
            <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <div><b><span className="stepnum">3</span>Chọn tiết cần đổi thành STEM</b>
                {slots && slots.length === 0 && <p className="warnline" style={{ background: '#fff7ed', padding: '8px 10px', borderRadius: 8, color: '#9a3412' }}>
                  {WD[weekday - 1]} ({new Date(f.on_date + 'T00:00:00').toLocaleDateString('vi-VN')}) bạn không có tiết nào với {cls?.name ?? 'lớp này'} trong thời khóa biểu — có thể chọn tiết khác hoặc đề nghị nhà trường xếp tiết trước khi đăng ký.</p>}
                <select value={f.period_id} onChange={e => setF({ ...f, period_id: e.target.value })} aria-label="Tiết học" style={{ width: '100%', marginTop: 6 }}>
                  <option value="">— Chọn tiết —</option>
                  {slots && slots.length > 0 && <optgroup label="Tiết của bạn trong TKB">{slots.map(s => <option key={'s' + s.period_id} value={s.period_id}>{period(s.period_id)?.name ?? 'Tiết'} · {s.subject}</option>)}</optgroup>}
                  <optgroup label="Mọi tiết">{periods.map(p => <option key={p.id} value={p.id}>{p.name} ({p.starts_at.slice(0, 5)}–{p.ends_at.slice(0, 5)})</option>)}</optgroup>
                </select></div>
              <div><b><span className="stepnum">4</span>Địa điểm</b>
                <div className="addrow" style={{ marginTop: 6 }}>
                  <select value={f.place} onChange={e => setF({ ...f, place: e.target.value as 'class' | 'room' })} aria-label="Địa điểm"><option value="class">Lớp học</option><option value="room">Phòng STEM</option></select>
                  {f.place === 'room' && <select value={f.room_id} onChange={e => setF({ ...f, room_id: e.target.value })} aria-label="Phòng STEM"><option value="">— Chọn phòng —</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>}
                </div></div>
              <div><b><span className="stepnum">5</span>{f.place === 'class' ? 'Thiết bị cần mượn' : 'Thiết bị yêu cầu tại phòng'}</b>
                <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 6, border: '1px solid var(--line)', borderRadius: 10, padding: '0 10px' }}>
                  {types.length === 0 && <p className="sub">Chưa có danh mục thiết bị.</p>}
                  {types.map(t => <label key={t.id} className="qtyrow"><span>{t.name}</span>
                    <input type="number" min={0} max={200} style={{ padding: 6, border: '1px solid var(--line)', borderRadius: 8 }} value={qty[t.id] ?? 0} onChange={e => setQty({ ...qty, [t.id]: Math.max(0, Number(e.target.value) || 0) })} aria-label={'Số lượng ' + t.name} /></label>)}
                </div></div>
            </div>
          </div>
          {err && <p className="warnline">{err}</p>}
        </div>
        <div className="modalfoot">
          {missing.length > 0 && <small style={{ color: '#c2410c', marginRight: 'auto' }}>Còn thiếu: {missing.join(', ')}</small>}
          <button type="button" className="primary" onClick={submit} disabled={busy || missing.length > 0}>{busy ? 'Đang gửi…' : 'Gửi đăng ký'}</button>
          <button type="button" onClick={onClose}>Hủy</button>
        </div>
      </div>
    </div>
  )
}
