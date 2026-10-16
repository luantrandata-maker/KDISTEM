// Giáo viên → Học trước & tự học (migration 030)
// Giao hoạt động / bài giảng / đường dẫn cho lớp để học sinh học trước tiết hoặc tự luyện; theo dõi từng học sinh.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { TProps, NoTeacher, Tabs, dueLabel, fmtDateTime, handoff, useMyClasses } from './common'
import { ACT, AnswerText, type ActKind } from './activity'

export type SSItem = {
  id: string; org_id: string; class_id: string; teacher_id: string | null; kind: 'activity' | 'lesson' | 'link'; activity_id: string | null
  lesson_plan_id: string | null; url: string | null; title: string; note: string | null; mode: 'before' | 'practice'; for_date: string | null
  opens_at: string; due_at: string | null; max_attempts: number; status: 'draft' | 'open' | 'closed'; activity_kind: ActKind | null; created_at: string
  classes?: { name: string } | null; teachers?: { full_name: string } | null
}
type Stat = { item_id: string; students: number; opened: number; done: number; avg_score: number | null; late: number }
type Prog = { item_id: string; student_id: string; status: 'started' | 'done'; attempts: number; score: number | null; best_score: number | null
  correct: number | null; total: number | null; answers: any; late: boolean; submitted_at: string | null; teacher_comment: string | null }
type Src = { id: string; title: string; kind?: ActKind }

export const SS_COLS = 'id, org_id, class_id, teacher_id, kind, activity_id, lesson_plan_id, url, title, note, mode, for_date, opens_at, due_at, max_attempts, status, activity_kind, created_at, classes(name), teachers(full_name)'
export const MODE: Record<SSItem['mode'], string> = { before: 'Học trước tiết', practice: 'Tự luyện' }
export const ssKindLabel = (i: Pick<SSItem, 'kind' | 'activity_kind'>) => i.kind === 'lesson' ? 'Bài giảng' : i.kind === 'link' ? 'Đường dẫn' : ACT[i.activity_kind ?? 'quiz'].label
const vnDate = (d: string | null) => d ? d.split('-').reverse().join('/') : ''

type T = 'open' | 'draft' | 'closed'
const blank = () => ({ classes: [] as string[], kind: 'activity' as SSItem['kind'], activity_id: '', lesson_plan_id: '', url: '', title: '', note: '',
  mode: 'before' as SSItem['mode'], for_date: '', due_at: '', max_attempts: 0, publish: true })

