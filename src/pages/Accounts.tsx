import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Acc = { id: string; full_name: string; email: string | null; org_id: string | null; organizations: { name: string } | null }
type Role = { id: string; key: string; name: string }
type Teacher = { id: string; full_name: string; profile_id: string | null }
type Student = { id: string; full_name: string; student_code: string | null; profile_id: string | null; classes: { name: string } | null }
type Link = { user_id: string; role_id: string; roles: { name: string } | null }

export default function Accounts({ orgId }: { orgId: string | null }) {
  const [rows, setRows] = useState<Acc[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [links, setLinks] = useState<Link[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [err, setErr] = useState('')

  async function load() {
    const [p, r, l, t, s] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, org_id, organizations(name)').order('full_name'),
      supabase.from('roles').select('id, key, name').is('org_id', null).order('name'),
      supabase.from('user_roles').select('user_id, role_id, roles(name)'),
      supabase.from('teachers').select('id, full_name, profile_id').order('full_name'),
      supabase.from('students').select('id, full_name, student_code, profile_id, classes(name)').order('student_code'),
    ])
    setRows((p.data as unknown as Acc[]) ?? []); setRoles(((r.data as Role[]) ?? []).filter(x => !['department', 'provider'].includes(x.key)))
    setStudents((s.data as unknown as Student[]) ?? [])
    setLinks((l.data as unknown as Link[]) ?? []); setTeachers((t.data as Teacher[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const check = (error: { message: string } | null) => { setErr(error ? 'Không thực hiện được: ' + error.message : ''); load() }
  async function assign(a: Acc) { check((await supabase.from('profiles').update({ org_id: orgId }).eq('id', a.id)).error) }
  async function addRole(a: Acc, role_id: string) { if (role_id) check((await supabase.from('user_roles').insert({ user_id: a.id, role_id })).error) }
  async function removeRole(a: Acc, role_id: string) { check((await supabase.from('user_roles').delete().eq('user_id', a.id).eq('role_id', role_id)).error) }
  async function linkTeacher(a: Acc, teacherId: string) {
    await supabase.from('teachers').update({ profile_id: null }).eq('profile_id', a.id)
    if (teacherId) check((await supabase.from('teachers').update({ profile_id: a.id }).eq('id', teacherId)).error); else load()
  }

  async function linkStudent(a: Acc, studentId: string) {
    await supabase.from('students').update({ profile_id: null }).eq('profile_id', a.id)
    if (studentId) check((await supabase.from('students').update({ profile_id: a.id }).eq('id', studentId)).error); else load()
  }

  const unassigned = rows.filter(r => !r.org_id)
  const assigned = rows.filter(r => r.org_id)
  return (
    <>
      {err && <p className="msg">{err}</p>}
      {unassigned.length > 0 && (
        <div className="panel warnbox">
          <b>{unassigned.length} tài khoản mới chưa được gán vào trường</b>
          {unassigned.map(a => (
            <div className="roomrow" key={a.id}><span>{a.full_name} <small>{a.email}</small></span>
              <button className="primary" onClick={() => assign(a)}>Gán vào trường này</button></div>
          ))}
        </div>
      )}
      <table>
        <thead><tr><th>Người dùng</th><th>Vai trò</th><th>Liên kết hồ sơ</th></tr></thead>
        <tbody>
          {assigned.map(a => {
            const mine = links.filter(l => l.user_id === a.id)
            const linked = teachers.find(t => t.profile_id === a.id)
            const linkedStudent = students.find(x => x.profile_id === a.id)
            const isStudent = mine.some(l => roles.find(r => r.id === l.role_id)?.key === 'student')
            return (
              <tr key={a.id}>
                <td><b>{a.full_name}</b><br /><small>{a.email}</small></td>
                <td>
                  {mine.map(l => <span className="chip" key={l.role_id}>{l.roles?.name}<button className="x" onClick={() => removeRole(a, l.role_id)} aria-label={`Gỡ vai trò ${l.roles?.name}`}>×</button></span>)}
                  <select value="" onChange={e => addRole(a, e.target.value)} aria-label="Thêm vai trò">
                    <option value="">+ Thêm vai trò</option>
                    {roles.filter(r => !mine.some(l => l.role_id === r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td>
                  {isStudent ? (
                    <select value={linkedStudent?.id ?? ''} onChange={e => linkStudent(a, e.target.value)} aria-label="Liên kết học sinh">
                      <option value="">Chưa liên kết học sinh</option>
                      {[...new Set(students.map(x => x.classes?.name ?? 'Chưa xếp lớp'))].map(cls => (
                        <optgroup key={cls} label={cls}>
                          {students.filter(x => (x.classes?.name ?? 'Chưa xếp lớp') === cls && (!x.profile_id || x.profile_id === a.id))
                            .map(x => <option key={x.id} value={x.id}>{x.full_name}{x.student_code ? ` · ${x.student_code}` : ''}</option>)}
                        </optgroup>
                      ))}
                    </select>
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
          {assigned.length === 0 && <tr><td colSpan={3}>Chưa có tài khoản nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
