import SchoolLocationImport from '../../components/SchoolLocationImport'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PROGRAM_COLOR } from '../teacher/common'
import { Tabs } from '../teacher/common'
import { useDeptStats, byWard, grade, pct, avg, sum, nf, LEVEL, PROGRAMS, PROGRAM_NAME, HEAT, type SchoolStat } from './data'
import { Tiles, GradePill, Columns, HBars, DataTable, rampColor, rampInk } from './charts'

// Bản đồ (Leaflet) tải lười để các màn khác của Sở không nặng thêm
const CoverageMap = lazy(() => import('./CoverageMap'))

const Loading = ({ err }: { err?: string }) => <p className="sub">{err ? 'Không tải được số liệu: ' + err : 'Đang tổng hợp số liệu các trường…'}</p>
const short = (n: string) => n.replace(/^Trường\s+/, '').replace('Tiểu học', 'TH')
const ProgBadges = ({ list }: { list: string[] }) => (
  <span className="nowrap">{PROGRAMS.map(p => (
    <span key={p} className="progchip" style={list.includes(p) ? { background: PROGRAM_COLOR[p], color: '#fff' } : { background: 'var(--soft)', color: '#b6c0cc' }}>{p}</span>
  ))}</span>
)

// ================= Dashboard toàn Sở + bản đồ nhiệt =================

