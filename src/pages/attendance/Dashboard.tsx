import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { today, addDays, attendRate } from '../../lib/attendance'
import { downloadXlsx } from '../../lib/sheet'
import { Tiles, HBars } from '../department/charts'

// Dashboard điểm danh (trường, Phòng/Sở/Tỉnh/Bộ, nền tảng) — số liệu từ attendance_summary() (migration 027).
// name = 'Buổi dạy & điểm danh' (cổng nền tảng): xếp trường theo số tiết chưa điểm danh để đôn đốc.

type Row = {
  org_id: string; school: string; ward: string | null; parent_name: string | null
  planned: number; taught: number; not_marked: number; cancelled: number; makeup: number
  stem_planned: number; stem_taught: number; stem_room_periods: number
  present: number; absent: number; late: number; excused: number; teachers_not_marked: number
}
const RANGES: [string, string, number][] = [['7', '7 ngày', 6], ['30', '30 ngày', 29], ['90', '90 ngày', 89]]
const nf = (n: number) => n.toLocaleString('vi-VN')
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)
const short = (n: string) => n.replace(/^Trường\s+/, '')

export function AttendanceDashboard({ name }: { name?: string }) {
  const ops = name === 'Buổi dạy & điểm danh'
  const [range, setRange] = useState('7')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [sort, setSort] = useState<'not_marked' | 'rate' | 'taught_pct' | 'name'>(ops ? 'not_marked' : 'taught_pct')
  const [q, setQ] = useState('')
  const to = today(), from = addDays(to, -(RANGES.find(r => r[0] === range)![2]))

  useEffect(() => {
    setRows(null)
    supabase.rpc('attendance_summary', { p_from: from, p_to: to }).then(({ data, error }) => {
      if (error) setErr(error.message); else { setErr(''); setRows((data as Row[]) ?? []) }
    })
  }, [range])

  if (!rows) return <p className="sub">{err ? 'Không tải được số liệu: ' + err : 'Đang tổng hợp số liệu điểm danh…'}</p>
  const sum = (k: keyof Row) => rows.reduce((a, r) => a + (r[k] as number), 0)
  const active = rows.filter(r => r.planned > 0)
  const tot = { present: sum('present'), late: sum('late'), absent: sum('absent'), excused: sum('excused') }
  const rateOf = (r: Row) => attendRate(r)
  const taughtPct = (r: Row) => pct(r.taught, r.taught + r.not_marked)
  const list = rows.filter(r => short(r.school).toLowerCase().includes(q.toLowerCase()) || (r.ward ?? '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === 'name' ? a.school.localeCompare(b.school, 'vi')
      : sort === 'not_marked' ? b.not_marked - a.not_marked
      : sort === 'rate' ? (rateOf(a) ?? 101) - (rateOf(b) ?? 101)
      : (taughtPct(a) ?? 101) - (taughtPct(b) ?? 101))
  const worst = [...active].sort((a, b) => (taughtPct(a) ?? 100) - (taughtPct(b) ?? 100)).slice(0, 8)

  function exportXlsx() {
    downloadXlsx(`diem-danh-${from}-${to}.xlsx`, [
      { key: 'school', label: 'Trường', width: 34 }, { key: 'ward', label: 'Xã/phường', width: 18 }, { key: 'parent', label: 'Đơn vị quản lý', width: 24 },
      { key: 'planned', label: 'Tiết theo lịch' }, { key: 'taught', label: 'Đã dạy' }, { key: 'not_marked', label: 'Chưa điểm danh' },
      { key: 'cancelled', label: 'Huỷ' }, { key: 'makeup', label: 'Dạy bù' }, { key: 'stem', label: 'Tiết STEM đã dạy' },
      { key: 'room', label: 'Tiết dùng phòng STEM' }, { key: 'rate', label: 'Chuyên cần (%)' }, { key: 'absent', label: 'Lượt vắng' },
    ], list.map(r => [r.school, r.ward, r.parent_name, r.planned, r.taught, r.not_marked, r.cancelled, r.makeup, r.stem_taught, r.stem_room_periods, rateOf(r), r.absent]))
  }

  const rate = attendRate(tot)
  const tp = pct(sum('taught'), sum('taught') + sum('not_marked'))
  return (
    <>
      <div className="bar">
        <div className="segmented" style={{ margin: 0 }}>{RANGES.map(([k, l]) => <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>)}</div>
        <button onClick={exportXlsx} disabled={!list.length}>Xuất Excel</button>
      </div>
      <Tiles items={[
        { label: 'Trường có tiết theo lịch', value: `${active.length}/${rows.length}`, sub: rows.length > active.length ? `${rows.length - active.length} trường chưa có TKB / chưa sinh buổi dạy` : 'Mọi trường đã có buổi dạy' },
        { label: 'Tiết đã dạy (đã điểm danh)', value: tp === null ? '—' : tp + '%', sub: `${nf(sum('taught'))} / ${nf(sum('taught') + sum('not_marked'))} tiết đã diễn ra`, tone: tp !== null && tp < 90 ? 'warn' : '' },
        { label: 'Tiết chưa điểm danh', value: nf(sum('not_marked')), sub: `${nf(sum('teachers_not_marked'))} lượt GV cần đôn đốc`, tone: sum('not_marked') ? 'bad' : '' },
        { label: 'Chuyên cần học sinh', value: rate === null ? '—' : rate + '%', sub: `${nf(tot.absent)} lượt vắng · ${nf(tot.excused)} có phép` },
        { label: 'Tiết STEM đã dạy', value: nf(sum('stem_taught')), sub: `${nf(sum('stem_room_periods'))} tiết dùng phòng STEM` },
        { label: 'Tiết huỷ / dạy bù', value: `${nf(sum('cancelled'))} / ${nf(sum('makeup'))}` },
      ]} />
      {worst.length > 1 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>Trường có tỉ lệ điểm danh thấp nhất</h3>
          <HBars data={worst.map(r => ({ label: short(r.school), value: taughtPct(r) ?? 0, sub: `${r.not_marked} tiết chưa điểm danh` }))} />
        </div>
      )}
      <div className="bar" style={{ margin: '16px 0 8px' }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm trường, xã/phường…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sắp xếp">
          <option value="not_marked">Nhiều tiết chưa điểm danh trước</option>
          <option value="taught_pct">Tỉ lệ điểm danh thấp trước</option>
          <option value="rate">Chuyên cần thấp trước</option>
          <option value="name">Tên trường</option>
        </select>
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Trường</th><th>Tiết theo lịch</th><th>Đã dạy</th><th>Chưa điểm danh</th><th>Huỷ · Bù</th><th>STEM đã dạy</th><th>Chuyên cần</th></tr></thead>
        <tbody>
          {list.map(r => { const t = taughtPct(r), a = rateOf(r); return (
            <tr key={r.org_id}>
              <td><b>{short(r.school)}</b><br /><small>{[r.ward, r.parent_name].filter(Boolean).join(' · ')}</small></td>
              <td>{nf(r.planned)}</td>
              <td>{nf(r.taught)}{t !== null && <><br /><small>{t}%</small></>}</td>
              <td>{r.not_marked ? <span className="pill inactive">{nf(r.not_marked)}</span> : <small>0</small>}{r.teachers_not_marked > 0 && <><br /><small>{r.teachers_not_marked} GV</small></>}</td>
              <td>{r.cancelled} · {r.makeup}</td>
              <td>{nf(r.stem_taught)}<br /><small>{r.stem_room_periods} tiết phòng STEM</small></td>
              <td>{a === null ? <small>—</small> : <>{a}%<div className="track"><div className="fill g" style={{ width: a + '%' }} /></div></>}</td>
            </tr>
          ) })}
          {list.length === 0 && <tr><td colSpan={7}>Không có trường phù hợp.</td></tr>}
        </tbody>
      </table></div>
      <p className="sub" style={{ marginTop: 8 }}>Chỉ tính tiết đã bắt đầu, từ {from.split('-').reverse().join('/')} đến hôm nay. Chuyên cần = (có mặt + muộn) / số lượt điểm danh.</p>
    </>
  )
}

// ================= Thời khoá biểu & xếp lịch (toàn hệ thống) =================
type Tkb = { org_id: string; school: string; parent_name: string | null; classes: number; classes_with_tkb: number; entries: number; stem_entries: number; teachers: number; conflicts: number; current_term: string | null }
type Conflict = { org_id: string; kind: 'teacher' | 'room'; weekday: number; period_name: string; resource: string; classes: string }

export function TimetableOverview() {
  const [rows, setRows] = useState<Tkb[] | null>(null)
  const [conf, setConf] = useState<Conflict[]>([])
  const [err, setErr] = useState('')
  const [q, setQ] = useState(''); const [only, setOnly] = useState<'all' | 'missing' | 'conflict'>('all')
  useEffect(() => {
    Promise.all([supabase.rpc('timetable_overview'), supabase.rpc('timetable_conflicts')]).then(([a, b]) => {
      if (a.error || b.error) setErr((a.error ?? b.error)!.message)
      setRows((a.data as Tkb[]) ?? []); setConf((b.data as Conflict[]) ?? [])
    })
  }, [])
  if (!rows) return <p className="sub">{err || 'Đang tải…'}</p>
  const missing = rows.filter(r => r.classes > 0 && r.classes_with_tkb < r.classes)
  const list = rows.filter(r => short(r.school).toLowerCase().includes(q.toLowerCase())
    && (only === 'all' || (only === 'missing' ? r.classes_with_tkb < r.classes : r.conflicts > 0)))
  const name = (id: string) => short(rows.find(r => r.org_id === id)?.school ?? '')
  return (
    <>
      <Tiles items={[
        { label: 'Trường có TKB', value: `${rows.filter(r => r.entries > 0).length}/${rows.length}` },
        { label: 'Trường còn lớp chưa có TKB', value: missing.length, tone: missing.length ? 'warn' : '' },
        { label: 'Tiết STEM / tuần', value: nf(rows.reduce((a, r) => a + r.stem_entries, 0)), sub: `trên ${nf(rows.reduce((a, r) => a + r.entries, 0))} tiết` },
        { label: 'Chỗ trùng lịch GV/phòng', value: conf.length, tone: conf.length ? 'bad' : '' },
      ]} />
      {conf.length > 0 && (
        <div className="panel warnbox" style={{ marginTop: 16 }}>
          <h3>Trùng lịch cần xử lý</h3>
          <div className="wrap"><table>
            <thead><tr><th>Trường</th><th>Loại</th><th>Thứ · Tiết</th><th>Giáo viên / Phòng</th><th>Các lớp</th></tr></thead>
            <tbody>{conf.map((c, i) => (
              <tr key={i}><td>{name(c.org_id)}</td><td>{c.kind === 'teacher' ? 'Giáo viên' : 'Phòng STEM'}</td>
                <td>Thứ {c.weekday} · {c.period_name}</td><td><b>{c.resource}</b></td><td>{c.classes}</td></tr>
            ))}</tbody>
          </table></div>
          <small>Thường do một tiết áp dụng mọi học kỳ trùng với tiết riêng của học kỳ. Trường sửa ở mục Thời khoá biểu.</small>
        </div>
      )}
      <div className="bar" style={{ margin: '16px 0 8px' }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm trường…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="segmented" style={{ margin: 0 }}>
          {([['all', 'Tất cả'], ['missing', 'Thiếu TKB'], ['conflict', 'Có trùng lịch']] as const).map(([k, l]) => <button key={k} className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>{l}</button>)}
        </div>
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Trường</th><th>Học kỳ hiện tại</th><th>Lớp có TKB</th><th>Tiết/tuần</th><th>Tiết STEM</th><th>GV có tiết</th><th>Trùng lịch</th></tr></thead>
        <tbody>
          {list.map(r => (
            <tr key={r.org_id}>
              <td><b>{short(r.school)}</b><br /><small>{r.parent_name}</small></td>
              <td>{r.current_term ?? <span className="pill inactive">Chưa đặt</span>}</td>
              <td>{r.classes_with_tkb}/{r.classes}{r.classes_with_tkb < r.classes && <span className="pill maintenance" style={{ marginLeft: 6 }}>thiếu</span>}</td>
              <td>{nf(r.entries)}</td><td>{nf(r.stem_entries)}</td><td>{r.teachers}</td>
              <td>{r.conflicts ? <span className="pill inactive">{r.conflicts}</span> : <small>0</small>}</td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={7}>Không có trường phù hợp.</td></tr>}
        </tbody>
      </table></div>
    </>
  )
}
