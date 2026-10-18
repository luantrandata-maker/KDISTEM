import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { norm, downloadXlsx } from '../../lib/sheet'
import { Tabs } from '../teacher/common'
import { StepTrail, useLatestRequests, decideText, approvalError } from '../approvals/common'
import { KHKT_FIELDS, STEM_FIELDS, words } from './templates'

// Dự án STEM của học sinh (migration 051). Trường / GV / HS: tạo, sửa, gửi duyệt; phụ huynh, Sở: xem.
type P = { id: string; org_id: string; title: string; kind: 'science' | 'engineering'; field: string | null; school_year: string | null; problem: string | null; abstract: string | null
  mentor_teacher_id: string | null; external_mentor: string | null; links: { label: string; url: string }[]; status: string; created_at: string
  teachers: { full_name: string } | null; organizations: { name: string } | null
  project_members: { student_id: string; role: string; students: { full_name: string; classes: { name: string } | null } | null }[]
  competition_entries: { status: string; award: string | null; competitions: { title: string } | null }[] }
type Log = { id: string; author_name: string | null; kind: string; content: string; link: string | null; created_at: string }
const ST: Record<string, [string, string]> = { draft: ['Nháp', 'mute'], pending: ['Chờ duyệt', 'bad'], approved: ['Đang thực hiện', 'ok'], rejected: ['Bị từ chối', 'bad'], completed: ['Hoàn thành', 'ok'] }
const KIND = { science: 'Nghiên cứu khoa học', engineering: 'Kỹ thuật / sản phẩm' }
const syear = (d = new Date()) => (d.getMonth() >= 7 ? `${d.getFullYear()}-${d.getFullYear() + 1}` : `${d.getFullYear() - 1}-${d.getFullYear()}`)
const when = (d: string) => new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 051 trên Supabase.' : /row-level/i.test(m) ? 'Bạn không có quyền sửa dự án này.' : approvalError(m))