export function DeptDashboard({ go }: { go?: (p: string) => void }) {
  const { schools, loading, err } = useDeptStats()
  const [sort, setSort] = useState('ward')
  if (loading || err) return <Loading err={err} />
  const deployed = schools.filter(s => s.programs.length > 0)
  const rows = [...schools].sort((a, b) => sort === 'ward' ? (a.ward ?? '').localeCompare(b.ward ?? '', 'vi') || b.kpi - a.kpi
    : (HEAT.find(h => h.key === sort)!.get(b) - HEAT.find(h => h.key === sort)!.get(a)))
  const needHelp = [...schools].sort((a, b) => a.kpi - b.kpi).slice(0, 5)
  return (
    <>
      <Tiles items={[
        { label: 'Trường triển khai STEM', value: `${deployed.length}/${schools.length}`, sub: `${pct(deployed.length, schools.length)}% số trường` },
        { label: 'Giáo viên', value: nf(sum(schools.map(s => s.teachers))), sub: `${nf(sum(schools.map(s => s.stem_teachers)))} GV dạy STEM` },
        { label: 'Học sinh học STEM', value: nf(sum(schools.map(s => s.stem_students))), sub: `trên ${nf(sum(schools.map(s => s.students)))} học sinh` },
        { label: 'Phòng STEM hoạt động', value: sum(schools.map(s => s.rooms_active)), sub: `${sum(schools.map(s => s.rooms))} phòng` },
        { label: 'Tiết STEM / tuần', value: nf(sum(schools.map(s => s.stem_periods))), sub: 'học kỳ hiện tại' },
        { label: 'KPI trung bình', value: Math.round(avg(schools.map(s => s.kpi))), sub: `${schools.filter(s => s.kpi < 45).length} trường chưa đạt` },
      ]} />
      <Suspense fallback={<div className="panel"><p className="sub">Đang tải bản đồ…</p></div>}><CoverageMap schools={schools} /></Suspense>
      <div className="panel">
        <div className="bar">
          <h3>Bản đồ nhiệt trường</h3>
          <span className="tools"><small>Sắp xếp</small>
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sắp xếp bản đồ nhiệt">
              <option value="ward">Theo xã/phường</option>{HEAT.map(h => <option key={h.key} value={h.key}>{h.label} (cao → thấp)</option>)}
            </select></span>
        </div>
        <p className="sub" style={{ margin: '0 0 8px' }}>Màu càng đậm, chỉ số càng tốt so với mục tiêu của cột. Rê chuột vào ô để xem giá trị.</p>
        <div className="wrap">
          <table className="heat">
            <thead><tr><th>Trường</th><th>Xã/phường</th>{HEAT.map(h => <th key={h.key}>{h.label}</th>)}</tr></thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.school_id}>
                  <td><b>{short(s.name)}</b> <small>{LEVEL[s.level ?? ''] ?? ''}</small></td>
                  <td><small>{s.ward}</small></td>
                  {HEAT.map(h => {
                    const v = h.get(s); const t = Math.min(1, v / h.max)
                    return <td key={h.key} className="hc" style={{ background: rampColor(t), color: rampInk(t) }} title={`${short(s.name)} · ${h.label}: ${h.fmt(v)}`}>{h.fmt(v)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="heatlegend"><small>Thấp</small>{[0, 0.2, 0.4, 0.6, 0.8, 1].map(t => <i key={t} style={{ background: rampColor(t) }} />)}<small>Cao</small></div>
      </div>
      <div className="twocol">
        <div className="panel">
          <h3>KPI theo xã/phường</h3>
          <HBars unit="" data={byWard(schools).map(w => ({ label: w.ward, value: w.kpi, sub: `${w.schools} trường` }))} />
          <button className="linkbtn" onClick={() => go?.('KPI & Xếp hạng Xã/Phường')}>Xem xếp hạng →</button>
        </div>
        <div className="panel">
          <h3>Trường cần hỗ trợ</h3>
          {needHelp.map(s => (
            <div className="roomrow" key={s.school_id}>
              <span><b>{short(s.name)}</b><br /><small>{s.ward} · {s.programs.length ? s.programs.join(', ') : 'chưa triển khai CT'} · {s.rooms_active} phòng STEM</small></span>
              <span className="tools"><b>{s.kpi}</b><GradePill kpi={s.kpi} /></span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ================= KPI & Xếp hạng Xã/Phường =================
export function DeptWardKpi() {
  const { schools, loading, err } = useDeptStats()
  const [tab, setTab] = useState<'detail' | 'rank'>('detail')
  const [q, setQ] = useState('')
  const wards = useMemo(() => byWard(schools), [schools])
  if (loading || err) return <Loading err={err} />
  const shown = wards.filter(w => w.ward.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <Tiles items={[
        { label: 'Tổng xã/phường', value: wards.length, sub: `${schools.length} trường` },
        { label: 'KPI trung bình', value: Math.round(avg(schools.map(s => s.kpi))), sub: 'thang 100' },
        { label: 'Triển khai STEM', value: pct(schools.filter(s => s.programs.length).length, schools.length) + '%', sub: 'số trường có ≥ 1 chương trình' },
        { label: 'Cần cải thiện', value: wards.filter(w => w.kpi < 70).length, sub: 'xã/phường KPI dưới 70', tone: 'warn' },
      ]} />
      <div className="bar">
        <Tabs value={tab} onChange={setTab} items={[['detail', 'KPI chi tiết'], ['rank', 'Xếp hạng']]} />
        <input className="search" style={{ margin: 0 }} placeholder="Tìm xã/phường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm xã/phường" />
      </div>
      {tab === 'rank' ? (
        <div className="panel">
          <h3>Xếp hạng KPI xã/phường</h3>
          <Columns data={shown.map(w => ({ label: w.ward, value: w.kpi, tip: `KPI ${w.kpi} · ${w.schools} trường · ${w.deployed} trường triển khai STEM` }))} max={100} />
          <DataTable cols={['Hạng', 'Xã/phường', 'KPI', 'Số trường']} rows={shown.map((w, i) => [i + 1, w.ward, w.kpi, w.schools])} />
        </div>
      ) : (
        <div className="wrap">
          <table>
            <thead><tr><th>#</th><th>Xã/phường</th><th>Số trường</th><th>Triển khai STEM</th><th>GV đã hoàn thành tập huấn</th><th>Học sinh</th><th>KPI</th><th>Xếp loại</th></tr></thead>
            <tbody>
              {shown.map((w, i) => (
                <tr key={w.ward}>
                  <td>{i + 1}</td><td><b>{w.ward}</b><br /><small>{w.list.map(s => short(s.name)).join(', ')}</small></td><td>{w.schools}</td>
                  <td>{w.deployed}/{w.schools} <small>({pct(w.deployed, w.schools)}%)</small></td>
                  <td>{pct(w.trained, w.teachers)}% <small>({w.trained}/{w.teachers})</small></td>
                  <td>{nf(w.students)}</td><td><b>{w.kpi}</b></td><td><GradePill kpi={w.kpi} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sub" style={{ marginTop: 10 }}><small>KPI trường (0–100) = độ phủ CT1–CT5 (25) + phòng STEM hoạt động (15) + tiết STEM/lớp (20) + tỉ lệ GV hoàn thành tập huấn (20) + giáo án GV tự soạn (10) + đồng bộ K12 (10). KPI xã/phường = trung bình các trường. Đạt ≥ 70, Cần cải thiện 45–69, Chưa đạt &lt; 45.</small></p>
    </>
  )
}

// ================= Danh sách trường =================
export function DeptSchools() {
  const { schools, loading, err } = useDeptStats()
  const [level, setLevel] = useState(''); const [ward, setWard] = useState(''); const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  if (loading || err) return <Loading err={err} />
  const wards = [...new Set(schools.map(s => s.ward ?? ''))].sort((a, b) => a.localeCompare(b, 'vi'))
  const shown = schools.filter(s => (!level || s.level === level) && (!ward || s.ward === ward) && (!q || s.name.toLowerCase().includes(q.toLowerCase())))
  const cur = schools.find(s => s.school_id === open)
  return (
    <>
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm trường" />
        <select value={level} onChange={e => setLevel(e.target.value)} aria-label="Cấp học"><option value="">Tất cả cấp học</option>{Object.entries(LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select value={ward} onChange={e => setWard(e.target.value)} aria-label="Xã/phường"><option value="">Tất cả xã/phường</option>{wards.map(w => <option key={w}>{w}</option>)}</select>
        <small>{shown.length} trường</small>
        <span style={{ flex: 1 }} />
        <SchoolLocationImport onMessage={(m, e) => setMsg([m, !!e])} />
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {cur && (
        <div className="panel">
          <div className="bar"><h3>{cur.name}</h3><button onClick={() => setOpen(null)}>Đóng</button></div>
          <Tiles items={[
            { label: 'KPI', value: cur.kpi, sub: grade(cur.kpi).label },
            { label: 'Giáo viên', value: cur.teachers, sub: `${cur.stem_teachers} dạy STEM · ${cur.training_done} hoàn thành tập huấn` },
            { label: 'Học sinh', value: nf(cur.students), sub: `${cur.stem_students} học STEM · ${cur.classes} lớp` },
            { label: 'Phòng STEM', value: `${cur.rooms_active}/${cur.rooms}`, sub: `${cur.room_periods} tiết/tuần dùng phòng` },
            { label: 'Thiết bị', value: cur.units, sub: `${cur.units_broken} hỏng · ${cur.units_maintenance} bảo trì` },
            { label: 'Giáo án tự soạn', value: cur.lesson_plans, sub: `${cur.products} dự án đã giao` },
          ]} />
        </div>
      )}
      <div className="wrap">
        <table>
          <thead><tr><th>Trường</th><th>Xã/phường</th><th>Cấp</th><th>Chương trình đang dạy</th><th>GV</th><th>HS</th><th>Phòng STEM</th><th>KPI</th><th></th></tr></thead>
          <tbody>
            {shown.map(s => (
              <tr key={s.school_id}>
                <td><b>{s.name}</b><br /><small>{s.code}{!s.activated && ' · chưa kích hoạt'}</small></td>
                <td>{s.ward}</td><td>{LEVEL[s.level ?? ''] ?? '—'}</td><td><ProgBadges list={s.programs} /></td>
                <td>{s.teachers}</td><td>{nf(s.students)}</td><td>{s.rooms_active}/{s.rooms}</td>
                <td className="nowrap"><b>{s.kpi}</b> <GradePill kpi={s.kpi} /></td>
                <td><button onClick={() => setOpen(s.school_id)}>Chi tiết</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ================= Chương trình CT1–CT5 =================
export function DeptPrograms() {
  const { schools, loading, err } = useDeptStats()
  const [ct, setCt] = useState('')
  if (loading || err) return <Loading err={err} />
  const has = (s: SchoolStat, p: string) => s.programs.includes(p)
  const shown = schools.filter(s => !ct || has(s, ct)).sort((a, b) => b.programs.length - a.programs.length || b.kpi - a.kpi)
  return (
    <>
      <Tiles items={[
        { label: 'Trường đang triển khai', value: schools.filter(s => s.programs.length).length, sub: 'có ít nhất 1 chương trình' },
        { label: 'Trường đủ 5 chương trình', value: schools.filter(s => s.programs.length === 5).length, sub: 'CT1–CT5' },
        { label: 'Giáo viên STEM', value: nf(sum(schools.map(s => s.stem_teachers))), sub: 'được phân công theo chương trình' },
        { label: 'Học sinh tham gia', value: nf(sum(schools.map(s => s.stem_students))), sub: 'thuộc lớp có chương trình STEM' },
      ]} />
      <div className="ctgrid">
        {PROGRAMS.map(p => {
          const list = schools.filter(s => has(s, p))
          return (
            <button key={p} className={'ctcard' + (ct === p ? ' on' : '')} onClick={() => setCt(ct === p ? '' : p)} aria-pressed={ct === p}>
              <span className="progchip" style={{ background: PROGRAM_COLOR[p], color: '#fff' }}>{p}</span>
              <b>{PROGRAM_NAME[p]}</b>
              <small>{list.length} trường · {nf(sum(list.map(s => s.stem_teachers)))} GV · {nf(sum(list.map(s => s.stem_students)))} HS</small>
              <div className="track"><div className="fill" style={{ width: pct(list.length, schools.length) + '%', background: PROGRAM_COLOR[p] }} /></div>
              <small>{pct(list.length, schools.length)}% số trường</small>
            </button>
          )
        })}
      </div>
      <div className="bar"><h3>Danh sách trường theo chương trình{ct && ` · ${ct}`}</h3>{ct && <button onClick={() => setCt('')}>Bỏ lọc</button>}</div>
      <div className="wrap">
        <table>
          <thead><tr><th>Trường</th><th>Xã/phường</th><th>Cấp</th><th>Chương trình đang dạy</th><th>GV STEM</th><th>HS tham gia</th><th>Lớp STEM</th></tr></thead>
          <tbody>{shown.map(s => (
            <tr key={s.school_id}><td><b>{short(s.name)}</b></td><td>{s.ward}</td><td>{LEVEL[s.level ?? '']}</td><td><ProgBadges list={s.programs} /></td>
              <td>{s.stem_teachers}</td><td>{nf(s.stem_students)}</td><td>{s.stem_classes}/{s.classes}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </>
  )
}

// ================= Theo dõi môn học STEM =================
export function DeptSubjects() {
  const { subjects, schools, loading, err } = useDeptStats()
  const [pick, setPick] = useState<string | null>(null)
  if (loading || err) return <Loading err={err} />
  const stemSubjects = subjects.filter(s => s.stem > 0)
  const rows = stemSubjects.map(s => ({ ...s, rate: pct(s.stem, s.total) }))
  const cur = rows.find(r => r.subject === pick)
  return (
    <>
      <Tiles items={[
        { label: 'Số môn có tiết STEM', value: stemSubjects.length, sub: `trên ${subjects.length} môn có trong TKB` },
        { label: 'Tỉ lệ tiết STEM', value: pct(sum(stemSubjects.map(s => s.stem)), sum(stemSubjects.map(s => s.total))) + '%', sub: 'trong các môn có STEM' },
        { label: 'Lượt lớp học STEM', value: nf(sum(stemSubjects.map(s => s.classes))), sub: 'lớp × môn / tuần' },
        { label: 'Học sinh tham gia', value: nf(sum(schools.map(s => s.stem_students))), sub: 'thuộc lớp có chương trình STEM' },
      ]} />
      <div className="panel">
        <h3>Tỉ lệ tiết STEM theo môn (% số tiết của môn)</h3>
        <Columns data={rows.map(r => ({ label: r.subject, value: r.rate, tip: `${r.rate}% · ${r.stem}/${r.total} tiết · ${r.schools} trường` }))} unit="%" />
        <DataTable cols={['Môn', 'Tiết STEM', 'Tổng tiết', 'Tỉ lệ', 'Lớp', 'Trường']} rows={rows.map(r => [r.subject, r.stem, r.total, r.rate + '%', r.classes, r.schools])} />
      </div>
      <div className="twocol">
        <div className="panel">
          <h3>Thống kê theo môn</h3>
          {rows.map(r => (
            <button key={r.subject} className={'todo' + (pick === r.subject ? ' sel' : '')} onClick={() => setPick(r.subject)}>
              <span><b>{r.subject}</b><br /><small>{r.classes} lớp · {nf(r.students)} HS · {r.schools} trường</small></span><b>{r.rate}%</b>
            </button>
          ))}
        </div>
        <div className="panel">
          {cur ? (<>
            <h3>{cur.subject}</h3>
            <Tiles items={[{ label: 'Tiết STEM/tuần', value: cur.stem }, { label: 'Tổng tiết/tuần', value: cur.total }, { label: 'Trường dạy STEM môn này', value: cur.schools }]} />
            <p className="sub">Tỉ lệ STEM {cur.rate}% · {cur.classes} lớp học tiết STEM của môn mỗi tuần.</p>
          </>) : <p className="sub">Chọn một môn để xem chi tiết.</p>}
        </div>
      </div>
    </>
  )
}

// ================= Giám sát tập huấn GV =================
export function DeptTrainingMonitor() {
  const { schools, loading, err } = useDeptStats()
  const [f, setF] = useState<'all' | 'good' | 'warn' | 'bad'>('all')
  if (loading || err) return <Loading err={err} />
  const rate = (s: SchoolStat) => pct(s.training_done, s.teachers)
  const tone = (s: SchoolStat) => (rate(s) >= 70 ? 'good' : rate(s) >= 40 ? 'warn' : 'bad')
  const shown = schools.filter(s => s.level !== 'mamnon' || s.trained).filter(s => f === 'all' || tone(s) === f).sort((a, b) => rate(b) - rate(a))
  const label = { good: ['✓', 'Đạt'], warn: ['!', 'Cần theo dõi'], bad: ['✕', 'Chưa đạt'] } as const
  return (
    <>
      <Tiles items={[
        { label: 'Trường có GV tham gia', value: schools.filter(s => s.trained).length, sub: `/${schools.length} trường` },
        { label: 'GV đã ghi danh', value: nf(sum(schools.map(s => s.trained))), sub: `${nf(sum(schools.map(s => s.training_done)))} đã hoàn thành` },
        { label: 'Trường đạt (≥ 70%)', value: schools.filter(s => tone(s) === 'good').length, tone: 'good' },
        { label: 'Cần theo dõi (40–69%)', value: schools.filter(s => tone(s) === 'warn').length, tone: 'warn' },
        { label: 'Chưa đạt (< 40%)', value: schools.filter(s => tone(s) === 'bad').length, tone: 'bad' },
      ]} />
      <Tabs value={f} onChange={setF} items={[['all', 'Tất cả'], ['good', 'Đạt'], ['warn', 'Cần theo dõi'], ['bad', 'Chưa đạt']]} />
      <div className="wrap">
        <table>
          <thead><tr><th>Trường</th><th>GV</th><th>Ghi danh</th><th>Hoàn thành</th><th>Tỉ lệ hoàn thành / tổng GV</th><th>Chuyên cần</th><th>Đánh giá</th></tr></thead>
          <tbody>{shown.map(s => {
            const t = tone(s)
            return (
              <tr key={s.school_id}><td><b>{short(s.name)}</b><br /><small>{s.ward}</small></td><td>{s.teachers}</td><td>{s.trained}</td><td>{s.training_done}</td>
                <td style={{ minWidth: 180 }}><div className="track"><div className="fill" style={{ width: rate(s) + '%', background: 'var(--accent)' }} /></div><small>{rate(s)}%</small></td>
                <td>{s.attendance_rate != null ? `${s.attendance_rate}%` : '—'}</td>
                <td><span className={'gpill ' + t}><i aria-hidden="true">{label[t][0]}</i>{label[t][1]}</span></td></tr>
            )
          })}</tbody>
        </table>
      </div>
    </>
  )
}

// ================= Hiệu quả phòng STEM =================
type Actual = { org_id: string; stem_taught: number; stem_room_periods: number; stem_planned: number; taught: number }
type RoomUse = { org_id: string; booked: number; slots: number; conflicts: number; room_id: string }
const WEEKS = 4

// Hiệu quả phòng STEM: kế hoạch theo TKB (018) + thực dạy theo buổi dạy đã điểm danh (027) + lịch giữ phòng (029), 4 tuần gần nhất
export function DeptRoomEffect({ go }: { go?: (p: string) => void }) {
  const { schools, loading, err } = useDeptStats()
  const [level, setLevel] = useState('')
  const [actual, setActual] = useState<Record<string, Actual>>({})
  const [rooms, setRooms] = useState<Record<string, { booked: number; slots: number; conflicts: number }>>({})
  const [live, setLive] = useState<'ok' | 'none' | 'loading'>('loading')
  useEffect(() => {
    const d = new Date(), iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    const to = iso(d); d.setDate(d.getDate() - WEEKS * 7 + 1); const from = iso(d)
    Promise.all([supabase.rpc('attendance_summary', { p_from: from, p_to: to }), supabase.rpc('room_overview', { p_from: from, p_to: to })]).then(([a, r]) => {
      setActual(Object.fromEntries(((a.data as Actual[]) ?? []).map(x => [x.org_id, x])))
      const m: Record<string, { booked: number; slots: number; conflicts: number }> = {}
      ;((r.data as RoomUse[]) ?? []).forEach(x => { const c = m[x.org_id] ?? { booked: 0, slots: 0, conflicts: 0 }; c.booked += x.booked; c.slots += x.slots; c.conflicts += x.conflicts; m[x.org_id] = c })
      setRooms(m); setLive(a.error && r.error ? 'none' : 'ok')
    })
  }, [])
  if (loading || err) return <Loading err={err} />
  const withRooms = schools.filter(s => s.rooms_active > 0 && (!level || s.level === level))
  const freq = (s: SchoolStat) => Math.round((s.room_periods / Math.max(1, s.rooms_active)) * 10) / 10
  const real = (s: SchoolStat) => Math.round(((actual[s.school_id]?.stem_room_periods ?? 0) / WEEKS / Math.max(1, s.rooms_active)) * 10) / 10
  const fill = (s: SchoolStat) => { const r = rooms[s.school_id]; return r && r.slots ? Math.round((r.booked / r.slots) * 1000) / 10 : null }
  const integ = (s: SchoolStat) => new Set(s.programs).size
  const stemDone = (s: SchoolStat) => { const a = actual[s.school_id]; return a && a.stem_planned ? pct(a.stem_taught, a.stem_planned) : null }
  const totalReal = sum(withRooms.map(s => actual[s.school_id]?.stem_room_periods ?? 0))
  const idle = withRooms.filter(s => (actual[s.school_id]?.stem_room_periods ?? 0) === 0)
  return (
    <>
      <Tiles items={[
        { label: 'Theo TKB', value: `${(avg(withRooms.map(freq))).toFixed(1)} tiết/tuần`, sub: 'kế hoạch, trung bình mỗi phòng' },
        { label: 'Thực dạy tại phòng', value: live === 'ok' ? `${(avg(withRooms.map(real))).toFixed(1)} tiết/tuần` : '—', sub: `đã điểm danh, ${WEEKS} tuần gần nhất` },
        { label: 'Tiết STEM tại phòng', value: live === 'ok' ? nf(totalReal) : '—', sub: `${WEEKS} tuần · ${withRooms.length} trường có phòng` },
        { label: 'Trường chưa dùng phòng', value: live === 'ok' ? idle.length : '—', sub: `có phòng nhưng 0 tiết thực dạy`, tone: idle.length ? 'warn' : '' },
        { label: 'Giáo án GV tự soạn', value: nf(sum(withRooms.map(s => s.lesson_plans))), sub: 'đã xuất bản' },
        { label: 'Dự án STEM / lớp', value: (sum(withRooms.map(s => s.products)) / Math.max(1, sum(withRooms.map(s => s.classes)))).toFixed(1), sub: 'đã giao trong năm' },
      ]} />
      <div className="panel">
        <div className="bar"><h3>Thực dạy tại phòng STEM theo trường (tiết/tuần/phòng, {WEEKS} tuần gần nhất)</h3>
          <span className="tools">
            <select value={level} onChange={e => setLevel(e.target.value)} aria-label="Cấp học"><option value="">Tất cả cấp học</option>{Object.entries(LEVEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            {go && <button onClick={() => go('Phòng STEM & lịch phòng')}>Lịch từng phòng</button>}
            {go && <button onClick={() => go('Thiết bị & kho')}>Thiết bị</button>}
          </span></div>
        <Columns data={[...withRooms].sort((a, b) => real(b) - real(a)).map(s => ({ label: short(s.name).replace(/^(THCS|THPT|TH)\s+/, ''), value: real(s),
          tip: `${short(s.name)}: thực dạy ${real(s)} · theo TKB ${freq(s)} tiết/tuần/phòng · ${s.rooms_active} phòng` }))} fmt={v => v.toFixed(1)} />
        {live === 'none' && <p className="sub">Chưa có số liệu buổi dạy (cần migration 027 và 029) — đang hiện theo TKB.</p>}
      </div>
      <div className="wrap">
        <table>
          <thead><tr><th>Trường</th><th>HS</th><th>Phòng hoạt động</th><th>Theo TKB<br /><small>tiết/tuần/phòng</small></th><th>Thực dạy<br /><small>tiết/tuần/phòng</small></th>
            <th>Lấp đầy lịch phòng</th><th>Tiết STEM đã dạy / kế hoạch</th><th>Chương trình tích hợp</th><th>Giáo án GV tự soạn</th><th>Thiết bị hỏng</th></tr></thead>
          <tbody>{withRooms.map(s => {
            const gap = live === 'ok' && freq(s) > 0 && real(s) < freq(s) * 0.5
            const r = rooms[s.school_id]
            return (
              <tr key={s.school_id}><td><b>{short(s.name)}</b><br /><small>{LEVEL[s.level ?? '']} · {s.ward}</small></td><td>{nf(s.students)}</td><td>{s.rooms_active}/{s.rooms}</td>
                <td>{freq(s)}</td>
                <td>{live === 'ok' ? <>{real(s)}{gap && <span className="pill maintenance" style={{ marginLeft: 6 }} title="Thực dạy dưới một nửa kế hoạch">▼ thấp</span>}</> : '—'}</td>
                <td>{fill(s) == null ? '—' : `${fill(s)}%`}{r?.conflicts ? <><br /><small className="due bad">{r.conflicts} chỗ trùng</small></> : null}</td>
                <td>{actual[s.school_id] ? `${actual[s.school_id].stem_taught}/${actual[s.school_id].stem_planned}` : '—'}{stemDone(s) != null && <small> ({stemDone(s)}%)</small>}</td>
                <td>{integ(s)}</td><td>{s.lesson_plans}</td>
                <td>{s.units_broken}/{s.units} <small>({pct(s.units_broken, s.units)}%)</small></td></tr>
            )
          })}</tbody>
        </table>
      </div>
    </>
  )
}
