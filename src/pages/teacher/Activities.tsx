import { coverStyle } from '../../components/Cover'
import { NameLink } from '../../components/TableSel'
import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { Icon } from '../../components/Icon'
// Giáo viên → Kho hoạt động & Bài giảng (migration 030)
// Hoạt động của tôi · Kho của trường (mẫu + đồng nghiệp đã xuất bản) · Bài giảng có thể giao học trước.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TProps, NoTeacher, PROGRAM_COLOR, Tabs, handoff, useMyClasses } from './common'
import { ACT, ACT_KINDS, STARTER, ActivityPlayer, ContentEditor, countItems, unitOf, toPlayable, emptyAnswers, answered,
  ACT_GROUP, actGroup, activityToBlock, type ActGroup, type ActKind, type Activity, type Grade } from './activity'
import { asLesson, lessonStats, LessonOutline, LessonPlayer, emptyLesson, INTERACTION, type ILesson } from '../../lib/lessonBlocks'
import { SIMS, type SimModel } from '../../lib/sims'
import { RaceGame } from '../../lib/games'
import '../../styles/activities.css'
import { useStemTracks } from '../../lib/stemTracks'

type View = { mode: 'list' } | { mode: 'new' } | { mode: 'edit'; a: Activity } | { mode: 'play'; a: Activity; big: boolean }
type T = 'mine' | 'school' | 'lessons'
type LessonLite = { id: string; title: string; subject: string | null; grades: string | null; program: string | null; is_template: boolean
  status: string; slides: unknown[]; teacher_id: string | null; teachers: { full_name: string } | null
  lesson?: any; cover_url?: string | null; summary?: string | null; periods?: number | null }

const COLS = 'id, org_id, teacher_id, kind, title, instructions, subject, grades, program, content, is_template, status, source_id, updated_at, teachers(full_name)'

