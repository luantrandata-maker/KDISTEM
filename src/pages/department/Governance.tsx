import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useDeptStats, pct, avg, sum, nf, LEVEL, type SchoolStat } from './data'
import { Tiles } from './charts'
import { downloadXlsx } from '../../lib/sheet'

// Điều hành của Sở (migration 040): giao chỉ tiêu theo năm học, cảnh báo trường cần chú ý.

type Metric = 'stem_coverage' | 'teacher_trained' | 'stem_students' | 'rooms_active' | 'attendance' | 'level3'
type Target = { id: string; org_id: string; school_year: string; metric: Metric; level: string | null; target: number; due_on: string | null; note: string | null }
type Action = { id: string; school_id: string; rule: string; status: string; note: string | null; created_at: string }

// Giá trị chỉ số cho một nhóm trường (%), và cho từng trường (để biết trường nào dưới chỉ tiêu)
export const METRICS: Record<Metric, { label: string; hint: string; of: (s: SchoolStat[]) => number | null; one: (s: SchoolStat) => number | null }> = {
  stem_coverage: { label: 'Trường triển khai STEM', hint: '% trường có ít nhất một chương trình CT1–CT5',
    of: s => s.length ? pct(s.filter(x => x.programs.length > 0).length, s.length) : null, one: s => (s.programs.length > 0 ? 100 : 0) },
  teacher_trained: { label: 'Giáo viên đã tập huấn', hint: '% GV hoàn thành tập huấn STEM',
    of: s => sum(s.map(x => x.teachers)) ? pct(sum(s.map(x => x.training_done)), sum(s.map(x => x.teachers))) : null, one: s => (s.teachers ? pct(s.training_done, s.teachers) : null) },
  stem_students: { label: 'Học sinh học STEM', hint: '% HS thuộc lớp có chương trình STEM',
    of: s => sum(s.map(x => x.students)) ? pct(sum(s.map(x => x.stem_students)), sum(s.map(x => x.students))) : null, one: s => (s.students ? pct(s.stem_students, s.students) : null) },
  rooms_active: { label: 'Phòng STEM hoạt động', hint: '% phòng STEM đang hoạt động',
    of: s => sum(s.map(x => x.rooms)) ? pct(sum(s.map(x => x.rooms_active)), sum(s.map(x => x.rooms))) : null, one: s => (s.rooms ? pct(s.rooms_active, s.rooms) : null) },
  attendance: { label: 'Chuyên cần', hint: 'Tỉ lệ có mặt bình quân các tiết đã điểm danh',
    of: s => { const v = s.map(x => x.attendance_rate).filter((x): x is number => x != null); return v.length ? Math.round(avg(v)) : null }, one: s => (s.attendance_rate == null ? null : Math.round(s.attendance_rate)) },
  level3: { label: 'Trường đạt KPI (≥ 70)', hint: '% trường có điểm KPI STEM từ 70',
    of: s => s.length ? pct(s.filter(x => x.kpi >= 70).length, s.length) : null, one: s => (s.kpi >= 70 ? 100 : 0) },
}
export const schoolYear = (d = new Date()) => { const y = d.getFullYear(); return d.getMonth() >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}` }
const applies = (t: Target, s: SchoolStat) => !t.level || s.level === t.level
const day = (d: string) => new Date(d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('vi-VN')

// ================= Cảnh báo & trường cần chú ý =================
type Rule = { key: string; label: string; high?: boolean }
const RULES: Rule[] = [
  { key: 'inactive', label: 'Chưa kích hoạt', high: true },
  { key: 'idle', label: 'Không hoạt động 14 ngày', high: true },
  { key: 'no_stem', label: 'Chưa triển khai STEM', high: true },
  { key: 'no_year', label: 'Chưa khai báo năm học' },
  { key: 'low_training', label: 'GV tập huấn < 50%' },
  { key: 'room_idle', label: 'Có phòng STEM mà không dùng' },
  { key: 'low_attendance', label: 'Chuyên cần < 70%' },
  { key: 'below_target', label: 'Dưới chỉ tiêu Sở giao' },
]
type Issue = { key: string; text: string; high: boolean }
function issuesOf(s: SchoolStat, targets: Target[]): Issue[] {
  const out: Issue[] = []
  const add = (key: string, text: string) => out.push({ key, text, high: !!RULES.find(r => r.key === key)?.high })
  if (!s.activated) add('inactive', 'Chưa kích hoạt trên hệ thống')
  const days = s.last_activity ? (Date.now() - new Date(s.last_activity).getTime()) / 86400000 : Infinity
  if (s.activated && days > 14) add('idle', s.last_activity ? `Không hoạt động ${Math.floor(days)} ngày` : 'Chưa có hoạt động nào')
  if (s.programs.length === 0) add('no_stem', 'Chưa triển khai chương trình STEM')
  if (!s.has_year) add('no_year', 'Chưa khai báo năm học')
  if (s.teachers > 0 && pct(s.training_done, s.teachers) < 50) add('low_training', `GV tập huấn ${pct(s.training_done, s.teachers)}%`)
  if (s.rooms > 0 && s.room_periods === 0) add('room_idle', `${s.rooms} phòng STEM chưa có tiết dùng phòng`)
  if (s.attendance_rate != null && s.attendance_rate < 70) add('low_attendance', `Chuyên cần ${Math.round(s.attendance_rate)}%`)
  const dup: Record<string, string> = { teacher_trained: 'low_training', attendance: 'low_attendance', stem_coverage: 'no_stem' }
  const drop = new Set<string>()
  for (const t of targets.filter(t => applies(t, s))) {
    const v = METRICS[t.metric].one(s)
    if (v == null || v >= t.target) continue
    if (dup[t.metric] === 'no_stem') continue                     // "Chưa triển khai STEM" đã nói đủ
    add('below_target', `${METRICS[t.metric].label} ${v}% (chỉ tiêu ${t.target}%)`)
    if (dup[t.metric]) drop.add(dup[t.metric])                    // không nhắc lại cùng một chỉ số hai lần
  }
  return out.filter(i => !drop.has(i.key))
}

function useTargets(year: string) {
  const [targets, setTargets] = useState<Target[]>([])
  const [err, setErr] = useState('')
  async function load() {
    const { data, error } = await supabase.from('dept_targets').select('id, org_id, school_year, metric, level, target, due_on, note').eq('school_year', year).order('metric')
    if (error) setErr(/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 040 trên Supabase.' : error.message)
    setTargets((data as Target[]) ?? [])
  }
  useEffect(() => { load() }, [year])
  return { targets, err, reload: load }
}

export function DeptAlerts() {
  const { schools, loading, err } = useDeptStats()
  const { targets } = useTargets(schoolYear())
  const [actions, setActions] = useState<Action[]>([])
  const [rule, setRule] = useState('')
  const [onlyHigh, setOnlyHigh] = useState(false)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function loadActions() {
    const { data } = await supabase.from('dept_alert_actions').select('id, school_id, rule, status, note, created_at').order('created_at', { ascending: false }).limit(1000)
    setActions((data as Action[]) ?? [])
  }
  useEffect(() => { loadActions() }, [])
  const rows = useMemo(() => schools.map(s => ({ s, issues: issuesOf(s, targets) })).filter(r => r.issues.length), [schools, targets])
  if (loading || err) return <p className={err ? 'msg' : 'sub'}>{err || 'Đang tải…'}</p>
  const last = (id: string) => actions.find(a => a.school_id === id)
  const shown = rows.filter(r => (!rule || r.issues.some(i => i.key === rule)) && (!onlyHigh || r.issues.some(i => i.high))
    && (!q || r.s.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(b.issues.some(i => i.high)) - Number(a.issues.some(i => i.high)) || b.issues.length - a.issues.length)
  const week = actions.filter(a => Date.now() - new Date(a.created_at).getTime() < 7 * 86400000)

  async function remind(s: SchoolStat, issues: Issue[]) {
    const text = prompt(`Nội dung nhắc gửi quản trị ${s.name}:`, 'Đề nghị nhà trường kiểm tra và khắc phục: ' + issues.map(i => i.text).join('; ') + '.')
    if (!text) return
    const { data, error } = await supabase.rpc('dept_notify_school', { p_school: s.school_id, p_title: 'Sở nhắc: cần chú ý hoạt động STEM', p_body: text, p_rule: issues.map(i => i.key).join(',') })
    if (error) return setMsg([error.message, true])
    setMsg([data ? `Đã gửi nhắc tới ${data} quản trị của ${s.name}.` : `${s.name} chưa có tài khoản Hiệu trưởng/QTV — chưa ai nhận được nhắc.`, !data]); loadActions()
  }
  async function ack(s: SchoolStat, issues: Issue[]) {
    const note = prompt(`Ghi nhận đã xử lý / đang theo dõi ${s.name} (ghi chú):`, '')
    if (note === null) return
    const { data: me } = await supabase.rpc('my_org_id')
    const { error } = await supabase.from('dept_alert_actions').insert({ org_id: me, school_id: s.school_id, rule: issues.map(i => i.key).join(','), status: 'acknowledged', note: note || null })
    if (error) return setMsg([error.message, true])
    setMsg([`Đã ghi nhận ${s.name}.`, false]); loadActions()
  }
  function excel() {
    downloadXlsx('truong-can-chu-y', [
      { key: 'a', label: 'Mã trường' }, { key: 'b', label: 'Tên trường', width: 34 }, { key: 'c', label: 'Xã/phường', width: 20 },
      { key: 'd', label: 'Vấn đề', width: 60 }, { key: 'e', label: 'Xử lý gần nhất', width: 30 },
    ], shown.map(r => [r.s.code, r.s.name, r.s.ward, r.issues.map(i => i.text).join('; '), (() => { const a = last(r.s.school_id); return a ? `${day(a.created_at)} ${a.status === 'notified' ? 'đã nhắc' : 'đã ghi nhận'}${a.note ? ': ' + a.note : ''}` : '' })()]), 'Cần chú ý')
  }

  return (
    <>
      <Tiles items={[
        { label: 'Trường cần chú ý', value: rows.length, sub: `/${schools.length} trường`, tone: rows.length ? 'warn' : 'good' },
        { label: 'Mức cao', value: rows.filter(r => r.issues.some(i => i.high)).length, sub: 'chưa kích hoạt, không hoạt động, chưa có STEM', tone: 'bad' },
        { label: 'Dưới chỉ tiêu', value: rows.filter(r => r.issues.some(i => i.key === 'below_target')).length, sub: targets.length ? `${targets.length} chỉ tiêu năm ${schoolYear()}` : 'chưa giao chỉ tiêu' },
        { label: 'Đã xử lý 7 ngày', value: new Set(week.map(a => a.school_id)).size, sub: `${week.filter(a => a.status === 'notified').length} lần nhắc` },
      ]} />
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm trường" />
        <select value={rule} onChange={e => setRule(e.target.value)} aria-label="Loại cảnh báo"><option value="">Mọi loại cảnh báo</option>
          {RULES.map(r => <option key={r.key} value={r.key}>{r.label} ({rows.filter(x => x.issues.some(i => i.key === r.key)).length})</option>)}</select>
        <label className="field inline"><input type="checkbox" checked={onlyHigh} onChange={e => setOnlyHigh(e.target.checked)} /> Chỉ mức cao</label>
        <span style={{ flex: 1 }} /><button onClick={excel} disabled={!shown.length}>Xuất Excel</button>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      <div className="wrap"><table>
        <thead><tr><th>Trường</th><th>Vấn đề</th><th>Xử lý gần nhất</th><th></th></tr></thead>
        <tbody>
          {shown.map(({ s, issues }) => { const a = last(s.school_id); return (
            <tr key={s.school_id}>
              <td><b>{s.name}</b><br /><small>{s.ward ?? ''}{s.level ? ' · ' + (LEVEL[s.level] ?? s.level) : ''}</small></td>
              <td>{issues.map((i, k) => <span key={k} className={'plbadge ' + (i.high ? 'bad' : 'mute')} style={{ margin: '0 4px 4px 0', display: 'inline-block' }}>{i.high ? '! ' : ''}{i.text}</span>)}</td>
              <td>{a ? <small>{day(a.created_at)} · {a.status === 'notified' ? 'đã nhắc' : a.status === 'resolved' ? 'đã xong' : 'đã ghi nhận'}{a.note ? <><br />{a.note}</> : null}</small> : <small className="sub">—</small>}</td>
              <td className="nowrap"><button onClick={() => remind(s, issues)}>Nhắc trường</button> <button onClick={() => ack(s, issues)}>Ghi nhận</button></td>
            </tr>) })}
          {shown.length === 0 && <tr><td colSpan={4}>{rows.length ? 'Không có trường phù hợp bộ lọc.' : 'Không có trường nào cần chú ý.'}</td></tr>}
        </tbody>
      </table></div>
      <p className="sub covhint">Quy tắc: chưa kích hoạt; không có hoạt động 14 ngày; chưa có chương trình CT1–CT5; chưa khai báo năm học; GV tập huấn &lt; 50%; có phòng STEM nhưng không có tiết dùng phòng; chuyên cần &lt; 70%; dưới chỉ tiêu Sở giao năm {schoolYear()}. "Nhắc trường" gửi thông báo trong ứng dụng tới Hiệu trưởng và QTV của trường.</p>
    </>
  )
}

// ================= Giao chỉ tiêu =================
export function DeptTargets() {
  const { schools, loading, err } = useDeptStats()
  const [year, setYear] = useState(schoolYear())
  const { targets, err: terr, reload } = useTargets(year)
  const [form, setForm] = useState<Partial<Target> | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [me, setMe] = useState<string | null>(null)
  useEffect(() => { supabase.rpc('my_org_id').then(({ data }) => setMe(data as string | null)) }, [])
  if (loading || err) return <p className={err ? 'msg' : 'sub'}>{err || 'Đang tải…'}</p>
  const y0 = Number(schoolYear().slice(0, 4))
  const years = [`${y0 - 1}-${y0}`, `${y0}-${y0 + 1}`, `${y0 + 1}-${y0 + 2}`]
  const mine = (t: Target) => t.org_id === me

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form?.metric || form.target == null) return
    const row = { org_id: me, school_year: year, metric: form.metric, level: form.level || null, target: Number(form.target), due_on: form.due_on || null, note: form.note || null }
    const { error } = form.id ? await supabase.from('dept_targets').update(row).eq('id', form.id) : await supabase.from('dept_targets').insert(row)
    if (error) return setMsg([/duplicate|unique/i.test(error.message) ? 'Chỉ tiêu này (cùng cấp học) đã có — hãy sửa chỉ tiêu cũ.' : /row-level/i.test(error.message) ? 'Chỉ cán bộ Sở/Phòng giao được chỉ tiêu.' : error.message, true])
    setForm(null); setMsg(['Đã lưu chỉ tiêu.', false]); reload()
  }
  async function remove(t: Target) {
    if (!confirm(`Xoá chỉ tiêu ${METRICS[t.metric].label}?`)) return
    const { error } = await supabase.from('dept_targets').delete().eq('id', t.id)
    if (error) return setMsg([error.message, true]); reload()
  }
  const rows = targets.map(t => {
    const scope = schools.filter(s => applies(t, s))
    const cur = METRICS[t.metric].of(scope)
    const below = scope.filter(s => { const v = METRICS[t.metric].one(s); return v != null && v < t.target })
    return { t, scope, cur, below }
  })
  const reached = rows.filter(r => r.cur != null && r.cur >= r.t.target).length

  return (
    <>
      <Tiles items={[
        { label: 'Chỉ tiêu năm ' + year, value: targets.length },
        { label: 'Đã đạt', value: `${reached}/${targets.length}`, tone: targets.length && reached === targets.length ? 'good' : 'warn' },
        { label: 'Trường trực thuộc', value: nf(schools.length) },
        { label: 'Trường dưới ít nhất 1 chỉ tiêu', value: new Set(rows.flatMap(r => r.below.map(s => s.school_id))).size, tone: 'warn' },
      ]} />
      <div className="bar">
        <div className="segmented" style={{ margin: 0 }}>{years.map(y => <button key={y} className={y === year ? 'on' : ''} onClick={() => setYear(y)}>{y}</button>)}</div>
        <button className="primary" onClick={() => setForm({ metric: 'stem_coverage', target: 80 })}>+ Giao chỉ tiêu</button>
      </div>
      {(msg || terr) && <p className={msg?.[1] || terr ? 'msg' : 'sub'}><b>{terr || msg![0]}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={save}>
          <label className="field"><span>Chỉ số</span><select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value as Metric })}>
            {(Object.keys(METRICS) as Metric[]).map(k => <option key={k} value={k}>{METRICS[k].label}</option>)}</select></label>
          <label className="field"><span>Áp dụng cho</span><select value={form.level ?? ''} onChange={e => setForm({ ...form, level: e.target.value || null })}>
            <option value="">Mọi cấp học</option>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Chỉ tiêu (%)</span><input type="number" min={0} max={100} step={1} required value={form.target ?? ''} onChange={e => setForm({ ...form, target: Number(e.target.value) })} /></label>
          <label className="field"><span>Hạn hoàn thành</span><input type="date" value={form.due_on ?? ''} onChange={e => setForm({ ...form, due_on: e.target.value })} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú / căn cứ (vd: Kế hoạch số …/KH-SGDĐT)</span><input value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}>{form.metric && METRICS[form.metric].hint}</p>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Chỉ số</th><th>Áp dụng</th><th>Chỉ tiêu</th><th>Hiện tại</th><th style={{ width: '22%' }}>Tiến độ</th><th>Trường chưa đạt</th><th>Hạn</th><th></th></tr></thead>
        <tbody>
          {rows.map(({ t, scope, cur, below }) => (
            <Fragment key={t.id}>
              <tr>
                <td><b>{METRICS[t.metric].label}</b>{t.note && <><br /><small>{t.note}</small></>}</td>
                <td>{t.level ? LEVEL[t.level] : 'Mọi cấp'} <small>({scope.length} trường)</small></td>
                <td>{t.target}%</td>
                <td><b>{cur == null ? '—' : cur + '%'}</b></td>
                <td><span className="covtrack" style={{ display: 'block' }}><i style={{ width: Math.min(100, cur ?? 0) + '%', background: cur != null && cur >= t.target ? '#1f8a4c' : '#d08a00' }} /></span>
                  <small>{cur == null ? 'chưa có số liệu' : cur >= t.target ? 'Đã đạt' : `còn thiếu ${Math.round(t.target - cur)} điểm %`}</small></td>
                <td>{below.length ? <button className="linkbtn" onClick={() => setOpen(open === t.id ? null : t.id)}>{below.length} trường</button> : '—'}</td>
                <td>{t.due_on ? day(t.due_on) : '—'}</td>
                <td className="nowrap">{mine(t) ? <><button onClick={() => setForm(t)}>Sửa</button> <button onClick={() => remove(t)}>Xoá</button></> : <small className="sub">cấp trên giao</small>}</td>
              </tr>
              {open === t.id && <tr><td colSpan={8}>
                <small>Trường chưa đạt: {below.sort((a, b) => (METRICS[t.metric].one(a) ?? 0) - (METRICS[t.metric].one(b) ?? 0))
                  .map(s => `${s.name} (${METRICS[t.metric].one(s)}%)`).join(' · ')}</small></td></tr>}
            </Fragment>
          ))}
          {rows.length === 0 && <tr><td colSpan={8}>Chưa giao chỉ tiêu cho năm học {year}. Bấm "Giao chỉ tiêu" — trường trực thuộc sẽ thấy chỉ tiêu và tiến độ của mình.</td></tr>}
        </tbody>
      </table></div>
    </>
  )
}
