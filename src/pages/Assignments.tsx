import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'

type Teacher = { id: string; full_name: string; subject: string | null }
type Cls = { id: string; name: string }
type Assign = { id: string; subject: string; teacher_id: string; classes: { name: string } | null }

export default function Assignments() {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [classes, setClasses] = useState<Cls[]>([])
  const [rows, setRows] = useState<Assign[]>([])
  const [form, setForm] = useState<{ teacher_id: string; class_id: string; subject: string } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const [t, c, a] = await Promise.all([
      supabase.from('teachers').select('id, full_name, subject').order('full_name'),
      supabase.from('classes').select('id, name').order('name'),
      supabase.from('teaching_assignments').select('id, subject, teacher_id, classes(name)'),
    ])
    setTeachers((t.data as Teacher[]) ?? []); setClasses((c.data as Cls[]) ?? [])
    setRows((a.data as unknown as Assign[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const { data: y } = await supabase.from('academic_years').select('id').eq('is_current', true).limit(1)
    const { error } = await supabase.from('teaching_assignments').insert({
      org_id: await myOrgId(), year_id: y?.[0]?.id ?? null, ...form,
    })
    if (error) return setErr(error.message.includes('duplicate') ? 'Phân công này đã tồn tại.' : error.message)
    setForm(null); setErr(''); load()
  }
  async function remove(id: string) {
    await supabase.from('teaching_assignments').delete().eq('id', id)
    load()
  }

  const byTeacher = (id: string) => rows.filter(r => r.teacher_id === id)
  const missing = teachers.filter(t => byTeacher(t.id).length === 0)

  return (
    <>
      <div className="bar">
        <p className="sub">Năm học hiện tại · {rows.length} phân công</p>
        <button className="primary" onClick={() => setForm({ teacher_id: teachers[0]?.id ?? '', class_id: classes[0]?.id ?? '', subject: teachers[0]?.subject ?? '' })}>Thêm phân công</button>
      </div>
      {missing.length > 0 && (
        <div className="panel warnbox">{missing.length} giáo viên chưa được phân công: {missing.map(t => t.full_name).join(', ')}</div>
      )}
      {form && (
        <form className="panel formgrid" onSubmit={add}>
          <select value={form.teacher_id} onChange={e => setForm({ ...form, teacher_id: e.target.value, subject: teachers.find(t => t.id === e.target.value)?.subject ?? '' })}>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
          <select value={form.class_id} onChange={e => setForm({ ...form, class_id: e.target.value })}>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input required placeholder="Môn dạy" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
          <div><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
          {err && <p className="msg">{err}</p>}
        </form>
      )}
      <table>
        <thead><tr><th>Giáo viên</th><th>Phân công giảng dạy</th></tr></thead>
        <tbody>
          {teachers.map(t => (
            <tr key={t.id}>
              <td><b>{t.full_name}</b><br /><small>{byTeacher(t.id).length} phân công</small></td>
              <td>
                {byTeacher(t.id).map(a => (
                  <span className="chip" key={a.id}>{a.subject} · {a.classes?.name}
                    <button className="x" onClick={() => remove(a.id)} aria-label={`Xoá phân công ${a.classes?.name}`}>×</button></span>
                ))}
                {byTeacher(t.id).length === 0 && <small>Chưa phân công</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
