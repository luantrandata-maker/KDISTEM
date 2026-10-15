import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'
import { k12Sync } from '../lib/k12'
import ImportExcel from '../components/ImportExcel'
import { importSummary, downloadXlsx, type Column } from '../lib/sheet'

const COLS: Column[] = [
  { key: 'name', label: 'Họ tên', aliases: ['Họ và tên', 'Tên giáo viên'], required: true, width: 28 },
  { key: 'email', label: 'Email', aliases: ['Thư điện tử'], width: 30 },
  { key: 'subject', label: 'Bộ môn', aliases: ['Môn', 'Môn dạy'] },
  { key: 'grade', label: 'Khối phụ trách', aliases: ['Khối'] },
]

type Teacher = { id: string; full_name: string; email: string | null; subject: string | null; grade: number | null; status: string }
const EMPTY = { full_name: '', email: '', subject: '', grade: '' }

export default function Teachers() {
  const [rows, setRows] = useState<Teacher[]>([])
  const [q, setQ] = useState('')
  const [form, setForm] = useState<typeof EMPTY & { id?: string } | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

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

  async function importRecords(recs: (Record<string, string> & { _line: number })[]) {
    const emails = new Set(rows.map(r => r.email?.toLowerCase()).filter(Boolean))
    const org = await myOrgId(); const bad: string[] = []
    const list = recs.flatMap(r => {
      const email = r.email.toLowerCase()
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { bad.push(`dòng ${r._line}: email sai`); return [] }
      if (email && emails.has(email)) { bad.push(`dòng ${r._line}: ${email} đã có`); return [] }
      const g = Number(r.grade.replace(/\D/g, ''))
      if (email) emails.add(email)
      return [{ org_id: org, full_name: r.name, email: email || null, subject: r.subject || null, grade: g >= 1 && g <= 12 ? g : null }]
    })
    if (list.length) { const { error } = await supabase.from('teachers').insert(list); if (error) return 'Không nhập được: ' + error.message }
    load(); return importSummary(list.length, 'giáo viên', bad)
  }

  const shown = rows.filter(r => (r.full_name + (r.email ?? '')).toLowerCase().includes(q.toLowerCase()))

  return (
    <>
      <div className="bar">
        <input className="search" placeholder="Tìm theo tên, email…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="tools"><button onClick={k12Sync}>Đồng bộ K12</button>
          <ImportExcel columns={COLS} template="mau-nhap-giao-vien" sample={[['Nguyễn Văn A', 'gv.a@truong.edu.vn', 'Toán', '9']]} onRecords={importRecords} onMessage={setMsg} />
          <button onClick={() => downloadXlsx('danh-sach-giao-vien', COLS, shown.map(r => [r.full_name, r.email, r.subject, r.grade]))}>Xuất Excel</button>
          <button className="primary" onClick={() => setForm({ ...EMPTY })}>Thêm mới</button></div>
      </div>
      {msg && <p className="sub"><b>{msg}</b></p>}
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