export function TeacherActivities({ teacherId, orgId, go }: TProps) {
  const [rows, setRows] = useState<Activity[]>([])
  const [lessons, setLessons] = useState<LessonLite[]>([])
  const [view, setView] = useState<View>({ mode: 'list' })
  const [tab, setTab] = useState<T>('mine')
  const [kind, setKind] = useState<ActKind | ''>('')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const [a, l] = await Promise.all([
      supabase.from('activities').select(COLS).order('updated_at', { ascending: false }),
      supabase.from('lesson_plans').select('id, title, subject, grades, program, is_template, status, slides, teacher_id, teachers(full_name), lesson, cover_url, summary, periods')
        .or('status.eq.published,is_template.eq.true').is('draft_of', null).order('updated_at', { ascending: false }).limit(200),
    ])
    if (a.error) setErr(/does not exist|schema cache/i.test(a.error.message) ? 'Hãy chạy migration 030_activities_self_study_holidays.sql trên Supabase.' : a.error.message)
    setRows((a.data as unknown as Activity[]) ?? []); setLessons((l.data as unknown as LessonLite[]) ?? [])
  }
  useEffect(() => { load() }, [teacherId])

  if (!teacherId) return <NoTeacher />

  async function create(k: ActKind, from?: Activity) {
    if (!orgId) return
    const body = from
      ? { kind: from.kind, title: from.title.replace(/^Mẫu:\s*/, ''), instructions: from.instructions, subject: from.subject, grades: from.grades,
          program: from.program, content: from.content, source_id: from.id }
      : { kind: k, title: `${ACT[k].label} mới`, content: STARTER[k] }
    const { data, error } = await supabase.from('activities').insert({ ...body, org_id: orgId, teacher_id: teacherId, status: 'draft' }).select(COLS).single()
    if (error || !data) return setErr('Không tạo được hoạt động: ' + (error?.message ?? ''))
    setTab('mine'); await load(); setView({ mode: 'edit', a: data as unknown as Activity })
  }
  async function remove(a: Activity) {
    if (!confirm(`Xoá hoạt động “${a.title}”? Bài tự học đã giao vẫn giữ nội dung.`)) return
    const { error } = await supabase.from('activities').delete().eq('id', a.id)
    if (error) setErr(error.message); load()
  }
  const assign = (ref: string) => { handoff.set('teacher.selfstudy', ref); go?.('Học trước & tự học') }

  if (view.mode === 'new') return (
    <>
      <div className="bar"><button onClick={() => setView({ mode: 'list' })}>← Danh sách</button><span className="sub" style={{ margin: 0 }}>Chọn mẫu hoạt động</span></div>
      <div className="acttypes">
        {ACT_KINDS.map(k => (
          <button key={k} className="panel acttype" onClick={() => create(k)}>
            <span className="acticon" aria-hidden="true"><Icon n={ACT[k].icon} size={24} /></span>
            <b>{ACT[k].label}</b><small>{ACT[k].desc}</small>
            {!ACT[k].graded && <span className="pill">Không chấm điểm</span>}
          </button>
        ))}
      </div>
    </>
  )
  if (view.mode === 'edit') return <Editor a={view.a} onClose={() => { setView({ mode: 'list' }); load() }} onPlay={a => setView({ mode: 'play', a, big: false })} />
  if (view.mode === 'play') return <Play a={view.a} big={view.big} onBig={b => setView({ ...view, big: b })} onClose={() => setView({ mode: 'list' })}
    onEdit={view.a.teacher_id === teacherId && !view.a.is_template ? () => setView({ mode: 'edit', a: view.a }) : undefined} />

  const match = (a: { title: string; program?: string | null }) => !q || a.title.toLowerCase().includes(q.toLowerCase())
  const mine = rows.filter(a => a.teacher_id === teacherId && !a.is_template)
  const school = rows.filter(a => (a.is_template || (a.teacher_id !== teacherId && a.status === 'published')))
  const src = mine.filter(a => (!kind || a.kind === kind) && match(a))

  return (
    <>
      <div className="bar">
        <Tabs<T> value={tab} onChange={setTab} items={[['mine', 'Hoạt động của tôi', mine.length], ['school', 'Kho hoạt động tương tác', school.length], ['lessons', 'Kho bài giảng', lessons.length]]} />
        <span className="tools">
          {go && <button onClick={() => go('Học trước & tự học')}>Học trước & tự học</button>}
          {go && <button onClick={() => go('Soạn bài giảng')}>Soạn bài giảng</button>}
          <button className="primary" onClick={() => setView({ mode: 'new' })}>+ Tạo hoạt động</button>
        </span>
      </div>
      {err && <p className="msg">{err}</p>}
      {tab === 'school' && <ActivityBank rows={school} teacherId={teacherId} orgId={orgId} go={go}
        onUse={a => create(a.kind, a)} onAssign={a => assign('activity:' + a.id)} />}
      {tab === 'lessons' && <LessonBank rows={lessons} teacherId={teacherId} go={go} onAssign={l => assign('lesson:' + l.id)} />}
      {tab === 'mine' && <>
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm theo tên…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        <select value={kind} onChange={e => setKind(e.target.value as ActKind | '')} aria-label="Lọc theo mẫu">
          <option value="">Tất cả mẫu</option>{ACT_KINDS.map(k => <option key={k} value={k}>{ACT[k].label}</option>)}</select>
      </div>
        <div className="lessongrid">
          {src.map(a => (
            <div className="panel lessoncard" key={a.id}>
              <div className="lessoncover actcover">
                <span className="progchip pkgchip"><span aria-hidden="true"><Icon n={ACT[a.kind].icon} /></span> {ACT[a.kind].label}</span>
                {a.program && <span className="progchip" style={{ background: PROGRAM_COLOR[a.program], color: '#fff' }}>{a.program}</span>}
                <span className="slidecount">{countItems(a.kind, a.content)} {unitOf(a.kind)}</span>
              </div>
              <b>{a.title}</b>
              <small>{[a.subject, a.grades && `Khối ${a.grades}`].filter(Boolean).join(' · ')}</small>
              <div className="lessonfoot"><span className={'pill ' + (a.status === 'published' ? 'active' : '')}>{a.status === 'published' ? 'Đã xuất bản' : 'Nháp'}</span></div>
              <div className="tools">
                <button className="primary" onClick={() => setView({ mode: 'edit', a })}>Soạn</button>
                <button onClick={() => setView({ mode: 'play', a, big: false })}>Chơi thử</button>
                <button onClick={() => assign('activity:' + a.id)}>Giao cho lớp</button>
                <button onClick={() => create(a.kind, a)}>Nhân bản</button>
                <button className="x" onClick={() => remove(a)} aria-label={`Xoá ${a.title}`}>×</button>
              </div>
            </div>
          ))}
          {src.length === 0 && <p className="sub">Chưa có hoạt động nào. Bấm “Tạo hoạt động” để chọn một trong {ACT_KINDS.length} mẫu.</p>}
        </div>
      </>}
    </>
  )
}