export function TeacherSelfStudy({ teacherId, orgId }: TProps) {
  const classes = useMyClasses(teacherId)
  const [items, setItems] = useState<SSItem[]>([])
  const [stats, setStats] = useState<Record<string, Stat>>({})
  const [acts, setActs] = useState<Src[]>([])
  const [lessons, setLessons] = useState<Src[]>([])
  const [cls, setCls] = useState('')
  const [tab, setTab] = useState<T>('open')
  const [form, setForm] = useState<ReturnType<typeof blank> | null>(null)
  const [detail, setDetail] = useState<SSItem | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    if (!teacherId) return
    const ids = classes.map(c => c.id)
    if (!ids.length) return setItems([])
    const { data, error } = await supabase.from('self_study_items').select(SS_COLS).in('class_id', ids).order('opens_at', { ascending: false })
    if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Hãy chạy migration 030_activities_self_study_holidays.sql trên Supabase.' : error.message)
    const list = (data as unknown as SSItem[]) ?? []
    setItems(list)
    if (list.length) {
      const s = await supabase.from('self_study_stats').select('*').in('item_id', list.map(i => i.id))
      setStats(Object.fromEntries(((s.data as Stat[]) ?? []).map(x => [x.item_id, x])))
    }
  }
  useEffect(() => { load() }, [teacherId, classes.length])
  useEffect(() => {
    if (!teacherId) return
    supabase.from('activities').select('id, title, kind, teacher_id, status, is_template').order('title').then(({ data }) =>
      setActs(((data as any[]) ?? []).filter(a => a.status === 'published' || a.teacher_id === teacherId).map(a => ({ id: a.id, title: a.title, kind: a.kind }))))
    supabase.from('lesson_plans').select('id, title, teacher_id, status, is_template').order('title').then(({ data }) =>
      setLessons(((data as any[]) ?? []).filter(l => l.status === 'published' || l.is_template || l.teacher_id === teacherId).map(l => ({ id: l.id, title: l.title }))))
  }, [teacherId])
  // Từ Kho hoạt động: "Giao cho lớp"
  useEffect(() => {
    const ref = handoff.take('teacher.selfstudy')
    if (!ref) return
    const [k, id] = ref.split(':')
    setForm({ ...blank(), kind: k === 'lesson' ? 'lesson' : 'activity', activity_id: k === 'activity' ? id : '', lesson_plan_id: k === 'lesson' ? id : '' })
  }, [])

  if (!teacherId) return <NoTeacher />
  if (detail) return <Detail item={detail} onBack={() => { setDetail(null); load() }} />

  const srcTitle = (f: ReturnType<typeof blank>) => f.kind === 'activity' ? acts.find(a => a.id === f.activity_id)?.title
    : f.kind === 'lesson' ? lessons.find(l => l.id === f.lesson_plan_id)?.title : ''

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !orgId) return
    setErr('')
    if (!form.classes.length) return setErr('Chọn ít nhất một lớp.')
    const title = (form.title.trim() || srcTitle(form) || '').trim()
    if (!title) return setErr('Nhập tên bài.')
    if (form.kind === 'activity' && !form.activity_id) return setErr('Chọn hoạt động.')
    if (form.kind === 'lesson' && !form.lesson_plan_id) return setErr('Chọn bài giảng.')
    if (form.kind === 'link' && !/^https?:\/\//i.test(form.url.trim())) return setErr('Đường dẫn phải bắt đầu bằng http:// hoặc https://')
    const due = form.due_at ? new Date(form.due_at).toISOString() : null
    if (due && new Date(due).getTime() <= Date.now()) return setErr('Hạn hoàn thành phải sau thời điểm hiện tại.')
    const rows = form.classes.map(c => ({
      org_id: orgId, class_id: c, teacher_id: teacherId, kind: form.kind, title, note: form.note.trim() || null, mode: form.mode,
      activity_id: form.kind === 'activity' ? form.activity_id : null, lesson_plan_id: form.kind === 'lesson' ? form.lesson_plan_id : null,
      url: form.kind === 'link' ? form.url.trim() : null, for_date: form.for_date || null, due_at: due,
      max_attempts: form.kind === 'activity' ? form.max_attempts : 0, status: form.publish ? 'open' : 'draft',
    }))
    const { error } = await supabase.from('self_study_items').insert(rows)
    if (error) return setErr('Chưa giao được: ' + error.message)
    setMsg(form.publish ? `Đã giao cho ${rows.length} lớp — học sinh nhận thông báo.` : 'Đã lưu nháp.')
    setForm(null); setTab(form.publish ? 'open' : 'draft'); load()
  }
  async function setStatus(i: SSItem, status: SSItem['status']) {
    const { error } = await supabase.from('self_study_items').update({ status }).eq('id', i.id)
    if (error) setErr(error.message); load()
  }
  async function remove(i: SSItem) {
    if (!confirm(`Xoá “${i.title}” của ${i.classes?.name}? Tiến độ của học sinh cũng bị xoá.`)) return
    const { error } = await supabase.from('self_study_items').delete().eq('id', i.id)
    if (error) setErr(error.message); load()
  }

  const shown = items.filter(i => i.status === tab && (!cls || i.class_id === cls))
  const count = (t: T) => items.filter(i => i.status === t && (!cls || i.class_id === cls)).length
  const pending = items.filter(i => i.status === 'open').reduce((n, i) => n + Math.max(0, (stats[i.id]?.students ?? 0) - (stats[i.id]?.done ?? 0)), 0)

  return (
    <>
      <div className="ktiles">
        <div className="ktile"><span>Đang mở</span><b>{count('open')}</b><small>bài học trước / tự luyện</small></div>
        <div className="ktile"><span>Lượt chưa hoàn thành</span><b>{pending}</b><small>học sinh × bài đang mở</small></div>
        <div className="ktile"><span>Điểm trung bình</span><b>{(() => { const v = items.map(i => stats[i.id]?.avg_score).filter((x): x is number => x != null); return v.length ? (v.reduce((a, b) => a + Number(b), 0) / v.length).toFixed(1) : '—' })()}</b><small>các bài có chấm</small></div>
      </div>
      <div className="bar">
        <Tabs<T> value={tab} onChange={setTab} items={[['open', 'Đang mở', count('open')], ['draft', 'Nháp', count('draft')], ['closed', 'Đã khoá', count('closed')]]} />
        <span className="tools">
          <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Lọc lớp"><option value="">Tất cả lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="primary" onClick={() => { setMsg(''); setForm({ ...blank(), classes: cls ? [cls] : [] }) }}>+ Giao bài</button>
        </span>
      </div>
      {msg && <p className="sub"><b>{msg}</b></p>}
      {err && !form && <p className="msg">{err}</p>}

      {form && (
        <form className="panel" onSubmit={save}>
          <div className="bar"><h3>Giao bài học trước / tự học</h3><button type="button" onClick={() => setForm(null)}>Đóng</button></div>
          <div className="formgrid">
            <div className="field" style={{ gridColumn: '1 / -1' }}><span>Lớp *</span>
              <span className="tools">{classes.map(c => (
                <button type="button" key={c.id} className={'chipbtn' + (form.classes.includes(c.id) ? ' on' : '')} aria-pressed={form.classes.includes(c.id)}
                  onClick={() => setForm({ ...form, classes: form.classes.includes(c.id) ? form.classes.filter(x => x !== c.id) : [...form.classes, c.id] })}>{c.name}</button>
              ))}{classes.length === 0 && <small>Bạn chưa được phân công lớp nào.</small>}</span></div>
            <label className="field"><span>Loại</span>
              <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as SSItem['kind'] })}>
                <option value="activity">Hoạt động tương tác</option><option value="lesson">Bài giảng (xem trước)</option><option value="link">Đường dẫn (video, tài liệu)</option></select></label>
            {form.kind === 'activity' && <label className="field" style={{ gridColumn: 'span 2' }}><span>Hoạt động *</span>
              <select value={form.activity_id} onChange={e => setForm({ ...form, activity_id: e.target.value })}>
                <option value="">— Chọn trong Kho hoạt động —</option>
                {acts.map(a => <option key={a.id} value={a.id}>{a.kind ? ACT[a.kind].label + ' · ' : ''}{a.title}</option>)}</select></label>}
            {form.kind === 'lesson' && <label className="field" style={{ gridColumn: 'span 2' }}><span>Bài giảng *</span>
              <select value={form.lesson_plan_id} onChange={e => setForm({ ...form, lesson_plan_id: e.target.value })}>
                <option value="">— Chọn bài giảng —</option>{lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>}
            {form.kind === 'link' && <label className="field" style={{ gridColumn: 'span 2' }}><span>Đường dẫn *</span>
              <input type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></label>}
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên hiện cho học sinh</span>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={srcTitle(form) || 'VD: Xem video trước tiết thí nghiệm'} maxLength={200} /></label>
            <label className="field"><span>Mục đích</span>
              <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value as SSItem['mode'] })}>
                <option value="before">Học trước tiết</option><option value="practice">Tự luyện / ôn tập</option></select></label>
            {form.mode === 'before' && <label className="field"><span>Cho tiết ngày</span>
              <input type="date" value={form.for_date} onChange={e => setForm({ ...form, for_date: e.target.value })} /></label>}
            <label className="field"><span>Hạn hoàn thành</span>
              <input type="datetime-local" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} /></label>
            {form.kind === 'activity' && <label className="field"><span>Số lượt làm</span>
              <select value={form.max_attempts} onChange={e => setForm({ ...form, max_attempts: Number(e.target.value) })}>
                <option value={0}>Không giới hạn</option>{[1, 2, 3, 5].map(n => <option key={n} value={n}>{n} lượt</option>)}</select></label>}
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Lời dặn</span>
              <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="VD: Làm trước để cô biết lớp đã nắm đến đâu" /></label>
            <label className="field"><span>Trạng thái</span>
              <span><input type="checkbox" checked={form.publish} onChange={e => setForm({ ...form, publish: e.target.checked })} /> Mở ngay cho học sinh</span></label>
            <div className="formactions" style={{ gridColumn: '1 / -1' }}>
              <button className="primary" type="submit">{form.publish ? 'Giao bài' : 'Lưu nháp'}</button>
              {form.kind === 'activity' && <small> Đáp án được giữ trên máy chủ — học sinh chỉ thấy sau khi hết lượt, quá hạn hoặc bài bị khoá.</small>}
            </div>
            {err && <p className="msg">{err}</p>}
          </div>
        </form>
      )}

      {shown.map(i => {
        const s = stats[i.id]; const due = dueLabel(i.due_at)
        return (
          <div className="workrow" key={i.id}>
            <div><b>{i.title}</b><br />
              <small><span className="kind">{ssKindLabel(i)}</span> {i.classes?.name} · {MODE[i.mode]}{i.for_date ? ` (tiết ${vnDate(i.for_date)})` : ''} · </small>
              <small className={'due ' + due.tone}>{due.text}</small>
              {s && s.students > 0 && <div className="track" style={{ marginTop: 6, maxWidth: 360 }} title={`${s.done}/${s.students} học sinh đã xong`}>
                <div className="fill g" style={{ width: (s.done / s.students) * 100 + '%' }} /></div>}
            </div>
            <span className="tools">
              {s && <span className="pill">{s.done}/{s.students} xong</span>}
              {s?.avg_score != null && <span className="pill active">TB {Number(s.avg_score).toFixed(1)}</span>}
            </span>
            <span className="tools">
              <button className="primary" onClick={() => setDetail(i)}>Tiến độ</button>
              {i.status === 'open' && <button onClick={() => setStatus(i, 'closed')}>Khoá</button>}
              {i.status !== 'open' && <button onClick={() => setStatus(i, 'open')}>{i.status === 'draft' ? 'Mở cho HS' : 'Mở lại'}</button>}
              <button className="x" onClick={() => remove(i)} aria-label={`Xoá ${i.title}`}>×</button>
            </span>
          </div>
        )
      })}
      {shown.length === 0 && !form && <p className="sub">{tab === 'open' ? 'Chưa có bài đang mở. Bấm “Giao bài” hoặc mở Kho hoạt động & Bài giảng để chọn hoạt động.' : 'Không có bài nào.'}</p>}
    </>
  )
}

