import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'

type Row = { id: string; name: string; grade: number; homeroom_teacher_id: string | null; teachers: { full_name: string } | null; teaching_assignments: { subject: string; teachers: { full_name: string } | null }[] }
type Teacher = { id: string; full_name: string }

export default function Classes({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [form, setForm] = useState<Row | 'new' | null>(null)

  async function load() {
    const [c, t, s] = await Promise.all([
      supabase.from('classes').select('id, name, grade, homeroom_teacher_id, teachers!classes_homeroom_teacher_id_fkey(full_name), teaching_assignments(subject, teachers(full_name))').order('name'),
      supabase.from('teachers').select('id, full_name').order('full_name'),
      supabase.from('students').select('class_id'),
    ])
    setRows((c.data as unknown as Row[]) ?? []); setTeachers((t.data as Teacher[]) ?? [])
    const m: Record<string, number> = {}; (s.data ?? []).forEach((x: any) => { m[x.class_id] = (m[x.class_id] ?? 0) + 1 }); setCounts(m)
  }
  useEffect(() => { load() }, [])

  async function save(v: Record<string, string>) {
    const body = { name: v.name, grade: Number(v.grade), homeroom_teacher_id: v.homeroom_teacher_id || null }
    const { error } = form !== 'new' && form ? await supabase.from('classes').update(body).eq('id', form.id) : await supabase.from('classes').insert({ ...body, org_id: orgId })
    if (error) return error.message
    setForm(null); load()
  }
  async function remove(c: Row) {
    if (!confirm(`Xoá ${c.name}? Phân công và thời khóa biểu của lớp cũng bị xoá.`)) return
    const { error } = await supabase.from('classes').delete().eq('id', c.id)
    if (error) alert(error.message); else load()
  }

  return (
    <>
      <div className="bar"><p className="sub">{rows.length} lớp</p><button className="primary" onClick={() => setForm('new')}>Thêm lớp</button></div>
      {form && (
        <FormPanel
          fields={[
            { key: 'name', label: 'Tên lớp', required: true, placeholder: 'VD: Lớp 6B' },
            { key: 'grade', label: 'Khối', type: 'number', required: true },
            { key: 'homeroom_teacher_id', label: 'Giáo viên chủ nhiệm', type: 'select', options: teachers.map(t => ({ value: t.id, label: t.full_name })) },
          ]}
          initial={form === 'new' ? undefined : { name: form.name, grade: String(form.grade), homeroom_teacher_id: form.homeroom_teacher_id ?? '' }}
          onSubmit={save} onCancel={() => setForm(null)} />
      )}
      <table>
        <thead><tr><th>Lớp</th><th>Khối</th><th>Chủ nhiệm</th><th>Sĩ số</th><th>Giáo viên bộ môn</th><th></th></tr></thead>
        <tbody>
          {rows.map(c => (
            <tr key={c.id}>
              <td><b>{c.name}</b></td><td>Khối {c.grade}</td><td>{c.teachers?.full_name ?? '—'}</td><td>{counts[c.id] ?? 0}</td>
              <td>{c.teaching_assignments.map(a => `${a.teachers?.full_name ?? '?'} (${a.subject})`).join(', ') || '—'}</td>
              <td><button onClick={() => setForm(c)}>Sửa</button> <button onClick={() => remove(c)}>Xoá</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6}>Chưa có lớp nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