function Editor({ a, onClose, onPlay }: { a: Activity; onClose: () => void; onPlay: (a: Activity) => void }) {
  const { codes: CTS } = useStemTracks()
  const [x, setX] = useState<Activity>(a)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const upd = (patch: Partial<Activity>) => { setX({ ...x, ...patch }); setDirty(true); setErr('') }

  async function save(status?: Activity['status']) {
    setBusy(true); setErr('')
    const body = { title: x.title.trim() || ACT[x.kind].label, instructions: x.instructions || null, subject: x.subject || null, grades: x.grades || null,
      program: x.program || null, content: x.content, status: status ?? x.status }
    const { data, error } = await supabase.from('activities').update(body).eq('id', x.id).select(COLS).single()
    setBusy(false)
    if (error || !data) return setErr(error?.message.replace(/^Chưa xuất bản được: /, 'Chưa xuất bản được — ') ?? 'Không lưu được')
    setX(data as unknown as Activity); setDirty(false)
    setMsg(status === 'published' ? 'Đã xuất bản — đồng nghiệp thấy trong Kho của trường, có thể giao cho lớp.' : 'Đã lưu.')
  }
  const close = () => { if (!dirty || confirm('Có thay đổi chưa lưu. Thoát không lưu?')) onClose() }

  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={close}>← Danh sách</button>
          <span className="progchip pkgchip"><Icon n={ACT[x.kind].icon} /> {ACT[x.kind].label}</span>
          <span className={'pill ' + (x.status === 'published' ? 'active' : '')}>{x.status === 'published' ? 'Đã xuất bản' : 'Nháp'}</span>
          {dirty ? <small>Chưa lưu</small> : msg && <small>{msg}</small>}</span>
        <span className="tools">
          <button onClick={() => onPlay(x)}>Chơi thử</button>
          <button onClick={() => save()} disabled={busy}>Lưu</button>
          {x.status === 'published'
            ? <button onClick={() => save('draft')} disabled={busy}>Thu hồi xuất bản</button>
            : <button className="primary" onClick={() => save('published')} disabled={busy}>Xuất bản</button>}
        </span>
      </div>
      {err && <p className="msg panel warnbox">{err}</p>}
      <div className="panel formgrid">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên hoạt động *</span>
          <input value={x.title} onChange={e => upd({ title: e.target.value })} maxLength={200} /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Hướng dẫn cho học sinh</span>
          <input value={x.instructions ?? ''} onChange={e => upd({ instructions: e.target.value })} /></label>
        <label className="field"><span>Môn</span><input value={x.subject ?? ''} onChange={e => upd({ subject: e.target.value })} /></label>
        <label className="field"><span>Khối</span><input value={x.grades ?? ''} onChange={e => upd({ grades: e.target.value })} placeholder="VD: 8 hoặc 6,7" /></label>
        <label className="field"><span>Chương trình</span>
          <select value={x.program ?? ''} onChange={e => upd({ program: e.target.value || null })}><option value="">—</option>{CTS.map(c => <option key={c}>{c}</option>)}</select></label>
      </div>
      <ContentEditor kind={x.kind} value={x.content} onChange={content => upd({ content })} />
    </>
  )
}

// Chơi thử / trình chiếu: chấm bằng chính hàm của CSDL để giáo viên thấy đúng như học sinh sẽ thấy
function Play({ a, big, onBig, onClose, onEdit }: { a: Activity; big: boolean; onBig: (b: boolean) => void; onClose: () => void; onEdit?: () => void }) {
  const [data, setData] = useState(() => toPlayable(a.kind, a.content))
  const [ans, setAns] = useState(() => emptyAnswers(a.kind, data))
  const [grade, setGrade] = useState<Grade | null>(null)
  const [reveal, setReveal] = useState(false)
  const [err, setErr] = useState('')
  const prog = answered(a.kind, ans, data)

  async function check() {
    const { data: g, error } = await supabase.rpc('activity_grade', { p_kind: a.kind, c: a.content, a: ans })
    if (error) return setErr(error.message)
    setGrade(g as Grade)
  }
  function reset() { const d = toPlayable(a.kind, a.content); setData(d); setAns(emptyAnswers(a.kind, d)); setGrade(null); setReveal(false) }

  return (
    <div className={big ? 'actstage' : ''}>
      <div className="bar">
        <span className="tools"><button onClick={onClose}>← Danh sách</button><b>{a.title}</b></span>
        <span className="tools">
          {onEdit && <button onClick={onEdit}>Soạn</button>}
          <button onClick={() => onBig(!big)}>{big ? 'Thu nhỏ' : 'Trình chiếu'}</button>
          <button onClick={reset}>Làm lại</button>
        </span>
      </div>
      {a.instructions && <p className="sub">{a.instructions}</p>}
      <div className="panel">
        <ActivityPlayer kind={a.kind} data={data} answers={ans} onChange={v => { setAns(v); setGrade(null) }} grade={grade} solution={reveal ? a.content : null} big={big} />
      </div>
      {ACT[a.kind].graded && (
        <div className="bar">
          <small>Đã trả lời {prog.done}/{prog.total}</small>
          <span className="tools">
            {grade && <b className="actscore">Đúng {grade.correct}/{grade.total} · {Math.round(100 * grade.correct / Math.max(1, grade.total)) / 10} điểm</b>}
            <button onClick={() => setReveal(!reveal)}>{reveal ? 'Ẩn đáp án' : 'Hiện đáp án'}</button>
            <button className="primary" onClick={check}>Kiểm tra</button>
          </span>
        </div>
      )}
      {err && <p className="msg">{err}</p>}
    </div>
  )
}