function Detail({ item, onBack }: { item: SSItem; onBack: () => void }) {
  const [students, setStudents] = useState<{ id: string; full_name: string; student_code: string | null }[]>([])
  const [prog, setProg] = useState<Record<string, Prog>>({})
  const [content, setContent] = useState<any>(null)
  const [only, setOnly] = useState<'all' | 'todo' | 'done'>('all')
  const [edit, setEdit] = useState<Record<string, { comment: string; score: string }>>({})
  const [err, setErr] = useState('')

  async function load() {
    const [s, p, c] = await Promise.all([
      supabase.from('students').select('id, full_name, student_code').eq('class_id', item.class_id).order('student_code'),
      supabase.from('self_study_progress').select('*').eq('item_id', item.id),
      supabase.from('self_study_content').select('kind, content').eq('item_id', item.id).maybeSingle(),
    ])
    setStudents((s.data as any[]) ?? [])
    setProg(Object.fromEntries(((p.data as Prog[]) ?? []).map(x => [x.student_id, x])))
    setContent(c.data?.content ?? null)
  }
  useEffect(() => { load() }, [item.id])

  const graded = item.kind === 'activity' && item.activity_kind && ACT[item.activity_kind].graded
  const isWs = item.activity_kind === 'worksheet'
  const rows = useMemo(() => students.filter(s => only === 'all' || (only === 'done' ? prog[s.id]?.status === 'done' : prog[s.id]?.status !== 'done')), [students, prog, only])
  const done = students.filter(s => prog[s.id]?.status === 'done').length
  const st = (p?: Prog) => !p ? ['Chưa mở', ''] : p.status === 'done' ? [p.late ? 'Xong (trễ hạn)' : 'Đã xong', p.late ? 'maintenance' : 'active'] : ['Đang làm', 'maintenance']

  async function saveReview(sid: string) {
    const e = edit[sid]; if (!e) return
    const score = e.score.trim() === '' ? null : Number(e.score.replace(',', '.'))
    if (score != null && (isNaN(score) || score < 0 || score > 10)) return setErr('Điểm từ 0 đến 10.')
    const { error } = await supabase.from('self_study_progress').update({ teacher_comment: e.comment.trim() || null, ...(isWs ? { score } : {}) })
      .eq('item_id', item.id).eq('student_id', sid)
    if (error) return setErr(error.message)
    setEdit(x => { const n = { ...x }; delete n[sid]; return n }); setErr(''); load()
  }
  function exportXlsx() {
    downloadXlsx(`Tu-hoc_${item.classes?.name ?? ''}_${item.title}`.replace(/\s+/g, '-'),
      [{ key: 'code', label: 'Mã HS' }, { key: 'name', label: 'Họ tên', width: 28 }, { key: 'st', label: 'Trạng thái' }, { key: 'n', label: 'Số lượt' },
       { key: 'score', label: 'Điểm lần cuối' }, { key: 'best', label: 'Điểm cao nhất' }, { key: 'at', label: 'Nộp lúc', width: 18 }, { key: 'cm', label: 'Nhận xét', width: 30 }],
      students.map(s => { const p = prog[s.id]; return [s.student_code, s.full_name, st(p)[0], p?.attempts ?? 0, p?.score ?? null, p?.best_score ?? null, p?.submitted_at ? fmtDateTime(p.submitted_at) : '', p?.teacher_comment ?? ''] }),
      'Tiến độ')
  }

  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={onBack}>← Danh sách</button><b>{item.title}</b><span className="kind">{ssKindLabel(item)}</span></span>
        <span className="tools"><button onClick={exportXlsx}>Xuất Excel</button></span>
      </div>
      <p className="sub">{item.classes?.name} · {MODE[item.mode]} · {dueLabel(item.due_at).text}{item.max_attempts ? ` · tối đa ${item.max_attempts} lượt` : ''}{item.note ? ` · “${item.note}”` : ''}</p>
      <div className="ktiles">
        <div className="ktile"><span>Đã xong</span><b>{done}/{students.length}</b></div>
        <div className="ktile"><span>Đang làm</span><b>{students.filter(s => prog[s.id]?.status === 'started').length}</b></div>
        <div className="ktile"><span>Chưa mở</span><b>{students.filter(s => !prog[s.id]).length}</b></div>
        {graded && <div className="ktile"><span>Điểm TB (cao nhất)</span><b>{(() => { const v = Object.values(prog).map(p => p.best_score).filter((x): x is number => x != null); return v.length ? (v.reduce((a, b) => a + Number(b), 0) / v.length).toFixed(1) : '—' })()}</b></div>}
      </div>
      <div className="bar"><Tabs value={only} onChange={setOnly} items={[['all', 'Cả lớp', students.length], ['todo', 'Chưa xong', students.length - done], ['done', 'Đã xong', done]]} /></div>
      {err && <p className="msg">{err}</p>}
      <div className="wrap"><table>
        <thead><tr><th>Học sinh</th><th>Trạng thái</th>{graded && <th>Điểm</th>}<th>Lượt</th><th>Nộp lúc</th>
          {(isWs || graded) && <th>Bài làm</th>}<th>Nhận xét</th></tr></thead>
        <tbody>{rows.map(s => {
          const p = prog[s.id]; const [label, pill] = st(p); const e = edit[s.id]
          return (
            <tr key={s.id}>
              <td><b>{s.full_name}</b><br /><small>{s.student_code}</small></td>
              <td><span className={'pill ' + pill}>{label}</span></td>
              {graded && <td>{p?.score != null ? <b>{Number(p.score).toFixed(1)}</b> : '—'}{p?.best_score != null && p.best_score !== p.score ? <small> (cao nhất {Number(p.best_score).toFixed(1)})</small> : null}
                {p?.total ? <><br /><small>đúng {p.correct}/{p.total}</small></> : null}</td>}
              <td>{p?.attempts ?? 0}</td>
              <td><small>{p?.submitted_at ? fmtDateTime(p.submitted_at) : '—'}</small></td>
              {(isWs || graded) && <td style={{ maxWidth: 360 }}>{p?.answers != null ? <AnswerText kind={item.activity_kind ?? ''} content={content} answers={p.answers} /> : <small>—</small>}</td>}
              <td>{e ? (
                <span className="tools">
                  {isWs && <input style={{ width: 64 }} value={e.score} onChange={x => setEdit({ ...edit, [s.id]: { ...e, score: x.target.value } })} placeholder="Điểm" aria-label="Điểm" />}
                  <input value={e.comment} onChange={x => setEdit({ ...edit, [s.id]: { ...e, comment: x.target.value } })} placeholder="Nhận xét" aria-label="Nhận xét" />
                  <button className="primary" onClick={() => saveReview(s.id)}>Lưu</button>
                  <button onClick={() => setEdit(x => { const n = { ...x }; delete n[s.id]; return n })}>Huỷ</button>
                </span>
              ) : (
                <span className="tools">{p?.teacher_comment && <small>{p.teacher_comment}</small>}
                  {p && <button onClick={() => setEdit({ ...edit, [s.id]: { comment: p.teacher_comment ?? '', score: p.score != null ? String(p.score) : '' } })}>{p.teacher_comment ? 'Sửa' : isWs ? 'Chấm' : 'Nhận xét'}</button>}</span>
              )}</td>
            </tr>
          )
        })}
        {rows.length === 0 && <tr><td colSpan={7}>Không có học sinh.</td></tr>}</tbody>
      </table></div>
    </>
  )
}
