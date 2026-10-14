import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'

type P = { id: string; name: string; starts_at: string; ends_at: string; session: string }
const hm = (t: string) => t.slice(0, 5)
const minutes = (a: string, b: string) => (Number(b.slice(0, 2)) * 60 + Number(b.slice(3, 5))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3, 5)))

export default function Periods() {
  const [rows, setRows] = useState<P[]>([])
  const [form, setForm] = useState<{ id?: string; name: string; starts_at: string; ends_at: string; session: string } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await supabase.from('period_configs').select('*').order('starts_at')
    setRows((data as P[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    if (minutes(form.starts_at, form.ends_at) <= 0) return setErr('Giờ kết thúc phải sau giờ bắt đầu.')
    const body = { name: form.name, starts_at: form.starts_at, ends_at: form.ends_at, session: form.session }
    const { error } = form.id
      ? await supabase.from('period_configs').update(body).eq('id', form.id)
      : await supabase.from('period_configs').insert({ ...body, org_id: await myOrgId() })
    if (error) return setErr(error.message)
    setForm(null); setErr(''); load()
  }
  async function remove(p: P) {
    if (!confirm(`Xoá ${p.name}? Các tiết trong thời khóa biểu dùng ${p.name} cũng bị xoá.`)) return
    await supabase.from('period_configs').delete().eq('id', p.id); load()
  }
  const SESSION: Record<string, string> = { morning: 'Buổi sáng', afternoon: 'Buổi chiều' }

  return (
    <>
      <div className="bar">
        <p className="sub">{rows.length} tiết học · tối đa 12 tiết mỗi ngày</p>
        <button className="primary" onClick={() => setForm({ name: `Tiết ${rows.length + 1}`, starts_at: '07:00', ends_at: '07:45', session: 'morning' })}>Thêm tiết học</button>
      </div>
      {form && (
        <form className="panel formgrid" onSubmit={save}>
          <input required placeholder="Tên tiết" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input type="time" required value={form.starts_at} onChange={e => setForm({ ...form, starts_at: e.target.value })} aria-label="Giờ bắt đầu" />
          <input type="time" required value={form.ends_at} onChange={e => setForm({ ...form, ends_at: e.target.value })} aria-label="Giờ kết thúc" />
          <select value={form.session} onChange={e => setForm({ ...form, session: e.target.value })}>
            <option value="morning">Buổi sáng</option><option value="afternoon">Buổi chiều</option>
          </select>
          <div><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
          {err && <p className="msg">{err}</p>}
        </form>
      )}
      <table>
        <thead><tr><th>Tên tiết</th><th>Bắt đầu</th><th>Kết thúc</th><th>Thời lượng</th><th>Buổi</th><th></th></tr></thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.id}>
              <td><b>{p.name}</b></td><td>{hm(p.starts_at)}</td><td>{hm(p.ends_at)}</td>
              <td>{minutes(p.starts_at, p.ends_at)} phút</td><td>{SESSION[p.session]}</td>
              <td>
                <button onClick={() => setForm({ id: p.id, name: p.name, starts_at: hm(p.starts_at), ends_at: hm(p.ends_at), session: p.session })}>Sửa</button>{' '}
                <button onClick={() => remove(p)}>Xoá</button>
                {i > 0 && rows[i - 1].session !== p.session && <div><small>Nghỉ buổi: {minutes(rows[i - 1].ends_at, p.starts_at)} phút</small></div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