// ================= Kho hoạt động tương tác =================
const KIND_ART: Record<ActKind, [string, number]> = {
  race: ['🏆', 0], wheel: ['🎡', 2], teams: ['⚑', 3], timer: ['⏳', 1], flashcard: ['🃏', 5], match: ['🧩', 1], group: ['🗂', 4], order: ['🪜', 3],
  sim: ['⚛', 5], quiz: ['📝', 0], truefalse: ['⚖', 2], fill: ['✏', 4], worksheet: ['📋', 1],
}
const SIM_ART: Record<string, string> = { circuit_series: '💡', circuit_parallel: '🔌', pendulum: '⏱', lever: '⚖', ruler: '📏', scale: '⚖', thermometer: '🌡' }
const artOf = (a: Activity): [string, number] => a.kind === 'sim' ? [SIM_ART[a.content?.model] ?? '⚛', 5] : KIND_ART[a.kind] ?? ['◉', 0]
const kindLabel = (a: Activity) => a.kind === 'sim' ? SIMS[a.content?.model as SimModel]?.label ?? ACT.sim.label : ACT[a.kind].label
const gradesOf = (s: string | null) => (s ?? '').split(/[,;\s–-]+/).map(x => x.trim()).filter(Boolean)

type MyPlan = { id: string; title: string; program: string | null; lesson: any; status: string; draft_of?: string | null }

function ActivityBank({ rows, teacherId, orgId, go, onUse, onAssign }: {
  rows: Activity[]; teacherId: string; orgId: string | null; go?: (p: string) => void; onUse: (a: Activity) => void; onAssign: (a: Activity) => void
}) {
  const [grp, setGrp] = useState<ActGroup | ''>('')
  const [q, setQ] = useState(''); const [grade, setGrade] = useState(''); const [subj, setSubj] = useState('')
  const [open, setOpen] = useState<Activity | null>(null)
  const grades = [...new Set(rows.flatMap(a => gradesOf(a.grades)))].sort((a, b) => Number(a) - Number(b))
  const subjects = [...new Set(rows.map(a => a.subject).filter(Boolean) as string[])].sort()
  const base = rows.filter(a => (!q || (a.title + ' ' + (a.subject ?? '') + ' ' + (a.instructions ?? '')).toLowerCase().includes(q.toLowerCase()))
    && (!grade || gradesOf(a.grades).includes(grade)) && (!subj || a.subject === subj))
  const count = (g: ActGroup) => base.filter(a => actGroup(a.kind) === g).length
  const groups = (Object.keys(ACT_GROUP) as ActGroup[]).filter(g => !grp || g === grp)
  return (
    <>
      <h3 style={{ margin: '4px 0 0' }}>Kho hoạt động tương tác</h3>
      <p className="sub" style={{ marginTop: 2 }}>Hoạt động có sẵn để thêm vào bài giảng — chỉ cần thay nội dung theo bài của thầy/cô.</p>
      <div className="statrow">
        <button className={'statcard' + (grp === '' ? ' on' : '')} onClick={() => setGrp('')}><i>◎</i><span><small>Tất cả nhóm</small><b>{base.length}</b></span></button>
        {(Object.keys(ACT_GROUP) as ActGroup[]).map(g => (
          <button key={g} className={'statcard' + (grp === g ? ' on' : '')} onClick={() => setGrp(grp === g ? '' : g)}>
            <i><Icon n={g === 'game' ? 'gamepad' : g === 'interactive' ? 'atom' : 'clipboard'} size={20} /></i><span><small>{ACT_GROUP[g].label}</small><b>{count(g)}</b></span></button>
        ))}
      </div>
      <div className="tools" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <input className="search" style={{ margin: 0, flex: 1, minWidth: 220 }} placeholder="Tìm theo tên hoạt động, môn học hoặc thẻ…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm hoạt động" />
        <select value={grp} onChange={e => setGrp(e.target.value as ActGroup | '')} aria-label="Nhóm"><option value="">Tất cả nhóm · {base.length}</option>
          {(Object.keys(ACT_GROUP) as ActGroup[]).map(g => <option key={g} value={g}>{ACT_GROUP[g].label}</option>)}</select>
        <select value={grade} onChange={e => setGrade(e.target.value)} aria-label="Khối"><option value="">Tất cả khối</option>{grades.map(g => <option key={g} value={g}>Khối {g}</option>)}</select>
        <select value={subj} onChange={e => setSubj(e.target.value)} aria-label="Môn"><option value="">Tất cả môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
      </div>
      {groups.map(g => {
        const list = base.filter(a => actGroup(a.kind) === g)
        if (!list.length) return null
        return (
          <div key={g}>
            <div className="sectionhead"><h3>{ACT_GROUP[g].label}</h3><small>{ACT_GROUP[g].desc}</small></div>
            <div className="tilegrid" style={{ marginTop: 8 }}>
              {list.map(a => { const [icon, art] = artOf(a); return (
                <button key={a.id} className="tile" onClick={() => setOpen(a)}>
                  <div className={'tileart art' + art}>{a.program && <span className="progchip" style={{ background: PROGRAM_COLOR[a.program], color: '#fff' }}>{a.program}</span>}<span aria-hidden="true"><Icon n={icon} size={36} /></span></div>
                  <div className="tilebody">
                    <b>{a.title}</b>
                    <small>{[a.subject, a.teachers?.full_name ?? (a.is_template ? 'Mẫu của trường' : '')].filter(Boolean).join(' · ')}</small>
                    <div className="tilemeta"><span>{ACT_GROUP[g].tag}</span><span>{kindLabel(a)}</span>{a.grades && <span>Khối {a.grades}</span>}</div>
                    <span className="tilemore">Xem chi tiết ›</span>
                  </div>
                </button>) })}
            </div>
          </div>
        )
      })}
      {base.length === 0 && <p className="sub">Kho chưa có hoạt động phù hợp.</p>}
      {open && <ActivityModal a={open} teacherId={teacherId} orgId={orgId} go={go} onClose={() => setOpen(null)} onUse={() => onUse(open)} onAssign={() => onAssign(open)} />}
    </>
  )
}

