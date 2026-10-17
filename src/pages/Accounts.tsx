import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { sendInviteEmail } from '../lib/invite'
import CodeAccounts from './CodeAccounts'

type Acc = { id: string; full_name: string; email: string | null; org_id: string | null }
type Role = { id: string; key: string; name: string; portal: string | null; is_system: boolean }
type Teacher = { id: string; full_name: string; profile_id: string | null }
type Student = { id: string; full_name: string; student_code: string | null; profile_id: string | null; classes: { name: string } | null }
type Link = { user_id: string; role_id: string; roles: { name: string } | null }
type Invite = {
  id: string; email: string; full_name: string | null; role_id: string; teacher_id: string | null; student_id: string | null
  status: string; note: string | null; created_at: string; sent_at: string | null; accepted_at: string | null
}
type InviteForm = { emails: string; full_name: string; role_id: string; link_id: string; send: boolean }

// Vai trò của cơ quan quản lý / nhà cung cấp — không gán trong trường
const AUTHORITY = ['ministry', 'province', 'department', 'district', 'provider']
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const fmt = (d: string | null) => d ? new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export default function Accounts({ orgId }: { orgId: string | null }) {
  const [rows, setRows] = useState<Acc[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [links, setLinks] = useState<Link[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [form, setForm] = useState<InviteForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [tab, setTab] = useState<'users' | 'code'>('users')

  async function load() {
    const [p, r, l, t, s, i] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, org_id').order('full_name'),
      supabase.from('roles').select('id, key, name, portal, is_system').order('is_system', { ascending: false }).order('name'),
      orgId ? supabase.from('memberships').select('user_id, role_id, roles(name)').eq('org_id', orgId) : Promise.resolve({ data: [] }),
      supabase.from('teachers').select('id, full_name, profile_id').order('full_name'),
      supabase.from('students').select('id, full_name, student_code, profile_id, classes(name)').order('student_code'),
      supabase.from('invitations').select('*').order('created_at', { ascending: false }),
    ])
    // Thành viên của trường = có ít nhất một vai trò tại trường (có thể đang làm việc ở đơn vị khác)
    const ls = (l.data as unknown as Link[]) ?? []
    const memberIds = new Set(ls.map(x => x.user_id))
    setRows(((p.data as Acc[]) ?? []).filter(x => memberIds.has(x.id)))
    setRoles(((r.data as Role[]) ?? []).filter(x => !AUTHORITY.includes(x.key)))
    setLinks(ls); setTeachers((t.data as Teacher[]) ?? [])
    setStudents((s.data as unknown as Student[]) ?? []); setInvites((i.data as Invite[]) ?? [])
  }
  useEffect(() => { load() }, [orgId])

  const check = (error: { message: string } | null) => { setErr(error ? 'Không thực hiện được: ' + error.message : ''); load() }
  async function addRole(a: Acc, role_id: string) { if (role_id && orgId) check((await supabase.from('memberships').insert({ user_id: a.id, org_id: orgId, role_id })).error) }
  async function removeRole(a: Acc, role_id: string) {
    if (!orgId) return
    if (links.filter(l => l.user_id === a.id).length === 1 && !confirm(`Gỡ vai trò cuối cùng — ${a.full_name} sẽ rời khỏi trường. Tiếp tục?`)) return
    check((await supabase.from('memberships').delete().eq('user_id', a.id).eq('org_id', orgId).eq('role_id', role_id)).error)
  }
  async function linkTeacher(a: Acc, teacherId: string) {
    await supabase.from('teachers').update({ profile_id: null }).eq('profile_id', a.id)
    if (teacherId) check((await supabase.from('teachers').update({ profile_id: a.id }).eq('id', teacherId)).error); else load()
  }
  async function linkStudent(a: Acc, studentId: string) {
    await supabase.from('students').update({ profile_id: null }).eq('profile_id', a.id)
    if (studentId) check((await supabase.from('students').update({ profile_id: a.id }).eq('id', studentId)).error); else load()
  }

  const roleOf = (id: string) => roles.find(r => r.id === id)
  const isStudentRole = (id: string) => roleOf(id)?.key === 'student'
  const isTeacherRole = (id: string) => roleOf(id)?.portal === 'teacher'

  // Mỗi dòng: "email" hoặc "email, Họ tên". Một dòng → được liên kết hồ sơ.
  function parseLines(text: string) {
    return text.split(/\n+/).map(l => l.trim()).filter(Boolean).map(l => {
      const [email, ...rest] = l.split(/[,;\t]/)
      return { email: email.trim().toLowerCase(), full_name: rest.join(' ').trim() || null }
    })
  }

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !orgId) return
    const people = parseLines(form.emails)
    const bad = people.filter(p => !EMAIL.test(p.email))
    if (!people.length) return setErr('Nhập ít nhất một email.')
    if (bad.length) return setErr('Email không hợp lệ: ' + bad.map(b => b.email).join(', '))
    const single = people.length === 1
    if (single && !people[0].full_name && form.full_name.trim()) people[0].full_name = form.full_name.trim()

    setBusy(true); setErr(''); setInfo('')
    const { data: { user } } = await supabase.auth.getUser()
    const rowsToInsert = people.map(p => ({
      org_id: orgId, email: p.email, full_name: p.full_name, role_id: form.role_id, invited_by: user?.id,
      teacher_id: single && form.link_id && !isStudentRole(form.role_id) ? form.link_id : null,
      student_id: single && form.link_id && isStudentRole(form.role_id) ? form.link_id : null,
    }))
    const { data, error } = await supabase.from('invitations').insert(rowsToInsert).select('id')
    if (error) {
      setBusy(false)
      return setErr(error.message.includes('invitations_pending_email')
        ? 'Có email đã được mời và đang chờ. Hãy dùng “Gửi lại” ở danh sách lời mời.' : 'Không tạo được lời mời: ' + error.message)
    }
    // Đọc lại: tài khoản đã có sẵn được hệ thống áp lời mời ngay sau khi chèn (status = accepted)
    const ids = ((data as { id: string }[]) ?? []).map(x => x.id)
    const fresh = ids.length ? (await supabase.from('invitations').select('id, email, full_name, status').in('id', ids)).data : []
    const created = (fresh as { id: string; email: string; full_name: string | null; status: string }[]) ?? []
    const applied = created.filter(x => x.status === 'accepted').length
    let sent = 0; const failed: string[] = []
    if (form.send) {
      for (const inv of created.filter(x => x.status === 'pending')) {
        const r = await sendInviteEmail(inv.email, inv.full_name)
        if (r.error) failed.push(`${inv.email} (${r.error.message})`)
        else { sent++; await supabase.from('invitations').update({ sent_at: new Date().toISOString() }).eq('id', inv.id) }
      }
    }
    setBusy(false); setForm(null)
    const parts = [`Đã tạo ${created.length} lời mời.`]
    if (applied) parts.push(`${applied} tài khoản đã có sẵn nên được thêm vào trường ngay.`)
    if (sent) parts.push(`Đã gửi ${sent} email đăng nhập.`)
    setInfo(parts.join(' '))
    if (failed.length) setErr('Chưa gửi được email cho: ' + failed.join('; ') + '. Người được mời vẫn có thể tự đăng ký bằng đúng email này, hoặc bấm “Gửi lại” sau.')
    load()
  }

  async function resend(inv: Invite) {
    setErr(''); setInfo('')
    const r = await sendInviteEmail(inv.email, inv.full_name)
    if (r.error) return setErr(`Không gửi được email tới ${inv.email}: ${r.error.message}`)
    await supabase.from('invitations').update({ sent_at: new Date().toISOString() }).eq('id', inv.id)
    setInfo(`Đã gửi lại email đăng nhập tới ${inv.email}.`); load()
  }
  async function cancel(inv: Invite) {
    if (!confirm(`Huỷ lời mời ${inv.email}?`)) return
    check((await supabase.from('invitations').update({ status: 'cancelled' }).eq('id', inv.id)).error)
  }

  const pending = invites.filter(i => i.status === 'pending')
  const linkOptions = form && (isStudentRole(form.role_id) ? 'student' : isTeacherRole(form.role_id) ? 'teacher' : null)
  const singleForm = form ? parseLines(form.emails).length <= 1 : false
  const tabs = (
    <div className="segmented" style={{ marginBottom: 12 }}>
      <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>Người dùng & lời mời</button>
      <button className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>Tài khoản học sinh, giáo viên (không cần email)</button>
    </div>
  )
  if (tab === 'code') return <>{tabs}<CodeAccounts orgId={orgId} /></>
  return (
    <>
      {tabs}
      <div className="bar">
        <p className="sub" style={{ margin: 0, flex: 1, minWidth: 260 }}>Mời người dùng bằng email. Khi họ bấm liên kết trong thư (hoặc tự đăng ký đúng email đó), tài khoản tự được gán trường, vai trò và hồ sơ. Người đã làm việc ở đơn vị khác cũng mời được — họ chuyển qua lại bằng ô “Đang làm việc tại”.</p>
        <button className="primary" onClick={() => setForm({ emails: '', full_name: '', role_id: roles.find(r => r.key === 'teacher')?.id ?? roles[0]?.id ?? '', link_id: '', send: true })}>+ Mời người dùng</button>
      </div>
      {err && <p className="msg">{err}</p>}
      {info && <p className="sub"><b>{info}</b></p>}

      {form && (
        <form className="panel formgrid" onSubmit={submitInvite}>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Email * <small>(mỗi dòng một người, có thể kèm họ tên: <i>email, Họ tên</i>)</small></span>
            <textarea required rows={singleForm ? 2 : 4} value={form.emails} onChange={e => setForm({ ...form, emails: e.target.value })}
              placeholder={'giaovien@truong.edu.vn\nhocsinh1@truong.edu.vn, Nguyễn Minh Anh'} /></label>
          {singleForm && (
            <label className="field"><span>Họ tên</span>
              <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="Hiển thị trong hệ thống" /></label>
          )}
          <label className="field"><span>Vai trò *</span>
            <select required value={form.role_id} onChange={e => setForm({ ...form, role_id: e.target.value, link_id: '' })}>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}{!r.is_system ? ' (tuỳ chỉnh)' : ''}</option>)}
            </select></label>
          {singleForm && linkOptions === 'teacher' && (
            <label className="field"><span>Liên kết hồ sơ giáo viên</span>
              <select value={form.link_id} onChange={e => setForm({ ...form, link_id: e.target.value })}>
                <option value="">Không liên kết</option>
                {teachers.filter(t => !t.profile_id).map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select></label>
          )}
          {singleForm && linkOptions === 'student' && (
            <label className="field"><span>Liên kết hồ sơ học sinh</span>
              <StudentSelect students={students.filter(x => !x.profile_id)} value={form.link_id} onChange={v => setForm({ ...form, link_id: v })} /></label>
          )}
          <label className="field"><span>Gửi email</span>
            <span><input type="checkbox" checked={form.send} onChange={e => setForm({ ...form, send: e.target.checked })} /> Gửi liên kết đăng nhập ngay</span></label>
          <div className="formactions">
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Đang mời…' : 'Gửi lời mời'}</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button>
          </div>
        </form>
      )}

      {pending.length > 0 && (
        <div className="panel">
          <b>Lời mời đang chờ ({pending.length})</b>
          <div className="wrap">
            <table>
              <thead><tr><th>Email</th><th>Vai trò</th><th>Hồ sơ liên kết</th><th>Gửi lúc</th><th></th></tr></thead>
              <tbody>
                {pending.map(i => (
                  <tr key={i.id}>
                    <td><b>{i.email}</b>{i.full_name && <><br /><small>{i.full_name}</small></>}{i.note && <><br /><small className="msg">{i.note}</small></>}</td>
                    <td>{roleOf(i.role_id)?.name ?? '—'}</td>
                    <td>{teachers.find(t => t.id === i.teacher_id)?.full_name ?? students.find(s => s.id === i.student_id)?.full_name ?? '—'}</td>
                    <td>{i.sent_at ? fmt(i.sent_at) : <small>Chưa gửi email</small>}</td>
                    <td><button onClick={() => resend(i)}>Gửi lại</button> <button onClick={() => cancel(i)}>Huỷ</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <table>
        <thead><tr><th>Người dùng</th><th>Vai trò</th><th>Liên kết hồ sơ</th></tr></thead>
        <tbody>
          {rows.map(a => {
            const mine = links.filter(l => l.user_id === a.id)
            const linked = teachers.find(t => t.profile_id === a.id)
            const linkedStudent = students.find(x => x.profile_id === a.id)
            const isStudent = mine.some(l => isStudentRole(l.role_id))
            return (
              <tr key={a.id}>
                <td><b>{a.full_name}</b><br /><small>{a.email}</small>{a.org_id && a.org_id !== orgId && <><br /><small className="sub">Đang làm việc ở đơn vị khác</small></>}</td>
                <td>
                  {mine.map(l => <span className="chip" key={l.role_id}>{l.roles?.name}<button className="x" onClick={() => removeRole(a, l.role_id)} aria-label={`Gỡ vai trò ${l.roles?.name}`}>×</button></span>)}
                  <select value="" onChange={e => addRole(a, e.target.value)} aria-label="Thêm vai trò">
                    <option value="">+ Thêm vai trò</option>
                    {roles.filter(r => !mine.some(l => l.role_id === r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td>
                  {isStudent ? (
                    <StudentSelect students={students.filter(x => !x.profile_id || x.profile_id === a.id)} value={linkedStudent?.id ?? ''} onChange={v => linkStudent(a, v)} />
                  ) : (
                    <select value={linked?.id ?? ''} onChange={e => linkTeacher(a, e.target.value)} aria-label="Liên kết giáo viên">
                      <option value="">Không liên kết giáo viên</option>
                      {teachers.filter(t => !t.profile_id || t.profile_id === a.id).map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && <tr><td colSpan={3}>Chưa có tài khoản nào. Bấm “Mời người dùng” để thêm.</td></tr>}
        </tbody>
      </table>
    </>
  )
}

function StudentSelect({ students, value, onChange }: { students: Student[]; value: string; onChange: (v: string) => void }) {
  const classes = [...new Set(students.map(x => x.classes?.name ?? 'Chưa xếp lớp'))]
  return (
    <select value={value} onChange={e => onChange(e.target.value)} aria-label="Liên kết học sinh">
      <option value="">Chưa liên kết học sinh</option>
      {classes.map(cls => (
        <optgroup key={cls} label={cls}>
          {students.filter(x => (x.classes?.name ?? 'Chưa xếp lớp') === cls)
            .map(x => <option key={x.id} value={x.id}>{x.full_name}{x.student_code ? ` · ${x.student_code}` : ''}</option>)}
        </optgroup>
      ))}
    </select>
  )
}
