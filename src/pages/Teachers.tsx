import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'

type Teacher = { id: string; full_name: string; email: string | null; subject: string | null; grade: number | null; status: string }
const EMPTY = { full_name: '', email: '', subject: '', grade: '' }

export default function Teachers() {
  const [rows, setRows] = useState<Teacher[]>([])
  const [q, setQ] = useState('')
  const [form, setForm] = useState<typeof EMPTY & { id?: string } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await supabase.from('teachers')
      .select('id, full_name, email, subject, grade, status').order('full_name')
    setRows((data as Teacher[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const body = {
      full_name: form.full_name, email: form.email || null,
      subject: form.subject || null, grade: form.grade ? Number(form.grade) : null,
    }
    const { error } = form.id
      ? await supabase.from('teachers').update(body).eq('id', form.id)
      : await supabase.from('teachers').insert({ ...body, org_id: await myOrgId() })
    if (error) return setErr(error.message)
    setForm(null); setErr(''); load()
  }

  async function remove(t: Teacher) {
    if (!confirm(`Xoá giáo viên ${t.full_name}?`)) return
    const { error } = await supabase.from('teachers').delete().eq('id', t.id)
    if (error) alert(error.message); else load()
  }

  const shown = rows.filter(r => (r.full_name + (r.email ?? '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="bar">
        <input className="search" placeholder="Tìm theo tên, email…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="primary" onClick={() => setForm({ ...EMPTY })}>Thêm giáo viên</button>
      </div>
      {form && (
        <form className="panel formgrid" onSubmit={save}>
          <input required placeholder="Họ và tên" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
          <input type="email" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Bộ môn" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} />
          <input type="number" min={1} max={12} placeholder="Khối phụ trách" value={form.grade} onChange={e => setForm({ ...form, grade: e.target.value })} />
          <div><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
          {err && <p className="msg">{err}</p>}
        </form>
      )}
      <table>
        <thead><tr><th>Giáo viên</th><th>Bộ môn</th><th>Khối phụ trách</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
          {shown.map(t => (
            <tr key={t.id}>
              <td><b>{t.full_name}</b><br /><small>{t.email}</small></td>
              <td>{t.subject}</td>
              <td>{t.grade ? `Khối ${t.grade}` : '—'}</td>
              <td>{t.status === 'active' ? 'Hoạt động' : 'Ngừng'}</td>
              <td>
                <button onClick={() => setForm({ id: t.id, full_name: t.full_name, email: t.email ?? '', subject: t.subject ?? '', grade: t.grade ? String(t.grade) : '' })}>Sửa</button>{' '}
                <button onClick={() => remove(t)}>Xoá</button>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={5}>Chưa có giáo viên nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