function useEsc(onClose: () => void) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [])
}

function TryOut({ a }: { a: Activity }) {
  const [data] = useState(() => toPlayable(a.kind, a.content))
  const [ans, setAns] = useState(() => emptyAnswers(a.kind, data))
  const [sol, setSol] = useState(false)
  if (a.kind === 'race') return <RaceGame items={(a.content?.items ?? []).filter((x: any) => x?.q)} seconds={a.content?.seconds ?? 20} title={a.title} />
  return (
    <div>
      <ActivityPlayer kind={a.kind} data={data} answers={ans} onChange={setAns} solution={sol ? a.content : null} />
      {ACT[a.kind].graded && <div className="actions"><button onClick={() => setSol(!sol)}>{sol ? 'Ẩn đáp án' : 'Xem đáp án'}</button>
        <button onClick={() => { setAns(emptyAnswers(a.kind, data)); setSol(false) }}>↺ Chơi lại</button></div>}
    </div>
  )
}

function ActivityModal({ a, teacherId, orgId, go, onClose, onUse, onAssign }: {
  a: Activity; teacherId: string; orgId: string | null; go?: (p: string) => void; onClose: () => void; onUse: () => void; onAssign: () => void
}) {
  useEsc(onClose)
  const [pick, setPick] = useState(false)
  const [plans, setPlans] = useState<MyPlan[]>([])
  const [plan, setPlan] = useState(''); const [phase, setPhase] = useState(0)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const [icon] = artOf(a)
  const g = actGroup(a.kind)
  useEffect(() => {
    if (!pick) return
    supabase.from('lesson_plans').select('id, title, program, lesson, status, draft_of').eq('teacher_id', teacherId).in('status', ['draft', 'editing', 'rejected'])
      .order('updated_at', { ascending: false }).then(({ data }) => { const d = (data as MyPlan[]) ?? []; setPlans(d); if (d[0]) setPlan(d[0].id) })
  }, [pick])
  const sel = plans.find(p => p.id === plan)
  const selLesson: ILesson | null = sel ? (asLesson(sel.lesson) ?? emptyLesson(sel.program)) : null

  async function addTo() {
    if (!sel || !selLesson) return
    setBusy(true)
    const phases = selLesson.phases.map((p, i) => i === phase ? { ...p, blocks: [...p.blocks, activityToBlock(a)] } : p)
    const { error } = await supabase.from('lesson_plans').update({ lesson: { ...selLesson, phases } }).eq('id', sel.id)
    setBusy(false)
    if (error) return setMsg(['Không thêm được: ' + error.message, true])
    setMsg([`Đã thêm vào “${sel.title}” — giai đoạn ${selLesson.phases[phase]?.title}.`, false]); setPick(false)
  }
  async function newLesson() {
    if (!orgId) return
    setBusy(true)
    const l = emptyLesson(a.program)
    l.phases[0].blocks.push(activityToBlock(a))
    const { data, error } = await supabase.from('lesson_plans').insert({ org_id: orgId, teacher_id: teacherId, title: 'Bài giảng: ' + a.title, subject: a.subject, grades: a.grades,
      program: a.program, status: 'draft', lesson: l }).select('id').single()
    setBusy(false)
    if (error || !data) return setMsg(['Không tạo được bài giảng: ' + (error?.message ?? ''), true])
    try { sessionStorage.setItem('kdi.openPlan', data.id) } catch { /* bỏ qua */ }
    if (go) go('Soạn bài giảng'); else setMsg(['Đã tạo bài giảng nháp trong Soạn bài giảng.', false])
  }
  const tags = [ACT_GROUP[g].tag, kindLabel(a), ...gradesOf(a.grades).map(x => 'Khối ' + x), a.subject, a.program].filter(Boolean) as string[]
  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={a.title} onClick={e => e.stopPropagation()}>
        <div className="modalhero actmodalhero">
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span className="acthero-icon" aria-hidden="true"><Icon n={icon} size={40} /></span>
            <div style={{ flex: 1 }}>
              <div className="tilemeta"><span className="herotag">{ACT_GROUP[g].label} — {ACT[a.kind].label}</span>{a.program && <span className="herotag">{a.program}</span>}</div>
              <h3>{a.title}</h3>
            </div>
            <button className="x" onClick={onClose} aria-label="Đóng" style={{ color: '#fff' }}>×</button>
          </div>
        </div>
        <div className="modalbody">
          <p style={{ margin: 0 }}>{a.instructions || ACT[a.kind].desc}</p>
          <div className="gvnote"><b><Icon n="settings" /> GV cấu hình</b><br /><small>Thầy/cô thay bộ câu hỏi, số đội, thời gian… khi thêm vào bài giảng — trò chơi giữ nguyên cách chơi.</small></div>
          <div className="tilemeta">{tags.map(t => <span key={t}>{t}</span>)}</div>
          <div><b>▶ Dùng thử ngay tại đây</b> <small className="sub">— {a.kind === 'sim' ? `kéo thanh trượt, bấm nút để thao tác${SIMS[a.content?.model as SimModel] ? ' với ' + SIMS[a.content.model as SimModel].label.toLowerCase() : ''}` : 'quay, lật thẻ, kéo–thả hoặc trả lời như học sinh'}, dữ liệu không được lưu.</small></div>
          <div className="panel tryout" style={{ margin: 0 }}><TryOut a={a} /></div>
          {pick && (
            <div className="panel" style={{ margin: 0 }}>
              <b>Thêm vào bài giảng của tôi</b>
              {plans.length === 0 ? <p className="sub">Thầy/cô chưa có bài giảng đang soạn. Bấm “Tạo bài giảng mới với hoạt động”.</p> : (
                <div className="formgrid">
                  <label className="field"><span>Bài giảng đang soạn</span><select value={plan} onChange={e => { setPlan(e.target.value); setPhase(0) }}>
                    {plans.map(p => <option key={p.id} value={p.id}>{p.title}{p.draft_of ? ' (bản nháp sửa)' : ''}</option>)}</select></label>
                  <label className="field"><span>Giai đoạn</span><select value={phase} onChange={e => setPhase(Number(e.target.value))}>
                    {(selLesson?.phases ?? []).map((p, i) => <option key={i} value={i}>{p.title} ({p.blocks.length} khối)</option>)}</select></label>
                  <div className="actions"><button className="primary" onClick={addTo} disabled={busy || !sel}>Thêm khối</button><button onClick={() => setPick(false)}>Huỷ</button></div>
                </div>
              )}
            </div>
          )}
          {msg && <p className={msg[1] ? 'warnline' : 'okline'}>{msg[0]}</p>}
        </div>
        <div className="modalfoot" style={{ flexWrap: 'wrap' }}>
          <button onClick={onUse}>Sao chép để sửa</button>
          {!a.is_template && <button onClick={onAssign}>Giao cho lớp</button>}
          <span style={{ flex: 1 }} />
          <button className="primary violet" onClick={() => setPick(true)} disabled={busy}>＋ Thêm vào bài giảng của tôi</button>
          <button onClick={newLesson} disabled={busy}>✦ Tạo bài giảng mới với hoạt động</button>
        </div>
      </div>
    </div>
  )
}

