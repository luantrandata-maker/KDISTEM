import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'

type St = { id: string; full_name: string; student_code: string | null; class_id: string | null; status: string; classes: { name: string; grade: number } | null }
const STATUS: Record<string, string> = { studying: 'Đang học', transferred: 'Chuyển trường', graduated: 'Đã tốt nghiệp' }
const PAGE = 20
type Cls = { id: string; name: string }

export default function Students() {
  const [rows, setRows] = useState<St[]>([])
  const [classes, setClasses] = useState<Cls[]>([])
  const [cls, setCls] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ full_name: string; student_code: string; class_id: string } | null>(null)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(1)

  async function load() {
    const [s, c] = await Promise.all([
      supabase.from('students').select('id, full_name, student_code, class_id, status, classes(name, grade)').order('student_code'),
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
  async function importCsv(file: File) {
    const text = (await file.text()).replace(/^\ufeff/, '')
    const byName = new Map(classes.map(c => [c.name.trim().toLowerCase(), c.id]))
    const org = await myOrgId()
    const list: { org_id: string; student_code: string | null; full_name: string; class_id: string | null }[] = []
    const bad: string[] = []
    text.split(/\r?\n/).slice(1).forEach((line, i) => {
      if (!line.trim()) return
      const [code, name, cname] = line.split(/[,;\t]/).map(x => x.replace(/^"|"$/g, '').trim())
      const cid = byName.get((cname ?? '').toLowerCase())
      if (!name) return void bad.push(`dòng ${i + 2}: thiếu họ tên`)
      if (!cid) return void bad.push(`dòng ${i + 2}: không tìm thấy lớp "${cname}"`)
      list.push({ org_id: org, student_code: code || null, full_name: name, class_id: cid })
    })
    if (list.length) { const { error } = await supabase.from('students').insert(list); if (error) return setErr(error.message) }
    setErr(`Đã nhập ${list.length} học sinh.` + (bad.length ? ` Bỏ qua ${bad.length} dòng lỗi: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? '…' : ''}` : ''))
    load()
  }
  async function remove(s: St) {
    if (!confirm(`Xoá học sinh ${s.full_name}?`)) return
    await supabase.from('students').delete().eq('id', s.id); load()
  }

  async function setStatus(st: St, status: string) { await supabase.from('students').update({ status }).eq('id', st.id); load() }
  const all = rows.filter(r => (!cls || r.class_id === cls) && (r.full_name + (r.student_code ?? '')).toLowerCase().includes(q.toLowerCase()))
  const pages = Math.max(1, Math.ceil(all.length / PAGE)); const cur = Math.min(page, pages)
  const shown = all.slice((cur - 1) * PAGE, cur * PAGE)

  return (
    <>
      <div className="bar">
        <div>
          <input className="search" placeholder="Tìm theo tên hoặc mã học sinh…" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />{' '}
          <select value={cls} onChange={e => { setCls(e.target.value); setPage(1) }} aria-label="Lọc theo lớp">
            <option value="">Tất cả lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="tools">
          <label className="filebtn">Nhập từ CSV<input type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = '' }} /></label>
          <button className="primary" onClick={() => setForm({ full_name: '', student_code: '', class_id: classes[0]?.id ?? '' })}>Thêm học sinh</button>
        </div>
      </div>
      {err && !form && <p className="sub">{err} <small>Định dạng: Mã học sinh, Họ tên, Tên lớp (dòng đầu là tiêu đề). Xuất file Excel sang CSV rồi nhập.</small></p>}
      
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
        <thead><tr><th>Học sinh</th><th>Lớp</th><th>Khối</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>
          {shown.map(s => (
            <tr key={s.id}><td><b>{s.full_name}</b><br /><small>{s.student_code}</small></td><td>{s.classes?.name ?? '—'}</td><td>{s.classes?.grade ?? '—'}</td>
              <td><select value={s.status} onChange={e => setStatus(s, e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td><button onClick={() => remove(s)}>Xoá</button></td></tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={5}>Không có học sinh phù hợp.</td></tr>}
        </tbody>
      </table>
      <div className="bar" style={{ marginTop: 10 }}><small>Hiển thị {shown.length}/{PAGE} (trang {cur}/{pages}) · Tổng {all.length} học sinh</small>
        <div className="tools"><button disabled={cur <= 1} onClick={() => setPage(cur - 1)}>‹ Trước</button><button disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Sau ›</button></div></div>
    </>
  )
}
