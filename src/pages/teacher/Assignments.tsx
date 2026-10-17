import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TProps, NoTeacher, KIND_LABEL, useMyClasses, dueLabel, fmtDateTime, handoff, Tabs } from './common'
import { type Rubric, RubricField, RubricGrader, RubricSummary, rubricProblem } from './rubric'

type Overview = {
  id: string; class_id: string; class_name: string; topic_id: string | null; title: string; kind: string; subject: string | null
  instructions: string | null; max_score: number; group_mode: boolean; due_at: string | null; status: string
  target_count: number; submitted_count: number; graded_count: number; late_count: number
}
type Topic = { id: string; class_id: string; title: string }
type Form = {
  id?: string; class_id: string; topic_id: string; title: string; kind: string; subject: string; group_mode: boolean
  due_at: string; max_score: string; instructions: string; status: string; rubric: Rubric | null
}
type TabKey = 'all' | 'open' | 'grading' | 'soon' | 'overdue'

const DAY = 86400000
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16)
}
const defaultDue = () => { const d = new Date(Date.now() + 7 * DAY); d.setHours(23, 59, 0, 0); return toLocalInput(d.toISOString()) }

export function TeacherAssignments({ teacherId, orgId, go }: TProps) {
  const classes = useMyClasses(teacherId)
  const [rows, setRows] = useState<Overview[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [groups, setGroups] = useState<Record<string, number>>({})
  const [tab, setTab] = useState<TabKey>('all')
  const [cls, setCls] = useState('')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [grouping, setGrouping] = useState<{ class_id: string; n: number } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    if (!teacherId) return
    const ids = classes.map(c => c.id)
    const [a, t, g] = await Promise.all([
      supabase.from('assignment_overview').select('*').eq('teacher_id', teacherId).order('due_at', { ascending: true, nullsFirst: false }),
      ids.length ? supabase.from('class_topics').select('id, class_id, title').in('class_id', ids).order('starts_on') : Promise.resolve({ data: [] }),
      ids.length ? supabase.from('student_groups').select('class_id').in('class_id', ids) : Promise.resolve({ data: [] }),
    ])
    setRows((a.data as Overview[]) ?? []); setTopics((t.data as Topic[]) ?? [])
    const gm: Record<string, number> = {}; ((g.data as { class_id: string }[]) ?? []).forEach(x => { gm[x.class_id] = (gm[x.class_id] ?? 0) + 1 }); setGroups(gm)
  }
  useEffect(() => { load() }, [teacherId, classes.length])

  const now = Date.now()
  const is = {
    open: (r: Overview) => r.status === 'open',
    grading: (r: Overview) => r.submitted_count > r.graded_count,
    soon: (r: Overview) => r.status === 'open' && !!r.due_at && new Date(r.due_at).getTime() > now && new Date(r.due_at).getTime() - now <= 3 * DAY,
    overdue: (r: Overview) => r.status === 'open' && !!r.due_at && new Date(r.due_at).getTime() < now,
  }
  const base = rows.filter(r => (!cls || r.class_id === cls) && (!kind || r.kind === kind) && (!q || r.title.toLowerCase().includes(q.toLowerCase())))
  const shown = tab === 'all' ? base : base.filter(is[tab])
  const pendingGrade = rows.reduce((s, r) => s + (r.submitted_count - r.graded_count), 0)

  function openForm(r?: Overview) {
    setErr('')
    setForm(r ? {
      id: r.id, class_id: r.class_id, topic_id: r.topic_id ?? '', title: r.title, kind: r.kind, subject: r.subject ?? '', group_mode: r.group_mode,
      due_at: toLocalInput(r.due_at), max_score: String(r.max_score), instructions: r.instructions ?? '', status: r.status, rubric: null,
    } : {
      class_id: cls || classes[0]?.id || '', topic_id: '', title: '', kind: 'worksheet', subject: classes.find(c => c.id === (cls || classes[0]?.id))?.subjects[0] ?? '',
      group_mode: false, due_at: defaultDue(), max_score: '10', instructions: '', status: 'open', rubric: null,
    })
    // Tiêu chí của bài đã giao (không có trong view assignment_overview)
    if (r) supabase.from('assignments').select('rubric').eq('id', r.id).single().then(({ data }) => {
      const rb = (data as { rubric: Rubric | null } | null)?.rubric
      if (rb) setForm(f => f && f.id === r.id ? { ...f, rubric: rb } : f)
    })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !orgId) return
    const body = {
      class_id: form.class_id, topic_id: form.topic_id || null, title: form.title.trim(), kind: form.kind, subject: form.subject.trim() || null,
      group_mode: form.group_mode, due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      max_score: Number(form.max_score) || 10, instructions: form.instructions.trim() || null, status: form.status,
      rubric: form.rubric ? { title: form.rubric.title.trim() || 'Tiêu chí', criteria: form.rubric.criteria.map(c => ({ ...c, name: c.name.trim(), points: Number(c.points) })) } : null,
    }
    if (form.rubric) { const p = rubricProblem(form.rubric); if (p) return setErr(p) }
    const { error } = form.id
      ? await supabase.from('assignments').update(body).eq('id', form.id)
      : await supabase.from('assignments').insert({ ...body, org_id: orgId, teacher_id: teacherId })
    if (error) return setErr('Không lưu được: ' + error.message)
    if (form.group_mode && !groups[form.class_id]) setGrouping({ class_id: form.class_id, n: 4 })
    setForm(null); load()
  }

  async function setStatus(r: Overview, status: string) {
    const { error } = await supabase.from('assignments').update({ status }).eq('id', r.id)
    if (error) setErr(error.message); load()
  }
  async function remove(r: Overview) {
    if (!confirm(`Xoá đề “${r.title}”?${r.submitted_count ? `\n${r.submitted_count} bài nộp cũng sẽ bị xoá.` : ''}`)) return
    const { error } = await supabase.from('assignments').delete().eq('id', r.id)
    if (error) setErr(error.message); load()
  }

  // Chia lớp thành n nhóm theo thứ tự mã học sinh (xoá nhóm cũ của lớp)
  async function makeGroups() {
    if (!grouping || !orgId) return
    const { class_id, n } = grouping
    const { data: st } = await supabase.from('students').select('id').eq('class_id', class_id).order('student_code')
    if (!st?.length) return setErr('Lớp chưa có học sinh.')
    await supabase.from('student_groups').delete().eq('class_id', class_id)
    const { data: gs, error } = await supabase.from('student_groups')
      .insert(Array.from({ length: n }, (_, i) => ({ org_id: orgId, class_id, name: `Nhóm ${i + 1}` }))).select('id, name')
    if (error || !gs) return setErr('Không tạo được nhóm: ' + (error?.message ?? ''))
    const ordered = [...gs].sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }))
    const r2 = await supabase.from('student_group_members').insert(st.map((s, i) => ({ org_id: orgId, group_id: ordered[i % n].id, student_id: s.id })))
    if (r2.error) return setErr(r2.error.message)
    setGrouping(null); load()
  }

  if (!teacherId) return <NoTeacher />
  const formTopics = topics.filter(t => t.class_id === form?.class_id)
  return (
    <>
      <div className="bar">
        <Tabs<TabKey> value={tab} onChange={setTab} items={[
          ['all', 'Tất cả', base.length], ['open', 'Đề đang mở', base.filter(is.open).length], ['grading', 'Bài chờ chấm', base.filter(is.grading).length],
          ['soon', 'Sắp hết hạn (≤ 3 ngày)', base.filter(is.soon).length], ['overdue', 'Quá hạn', base.filter(is.overdue).length],
        ]} />
        <span className="tools">
          <button onClick={() => setGrouping({ class_id: cls || classes[0]?.id || '', n: 4 })} disabled={!classes.length}>Chia nhóm</button>
          <button className="primary" onClick={() => openForm()} disabled={!classes.length}>+ Tạo đề</button>
        </span>
      </div>
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm đề bài…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm đề bài" />
        <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Lọc lớp"><option value="">Tất cả lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Lọc loại"><option value="">Tất cả loại</option>{Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {pendingGrade > 0 && <button onClick={() => go?.('Chấm bài')}>{pendingGrade} bài chờ chấm →</button>}
      </div>
      {err && <p className="msg">{err}</p>}
      {classes.length === 0 && <p className="sub">Bạn chưa được phân công lớp nào nên chưa thể giao bài.</p>}

      {grouping && (
        <div className="panel formgrid">
          <label className="field"><span>Lớp</span>
            <select value={grouping.class_id} onChange={e => setGrouping({ ...grouping, class_id: e.target.value })}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Số nhóm</span>
            <input type="number" min={2} max={12} value={grouping.n} onChange={e => setGrouping({ ...grouping, n: Math.max(2, Math.min(12, Number(e.target.value) || 2)) })} /></label>
          <p className="sub" style={{ alignSelf: 'end', margin: 0 }}>
            {groups[grouping.class_id] ? `Lớp đang có ${groups[grouping.class_id]} nhóm — chia lại sẽ thay nhóm cũ.` : 'Lớp chưa có nhóm. Bài nộp theo nhóm cần chia nhóm trước.'}
          </p>
          <div className="formactions"><button className="primary" onClick={makeGroups}>Chia nhóm</button> <button onClick={() => setGrouping(null)}>Huỷ</button></div>
        </div>
      )}

      {form && (
        <form className="panel formgrid" onSubmit={save}>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Đề bài *</span>
            <input required maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Phiếu học tập: Đo nhiệt độ nước" /></label>
          <label className="field"><span>Lớp *</span>
            <select required value={form.class_id} onChange={e => setForm({ ...form, class_id: e.target.value, topic_id: '' })}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Loại</span>
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value, group_mode: e.target.value === 'product' ? true : form.group_mode })}>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field"><span>Môn</span>
            <input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} list="subjects" /></label>
          <datalist id="subjects">{[...new Set(classes.flatMap(c => c.subjects))].map(s => <option key={s} value={s} />)}</datalist>
          <label className="field"><span>Chủ đề STEM</span>
            <select value={form.topic_id} onChange={e => setForm({ ...form, topic_id: e.target.value })}>
              <option value="">Không gắn chủ đề</option>{formTopics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
          <label className="field"><span>Hạn nộp</span>
            <input type="datetime-local" value={form.due_at} onChange={e => setForm({ ...form, due_at: e.target.value })} /></label>
          <label className="field"><span>Thang điểm</span>
            <input type="number" min={1} max={100} step="0.5" value={form.max_score} onChange={e => setForm({ ...form, max_score: e.target.value })} /></label>
          <label className="field"><span>Hình thức nộp</span>
            <span><input type="checkbox" checked={form.group_mode} onChange={e => setForm({ ...form, group_mode: e.target.checked })} /> Nộp theo nhóm
              {form.group_mode && !groups[form.class_id] && <small> · lớp chưa chia nhóm</small>}</span></label>
          <label className="field"><span>Trạng thái</span>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
              <option value="open">Giao ngay</option><option value="draft">Lưu nháp (học sinh chưa thấy)</option><option value="closed">Đã đóng</option></select></label>
          <RubricField value={form.rubric} onChange={r => setForm(f => f && { ...f, rubric: r })} orgId={orgId ?? null} />
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Hướng dẫn</span>
            <textarea rows={3} value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} placeholder="Yêu cầu, tiêu chí chấm, tài liệu đính kèm (đường dẫn)…" /></label>
          <div className="formactions"><button className="primary" type="submit">{form.id ? 'Lưu' : 'Giao bài'}</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}

      <div className="wrap">
        <table>
          <thead><tr><th>Đề bài</th><th>Lớp</th><th>Hạn nộp</th><th>Đã nộp</th><th>Đã chấm</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            {shown.map(r => {
              const due = dueLabel(r.due_at)
              const waiting = r.submitted_count - r.graded_count
              return (
                <tr key={r.id}>
                  <td><b>{r.title}</b> <span className={'kind ' + r.kind}>{KIND_LABEL[r.kind]}</span>
                    {r.group_mode && <><br /><small>Nộp theo nhóm</small></>}</td>
                  <td className="nowrap">{r.class_name}</td>
                  <td className={'due ' + (r.status === 'open' ? due.tone : '')}>{due.text}</td>
                  <td>{r.submitted_count}/{r.target_count}{r.late_count > 0 && <><br /><small className="due bad">{r.late_count} trễ</small></>}</td>
                  <td>{r.graded_count}/{r.submitted_count}</td>
                  <td><span className={'pill ' + (r.status === 'open' ? 'active' : r.status === 'draft' ? 'maintenance' : '')}>
                    {{ open: 'Đang mở', draft: 'Nháp', closed: 'Đã đóng' }[r.status]}</span></td>
                  <td className="rowactions">
                    {r.submitted_count > 0 && (
                      <button className={waiting ? 'primary' : ''} onClick={() => { handoff.set('grading.assignment', r.id); go?.('Chấm bài') }}>
                        {waiting ? `Chấm bài (${waiting})` : 'Xem kết quả'}</button>
                    )}
                    <button onClick={() => openForm(r)}>Sửa</button>
                    {r.status === 'open' ? <button onClick={() => setStatus(r, 'closed')}>Đóng</button>
                      : <button onClick={() => setStatus(r, 'open')}>{r.status === 'draft' ? 'Giao' : 'Mở lại'}</button>}
                    <button className="x" onClick={() => remove(r)} aria-label={`Xoá ${r.title}`}>×</button>
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && <tr><td colSpan={7}>Không có đề nào{tab !== 'all' ? ' trong mục này' : ''}.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}

type Sub = {
  id: string; assignment_id: string; student_id: string | null; group_id: string | null; content: string | null; attachment_url: string | null
  submitted_at: string; status: string; score: number | null; feedback: string | null; graded_at: string | null
  assignments: { id: string; title: string; kind: string; class_id: string; due_at: string | null; max_score: number; rubric: Rubric | null; classes: { name: string } | null } | null
  rubric_scores: (number | null)[] | null
  students: { full_name: string; student_code: string | null } | null
  student_groups: { name: string; student_group_members: { students: { full_name: string } | null }[] } | null
}
type GTab = 'todo' | 'late' | 'done'

export function TeacherGrading({ teacherId }: TProps) {
  const [subs, setSubs] = useState<Sub[]>([])
  const [assigns, setAssigns] = useState<{ id: string; title: string; class_id: string; group_mode: boolean; class_name: string }[]>([])
  const [tab, setTab] = useState<GTab>('todo')
  const [aid, setAid] = useState(() => handoff.take('grading.assignment') ?? '')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<{ id: string; score: string; feedback: string; levels: (number | null)[] } | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [err, setErr] = useState('')

  async function load() {
    if (!teacherId) return
    const [s, a] = await Promise.all([
      supabase.from('submissions')
        .select('*, assignments!inner(id, title, kind, class_id, due_at, max_score, rubric, teacher_id, classes(name)), students(full_name, student_code), student_groups(name, student_group_members(students(full_name)))')
        .eq('assignments.teacher_id', teacherId).order('submitted_at', { ascending: true }),
      supabase.from('assignment_overview').select('id, title, class_id, group_mode, class_name').eq('teacher_id', teacherId).order('created_at', { ascending: false }),
    ])
    if (s.error) setErr(s.error.message)
    setSubs((s.data as unknown as Sub[]) ?? []); setAssigns((a.data as any[]) ?? [])
  }
  useEffect(() => { load() }, [teacherId])

  // Ai chưa nộp đề đang chọn
  useEffect(() => {
    const a = assigns.find(x => x.id === aid)
    if (!a) return setMissing([])
    const done = subs.filter(s => s.assignment_id === aid)
    ;(a.group_mode
      ? supabase.from('student_groups').select('id, name').eq('class_id', a.class_id).order('name')
          .then(({ data }) => (data ?? []).filter(g => !done.some(s => s.group_id === g.id)).map(g => g.name))
      : supabase.from('students').select('id, full_name').eq('class_id', a.class_id).order('student_code')
          .then(({ data }) => (data ?? []).filter(st => !done.some(s => s.student_id === st.id)).map(st => st.full_name))
    ).then(setMissing)
  }, [aid, assigns, subs])

  const isLate = (s: Sub) => !!s.assignments?.due_at && new Date(s.submitted_at) > new Date(s.assignments.due_at)
  const who = (s: Sub) => s.students?.full_name ?? s.student_groups?.name ?? '—'
  const base = useMemo(() => subs.filter(s => (!aid || s.assignment_id === aid)
    && (!q || who(s).toLowerCase().includes(q.toLowerCase()) || s.assignments?.title.toLowerCase().includes(q.toLowerCase()))), [subs, aid, q])
  const lists: Record<GTab, Sub[]> = {
    todo: base.filter(s => s.status !== 'graded'),
    late: base.filter(isLate),
    done: base.filter(s => s.status === 'graded'),
  }
  const shown = lists[tab]

  async function save(e: React.FormEvent, next: boolean) {
    e.preventDefault()
    if (!open) return
    const sub = subs.find(s => s.id === open.id)
    const max = sub?.assignments?.max_score ?? 10
    const rb = sub?.assignments?.rubric
    let patch: Record<string, unknown>
    if (rb) {   // chấm theo tiêu chí: CSDL tính điểm từ mức đạt
      if (open.levels.length !== rb.criteria.length || open.levels.some(l => !l)) return setErr(`Chọn mức cho đủ ${rb.criteria.length} tiêu chí.`)
      patch = { rubric_scores: open.levels, feedback: open.feedback.trim() || null }
    } else {
      const score = Number(open.score.replace(',', '.'))
      if (open.score === '' || Number.isNaN(score) || score < 0 || score > max) return setErr(`Điểm phải từ 0 đến ${max}.`)
      patch = { score, feedback: open.feedback.trim() || null }
    }
    const { error } = await supabase.from('submissions').update(patch).eq('id', open.id)
    if (error) return setErr('Không lưu được: ' + error.message)
    setErr('')
    const queue = lists.todo.filter(s => s.id !== open.id)
    await load()
    if (next && queue[0]) setOpen({ id: queue[0].id, score: '', feedback: '', levels: [] }); else setOpen(null)
  }

  if (!teacherId) return <NoTeacher />
  const cur = open && subs.find(s => s.id === open.id)
  return (
    <>
      <div className="bar">
        <Tabs<GTab> value={tab} onChange={setTab} items={[['todo', 'Cần chấm', lists.todo.length], ['late', 'Nộp trễ', lists.late.length], ['done', 'Đã chấm', lists.done.length]]} />
        <span className="tools">
          <input className="search" style={{ margin: 0 }} placeholder="Tìm học sinh, nhóm, đề…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <select value={aid} onChange={e => setAid(e.target.value)} aria-label="Lọc đề">
            <option value="">Tất cả đề</option>{assigns.map(a => <option key={a.id} value={a.id}>{a.class_name} · {a.title}</option>)}</select>
        </span>
      </div>
      {err && <p className="msg">{err}</p>}
      {aid && subs.some(s => s.assignment_id === aid && s.assignments?.rubric) && <RubricSummary key={aid + lists.done.length} assignmentId={aid} />}
      {aid && missing.length > 0 && (
        <p className="sub">Chưa nộp ({missing.length}): {missing.join(', ')}</p>
      )}

      {cur && open && (
        <form className={'panel gradebox' + (cur.assignments?.rubric ? ' wide' : '')} onSubmit={e => save(e, false)}>
          <div>
            <small>{cur.assignments?.classes?.name} · {cur.assignments?.title}</small>
            <h3>{who(cur)}{cur.student_groups && <small> · {cur.student_groups.student_group_members.map(m => m.students?.full_name).filter(Boolean).join(', ')}</small>}</h3>
            <small>Nộp lúc {fmtDateTime(cur.submitted_at)}{isLate(cur) && <b className="due bad"> · nộp trễ</b>}</small>
            <div className="answer">{cur.content || <i>Không có nội dung văn bản.</i>}</div>
            {cur.attachment_url && <a href={cur.attachment_url} target="_blank" rel="noreferrer">Mở tệp đính kèm ↗</a>}
          </div>
          <div className="formgrid">
            {cur.assignments?.rubric
              ? <div style={{ gridColumn: '1 / -1' }}><RubricGrader rubric={cur.assignments.rubric} max={cur.assignments.max_score} levels={open.levels}
                  onChange={l => setOpen({ ...open, levels: l })} /></div>
              : <label className="field"><span>Điểm (/{cur.assignments?.max_score ?? 10}) *</span>
                  <input autoFocus inputMode="decimal" value={open.score} onChange={e => setOpen({ ...open, score: e.target.value })} /></label>}
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Nhận xét</span>
              <textarea rows={3} value={open.feedback} onChange={e => setOpen({ ...open, feedback: e.target.value })} placeholder="Điểm mạnh, cần cải thiện…" /></label>
            <div className="formactions">
              <button className="primary" type="submit">Lưu điểm</button>{' '}
              <button type="button" onClick={e => save(e, true)}>Lưu & chấm bài tiếp</button>{' '}
              <button type="button" onClick={() => setOpen(null)}>Đóng</button>
            </div>
          </div>
        </form>
      )}

      <div className="wrap">
        <table>
          <thead><tr><th>Học sinh / nhóm</th><th>Đề bài</th><th>Lớp</th><th>Nộp lúc</th><th>Điểm</th><th></th></tr></thead>
          <tbody>
            {shown.map(s => (
              <tr key={s.id}>
                <td><b>{who(s)}</b>{s.group_id && <small> · Nhóm</small>}</td>
                <td>{s.assignments?.title} <span className={'kind ' + s.assignments?.kind}>{KIND_LABEL[s.assignments?.kind ?? '']}</span></td>
                <td>{s.assignments?.classes?.name}</td>
                <td className="nowrap">{fmtDateTime(s.submitted_at)}{isLate(s) && <><br /><small className="due bad">Nộp trễ</small></>}</td>
                <td>{s.score != null ? <b>{s.score}/{s.assignments?.max_score}</b> : '—'}</td>
                <td><button className={s.status !== 'graded' ? 'primary' : ''}
                  onClick={() => setOpen({ id: s.id, score: s.score != null ? String(s.score) : '', feedback: s.feedback ?? '', levels: s.rubric_scores ?? [] })}>
                  {s.status === 'graded' ? 'Sửa điểm' : 'Chấm bài'}</button></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6}>{tab === 'todo' ? 'Không còn bài nào cần chấm.' : 'Không có bài nào.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