// ================= Kho bài giảng =================
type KindKey = keyof typeof INTERACTION
const HAS_LABEL: Record<KindKey, string> = { sim: 'Có mô phỏng 2D', game: 'Có game hoá', tool: 'Có giáo cụ ảo', drag: 'Có kéo – thả' }
const KIND_ICON: Record<KindKey, string> = { sim: '⚛', game: '🎮', tool: '📏', drag: '↕' }
const levelOf = (g: string | null) => { const n = Number(gradesOf(g)[0]); return !n ? '' : n <= 5 ? 'Tiểu học' : n <= 9 ? 'THCS' : 'THPT' }

function LessonBank({ rows, teacherId, go, onAssign }: { rows: LessonLite[]; teacherId: string; go?: (p: string) => void; onAssign: (l: LessonLite) => void }) {
  const { allCodes: CTS } = useStemTracks()
  const [q, setQ] = useState(''); const [ct, setCt] = useState(''); const [grade, setGrade] = useState(''); const [subj, setSubj] = useState(''); const [kind, setKind] = useState<KindKey | ''>('')
  const [view, setView] = useViewMode('kho-bai-giang')
  const [open, setOpen] = useState<LessonLite | null>(null)
  const stats = useMemo(() => new Map(rows.map(l => [l.id, lessonStats(asLesson(l.lesson))])), [rows])
  const grades = [...new Set(rows.flatMap(l => gradesOf(l.grades)))].sort((a, b) => Number(a) - Number(b))
  const subjects = [...new Set(rows.map(l => l.subject).filter(Boolean) as string[])].sort()
  const base = rows.filter(l => (!q || (l.title + ' ' + (l.subject ?? '') + ' ' + (l.summary ?? '') + ' ' + (asLesson(l.lesson)?.tags ?? []).join(' ')).toLowerCase().includes(q.toLowerCase()))
    && (!ct || l.program === ct) && (!grade || gradesOf(l.grades).includes(grade)) && (!subj || l.subject === subj))
  const shown = base.filter(l => !kind || stats.get(l.id)!.kinds.includes(kind))
  const has = (k: KindKey) => base.filter(l => stats.get(l.id)!.kinds.includes(k)).length
  return (
    <>
      <h3 style={{ margin: '4px 0 0' }}>Kho bài giảng</h3>
      <p className="sub" style={{ marginTop: 2 }}>Bài giảng đã soạn đầy đủ — chọn một bài rồi chỉnh sửa cho lớp của mình.</p>
      <div className="statrow">
        <button className={'statcard' + (kind === '' ? ' on' : '')} onClick={() => setKind('')}><i>◎</i><span><small>Mọi loại tương tác</small><b>{base.length}</b></span></button>
        {(Object.keys(INTERACTION) as KindKey[]).map(k => (
          <button key={k} className={'statcard' + (kind === k ? ' on' : '')} onClick={() => setKind(kind === k ? '' : k)}><i><Icon n={KIND_ICON[k]} size={20} /></i><span><small>{HAS_LABEL[k]}</small><b>{has(k)}</b></span></button>
        ))}
      </div>
      <div className="tools" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <input className="search" style={{ margin: 0, flex: 1, minWidth: 220 }} placeholder="Tìm theo tên bài, mô tả, khối, thẻ hoặc mục tiêu…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm bài giảng" />
        <select value={ct} onChange={e => setCt(e.target.value)} aria-label="Chương trình"><option value="">Tất cả chương trình</option>{CTS.map(c => <option key={c}>{c}</option>)}</select>
        <select value={grade} onChange={e => setGrade(e.target.value)} aria-label="Khối"><option value="">Tất cả khối</option>{grades.map(g => <option key={g} value={g}>Khối {g}</option>)}</select>
        <select value={subj} onChange={e => setSubj(e.target.value)} aria-label="Môn"><option value="">Tất cả môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
        <select value={kind} onChange={e => setKind(e.target.value as KindKey | '')} aria-label="Loại tương tác"><option value="">Mọi loại tương tác</option>
          {(Object.keys(INTERACTION) as KindKey[]).map(k => <option key={k} value={k}>{INTERACTION[k]}</option>)}</select>
        <ViewToggle value={view} onChange={setView} />
      </div>
      {view === 'cards' ? (
        <div className="tilegrid wide">
          {shown.map((l, i) => { const st = stats.get(l.id)!; return (
            <button key={l.id} className="tile" onClick={() => setOpen(l)}>
              <div className={'tileart art' + (i % 6)} style={coverStyle(l)}>
                {l.program && <span className="progchip" style={{ background: PROGRAM_COLOR[l.program], color: '#fff' }}>{l.program}</span>}
</div>
              <div className="tilebody">
                <b>{l.title}</b><small>{l.subject}</small>
                <div className="tilemeta">{levelOf(l.grades) && <span>{levelOf(l.grades)} {gradesOf(l.grades).join(',')}</span>}{st.minutes > 0 && <span>{st.minutes}′</span>}
                  {st.blocks > 0 ? <span>{st.blocks} khối</span> : <span>{l.slides.length} slide</span>}{l.is_template && <span>Mẫu</span>}</div>
                <span className="tilemore">Xem chi tiết ›</span>
              </div>
            </button>) })}
        </div>
      ) : (
        <div className="wrap"><table><thead><tr><th>Bài giảng</th><th>CT</th><th>Môn · khối</th><th>Khối nội dung</th><th>Tương tác</th></tr></thead>
          <tbody>{shown.map(l => { const st = stats.get(l.id)!; return (
            <tr key={l.id}><td><NameLink onClick={() => setOpen(l)} title="Xem chi tiết">{l.title}</NameLink><br /><small className="sub">{l.teachers?.full_name ?? (l.is_template ? 'Mẫu của trường' : '')}</small></td>
              <td>{l.program && <span className="progchip" style={{ background: PROGRAM_COLOR[l.program], color: '#fff' }}>{l.program}</span>}</td>
              <td>{[l.subject, l.grades && 'Khối ' + l.grades].filter(Boolean).join(' · ')}</td><td>{st.blocks || '—'}</td>
              <td>{st.kinds.map(k => <span key={k} title={INTERACTION[k]}><Icon n={KIND_ICON[k]} /> </span>)}</td></tr>) })}</tbody></table></div>
      )}
      {shown.length === 0 && <p className="sub">Chưa có bài giảng phù hợp.</p>}
      {open && <LessonModal l={open} teacherId={teacherId} go={go} onClose={() => setOpen(null)} onAssign={() => onAssign(open)} />}
    </>
  )
}

