import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStemTracks, trackLabel } from '../lib/stemTracks'
import { gradeName } from '../lib/eduLevels'
import { loadPackages, type PackageItem, type ProgramPackage } from '../lib/programFrame'
import { PROGRAM_COLOR } from './teacher/common'

// PPCT chuẩn của KDI (162): với mỗi gói × loại chương trình × khối, KDI đặt số tuần dạy và xếp từng chủ đề vào
// "tuần dạy thứ n". Tuần dạy chưa gắn ngày tháng: khi trường tạo PPCT từ gói, tuần dạy thứ n là tuần học thứ n trong lịch
// của trường (tuần nghỉ cả tuần đã bỏ qua), nên mỗi trường nghỉ / thi khác nhau vẫn dùng chung một PPCT chuẩn.

type Row = { slot: number; module_name: string; topic_id: string; topic_seq: number; topic_title: string; periods: number; track_code: string; grade: number }
type StdRow = { slot: number; topic_id: string; week_from: number; week_to: number }
const key = (slot: number, topic: string) => `${slot}|${topic}`
const errOf = (m: string) => (/ppct_std|package_topic_list|schema cache/i.test(m) && /exist|cache|find/i.test(m) ? 'Hãy chạy migration 162 trên Supabase.'
  : /row-level|42501|Chỉ quản trị/i.test(m) ? 'Chỉ quản trị nền tảng KDI soạn được PPCT chuẩn.'
  : /vượt số tuần/i.test(m) ? m.replace(/^.*?(Tuần dạy)/, '$1') : m)

