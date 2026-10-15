import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { useDeptStats, LEVEL, type SchoolStat } from './data'
import { Tiles } from './charts'

type Y = { name: string; term: string; starts_on: string | null; ends_on: string | null }
const ago = (iso: string | null) => {
  if (!iso) return 'Chưa có hoạt động'
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000)
  return d <= 0 ? 'Hôm nay' : d === 1 ? 'Hôm qua' : `${d} ngày trước`
}
const checks = (s: SchoolStat) => [s.activated, s.has_year, s.k12_synced, s.rooms_active > 0, s.units > 0]
type F = 'all' | 'full' | 'missing' | 'inactive'

// Điều hành & cấu hình: năm học, trạng thái khai báo của từng trường, kích hoạt trường
export function DeptAdmin() {
  const { schools, loading, err, reload } = useDeptStats()
  const [year, setYear] = useState<Y | null>(null)
  const [f, setF] = useState<F>('all')
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    supabase.from('academic_years').select('name, term, starts_on, ends_on').eq('is_current', true).then(({ data }) => {
      const ys = (data as Y[]) ?? []
      const count = new Map<string, number>(); ys.forEach(y => count.set(y.name + '|' + y.term, (count.get(y.name + '|' + y.term) ?? 0) + 1))
      const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      setYear(ys.find(y => y.name + '|' + y.term === top) ?? null)
    })
  }, [])
  if (loading || err) return <p className="sub">{err || 'Đang tải…'}</p>

  const full = (s: SchoolStat) => checks(s).every(Boolean)
  const shown = schools.filter(s => (f === 'all' || (f === 'full' && full(s)) || (f === 'missing' && s.activated && !full(s)) || (f === 'inactive' && !s.activated))
    && (!q || s.name.toLowerCase().includes(q.toLowerCase())))
  const progress = year?.starts_on && year.ends_on
    ? Math.max(0, Math.min(100, Math.round(100 * (Date.now() - new Date(year.starts_on).getTime()) / (new Date(year.ends_on).getTime() - new Date(year.starts_on).getTime())))) : null

  async function toggle(s: SchoolStat) {
    if (s.activated && !confirm(`Tạm khoá ${s.name}? Trường vẫn giữ dữ liệu.`)) return
    const { error } = await supabase.from('organizations').update({ activated_at: s.activated ? null : new Date().toISOString() }).eq('id', s.school_id)
    if (error) return setMsg('Không cập nhật được: ' + error.message)
    setMsg(`${s.activated ? 'Đã tạm khoá' : 'Đã kích hoạt'} ${s.name}.`); reload()
  }
  const Mark = ({ ok, label }: { ok: boolean; label: string }) => (
    <span className={'gpill ' + (ok ? 'good' : 'bad')} title={label}><i aria-hidden="true">{ok ? '✓' : '✕'}</i>{ok ? 'Có' : 'Chưa'}</span>
  )

  return (
    <>
      <div className="twocol">
        <div className="panel">
          <small>Năm học hiện tại (đa số trường)</small>
          <h2 style={{ margin: '4px 0' }}>{year ? `${year.name} · ${year.term}` : 'Chưa có'}</h2>
          {progress != null && <><div className="track"><div className="fill" style={{ width: progress + '%', background: 'var(--accent)' }} /></div>
            <small>Đã qua {progress}% học kỳ · {year?.starts_on?.split('-').reverse().join('/')} – {year?.ends_on?.split('-').reverse().join('/')}</small></>}
        </div>
        <Tiles items={[
          { label: 'Đã kích hoạt', value: `${schools.filter(s => s.activated).length}/${schools.length}` },
          { label: 'Cấu hình đầy đủ', value: schools.filter(full).length, tone: 'good' },
          { label: 'Thiếu cấu hình', value: schools.filter(s => s.activated && !full(s)).length, tone: 'warn' },
          { label: 'Chưa đồng bộ K12', value: schools.filter(s => !s.k12_synced).length, tone: 'bad' },
        ]} />
      </div>
      <div className="bar">
        <Tabs<F> value={f} onChange={setF} items={[['all', 'Tất cả', schools.length], ['full', 'Đầy đủ', schools.filter(full).length],
          ['missing', 'Thiếu cấu hình', schools.filter(s => s.activated && !full(s)).length], ['inactive', 'Chưa kích hoạt', schools.filter(s => !s.activated).length]]} />
        <input className="search" style={{ margin: 0 }} placeholder="Tìm trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm trường" />
      </div>
      {msg && <p className="sub"><b>{msg}</b></p>}
      <div className="wrap">
        <table>
          <thead><tr><th>Trường</th><th>Cấp</th><th>Kích hoạt</th><th>Năm học</th><th>Đồng bộ K12</th><th>Phòng STEM</th><th>Khai báo thiết bị (TT38)</th><th>Hoạt động gần nhất</th><th></th></tr></thead>
          <tbody>{shown.map(s => (
            <tr key={s.school_id}>
              <td><b>{s.name.replace(/^Trường\s+/, '')}</b><br /><small>{s.ward} · {checks(s).filter(Boolean).length}/5 mục</small></td>
              <td>{LEVEL[s.level ?? '']}</td>
              <td><Mark ok={s.activated} label="Kích hoạt" /></td><td><Mark ok={s.has_year} label="Năm học" /></td><td><Mark ok={s.k12_synced} label="Đồng bộ K12" /></td>
              <td><Mark ok={s.rooms_active > 0} label="Phòng STEM" /></td><td><Mark ok={s.units > 0} label="Thiết bị" /></td>
              <td><small>{ago(s.last_activity)}</small></td>
              <td><button className={s.activated ? '' : 'primary'} onClick={() => toggle(s)}>{s.activated ? 'Tạm khoá' : 'Kích hoạt'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}