function LessonModal({ l, teacherId, go, onClose, onAssign }: { l: LessonLite; teacherId: string; go?: (p: string) => void; onClose: () => void; onAssign: () => void }) {
  useEsc(onClose)
  const classes = useMyClasses(teacherId)
  const [cls, setCls] = useState('')
  const [preview, setPreview] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const lesson = asLesson(l.lesson)
  const st = lessonStats(lesson)
  useEffect(() => { if (!cls && classes[0]) setCls(classes[0].id) }, [classes.length])
  async function useTemplate() {
    setBusy(true)
    const c = classes.find(x => x.id === cls)
    const { data, error } = await supabase.rpc('lesson_plan_clone', { p_plan: l.id, p_title: c ? `${l.title.replace(/^Mẫu:\s*/, '')} — ${c.name}` : null })
    setBusy(false)
    if (error || !data) return setMsg('Không dùng được mẫu: ' + (error?.message ?? ''))
    try { sessionStorage.setItem('kdi.openPlan', data as string) } catch { /* bỏ qua */ }
    if (go) go('Soạn bài giảng'); else setMsg('Đã tạo bản của thầy/cô trong Soạn bài giảng.')
  }
  return (
    <div className="modalbg" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={l.title} onClick={e => e.stopPropagation()}>
        <div className="modalhero lessonhero" style={{ ...coverStyle(l), backgroundImage: `linear-gradient(rgba(15,23,42,.35),rgba(15,23,42,.85)),${coverStyle(l).backgroundImage}` }}>
          <div className="bar" style={{ margin: 0 }}>
            <div className="tilemeta">{l.program && <span className="herotag">{l.program}</span>}{l.is_template && <span className="herotag">Mẫu</span>}
              {(levelOf(l.grades) || l.subject) && <span className="herotag">{[levelOf(l.grades) && `${levelOf(l.grades)} ${gradesOf(l.grades).join(',')}`, l.subject].filter(Boolean).join(' · ')}</span>}
              {st.minutes > 0 && <span className="herotag">{st.minutes} phút</span>}</div>
            <button className="x" onClick={onClose} aria-label="Đóng" style={{ color: '#fff' }}>×</button>
          </div>
          <h3>{l.title}</h3>
        </div>
        <div className="modalbody">
          {l.summary && <p style={{ margin: 0 }}>{l.summary}</p>}
          {(lesson?.tags ?? []).length > 0 && <div className="tilemeta">{lesson!.tags!.map(t => <span key={t}>{t}</span>)}</div>}
          {(lesson?.goals ?? []).length > 0 && (
            <div className="goalbox"><b>◎ Mục tiêu bài học</b>
              <ul>{lesson!.goals!.map((g, i) => <li key={i}>✓ {g}</li>)}</ul></div>
          )}
          <div className="simstats">
            <div className="simstat"><small>Tổng khối</small><b>{st.blocks}</b></div>
            <div className="simstat"><small>Khối tương tác</small><b>{st.interactive}</b></div>
            <div className="simstat"><small>Loại tương tác</small><b>{st.kinds.length ? st.kinds.map(k => <span key={k} title={INTERACTION[k]}><Icon n={KIND_ICON[k]} /> </span>) : '—'}</b></div>
          </div>
          {lesson ? <LessonOutline lesson={lesson} ct={l.program} />
            : <p className="sub">Bài giảng này soạn theo dạng slide ({l.slides.length} slide), chưa có tiến trình khối tương tác.</p>}
          {msg && <p className="warnline">{msg}</p>}
        </div>
        <div className="modalfoot" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <span className="tools" style={{ alignItems: 'center' }}>
            <label className="tools" style={{ alignItems: 'center', gap: 6 }}><small>Lớp sẽ dạy</small>
              <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Lớp sẽ dạy">{classes.length === 0 && <option value="">—</option>}{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <small className="sub">Bản của thầy/cô là bản riêng — chỉnh sửa thoải mái, bài mẫu không đổi.</small>
          </span>
          <span className="tools">
            <button onClick={onAssign}>Giao học trước</button>
            <button onClick={() => lesson ? setPreview(true) : setMsg('Bài giảng chưa có nội dung tương tác để xem như học sinh.')}><Icon n="eye" /> Xem trước như học sinh</button>
            <button className="primary violet" onClick={useTemplate} disabled={busy}>✦ Dùng mẫu</button>
          </span>
        </div>
      </div>
      {preview && lesson && <div onClick={e => e.stopPropagation()}><LessonPlayer title={l.title} ct={l.program} sub={[l.subject, l.grades && 'Khối ' + l.grades].filter(Boolean).join(' · ')} lesson={lesson} onClose={() => setPreview(false)} /></div>}
    </div>
  )
}
