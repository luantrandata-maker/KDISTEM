import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'
import { type Year, sameSchoolYear } from '../lib/year'

type Teacher = { id: string; full_name: string; subject: string | null }
type Cls = { id: string; name: string; year_id: string | null }
type Assign = { id: string; year_id: string | null; subject: string; teacher_id: string; class_id: string; classes: { name: string } | null }
const COLORS = [['#fff1e0', '#b45309'], ['#e6f1fd', '#1c63bb'], ['#e3f5ea', '#23824f'], ['#f1e8fb', '#7a3fc4'], ['#fde8ea', '#c0324a'], ['#e3f4f8', '#0f7490']]
const colorOf = (s: string) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]

export default function Assignments({ year, years = [] }: { year?: Year | null; years?: Year[] }) {
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [classes, setClasses] = useState<Cls[]>([])
  const [rows, setRows] = useState<Assign[]>([])
  const [form, setForm] = useState<{ teacher_id: string; class_id: string; subject: string } | null>(null)
  const [err, setErr] = useState('')
  const [fSubject, setFSubject] = useState(''); const [fClass, setFClass] = useState('')

  async function load() {
    const [t, c, a] = await Promise.all([
      supabase.from('teachers').select('id, full_name, subject').order('full_name'),
      supabase.from('classes').select('id, name, year_id').order('name'),
      supabase.from('teaching_assignments').select('id, year_id, subject, teacher_id, class_id, classes(name)'),
    ])
    setTeachers((t.data as Teacher[]) ?? []); setClasses(((c.data as Cls[]) ?? []).filter(x => sameSchoolYear(years, x.year_id, year ?? null)))
    setRows(((a.data as unknown as Assign[]) ?? []).filter(x => sameSchoolYear(years, x.year_id, year ?? null)))
  }
  useEffect(() => { load() }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const { error } = await supabase.from('teaching_assignments').insert({
      org_id: await myOrgId(), year_id: year?.id ?? null, ...form,
    })
    if (error) return setErr(error.message.includes('duplicate') ? 'Phân công này đã tồn tại.' : error.message)
    setForm(null); setErr(''); load()
  }
  async function remove(id: string) {
    await supabase.from('teaching_assignments').delete().eq('id', id)
    load()
  }

  const fRows = rows.filter(r => (!fSubject || r.subject === fSubject) && (!fClass || r.class_id === fClass))
  const subjects = [...new Set(rows.map(r => r.subject))]
  const byTeacher = (id: string) => fRows.filter(r => r.teacher_id === id)
  const missing = teachers.filter(t => rows.filter(r => r.teacher_id === t.id).length === 0)
  const visible = teachers.filter(t => (!fSubject && !fClass) || byTeacher(t.id).length > 0)

  return (
    <>
      <div className="bar">
        <div className="tools"><select value={fSubject} onChange={e => setFSubject(e.target.value)} aria-label="Môn"><option value="">Tất cả môn</option>{subjects.map(x => <option key={x}>{x}</option>)}</select><select value={fClass} onChange={e => setFClass(e.target.value)} aria-label="Lớp"><option value="">Tất cả lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
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
          {visible.map(t => (
            <tr key={t.id}>
              <td><b>{t.full_name}</b><br /><small>{byTeacher(t.id).length} phân công</small></td>
              <td>
                {byTeacher(t.id).map(a => (
                  <span className="chip" key={a.id} style={{ background: colorOf(a.subject)[0], color: colorOf(a.subject)[1] }}>{a.subject} · {a.classes?.name}
                    <button className="x" onClick={() => remove(a.id)} aria-label={`Xoá phân công ${a.classes?.name}`}>×</button></span>
                ))}
                {byTeacher(t.id).length === 0 && <small>Chưa phân công</small>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub" style={{ marginTop: 10 }}>{visible.length} giáo viên · {fRows.length} phân công {subjects.map(x => ` · ${x} ${fRows.filter(r => r.subject === x).length}`).join('')}</p>
    </>
  )
}
