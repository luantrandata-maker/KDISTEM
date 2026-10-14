import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'

type St = { id: string; full_name: string; student_code: string | null; class_id: string | null; classes: { name: string } | null }
type Cls = { id: string; name: string }

export default function Students() {
  const [rows, setRows] = useState<St[]>([])
  const [classes, setClasses] = useState<Cls[]>([])
  const [cls, setCls] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ full_name: string; student_code: string; class_id: string } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const [s, c] = await Promise.all([
      supabase.from('students').select('id, full_name, student_code, class_id, classes(name)').order('student_code'),
      supabase.from('classes').select('id, name').order('name'),
    ])
    setRows((s.data as unknown as St[]) ?? []); setClasses((c.data as Cls[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const { error } = await supabase.from('students').insert({ org_id: await myOrgId(), ...form, student_code: form.student_code || null })
    if (error) return setErr(error.message)
    setForm(null); setErr(''); load()
  }
  async function remove(s: St) {
    if (!confirm(`Xoá học sinh ${s.full_name}?`)) return
    await supabase.from('students').delete().eq('id', s.id); load()
  }

  const shown = rows.filter(r => (!cls || r.class_id === cls) && (r.full_name + (r.student_code ?? '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="bar">
        <div>
          <input className="search" placeholder="Tìm theo tên hoặc mã học sinh…" value={q} onChange={e => setQ(e.target.value)} />{' '}
          <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Lọc theo lớp">
            <option value="">Tất cả lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button className="primary" onClick={() => setForm({ full_name: '', student_code: '', class_id: classes[0]?.id ?? '' })}>Thêm học sinh</button>
      </div>
      <p className="sub">{shown.length} / {rows.length} học sinh</p>
      {form && (
        <form className="panel formgrid" onSubmit={add}>
          <input required placeholder="Họ và tên" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
          <input placeholder="Mã học sinh" value={form.student_code} onChange={e => setForm({ ...form, student_code: e.target.value })} />
          <select value={form.class_id} onChange={e => setForm({ ...form, class_id: e.target.value })}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <div><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
          {err && <p className="msg">{err}</p>}
        </form>
      )}
      <table>
        <thead><tr><th>Mã</th><th>Họ và tên</th><th>Lớp</th><th></th></tr></thead>
        <tbody>
          {shown.map(s => (
            <tr key={s.id}><td>{s.student_code}</td><td><b>{s.full_name}</b></td><td>{s.classes?.name ?? '—'}</td>
              <td><button onClick={() => remove(s)}>Xoá</button></td></tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={4}>Không có học sinh phù hợp.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
