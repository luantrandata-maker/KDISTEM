// Ngày nghỉ & lễ (migration 030) — dùng cho Trường (Quản lý khai báo) và Sở/Phòng (Điều hành).
// Ngày nghỉ của Sở áp dụng cho mọi trường trực thuộc. Buổi dạy không sinh vào ngày nghỉ;
// tiết đã sinh sẵn (chưa điểm danh) trong ngày nghỉ được bỏ ngay khi trường lưu, hoặc khi mở tuần đó.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { today, addDays, dayLabel, parseDay } from '../lib/attendance'
import { downloadXlsx } from '../lib/sheet'

type Holiday = { id: string; org_id: string; name: string; starts_on: string; ends_on: string; note: string | null; organizations: { name: string; type: string } | null }
type Org = { id: string; name: string; type: string }

const days = (h: { starts_on: string; ends_on: string }) => Math.round((parseDay(h.ends_on).getTime() - parseDay(h.starts_on).getTime()) / 86400000) + 1
const weekdays = (from: string, to: string) => {
  let n = 0
  for (let d = from; d <= to; d = addDays(d, 1)) if (parseDay(d).getDay() !== 0) n++
  return n
}
// Ngày lễ cố định theo Bộ luật Lao động; Tết Nguyên đán, Giỗ Tổ theo âm lịch — nhập theo thông báo hằng năm
function presets(): { name: string; starts_on: string; ends_on: string }[] {
  const t = today(), y = Number(t.slice(0, 4))
  const next = (m: number, d: number) => { const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; return s >= t ? s : `${y + 1}${s.slice(4)}` }
  return [
    { name: 'Tết Dương lịch', starts_on: next(1, 1), ends_on: next(1, 1) },
    { name: 'Ngày Chiến thắng & Quốc tế Lao động', starts_on: next(4, 30), ends_on: addDays(next(4, 30), 1) },
    { name: 'Quốc khánh', starts_on: next(9, 2), ends_on: next(9, 2) },
  ].sort((a, b) => a.starts_on.localeCompare(b.starts_on))
}

