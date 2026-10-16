// Giáo viên → Kho hoạt động & Bài giảng (migration 030)
// Hoạt động của tôi · Kho của trường (mẫu + đồng nghiệp đã xuất bản) · Bài giảng có thể giao học trước.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TProps, NoTeacher, PROGRAM_COLOR, Tabs, handoff } from './common'
import { ACT, ACT_KINDS, STARTER, ActivityPlayer, ContentEditor, countItems, unitOf, toPlayable, emptyAnswers, answered,
  type ActKind, type Activity, type Grade } from './activity'

type View = { mode: 'list' } | { mode: 'new' } | { mode: 'edit'; a: Activity } | { mode: 'play'; a: Activity; big: boolean }
type T = 'mine' | 'school' | 'lessons'
type LessonLite = { id: string; title: string; subject: string | null; grades: string | null; program: string | null; is_template: boolean
  status: string; slides: unknown[]; teacher_id: string | null; teachers: { full_name: string } | null }

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
      supabase.from('lesson_plans').select('id, title, subject, grades, program, is_template, status, slides, teacher_id, teachers(full_name)')
        .or('status.eq.published,is_template.eq.true').order('updated_at', { ascending: false }).limit(200),
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
            <span className="acticon" aria-hidden="true">{ACT[k].icon}</span>
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
  const src = (tab === 'mine' ? mine : school).filter(a => (!kind || a.kind === kind) && match(a))
  const ls = lessons.filter(match)

  return (
    <>
      <div className="bar">
        <Tabs<T> value={tab} onChange={setTab} items={[['mine', 'Hoạt động của tôi', mine.length], ['school', 'Kho của trường', school.length], ['lessons', 'Bài giảng', lessons.length]]} />
        <span className="tools">
          {go && <button onClick={() => go('Học trước & tự học')}>Học trước & tự học</button>}
          {go && <button onClick={() => go('Soạn bài giảng')}>Soạn bài giảng</button>}
          <button className="primary" onClick={() => setView({ mode: 'new' })}>+ Tạo hoạt động</button>
        </span>
      </div>
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm theo tên…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        {tab !== 'lessons' && <select value={kind} onChange={e => setKind(e.target.value as ActKind | '')} aria-label="Lọc theo mẫu">
          <option value="">Tất cả mẫu</option>{ACT_KINDS.map(k => <option key={k} value={k}>{ACT[k].label}</option>)}</select>}
      </div>
      {err && <p className="msg">{err}</p>}

      {tab === 'lessons' ? (
        <div className="lessongrid">
          {ls.map(l => (
            <div className="panel lessoncard" key={l.id}>
              <div className="lessoncover">
                {l.program && <span className="progchip" style={{ background: PROGRAM_COLOR[l.program], color: '#fff' }}>{l.program}</span>}
                {l.is_template && <span className="progchip pkgchip">Mẫu</span>}
                <span className="slidecount">{l.slides.length} slide</span>
              </div>
              <b>{l.title}</b>
              <small>{[l.subject, l.grades && `Khối ${l.grades}`, l.teachers?.full_name].filter(Boolean).join(' · ')}</small>
              <div className="tools"><button className="primary" onClick={() => assign('lesson:' + l.id)}>Giao học trước</button></div>
            </div>
          ))}
          {ls.length === 0 && <p className="sub">Chưa có bài giảng nào đã xuất bản.</p>}
        </div>
      ) : (
        <div className="lessongrid">
          {src.map(a => (
            <div className="panel lessoncard" key={a.id}>
              <div className="lessoncover actcover">
                <span className="progchip pkgchip"><span aria-hidden="true">{ACT[a.kind].icon}</span> {ACT[a.kind].label}</span>
                {a.program && <span className="progchip" style={{ background: PROGRAM_COLOR[a.program], color: '#fff' }}>{a.program}</span>}
                {a.is_template && <span className="progchip pkgchip">Mẫu</span>}
                <span className="slidecount">{countItems(a.kind, a.content)} {unitOf(a.kind)}</span>
              </div>
              <b>{a.title}</b>
              <small>{[a.subject, a.grades && `Khối ${a.grades}`, tab === 'school' && a.teachers?.full_name].filter(Boolean).join(' · ')}</small>
              <div className="lessonfoot"><span className={'pill ' + (a.status === 'published' ? 'active' : '')}>{a.status === 'published' ? 'Đã xuất bản' : 'Nháp'}</span></div>
              <div className="tools">
                {tab === 'mine' ? <>
                  <button className="primary" onClick={() => setView({ mode: 'edit', a })}>Soạn</button>
                  <button onClick={() => setView({ mode: 'play', a, big: false })}>Chơi thử</button>
                  <button onClick={() => assign('activity:' + a.id)}>Giao cho lớp</button>
                  <button onClick={() => create(a.kind, a)}>Nhân bản</button>
                  <button className="x" onClick={() => remove(a)} aria-label={`Xoá ${a.title}`}>×</button>
                </> : <>
                  <button className="primary" onClick={() => create(a.kind, a)}>Dùng bài này</button>
                  <button onClick={() => setView({ mode: 'play', a, big: false })}>Xem</button>
                  {!a.is_template && <button onClick={() => assign('activity:' + a.id)}>Giao cho lớp</button>}
                </>}
              </div>
            </div>
          ))}
          {src.length === 0 && <p className="sub">{tab === 'mine' ? 'Chưa có hoạt động nào. Bấm “Tạo hoạt động” để chọn một trong 8 mẫu.' : 'Kho của trường chưa có hoạt động phù hợp.'}</p>}
        </div>
      )}
    </>
  )
}

function Editor({ a, onClose, onPlay }: { a: Activity; onClose: () => void; onPlay: (a: Activity) => void }) {
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
          <span className="progchip pkgchip">{ACT[x.kind].icon} {ACT[x.kind].label}</span>
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
          <select value={x.program ?? ''} onChange={e => upd({ program: e.target.value || null })}><option value="">—</option>{['CT1', 'CT2', 'CT3', 'CT4', 'CT5'].map(c => <option key={c}>{c}</option>)}</select></label>
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