export function ProjectsPage({ orgId, teacherId, studentId, readOnly = false }: { orgId: string | null; teacherId?: string | null; studentId?: string | null; readOnly?: boolean }) {
  const [rows, setRows] = useState<P[]>([])
  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([])
  const [students, setStudents] = useState<{ id: string; full_name: string; classes: { name: string } | null }[]>([])
  const [form, setForm] = useState<(Partial<P> & { members: string[] }) | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [logs, setLogs] = useState<Log[]>([])
  const [note, setNote] = useState({ content: '', link: '', kind: 'progress' })
  const [q, setQ] = useState(''); const [pick, setPick] = useState('')
  const [tab, setTab] = useState<'active' | 'done' | 'all'>('active')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [admin, setAdmin] = useState(false)
  const { map: reqs, reload: reloadReqs } = useLatestRequests('student_projects', rows.map(r => r.id))
  async function load() {
    const [p, t, s, a] = await Promise.all([
      supabase.from('student_projects').select('*, teachers(full_name), organizations(name), project_members(student_id, role, students(full_name, classes(name))), competition_entries(status, award, competitions(title))').order('created_at', { ascending: false }),
      orgId && !readOnly ? supabase.from('teachers').select('id, full_name').eq('org_id', orgId).eq('status', 'active').order('full_name') : Promise.resolve({ data: [] }),
      orgId && !readOnly ? supabase.from('students').select('id, full_name, classes(name)').eq('org_id', orgId).neq('status', 'erased').order('full_name').limit(3000) : Promise.resolve({ data: [] }),
      supabase.rpc('is_admin'),
    ])
    if (p.error) setMsg([errText(p.error.message), true])
    setRows((p.data as unknown as P[]) ?? []); setTeachers(((t as any).data as any[]) ?? []); setStudents(((s as any).data as any[]) ?? []); setAdmin(!!a.data)
  }
  useEffect(() => { load() }, [])
  async function loadLogs(id: string) { const { data } = await supabase.from('project_logs').select('*').eq('project_id', id).order('created_at'); setLogs((data as Log[]) ?? []) }
  useEffect(() => { if (open) loadLogs(open) }, [open])
  const mine = (p: P) => !readOnly && p.org_id === orgId && (admin || (!!teacherId && p.mentor_teacher_id === teacherId) || p.project_members.some(m => m.student_id === studentId))
  const shown = rows.filter(p => (tab === 'all' || (tab === 'done' ? p.status === 'completed' : p.status !== 'completed'))
    && (!q || norm(p.title + ' ' + (p.field ?? '') + ' ' + p.project_members.map(m => m.students?.full_name).join(' ')).includes(norm(q))))

  async function save(submit: boolean) {
    if (!form || !orgId) return
    if (!form.title?.trim() || form.title.trim().length < 5) return setMsg(['Tên dự án cần ít nhất 5 ký tự.', true])
    if (submit && !form.members.length) return setMsg(['Thêm ít nhất một học sinh.', true])
    const row = { org_id: orgId, title: form.title.trim(), kind: form.kind ?? 'engineering', field: form.field?.trim() || null, school_year: form.school_year || syear(), problem: form.problem?.trim() || null,
      abstract: form.abstract?.trim() || null, mentor_teacher_id: form.mentor_teacher_id || null, external_mentor: form.external_mentor?.trim() || null,
      links: (form.links ?? []).filter(l => l.url.trim()).map(l => ({ label: l.label.trim() || 'Tài liệu', url: l.url.trim() })) }
    let id = form.id
    if (id) { const { error } = await supabase.from('student_projects').update(row).eq('id', id); if (error) return setMsg([errText(error.message), true]) }
    else { const { data, error } = await supabase.from('student_projects').insert(row).select('id').single(); if (error) return setMsg([errText(error.message), true]); id = data.id }
    const cur = rows.find(r => r.id === id)?.project_members.map(m => m.student_id) ?? (studentId ? [studentId] : [])
    const del = cur.filter(x => !form.members.includes(x)), add = form.members.filter(x => !cur.includes(x))
    if (del.length) await supabase.from('project_members').delete().eq('project_id', id!).in('student_id', del)
    if (add.length) { const { error } = await supabase.from('project_members').insert(add.map((s, i) => ({ project_id: id, student_id: s, role: !cur.length && i === 0 ? 'leader' : 'member' }))); if (error) return setMsg([errText(error.message), true]) }
    if (submit) { const { error } = await supabase.from('student_projects').update({ status: 'pending' }).eq('id', id!); if (error) return setMsg([errText(error.message), true]) }
    setForm(null); setMsg([submit ? 'Đã gửi duyệt — Ban giám hiệu duyệt ở Hộp phê duyệt.' : 'Đã lưu.', false]); await load(); reloadReqs()
  }
  async function decide(p: P, d: 'approve' | 'reject') {
    const note = d === 'reject' ? prompt('Lý do:') : null; if (d === 'reject' && note === null) return
    const { data, error } = await supabase.rpc('approval_decide_ref', { p_table: 'student_projects', p_ref: p.id, p_decision: d, p_note: note })
    if (error) return setMsg([errText(error.message), true]); setMsg([decideText(data as any), false]); await load(); reloadReqs()
  }
  async function setStatus(p: P, status: string) {
    const { error } = await supabase.from('student_projects').update({ status }).eq('id', p.id)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  async function addLog(p: P) {
    if (!note.content.trim()) return
    const { data: me } = await supabase.auth.getUser()
    const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', me.user?.id ?? '').maybeSingle()
    const { error } = await supabase.from('project_logs').insert({ project_id: p.id, author: me.user?.id, author_name: prof?.full_name ?? null, kind: note.kind, content: note.content.trim(), link: note.link.trim() || null })
    if (error) return setMsg([errText(error.message), true]); setNote({ content: '', link: '', kind: note.kind }); loadLogs(p.id)
  }
  function excel() {
    downloadXlsx('du-an-stem', [{ key: 't', label: 'Dự án', width: 34 }, { key: 'f', label: 'Lĩnh vực', width: 22 }, { key: 'm', label: 'Học sinh', width: 32 }, { key: 'g', label: 'GV hướng dẫn', width: 22 },
      { key: 's', label: 'Trạng thái' }, { key: 'a', label: 'Giải thưởng', width: 30 }],
      shown.map(p => [p.title, p.field, p.project_members.map(m => m.students?.full_name).join(', '), p.teachers?.full_name, ST[p.status][0], p.competition_entries.filter(e => e.award).map(e => `${e.award} — ${e.competitions?.title}`).join('; ')]), 'Dự án')
  }
  const fieldList = form?.kind === 'science' ? KHKT_FIELDS : [...STEM_FIELDS, ...KHKT_FIELDS]
  return (
    <>
      <div className="bar">
        <Tabs<'active' | 'done' | 'all'> value={tab} onChange={setTab} items={[['active', 'Đang thực hiện', rows.filter(r => r.status !== 'completed').length], ['done', 'Hoàn thành', rows.filter(r => r.status === 'completed').length], ['all', 'Tất cả', rows.length]]} />
        <span className="tools"><input className="search" style={{ margin: 0 }} placeholder="Tìm dự án, học sinh…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <button onClick={excel}>Xuất Excel</button>
          {!readOnly && orgId && <button className="primary" onClick={() => setForm({ kind: 'engineering', school_year: syear(), mentor_teacher_id: teacherId ?? null, links: [], members: studentId ? [studentId] : [] })}>+ Dự án mới</button>}</span>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={e => { e.preventDefault(); save(false) }}>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên dự án *</span><input required value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field"><span>Loại</span><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as P['kind'] })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Lĩnh vực</span><input list="pj-fields" value={form.field ?? ''} onChange={e => setForm({ ...form, field: e.target.value })} /><datalist id="pj-fields">{fieldList.map(f => <option key={f} value={f} />)}</datalist></label>
          <label className="field"><span>Năm học</span><input value={form.school_year ?? ''} onChange={e => setForm({ ...form, school_year: e.target.value })} placeholder="2026-2027" /></label>
          <label className="field"><span>Giáo viên hướng dẫn</span><select value={form.mentor_teacher_id ?? ''} onChange={e => setForm({ ...form, mentor_teacher_id: e.target.value || null })}><option value="">—</option>{teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></label>
          <label className="field"><span>Người hướng dẫn ngoài (nhà khoa học…)</span><input value={form.external_mentor ?? ''} onChange={e => setForm({ ...form, external_mentor: e.target.value })} /></label>
          <div className="field" style={{ gridColumn: '1 / -1' }}><span>Học sinh thực hiện *</span>
            <span className="tools" style={{ flexWrap: 'wrap' }}>{form.members.map(id => { const s = students.find(x => x.id === id); return <span key={id} className="chipbtn on">{s?.full_name ?? 'Học sinh'}{s?.classes ? ' · ' + s.classes.name : ''} <button type="button" className="xbtn" onClick={() => setForm({ ...form, members: form.members.filter(x => x !== id) })} aria-label="Bỏ">✕</button></span> })}
              <input list="pj-students" value={pick} placeholder="Gõ tên học sinh…" onChange={e => { const s = students.find(x => `${x.full_name} · ${x.classes?.name ?? ''}` === e.target.value); if (s) { setForm({ ...form, members: [...new Set([...form.members, s.id])] }); setPick('') } else setPick(e.target.value) }} aria-label="Thêm học sinh" />
              <datalist id="pj-students">{students.filter(s => !form.members.includes(s.id)).slice(0, 400).map(s => <option key={s.id} value={`${s.full_name} · ${s.classes?.name ?? ''}`} />)}</datalist></span></div>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Vấn đề / câu hỏi nghiên cứu</span><textarea rows={2} value={form.problem ?? ''} onChange={e => setForm({ ...form, problem: e.target.value })} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tóm tắt dự án <small className={words(form.abstract) > 250 ? 'due bad' : 'sub'}>({words(form.abstract)} từ — KHKT tối đa 250)</small></span><textarea rows={4} value={form.abstract ?? ''} onChange={e => setForm({ ...form, abstract: e.target.value })} /></label>
          <div className="field" style={{ gridColumn: '1 / -1' }}><span>Tài liệu, minh chứng (đường link Google Drive, YouTube…)</span>
            {(form.links ?? []).map((l, i) => <span key={i} className="tools"><input value={l.label} placeholder="Tên tài liệu" onChange={e => setForm({ ...form, links: form.links!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} style={{ width: 200 }} aria-label="Tên tài liệu" />
              <input value={l.url} placeholder="https://…" onChange={e => setForm({ ...form, links: form.links!.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} style={{ flex: 1 }} aria-label="Đường link" />
              <button type="button" onClick={() => setForm({ ...form, links: form.links!.filter((_, j) => j !== i) })} aria-label="Bỏ">✕</button></span>)}
            <button type="button" onClick={() => setForm({ ...form, links: [...(form.links ?? []), { label: '', url: '' }] })}>+ Link</button></div>
          <div className="formactions"><button type="submit">Lưu</button> {(!form.status || ['draft', 'rejected'].includes(form.status)) && <button type="button" className="primary" onClick={() => save(true)}>Gửi duyệt</button>} <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Dự án</th><th>Học sinh</th><th>Hướng dẫn</th><th>Trạng thái</th><th>Cuộc thi</th><th /></tr></thead>
        <tbody>{shown.flatMap(p => [
          <tr key={p.id}><td><b>{p.title}</b><br /><small>{[KIND[p.kind], p.field, p.school_year, readOnly || p.org_id !== orgId ? p.organizations?.name : null].filter(Boolean).join(' · ')}</small></td>
            <td><small>{p.project_members.map(m => `${m.students?.full_name ?? ''}${m.students?.classes ? ' (' + m.students.classes.name + ')' : ''}${m.role === 'leader' ? ' ★' : ''}`).join(', ') || '—'}</small></td>
            <td><small>{[p.teachers?.full_name, p.external_mentor].filter(Boolean).join(' · ') || '—'}</small></td>
            <td><span className={'plbadge ' + ST[p.status][1]}>{ST[p.status][0]}</span></td>
            <td><small>{p.competition_entries.map((e, i) => <span key={i} style={{ display: 'block' }}>{e.award ? <b className="good">🏆 {e.award}</b> : e.status === 'eliminated' ? 'Dừng' : 'Dự thi'} · {e.competitions?.title}</span>)}</small></td>
            <td className="nowrap"><button onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Đóng' : 'Xem'}</button>
              {mine(p) && p.status !== 'completed' && <> <button onClick={() => setForm({ ...p, members: p.project_members.map(m => m.student_id) })}>Sửa</button></>}
              {admin && p.status === 'pending' && p.org_id === orgId && <> <button className="primary" onClick={() => decide(p, 'approve')}>Duyệt</button> <button onClick={() => decide(p, 'reject')}>Từ chối</button></>}
              {mine(p) && p.status === 'approved' && (admin || p.mentor_teacher_id === teacherId) && <> <button onClick={() => setStatus(p, 'completed')}>Hoàn thành</button></>}</td></tr>,
          open === p.id && <tr key={p.id + 'd'}><td colSpan={6}>
            <div className="projdetail">
              <div>{p.problem && <p><b>Vấn đề:</b> {p.problem}</p>}{p.abstract && <p style={{ whiteSpace: 'pre-line' }}><b>Tóm tắt:</b> {p.abstract}</p>}
                {p.links.length > 0 && <p>{p.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" style={{ marginRight: 12 }}>🔗 {l.label}</a>)}</p>}
                {reqs.get(p.id) && <StepTrail req={reqs.get(p.id)!} />}</div>
              <div><b>Nhật ký & nhận xét</b>
                {logs.map(l => <p key={l.id} className={'projlog ' + l.kind}><small className="sub">{when(l.created_at)} · {l.author_name ?? ''}{l.kind === 'feedback' ? ' · nhận xét' : ''}</small><br />{l.content}{l.link && <> · <a href={l.link} target="_blank" rel="noreferrer noopener">link</a></>}</p>)}
                {!logs.length && <p className="sub">Chưa có ghi chép.</p>}
                {!readOnly && p.org_id === orgId && <div className="tools" style={{ flexWrap: 'wrap' }}>
                  <select value={note.kind} onChange={e => setNote({ ...note, kind: e.target.value })} aria-label="Loại"><option value="progress">Tiến độ</option><option value="feedback">Nhận xét (GV)</option></select>
                  <input value={note.content} onChange={e => setNote({ ...note, content: e.target.value })} placeholder="Đã làm gì, kết quả, vướng mắc…" style={{ flex: 1, minWidth: 200 }} aria-label="Nội dung" />
                  <input value={note.link} onChange={e => setNote({ ...note, link: e.target.value })} placeholder="Link (tuỳ chọn)" style={{ width: 160 }} aria-label="Link" />
                  <button onClick={() => addLog(p)}>Ghi</button></div>}
              </div>
            </div>
          </td></tr>])}
          {!shown.length && <tr><td colSpan={6}>Chưa có dự án.</td></tr>}</tbody>
      </table></div>
    </>
  )
}
export const ParentProjects = (p: any) => <ProjectsPage {...p} readOnly />
