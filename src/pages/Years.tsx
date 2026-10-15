import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { type Year, yearLabel } from '../lib/year'

type Props = { orgId: string | null; years: Year[]; year: Year | null; reloadYears: () => void; selectYear: (id: string) => void }
const vnDate = (d: string | null) => d ? d.split('-').reverse().join('/') : '—'

// Năm học & học kỳ: thêm học kỳ, đặt học kỳ hiện tại, sao chép thời khóa biểu sang học kỳ mới
export default function Years({ orgId, years, year, reloadYears, selectYear }: Props) {
  const [usage, setUsage] = useState<Record<string, { classes: number; tkb: number }>>({})
  const [form, setForm] = useState<null | { name: string; term: string; starts_on: string; ends_on: string }>(null)
  const [copy, setCopy] = useState<null | { from: string; to: string }>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const [c, t] = await Promise.all([supabase.from('classes').select('year_id'), supabase.from('timetable_entries').select('year_id')])
    const u: Record<string, { classes: number; tkb: number }> = {}
    const bump = (id: string | null, k: 'classes' | 'tkb') => { if (!id) return; u[id] ??= { classes: 0, tkb: 0 }; u[id][k]++ }
    ;((c.data as { year_id: string | null }[]) ?? []).forEach(x => bump(x.year_id, 'classes'))
    ;((t.data as { year_id: string | null }[]) ?? []).forEach(x => bump(x.year_id, 'tkb'))
    setUsage(u)
  }
  useEffect(() => { load() }, [years.length])

  function suggest() {
    const last = years[0]
    if (!last) return { name: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`, term: 'HK I', starts_on: '', ends_on: '' }
    if (last.term === 'HK I') return { name: last.name, term: 'HK II', starts_on: '', ends_on: '' }
    const [a] = last.name.split('-').map(Number)
    return { name: `${a + 1}-${a + 2}`, term: 'HK I', starts_on: '', ends_on: '' }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !orgId) return
    if (!/^\d{4}-\d{4}$/.test(form.name.trim())) return setErr('Năm học có dạng 2026-2027.')
    const { data, error } = await supabase.from('academic_years').insert({
      org_id: orgId, name: form.name.trim(), term: form.term, starts_on: form.starts_on || null, ends_on: form.ends_on || null, is_current: false,
    }).select('id').single()
    if (error) return setErr(error.message.includes('academic_years_name_term') ? 'Học kỳ này đã có.' : error.message)
    setErr(''); setForm(null); reloadYears(); if (data) setCopy({ from: year?.id ?? '', to: data.id })
  }
  async function makeCurrent(y: Year) {
    const { error } = await supabase.rpc('set_current_year', { p_year: y.id })
    if (error) return setErr(error.message)
    setErr(''); setMsg(`Đã đặt ${yearLabel(y)} là học kỳ hiện tại.`); reloadYears()
  }
  async function remove(y: Year) {
    if (!confirm(`Xoá ${yearLabel(y)}?`)) return
    const { error } = await supabase.from('academic_years').delete().eq('id', y.id)
    if (error) return setErr('Không xoá được (học kỳ đang được dùng): ' + error.message)
    reloadYears()
  }
  async function copyTimetable(e: React.FormEvent) {
    e.preventDefault()
    if (!copy || !orgId || !copy.from || copy.from === copy.to) return
    const { data: src } = await supabase.from('timetable_entries').select('class_id, teacher_id, period_id, weekday, subject, kind, room_id').eq('year_id', copy.from)
    if (!src?.length) return setErr('Học kỳ nguồn chưa có thời khóa biểu.')
    const { count } = await supabase.from('timetable_entries').select('id', { count: 'exact', head: true }).eq('year_id', copy.to)
    if (count && !confirm(`Học kỳ đích đã có ${count} tiết. Xoá và thay bằng ${src.length} tiết từ học kỳ nguồn?`)) return
    if (count) await supabase.from('timetable_entries').delete().eq('year_id', copy.to)
    const { error } = await supabase.from('timetable_entries').insert(src.map(r => ({ ...r, org_id: orgId, year_id: copy.to })))
    if (error) return setErr('Không sao chép được: ' + error.message)
    setErr(''); setMsg(`Đã sao chép ${src.length} tiết sang ${yearLabel(years.find(y => y.id === copy.to))}.`); setCopy(null); load()
  }

  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0, flex: 1, minWidth: 260 }}>Học kỳ hiện tại là mặc định cho mọi người dùng. Mỗi người vẫn chọn xem học kỳ khác ở đầu menu.</p>
        <span className="tools">
          <button onClick={() => setCopy({ from: years.find(y => y.is_current)?.id ?? '', to: years.find(y => !y.is_current)?.id ?? '' })} disabled={years.length < 2}>Sao chép TKB</button>
          <button className="primary" onClick={() => setForm(suggest())}>+ Thêm học kỳ</button>
        </span>
      </div>
      {err && <p className="msg">{err}</p>}
      {msg && <p className="sub"><b>{msg}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={save}>
          <label className="field"><span>Năm học *</span><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="2026-2027" /></label>
          <label className="field"><span>Học kỳ *</span>
            <select value={form.term} onChange={e => setForm({ ...form, term: e.target.value })}>{['HK I', 'HK II', 'Hè'].map(t => <option key={t}>{t}</option>)}</select></label>
          <label className="field"><span>Bắt đầu</span><input type="date" value={form.starts_on} onChange={e => setForm({ ...form, starts_on: e.target.value })} /></label>
          <label className="field"><span>Kết thúc</span><input type="date" value={form.ends_on} onChange={e => setForm({ ...form, ends_on: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Thêm</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {copy && (
        <form className="panel formgrid" onSubmit={copyTimetable}>
          <label className="field"><span>Sao chép thời khóa biểu từ</span>
            <select value={copy.from} onChange={e => setCopy({ ...copy, from: e.target.value })}>{years.map(y => <option key={y.id} value={y.id}>{yearLabel(y)} ({usage[y.id]?.tkb ?? 0} tiết)</option>)}</select></label>
          <label className="field"><span>Sang học kỳ</span>
            <select value={copy.to} onChange={e => setCopy({ ...copy, to: e.target.value })}>{years.map(y => <option key={y.id} value={y.id}>{yearLabel(y)} ({usage[y.id]?.tkb ?? 0} tiết)</option>)}</select></label>
          <div className="formactions"><button className="primary" type="submit" disabled={!copy.from || copy.from === copy.to}>Sao chép</button> <button type="button" onClick={() => setCopy(null)}>Để sau</button></div>
        </form>
      )}
      <div className="wrap">
        <table>
          <thead><tr><th>Năm học</th><th>Học kỳ</th><th>Thời gian</th><th>Lớp</th><th>Tiết TKB</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            {years.map(y => (
              <tr key={y.id}>
                <td><b>{y.name}</b></td><td>{y.term}</td><td className="nowrap">{vnDate(y.starts_on)} – {vnDate(y.ends_on)}</td>
                <td>{usage[y.id]?.classes ?? 0}</td><td>{usage[y.id]?.tkb ?? 0}</td>
                <td>{y.is_current ? <span className="pill active">Hiện tại</span> : <span className="pill">—</span>}{year?.id === y.id && <small> · đang xem</small>}</td>
                <td className="rowactions">
                  {year?.id !== y.id && <button onClick={() => selectYear(y.id)}>Xem</button>}
                  {!y.is_current && <button onClick={() => makeCurrent(y)}>Đặt hiện tại</button>}
                  {!y.is_current && !usage[y.id] && <button className="x" onClick={() => remove(y)} aria-label={`Xoá ${yearLabel(y)}`}>×</button>}
                </td>
              </tr>
            ))}
            {years.length === 0 && <tr><td colSpan={7}>Chưa có năm học nào. Bấm “Thêm học kỳ”.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