export function PpctStandard() {
  const { tracks } = useStemTracks()
  const [admin, setAdmin] = useState(false)
  const [packages, setPackages] = useState<ProgramPackage[]>([])
  const [items, setItems] = useState<PackageItem[]>([])
  const [pkg, setPkg] = useState('')
  const [track, setTrack] = useState('')
  const [grade, setGrade] = useState(0)
  const [rows, setRows] = useState<Row[]>([])
  const [weeks, setWeeks] = useState<number | null>(null)   // null = chưa có PPCT chuẩn
  const [wInput, setWInput] = useState(35)
  const [plan, setPlan] = useState<Map<string, [number, number]>>(new Map())
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())   // gói|loại|khối đã có PPCT chuẩn

  useEffect(() => {
    supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data))
    loadPackages().then(p => {
      const act = p.packages.filter(x => x.active)
      setPackages(act); setItems(p.items)
      if (p.error) setMsg([p.error, true])
      if (act[0]) setPkg(a => a || act[0].id)
    })
  }, [])
  async function loadDone() {
    const { data } = await supabase.from('ppct_std').select('package_id, track_code, grade')
    setDone(new Set(((data ?? []) as { package_id: string; track_code: string; grade: number }[]).map(d => `${d.package_id}|${d.track_code}|${d.grade}`)))
  }
  useEffect(() => { loadDone() }, [])

  const inPkg = items.filter(i => i.package_id === pkg)
  const trackList = tracks.filter(t => inPkg.some(i => i.track_code === t.code))
  const gradeList = [...new Set(inPkg.filter(i => i.track_code === track).map(i => i.grade))].sort((a, b) => a - b)
  useEffect(() => { if (trackList.length && !trackList.some(t => t.code === track)) setTrack(trackList[0].code) }, [pkg, items, tracks])
  useEffect(() => { if (gradeList.length && !gradeList.includes(grade)) setGrade(gradeList[0]) }, [pkg, track, items])

  async function load() {
    if (!pkg || !track || !grade) return
    setMsg(null)
    const [l, s, t] = await Promise.all([
      supabase.rpc('package_topic_list', { p_package: pkg }),
      supabase.from('ppct_std').select('weeks').eq('package_id', pkg).eq('track_code', track).eq('grade', grade).maybeSingle(),
      supabase.from('ppct_std_topics').select('slot, topic_id, week_from, week_to').eq('package_id', pkg).eq('track_code', track).eq('grade', grade),
    ])
    const err = l.error ?? s.error ?? t.error
    if (err) setMsg([errOf(err.message), true])
    setRows(((l.data ?? []) as Row[]).filter(r => r.track_code === track && r.grade === grade))
    const w = (s.data as { weeks: number } | null)?.weeks ?? null
    setWeeks(w); setWInput(w ?? 35)
    setPlan(new Map(((t.data ?? []) as StdRow[]).map(r => [key(r.slot, r.topic_id), [r.week_from, r.week_to]])))
    setDirty(false)
  }
  useEffect(() => { load() }, [pkg, track, grade])

  const total = rows.reduce((a, r) => a + r.periods, 0)
  const W = weeks ?? wInput
  // Chưa có PPCT chuẩn: xem trước cách tự chia đều (giống ppct_std_fill)
  const shown = useMemo(() => {
    let c = 0
    return rows.map(r => {
      const before = c; c += r.periods
      const auto: [number, number] = [Math.min(W, Math.floor(before * W / Math.max(total, 1)) + 1), 0]
      auto[1] = Math.max(auto[0], Math.min(W, Math.ceil(c * W / Math.max(total, 1))))
      return { r, w: plan.get(key(r.slot, r.topic_id)) ?? (weeks == null ? auto : null) }
    })
  }, [rows, plan, W, total, weeks])

  async function fill() {
    const w = Math.round(wInput)
    if (!(w >= 1 && w <= 52)) return setMsg(['Số tuần dạy từ 1 đến 52.', true])
    if (weeks != null && plan.size && !confirm(`Chia lại ${rows.length} chủ đề đều trên ${w} tuần dạy? Các tuần đã chỉnh tay sẽ bị thay.`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('ppct_std_fill', { p_package: pkg, p_track: track, p_grade: grade, p_weeks: w })
    setBusy(false)
    if (error) return setMsg([errOf(error.message), true])
    await load(); loadDone()
    setMsg([`Đã chia ${data} chủ đề trên ${w} tuần dạy. Chỉnh tuần từng chủ đề nếu cần rồi bấm Lưu.`, false])
  }
  function setWeek(r: Row, i: 0 | 1, v: number) {
    const k = key(r.slot, r.topic_id)
    const cur = plan.get(k) ?? [1, 1]
    const nx: [number, number] = [...cur] as [number, number]
    nx[i] = v
    if (i === 0 && nx[1] < v) nx[1] = v
    setPlan(new Map(plan).set(k, nx)); setDirty(true)
  }
  async function save() {
    if (weeks == null) return
    const bad = shown.find(x => x.w && (x.w[0] < 1 || x.w[1] < x.w[0] || x.w[1] > weeks))
    if (bad) return setMsg([`Chủ đề "${bad.r.topic_title}": tuần dạy phải từ 1 đến ${weeks}, tuần kết thúc không trước tuần bắt đầu.`, true])
    setBusy(true)
    const up = shown.filter(x => x.w).map(x => ({ package_id: pkg, track_code: track, grade, slot: x.r.slot, topic_id: x.r.topic_id, week_from: x.w![0], week_to: x.w![1] }))
    const { error } = await supabase.from('ppct_std_topics').upsert(up)
    setBusy(false)
    if (error) return setMsg([errOf(error.message), true])
    setDirty(false); setMsg(['Đã lưu PPCT chuẩn. Trường tạo PPCT từ gói sẽ lấy tuần theo bản này.', false])
  }
  async function remove() {
    if (!confirm('Xoá PPCT chuẩn của khối này? PPCT các trường đã tạo giữ nguyên; trường tạo mới sẽ tự chia đều 35 tuần.')) return
    const { error } = await supabase.from('ppct_std').delete().eq('package_id', pkg).eq('track_code', track).eq('grade', grade)
    if (error) return setMsg([errOf(error.message), true])
    await load(); loadDone(); setMsg(['Đã xoá PPCT chuẩn của khối này.', false])
  }

  const color = PROGRAM_COLOR[track] ?? '#2563eb'
  const slots = [...new Set(rows.map(r => r.slot))]
  const multiSlot = slots.length > 1 || tracks.find(t => t.code === track)?.use_modules !== false
  const isDone = (g: number) => done.has(`${pkg}|${track}|${g}`)

  return <>
    <div className="bar" style={{ flexWrap: 'wrap', gap: 8 }}>
      <select value={pkg} onChange={e => setPkg(e.target.value)} aria-label="Gói STEM">
        {packages.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select>
      <div className="seg" role="group" aria-label="Loại chương trình">
        {trackList.map(t => <button key={t.code} type="button" className={track === t.code ? 'on' : ''} onClick={() => setTrack(t.code)}>{trackLabel(t.code)}</button>)}</div>
      <div className="seg" role="group" aria-label="Khối">
        {gradeList.map(g => <button key={g} type="button" className={grade === g ? 'on' : ''} onClick={() => setGrade(g)} title={isDone(g) ? 'Đã có PPCT chuẩn' : 'Chưa có PPCT chuẩn'}>
          K{g}{isDone(g) ? ' ✓' : ''}</button>)}</div>
    </div>
    <div className="bar" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <b>{trackLabel(track)} · {grade ? gradeName(grade) : ''}</b>
      <small className="sub">{rows.length} chủ đề · {total} tiết · {weeks == null ? 'chưa có PPCT chuẩn (trường tạo PPCT sẽ tự chia đều 35 tuần)' : `${weeks} tuần dạy · khoảng ${(total / weeks).toFixed(1).replace('.', ',')} tiết/tuần`}</small>
      {admin && rows.length > 0 && <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <label>Số tuần dạy <input type="number" min={1} max={52} value={wInput} onChange={e => setWInput(Number(e.target.value))} style={{ width: 64 }} /></label>
        <button type="button" onClick={fill} disabled={busy}>{weeks == null ? 'Tự chia, tạo PPCT chuẩn' : 'Chia lại'}</button>
        {weeks != null && <button type="button" className="primary" onClick={save} disabled={busy || !dirty}>Lưu</button>}
        {weeks != null && <button type="button" className="danger" onClick={remove} disabled={busy}>Xoá</button>}
      </span>}
    </div>
    {msg && <p className={msg[1] ? 'warnline' : 'msg'} role="status">{msg[0]}</p>}
    {rows.length === 0 ? <p className="sub">Khối này chưa có chủ đề trong gói. Thêm chủ đề ở Khung chương trình.</p>
      : <div className="tablewrap"><table className="table ttdense">
        <thead><tr>{multiSlot && <th>Học phần</th>}<th>#</th><th>Chủ đề</th><th>Số tiết</th><th>Tuần dạy</th>
          <th style={{ minWidth: 260 }}>Tuần dạy 1 → {W}{weeks == null ? ' (xem trước tự chia)' : ''}</th></tr></thead>
        <tbody>{shown.map(({ r, w }, i) => <tr key={key(r.slot, r.topic_id)}>
          {multiSlot && <td><small>HP{r.slot}: {r.module_name}</small></td>}
          <td>{i + 1}</td><td>{r.topic_title}</td><td>{r.periods}</td>
          <td style={{ whiteSpace: 'nowrap' }}>{admin && weeks != null
            ? <><input type="number" min={1} max={weeks} value={w?.[0] ?? ''} onChange={e => setWeek(r, 0, Number(e.target.value))} style={{ width: 52 }} aria-label="Từ tuần dạy" />
              {' – '}<input type="number" min={1} max={weeks} value={w?.[1] ?? ''} onChange={e => setWeek(r, 1, Number(e.target.value))} style={{ width: 52 }} aria-label="Đến tuần dạy" /></>
            : w ? (w[0] === w[1] ? `Tuần ${w[0]}` : `Tuần ${w[0]}–${w[1]}`) : '—'}</td>
          <td>{w && <div style={{ position: 'relative', height: 10, background: 'color-mix(in srgb, currentColor 8%, transparent)', borderRadius: 5 }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, borderRadius: 5, background: color, opacity: weeks == null ? 0.45 : 1,
              left: `${(w[0] - 1) / W * 100}%`, width: `${Math.max(1, w[1] - w[0] + 1) / W * 100}%` }} /></div>}</td>
        </tr>)}</tbody></table></div>}
    <p className="sub" style={{ marginTop: 8 }}>Tuần dạy thứ n là tuần học thứ n trong lịch của từng trường: tuần trường nghỉ cả tuần đã được bỏ qua, tuần có ngày nghỉ sẽ được cảnh báo trong PPCT của trường.</p>
  </>
}