export function Holidays({ orgId }: { orgId: string | null }) {
  const [org, setOrg] = useState<Org | null>(null)
  const [rows, setRows] = useState<Holiday[]>([])
  const [past, setPast] = useState(false)
  const [form, setForm] = useState<{ name: string; starts_on: string; ends_on: string; note: string } | null>(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    if (!orgId) return
    const [o, h] = await Promise.all([
      supabase.from('organizations').select('id, name, type').eq('id', orgId).maybeSingle(),
      supabase.from('school_holidays').select('id, org_id, name, starts_on, ends_on, note, organizations(name, type)').order('starts_on'),
    ])
    if (h.error) setErr(/does not exist|schema cache/i.test(h.error.message) ? 'Hãy chạy migration 030_activities_self_study_holidays.sql trên Supabase.' : h.error.message)
    setOrg(o.data as Org | null); setRows((h.data as unknown as Holiday[]) ?? [])
  }
  useEffect(() => { load() }, [orgId])

  const isSchool = org?.type === 'school'
  // Trường: của trường + cấp trên áp xuống. Sở/Phòng: của đơn vị mình (cấp dưới tự khai báo riêng)
  const mine = rows.filter(r => r.org_id === orgId)
  const inherited = isSchool ? rows.filter(r => r.org_id !== orgId) : []
  const below = !isSchool ? rows.filter(r => r.org_id !== orgId && r.organizations?.type === 'school') : []
  const visible = (l: Holiday[]) => past ? l : l.filter(r => r.ends_on >= today())

  // Trường: bỏ ngay các tiết chưa điểm danh rơi vào ngày nghỉ (sinh lại theo từng khúc ≤ 63 ngày)
  async function resync(from: string, to: string) {
    if (!isSchool) return null
    let a = from < today() ? today() : from
    let removed = 0
    while (a <= to) {
      const b = addDays(a, 62) < to ? addDays(a, 62) : to
      const { data, error } = await supabase.rpc('generate_teaching_sessions', { p_from: a, p_to: b })
      if (error) return null
      removed += (data as { removed: number }).removed ?? 0
      a = addDays(b, 1)
    }
    return removed
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !orgId) return
    setErr('')
    if (!form.name.trim()) return setErr('Nhập tên ngày nghỉ.')
    if (!form.starts_on || !form.ends_on) return setErr('Chọn ngày bắt đầu và kết thúc.')
    if (form.ends_on < form.starts_on) return setErr('Ngày kết thúc phải từ ngày bắt đầu trở đi.')
    if (days(form) > 61) return setErr('Mỗi đợt nghỉ tối đa 61 ngày (nghỉ hè: khai báo theo ngày kết thúc học kỳ).')
    const { error } = await supabase.from('school_holidays').insert({ org_id: orgId, name: form.name.trim(), starts_on: form.starts_on, ends_on: form.ends_on, note: form.note.trim() || null })
    if (error) return setErr(error.code === '42501' ? 'Bạn chưa có quyền khai báo ngày nghỉ (cần quyền Năm học & học kỳ).' : error.message)
    const removed = await resync(form.starts_on, form.ends_on)
    setMsg(`Đã thêm “${form.name.trim()}”.` + (removed ? ` Đã bỏ ${removed} tiết chưa diễn ra trong thời gian nghỉ.` : '')
      + (!isSchool ? ' Áp dụng cho mọi trường trực thuộc.' : ''))
    setForm(null); load()
  }
  async function remove(h: Holiday) {
    if (!confirm(`Xoá ngày nghỉ “${h.name}”?${isSchool ? ' Tiết theo TKB trong những ngày này sẽ được sinh lại.' : ''}`)) return
    const { error } = await supabase.from('school_holidays').delete().eq('id', h.id)
    if (error) return setErr(error.message)
    const r = await resync(h.starts_on, h.ends_on)
    setMsg(`Đã xoá “${h.name}”.` + (r !== null ? ' Đã sinh lại tiết theo TKB.' : '')); load()
  }
  function exportXlsx() {
    const all = [...mine, ...inherited, ...below]
    downloadXlsx(`Ngay-nghi_${org?.name ?? ''}`.replace(/\s+/g, '-'),
      [{ key: 'n', label: 'Tên', width: 32 }, { key: 'f', label: 'Từ ngày' }, { key: 't', label: 'Đến ngày' }, { key: 'd', label: 'Số ngày' }, { key: 'o', label: 'Đơn vị khai báo', width: 28 }, { key: 'g', label: 'Ghi chú', width: 30 }],
      all.map(h => [h.name, h.starts_on.split('-').reverse().join('/'), h.ends_on.split('-').reverse().join('/'), days(h), h.organizations?.name ?? '', h.note ?? '']), 'Ngày nghỉ')
  }

  const Table = ({ list, own, by }: { list: Holiday[]; own?: boolean; by?: boolean }) => (
    <div className="wrap"><table>
      <thead><tr><th>Ngày nghỉ</th><th>Thời gian</th><th>Ngày học bị nghỉ</th>{by && <th>Đơn vị</th>}<th>Ghi chú</th>{own && <th />}</tr></thead>
      <tbody>{list.map(h => (
        <tr key={h.id} className={h.ends_on < today() ? 'muted' : ''}>
          <td><b>{h.name}</b>{h.starts_on <= today() && h.ends_on >= today() && <span className="pill maintenance" style={{ marginLeft: 6 }}>Đang nghỉ</span>}</td>
          <td>{dayLabel(h.starts_on)}{h.ends_on !== h.starts_on && <> – {dayLabel(h.ends_on)}</>}<br /><small>{h.starts_on.slice(0, 4)}{days(h) > 1 ? ` · ${days(h)} ngày` : ''}</small></td>
          <td>{weekdays(h.starts_on, h.ends_on)} <small>(Thứ 2–7)</small></td>
          {by && <td>{h.organizations?.name}</td>}
          <td><small>{h.note}</small></td>
          {own && <td><button className="x" onClick={() => remove(h)} aria-label={`Xoá ${h.name}`}>×</button></td>}
        </tr>
      ))}
      {list.length === 0 && <tr><td colSpan={6}>Chưa có ngày nghỉ{past ? '' : ' sắp tới'}.</td></tr>}</tbody>
    </table></div>
  )

  const ps = presets().filter(p => !rows.some(r => r.starts_on === p.starts_on))
  return (
    <>
      <p className="sub">{isSchool
        ? 'Buổi dạy không được sinh từ thời khoá biểu vào ngày nghỉ. Ngày nghỉ do Sở khai báo tự áp dụng cho trường. Tiết dạy bù vẫn thêm được vào ngày nghỉ (vd: Thứ 7).'
        : 'Ngày nghỉ khai báo ở đây áp dụng cho mọi trường trực thuộc; trường khai báo thêm ngày nghỉ riêng của mình.'}</p>
      <div className="bar">
        <label><input type="checkbox" checked={past} onChange={e => setPast(e.target.checked)} /> Hiện cả ngày nghỉ đã qua</label>
        <span className="tools">
          <button onClick={exportXlsx}>Xuất Excel</button>
          <button className="primary" onClick={() => { setMsg(''); setForm({ name: '', starts_on: today(), ends_on: today(), note: '' }) }}>+ Thêm ngày nghỉ</button>
        </span>
      </div>
      {msg && <p className="sub"><b>{msg}</b></p>}
      {err && !form && <p className="msg">{err}</p>}
      {form && (
        <form className="panel" onSubmit={save}>
          <div className="bar"><h3>Thêm ngày nghỉ</h3><button type="button" onClick={() => setForm(null)}>Đóng</button></div>
          {ps.length > 0 && <p className="tools" style={{ marginTop: 0 }}><small>Gợi ý:</small>
            {ps.map(p => <button type="button" className="chipbtn" key={p.name} onClick={() => setForm({ ...form, ...p })}>{p.name} · {p.starts_on.split('-').reverse().slice(0, 2).join('/')}</button>)}</p>}
          <div className="formgrid">
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên *</span>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="VD: Tết Nguyên đán, Nghỉ giữa học kỳ, Hội thao" maxLength={200} /></label>
            <label className="field"><span>Từ ngày *</span>
              <input type="date" value={form.starts_on} onChange={e => setForm({ ...form, starts_on: e.target.value, ends_on: form.ends_on < e.target.value ? e.target.value : form.ends_on })} /></label>
            <label className="field"><span>Đến ngày *</span>
              <input type="date" value={form.ends_on} min={form.starts_on} onChange={e => setForm({ ...form, ends_on: e.target.value })} /></label>
            <label className="field" style={{ gridColumn: 'span 2' }}><span>Ghi chú</span>
              <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
            <div className="formactions" style={{ gridColumn: '1 / -1' }}>
              <button className="primary" type="submit">Lưu</button>
              {form.starts_on && form.ends_on >= form.starts_on && <small> {days(form)} ngày · {weekdays(form.starts_on, form.ends_on)} ngày học (Thứ 2–7)</small>}
            </div>
            {err && <p className="msg">{err}</p>}
          </div>
        </form>
      )}
      <div className="panel"><h3 style={{ marginTop: 0 }}>{isSchool ? 'Ngày nghỉ của trường' : `Ngày nghỉ do ${org?.name ?? 'đơn vị'} khai báo`}</h3><Table list={visible(mine)} own /></div>
      {isSchool && <div className="panel"><h3 style={{ marginTop: 0 }}>Theo lịch của Sở / cấp trên</h3><Table list={visible(inherited)} by /></div>}
      {!isSchool && below.length > 0 && <div className="panel"><h3 style={{ marginTop: 0 }}>Ngày nghỉ riêng của các trường</h3><Table list={visible(below)} by /></div>}
    </>
  )
}
