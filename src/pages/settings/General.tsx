// Thiết lập chung (video 26/10) — Quản trị nền tảng KDI và Quản trị trường.
//  Năm học & ngày nghỉ (095):
//   • Năm học và quy tắc: quy tắc vận hành (KDI đặt mặc định, trường ghi đè), khung giờ tiết học.
//   • Lịch năm học: ngày khai giảng / kết thúc HK1 / bắt đầu HK2 / kết thúc năm học, tuần học và ngày thật.
//     KDI soạn "Chuẩn chung"; trường dùng chuẩn chung hoặc đặt ngày riêng.
//   • Ngày nghỉ: KDI khai báo ngày nghỉ chuẩn chung; trường bỏ ngày chuẩn chung không áp dụng và thêm ngày nghỉ riêng.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import Periods from '../Periods'
import { WEEKDAY, addD, dayOf, offIn, vnd, vnShort } from '../dist/calendar'

type Props = { orgId: string | null; platform?: boolean }
type Sub = 'rules' | 'cal' | 'hol'
type YRow = { id: string; org_id: string; name: string; term: string; starts_on: string | null; ends_on: string | null; status: string; source: string | null }
type Hol = { id: string; org_id: string; org_name: string; name: string; starts_on: string; ends_on: string; note: string | null; kind: string; status: string; source: string | null; std: boolean; skipped: boolean }
type CalRow = { cal: number; week: number | null; term: number; starts_on: string; ends_on: string; off_days: number; holiday: string | null }
type YForm = { name: string; s1: string; e1: string; s2: string; e2: string; status: string; source: string }

export const KIND: [string, string][] = [['state', 'Lễ nhà nước'], ['tet', 'Tết'], ['break', 'Nghỉ giữa kỳ'], ['school', 'Của trường'], ['other', 'Khác']]
const kindName = (k: string) => KIND.find(x => x[0] === k)?.[1] ?? k
const isHK2 = (t: string) => /(ii|2)\s*$/i.test(t)
const days = (h: { starts_on: string; ends_on: string }) => Math.round((new Date(h.ends_on).getTime() - new Date(h.starts_on).getTime()) / 86400000) + 1
const errText = (m: string) => /schema cache|does not exist|function .* not found/i.test(m) ? 'Hãy chạy migration 095 trên Supabase.'
  : /row-level|42501|permission|quyền/i.test(m) ? 'Bạn không có quyền thay đổi mục này.' : m
function curYear() { const t = new Date(), y = t.getMonth() >= 7 ? t.getFullYear() : t.getFullYear() - 1; return `${y}-${y + 1}` }
const nextName = (n: string) => { const a = Number(n.slice(0, 4)) + 1; return `${a}-${a + 1}` }

export function GeneralSettings({ orgId, platform }: Props) {
  const [sub, setSub] = useState<Sub>('cal')
  const [std, setStd] = useState<string | null>(null)
  const [years, setYears] = useState<string[]>([])
  const [year, setYear] = useState('')
  const [err, setErr] = useState('')
  const [reload, setReload] = useState(0)
  const scope = platform ? std : orgId

  useEffect(() => { supabase.rpc('platform_org_id').then(({ data, error }) => { if (error) setErr(errText(error.message)); setStd((data as string) ?? null) }) }, [])
  useEffect(() => {
    if (!scope) return
    supabase.rpc('calendar_years', { p_org: scope }).then(({ data }) => {
      const ns = ((data as { name: string }[]) ?? []).map(x => x.name)
      if (!ns.includes(curYear())) ns.push(curYear())
      ns.sort(); setYears(ns); setYear(y => ns.includes(y) ? y : curYear())
    })
  }, [scope, reload])

  if (!orgId) return <p className="sub">Chọn đơn vị trước.</p>
  return <>
    <div className="panel" style={{ marginBottom: 12 }}>
      <b>Năm học & ngày nghỉ</b>
      <p className="sub" style={{ margin: '4px 0 0' }}>{platform
        ? 'Lịch “Chuẩn chung” áp cho toàn hệ thống: mọi trường dùng ngày năm học và ngày nghỉ ở đây, trừ khi trường đặt lịch riêng. Bản phân phối chương trình cảnh báo tuần có ngày nghỉ theo lịch này.'
        : 'Trường dùng lịch Chuẩn chung của KDI. Có thể đặt ngày năm học riêng, bỏ ngày nghỉ chuẩn chung không áp dụng và thêm ngày nghỉ riêng của trường.'}</p>
    </div>
    {err && <p className="msg">{err}</p>}
    <div className="bar">
      <Tabs<Sub> value={sub} onChange={setSub} items={[['rules', 'Năm học và quy tắc'], ['cal', 'Lịch năm học'], ['hol', 'Ngày nghỉ']]} />
      {sub !== 'rules' && <div className="segmented" role="group" aria-label="Năm học">
        {years.map(y => <button type="button" key={y} className={y === year ? 'on' : ''} aria-pressed={y === year} onClick={() => setYear(y)}>{y}</button>)}
        {platform && <button type="button" title="Thêm năm học" onClick={() => { const n = nextName(years[years.length - 1] ?? curYear()); setYears(ys => ys.includes(n) ? ys : [...ys, n]); setYear(n) }}>+</button>}
      </div>}
    </div>
    {sub === 'rules' && <RulesTab orgId={orgId} platform={!!platform} std={std} />}
    {sub === 'cal' && scope && year && <CalTab key={scope + year} orgId={orgId} platform={!!platform} std={std} scope={scope} year={year} onSaved={() => setReload(r => r + 1)} />}
    {sub === 'hol' && scope && year && <HolTab key={scope + year} orgId={orgId} platform={!!platform} scope={scope} year={year} />}
  </>
}

// ===== Năm học và quy tắc =====
type Rules = { max_stem_periods_per_day?: number; plan_remind_days?: number; attendance_edit_days?: number }
const RULES: [keyof Rules, string, string, number][] = [
  ['max_stem_periods_per_day', 'Số tiết STEM tối đa mỗi nhà giáo mỗi ngày', 'tiết', 3],
  ['plan_remind_days', 'Nhắc nộp kế hoạch trước hạn', 'ngày', 7],
  ['attendance_edit_days', 'Cho phép giáo viên sửa điểm danh trong', 'ngày', 7],
]
type Slot = { name: string; starts_at: string; ends_at: string }
const mins = (a: string, b: string) => (Number(b.slice(0, 2)) * 60 + Number(b.slice(3, 5))) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3, 5)))

function RulesTab({ orgId, platform, std }: { orgId: string; platform: boolean; std: string | null }) {
  const [base, setBase] = useState<Rules>({})
  const [mine, setMine] = useState<Rules>({})
  const [slots, setSlots] = useState<Slot[]>([])
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [pk, setPk] = useState(0)

  useEffect(() => {
    if (!std) return
    supabase.from('org_settings').select('org_id, key, value').in('org_id', [...new Set([std, orgId])]).then(({ data, error }) => {
      if (error) return setErr(errText(error.message))
      const rows = (data as { org_id: string; key: string; value: unknown }[]) ?? []
      const get = (o: string, k: string) => rows.find(r => r.org_id === o && r.key === k)?.value
      setBase((get(std, 'rules') as Rules) ?? {})
      setMine(platform ? (get(std, 'rules') as Rules) ?? {} : (get(orgId, 'rules') as Rules) ?? {})
      setSlots(((get(std, 'periods') as Slot[]) ?? []).filter(s => s && s.starts_at))
    })
  }, [std, orgId, platform])

  async function put(key: 'rules' | 'periods', value: unknown, note: string) {
    const { error } = await supabase.from('org_settings').upsert({ org_id: platform ? std : orgId, key, value, updated_at: new Date().toISOString() })
    if (error) { setErr(errText(error.message)); setMsg(''); return }
    setErr(''); setMsg(note)
  }
  function saveSlots() {
    const bad = slots.find(s => !s.name.trim() || mins(s.starts_at, s.ends_at) <= 0)
    if (bad) return setErr(`${bad.name || 'Một tiết'}: giờ kết thúc phải sau giờ bắt đầu.`)
    put('periods', [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at)), 'Đã lưu khung giờ tiết học chuẩn chung.')
  }
  async function pullSlots() {
    if (!slots.length) return setErr('KDI chưa đặt khung giờ chuẩn chung.')
    const { data } = await supabase.from('period_configs').select('name').eq('org_id', orgId)
    const have = new Set(((data as { name: string }[]) ?? []).map(x => x.name.trim().toLowerCase()))
    const add = slots.filter(s => !have.has(s.name.trim().toLowerCase()))
    if (!add.length) return setMsg('Trường đã có đủ các tiết theo khung chuẩn chung.')
    const { error } = await supabase.from('period_configs').insert(add.map(s => ({ org_id: orgId, name: s.name, starts_at: s.starts_at, ends_at: s.ends_at, session: s.starts_at < '12:00' ? 'morning' : 'afternoon' })))
    if (error) return setErr(errText(error.message))
    setErr(''); setMsg(`Đã thêm ${add.length} tiết theo khung chuẩn chung.`); setPk(k => k + 1)
  }

  return <>
    {err && <p className="msg">{err}</p>}{msg && <p className="sub"><b>{msg}</b></p>}
    <div className="panel">
      <h3 style={{ marginTop: 0 }}>Quy tắc vận hành</h3>
      {!platform && <p className="sub">Để trống là dùng mặc định của KDI.</p>}
      <div className="setrules">{RULES.map(([k, label, unit, def]) => <label key={k} className="field"><span>{label}</span>
        <span className="inl"><input type="number" min={0} max={60} value={mine[k] ?? ''} placeholder={String(base[k] ?? def)} style={{ width: 90 }}
          onChange={e => setMine(m => { const n = { ...m }; if (e.target.value === '') delete n[k]; else n[k] = Math.max(0, Math.min(60, Number(e.target.value))); return n })} /> {unit}</span></label>)}</div>
      <small className="sub">“Sửa điểm danh” áp ngay vào màn điểm danh của giáo viên (quá hạn thì nhờ quản trị trường). Hai quy tắc còn lại được lưu để dùng cho cảnh báo xếp lịch và nhắc nộp kế hoạch.</small>
      <div className="formactions" style={{ textAlign: 'right' }}><button type="button" className="primary" onClick={() => put('rules', mine, 'Đã lưu quy tắc vận hành.')}>Lưu quy tắc</button></div>
    </div>
    <div className="panel" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Khung giờ tiết học</h3>
      {platform ? <>
        <p className="sub">Khung giờ chuẩn chung. Trường bấm “Lấy theo khung chuẩn chung” ở Thiết lập chung của trường để tạo tiết theo khung này.</p>
        <div className="wrap"><table className="libtable">
          <thead><tr><th style={{ width: 36 }} /><th>Tiết</th><th>Bắt đầu</th><th>Kết thúc</th><th>Thời lượng</th></tr></thead>
          <tbody>{slots.map((s, k) => <tr key={k}>
            <td><input type="checkbox" aria-label={'Chọn ' + s.name} checked={ticked.has(k)} onChange={e => setTicked(t => { const n = new Set(t); if (e.target.checked) n.add(k); else n.delete(k); return n })} /></td>
            <td><input value={s.name} maxLength={40} aria-label="Tên tiết" onChange={e => setSlots(xs => xs.map((x, j) => j === k ? { ...x, name: e.target.value } : x))} /></td>
            <td><input type="time" value={s.starts_at} aria-label="Bắt đầu" onChange={e => setSlots(xs => xs.map((x, j) => j === k ? { ...x, starts_at: e.target.value } : x))} /></td>
            <td><input type="time" value={s.ends_at} aria-label="Kết thúc" onChange={e => setSlots(xs => xs.map((x, j) => j === k ? { ...x, ends_at: e.target.value } : x))} /></td>
            <td>{mins(s.starts_at, s.ends_at) > 0 ? mins(s.starts_at, s.ends_at) + ' phút' : '—'}</td></tr>)}
            {!slots.length && <tr><td colSpan={5} className="sub">Chưa có tiết nào.</td></tr>}</tbody></table></div>
        <div className="formactions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => { const last = slots[slots.length - 1]; const st = last ? addMin(last.ends_at, 5) : '07:00'
            setSlots(xs => [...xs, { name: `Tiết ${xs.length + 1}`, starts_at: st, ends_at: addMin(st, 45) }]) }}>+ Thêm tiết</button>
          <button type="button" className="danger" disabled={!ticked.size} onClick={() => { setSlots(xs => xs.filter((_, j) => !ticked.has(j))); setTicked(new Set()) }}>Xóa {ticked.size || ''}</button>
          <button type="button" className="primary" onClick={saveSlots}>Lưu khung giờ</button>
        </div>
      </> : <>
        <div className="bar"><p className="sub" style={{ margin: 0 }}>Tiết học của trường (dùng cho thời khóa biểu, buổi dạy).{slots.length ? ` Khung chuẩn chung có ${slots.length} tiết.` : ''}</p>
          {slots.length > 0 && <button type="button" onClick={pullSlots}>Lấy theo khung chuẩn chung</button>}</div>
        <Periods key={pk} />
      </>}
    </div>
  </>
}
const addMin = (t: string, m: number) => { const x = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + m; return `${String(Math.floor(x / 60) % 24).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }

// ===== Lịch năm học =====
function useCalendar(scope: string, year: string, bump = 0) {
  const [rows, setRows] = useState<CalRow[]>([])
  const [hols, setHols] = useState<Hol[]>([])
  useEffect(() => {
    supabase.rpc('curriculum_calendar', { p_org: scope, p_year: year }).then(async ({ data }) => {
      const rs = (data as CalRow[]) ?? []; setRows(rs)
      const from = rs[0]?.starts_on ?? `${year.slice(0, 4)}-08-01`, to = rs[rs.length - 1]?.ends_on ?? `${year.slice(5)}-07-31`
      const { data: h } = await supabase.rpc('effective_holidays', { p_org: scope, p_from: from, p_to: to })
      setHols((h as Hol[]) ?? [])
    })
  }, [scope, year, bump])
  return { rows, hols }
}

function CalTab({ orgId, platform, std, scope, year, onSaved }: { orgId: string; platform: boolean; std: string | null; scope: string; year: string; onSaved: () => void }) {
  const [own, setOwn] = useState<YRow[]>([])
  const [stdRows, setStdRows] = useState<YRow[]>([])
  const [f, setF] = useState<YForm | null>(null)
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const [bump, setBump] = useState(0)
  const [schools, setSchools] = useState<{ org_id: string; name: string; own_year: boolean; starts_on: string | null; ends_on: string | null; own_holidays: number; skipped: number }[]>([])
  const { rows, hols } = useCalendar(scope, year, bump)

  useEffect(() => {
    (async () => {
      const ids = [...new Set([std, scope].filter(Boolean))] as string[]
      const { data } = await supabase.from('academic_years').select('id, org_id, name, term, starts_on, ends_on, status, source').in('org_id', ids).eq('name', year)
      const ys = (data as YRow[]) ?? []
      const s = ys.filter(y => y.org_id === std), o = platform ? s : ys.filter(y => y.org_id === scope)
      setStdRows(s); setOwn(o)
      const src = o.length ? o : s
      const h1 = src.find(y => !isHK2(y.term)), h2 = src.find(y => isHK2(y.term))
      setF({ name: year, s1: h1?.starts_on ?? '', e1: h1?.ends_on ?? '', s2: h2?.starts_on ?? '', e2: h2?.ends_on ?? '', status: (s[0]?.status ?? 'official'), source: s[0]?.source ?? '' })
      if (platform) supabase.rpc('school_calendars', { p_year: year }).then(({ data: sc }) => setSchools((sc as typeof schools) ?? []))
    })()
  }, [scope, year, bump])

  async function save() {
    if (!f) return
    if (!f.s1 || !f.e1) return setErr('Cần ngày khai giảng và ngày kết thúc học kỳ 1.')
    if (f.e1 <= f.s1 || (f.s2 && f.s2 <= f.e1) || (f.e2 && f.s2 && f.e2 <= f.s2)) return setErr('Thứ tự ngày chưa đúng: khai giảng < kết thúc HK1 < bắt đầu HK2 < kết thúc năm học.')
    const terms: [string, string, string][] = [['HK I', f.s1, f.e1], ...(f.s2 ? [['HK II', f.s2, f.e2 || ''] as [string, string, string]] : [])]
    for (const [t, a, b] of terms) {
      const cur = own.find(y => (t === 'HK II') === isHK2(y.term))
      const body = { starts_on: a || null, ends_on: b || null, ...(platform ? { status: f.status, source: f.source.trim() || null } : {}) }
      const { error } = cur ? await supabase.from('academic_years').update(body).eq('id', cur.id)
        : await supabase.from('academic_years').insert({ org_id: scope, name: year, term: t, is_current: false, ...body })
      if (error) return setErr(errText(error.message))
    }
    setErr(''); setMsg(platform ? `Đã lưu năm học ${year} (chuẩn chung).` : `Đã lưu ngày năm học ${year} riêng của trường.`); setBump(b => b + 1); onSaved()
  }

  const holOf = (r: CalRow) => hols.filter(h => !h.skipped && h.starts_on <= r.ends_on && h.ends_on >= r.starts_on)
  const usingStd = !platform && !own.length
  return <>
    {err && <p className="msg">{err}</p>}{msg && <p className="sub"><b>{msg}</b></p>}
    {f && <div className="panel">
      <div className="bar" style={{ marginBottom: 6 }}>
        <span><b>Năm học {year}</b>{' '}{platform ? <span className={'gpill ' + (f.status === 'official' ? 'good' : 'warn')}>{f.status === 'official' ? 'Chính thức' : 'Dự kiến'}</span>
          : usingStd ? <span className="gpill good">Theo chuẩn chung</span> : <span className="gpill warn">Lịch riêng của trường</span>}
          {stdRows[0]?.source && <small className="sub"> · Nguồn: {stdRows[0].source}</small>}</span>
        <span className="sub">Phạm vi: <b>{platform ? 'Chuẩn chung (toàn hệ thống)' : 'Trường đang làm việc'}</b></span>
      </div>
      {usingStd && <p className="sub" style={{ margin: '0 0 8px' }}>{stdRows.length ? 'Trường đang dùng ngày của chuẩn chung (ô bên dưới). Sửa ngày rồi Lưu để đặt lịch riêng cho trường.' : 'KDI chưa khai báo năm học này. Nhập ngày rồi Lưu để đặt lịch riêng cho trường.'}</p>}
      <div className="formgrid">
        <label className="field"><span>Ngày khai giảng</span><input type="date" value={f.s1} onChange={e => setF({ ...f, s1: e.target.value })} /></label>
        <label className="field"><span>Kết thúc học kỳ 1</span><input type="date" value={f.e1} onChange={e => setF({ ...f, e1: e.target.value })} /></label>
        <label className="field"><span>Bắt đầu học kỳ 2</span><input type="date" value={f.s2} onChange={e => setF({ ...f, s2: e.target.value })} /></label>
        <label className="field"><span>Kết thúc năm học</span><input type="date" value={f.e2} onChange={e => setF({ ...f, e2: e.target.value })} /></label>
        {platform && <label className="field"><span>Trạng thái</span><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="official">Chính thức</option><option value="expected">Dự kiến</option></select></label>}
        {platform && <label className="field"><span>Nguồn</span><input value={f.source} maxLength={300} placeholder="vd QĐ 2308/QĐ-BGDĐT" onChange={e => setF({ ...f, source: e.target.value })} /></label>}
      </div>
      <div className="formactions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {!platform && own.length > 0 && <small className="sub" style={{ alignSelf: 'center' }}>Học kỳ của trường cũng hiện ở “Năm học & học kỳ”.</small>}
        <button type="button" className="primary" onClick={save}>Lưu năm học</button></div>
    </div>}
    <h4 className="distsec">Tuần học và ngày thật ({platform ? 'chuẩn chung' : usingStd ? 'theo chuẩn chung' : 'lịch của trường'})</h4>
    {!rows.length ? <p className="sub">Chưa có lịch: cần ngày khai giảng của năm học {year}.</p>
      : <div className="wrap"><table className="libtable setweeks">
        <thead><tr><th style={{ width: 70 }}>Tuần</th><th>Ngày</th><th style={{ width: 90 }}>Học kỳ</th><th>Ngày nghỉ trong tuần</th></tr></thead>
        <tbody>{rows.map(r => { const hs = holOf(r)
          return <tr key={r.cal} className={hs.length ? 'hol' : undefined}>
            <td>{r.week ?? <small className="sub">nghỉ</small>}</td>
            <td>{vnShort(r.starts_on)} – {vnd(r.ends_on)}</td><td>HK{r.term}</td>
            <td>{hs.map(h => <div key={h.id}>⚠ {h.name} <small className="sub">{h.starts_on === h.ends_on ? WEEKDAY[dayOf(h.starts_on)] + ' ' + vnShort(h.starts_on) : vnShort(h.starts_on) + '–' + vnShort(h.ends_on)}
              {' · '}nghỉ {offIn(h, r.starts_on, addD(r.starts_on, 6))}/5 ngày học{h.status === 'expected' ? ' · Dự kiến' : ''}</small></div>)}
              {r.week == null && <small className="sub">Cả tuần nghỉ, không tính tuần học</small>}</td></tr>
        })}</tbody></table></div>}
    {platform && <>
      <h4 className="distsec">Lịch riêng của từng trường</h4>
      {!schools.length ? <p className="sub">Chưa trường nào đặt lịch riêng cho năm học {year}: mọi trường dùng chuẩn chung.</p>
        : <div className="wrap"><table className="libtable"><thead><tr><th>Trường</th><th>Ngày năm học</th><th>Ngày nghỉ riêng</th><th>Bỏ ngày chuẩn chung</th></tr></thead>
          <tbody>{schools.map(x => <tr key={x.org_id}><td>{x.name}</td>
            <td>{x.own_year ? `${x.starts_on ? vnd(x.starts_on) : '—'} – ${x.ends_on ? vnd(x.ends_on) : '—'}` : <small className="sub">Theo chuẩn chung</small>}</td>
            <td>{x.own_holidays}</td><td>{x.skipped}</td></tr>)}</tbody></table></div>}
    </>}
  </>
}

// ===== Ngày nghỉ =====
type HForm = { id?: string; name: string; starts_on: string; ends_on: string; note: string; kind: string; status: string; source: string }
function HolTab({ orgId, platform, scope, year }: { orgId: string; platform: boolean; scope: string; year: string }) {
  const [bump, setBump] = useState(0)
  const { rows, hols } = useCalendar(scope, year, bump)
  const [f, setF] = useState<HForm | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('')
  const from = `${year.slice(0, 4)}-08-01`, to = `${year.slice(5)}-07-31`
  const list = useMemo(() => hols.filter(h => h.ends_on >= from && h.starts_on <= to), [hols, from, to])
  const mineId = platform ? scope : orgId
  const editableH = (h: Hol) => h.org_id === mineId
  const weekOf = (h: Hol) => { const ws = rows.filter(r => r.starts_on <= h.ends_on && r.ends_on >= h.starts_on).map(r => r.week ?? ('nghỉ' as const))
    return ws.length ? ws.map(w => w === 'nghỉ' ? 'tuần nghỉ' : 'Tuần ' + w).filter((x, i, a) => a.indexOf(x) === i).join(', ') : '—' }
  const done = (m: string) => { setErr(''); setMsg(m); setBump(b => b + 1) }

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!f) return
    if (!f.name.trim() || !f.starts_on) return setErr('Cần tên và ngày bắt đầu.')
    const end = f.ends_on || f.starts_on
    if (end < f.starts_on) return setErr('Ngày kết thúc phải từ ngày bắt đầu trở đi.')
    const body = { name: f.name.trim(), starts_on: f.starts_on, ends_on: end, note: f.note.trim() || null, kind: f.kind, status: f.status, source: f.source.trim() || null }
    const { error } = f.id ? await supabase.from('school_holidays').update(body).eq('id', f.id) : await supabase.from('school_holidays').insert({ ...body, org_id: mineId })
    if (error) return setErr(errText(error.message))
    setF(null); done(`Đã lưu ngày nghỉ “${body.name}”.`)
  }
  async function removeTicked() {
    const ids = [...ticked].filter(id => list.some(h => h.id === id && editableH(h)))
    if (!ids.length || !confirm(`Xóa ${ids.length} ngày nghỉ?`)) return
    const { error } = await supabase.from('school_holidays').delete().in('id', ids)
    if (error) return setErr(errText(error.message))
    setTicked(new Set()); done(`Đã xóa ${ids.length} ngày nghỉ.`)
  }
  async function toggleSkip(h: Hol) {
    const { error } = h.skipped ? await supabase.from('holiday_skips').delete().eq('org_id', orgId).eq('holiday_id', h.id)
      : await supabase.from('holiday_skips').insert({ org_id: orgId, holiday_id: h.id })
    if (error) return setErr(errText(error.message))
    done(h.skipped ? `Trường áp dụng lại “${h.name}”.` : `Trường không nghỉ “${h.name}” (vẫn dạy bình thường).`)
  }
  async function presets() {
    const a = Number(year.slice(0, 4)), b = a + 1
    const ps = [{ name: 'Quốc khánh', starts_on: `${a}-09-01`, ends_on: `${a}-09-02` }, { name: 'Tết Dương lịch', starts_on: `${b}-01-01`, ends_on: `${b}-01-01` },
      { name: 'Ngày Chiến thắng & Quốc tế Lao động', starts_on: `${b}-04-30`, ends_on: `${b}-05-01` }]
      .filter(p => !list.some(h => h.org_id === mineId && h.starts_on === p.starts_on))
    if (!ps.length) return setMsg('Đã có đủ các ngày lễ cố định.')
    const { error } = await supabase.from('school_holidays').insert(ps.map(p => ({ ...p, org_id: mineId, kind: 'state', status: 'official', source: 'Bộ luật Lao động 2019' })))
    if (error) return setErr(errText(error.message))
    done(`Đã thêm ${ps.length} ngày lễ cố định. Tết Nguyên đán, Giỗ Tổ theo âm lịch: thêm theo thông báo hằng năm.`)
  }

  const groups: [string, Hol[]][] = platform ? [['Chuẩn chung', list.filter(h => h.std)]]
    : [['Chuẩn chung (KDI) — bỏ tick “Áp dụng” nếu trường không nghỉ', list.filter(h => h.std)], ['Cấp trên (Sở/Phòng)', list.filter(h => !h.std && h.org_id !== orgId)], ['Của trường', list.filter(h => h.org_id === orgId)]]
  return <>
    {err && <p className="msg">{err}</p>}{msg && <p className="sub"><b>{msg}</b></p>}
    <div className="bar">
      <p className="sub" style={{ margin: 0, flex: 1 }}>Phạm vi: <b>{platform ? 'Chuẩn chung' : 'Trường đang làm việc'}</b> · Năm học {year} · {list.filter(h => !h.skipped).length} ngày nghỉ áp dụng
        {platform ? '. Trường có thể bỏ ngày chuẩn chung hoặc thêm ngày riêng.' : ''}</p>
      <span className="tools" style={{ display: 'flex', gap: 8 }}>
        {ticked.size > 0 && <>
          {ticked.size === 1 && <button type="button" onClick={() => { const h = list.find(x => x.id === [...ticked][0])!; setF({ id: h.id, name: h.name, starts_on: h.starts_on, ends_on: h.ends_on, note: h.note ?? '', kind: h.kind, status: h.status, source: h.source ?? '' }) }}>Sửa</button>}
          <button type="button" className="danger" onClick={removeTicked}>Xóa {ticked.size}</button></>}
        <button type="button" onClick={presets}>+ Ngày lễ cố định</button>
        <button type="button" className="primary" onClick={() => setF({ name: '', starts_on: '', ends_on: '', note: '', kind: platform ? 'state' : 'school', status: 'official', source: '' })}>+ Thêm ngày nghỉ</button>
      </span>
    </div>
    {f && <form className="panel formgrid" onSubmit={save}>
      <label className="field"><span>Tên ngày nghỉ *</span><input required maxLength={200} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Từ ngày *</span><input type="date" required value={f.starts_on} onChange={e => setF({ ...f, starts_on: e.target.value })} /></label>
      <label className="field"><span>Đến ngày</span><input type="date" value={f.ends_on} min={f.starts_on} onChange={e => setF({ ...f, ends_on: e.target.value })} /></label>
      <label className="field"><span>Loại</span><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{KIND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label className="field"><span>Trạng thái</span><select value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="official">Chính thức</option><option value="expected">Dự kiến</option></select></label>
      <label className="field"><span>Nguồn</span><input maxLength={300} value={f.source} placeholder="vd Công văn của Bộ" onChange={e => setF({ ...f, source: e.target.value })} /></label>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú</span><input maxLength={500} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      <div className="formactions"><button type="button" onClick={() => setF(null)}>Hủy</button> <button className="primary">Lưu</button></div>
    </form>}
    <div className="wrap"><table className="libtable">
      <thead><tr><th style={{ width: 36 }} /><th>Ngày nghỉ</th><th>Thời gian</th><th>Thuộc tuần</th><th>Loại</th><th>Trạng thái</th><th>Nguồn</th>{!platform && <th>Áp dụng</th>}</tr></thead>
      <tbody>{groups.map(([g, hs]) => <Fragment key={g}>
        {!platform && <tr className="distgsubj"><th colSpan={8}><b>{g}</b> <small className="sub">{hs.length}</small></th></tr>}
        {hs.map(h => <tr key={h.id} className={h.skipped ? 'skipped' : undefined}>
          <td>{editableH(h) && <input type="checkbox" aria-label={'Chọn ' + h.name} checked={ticked.has(h.id)} onChange={e => setTicked(t => { const n = new Set(t); if (e.target.checked) n.add(h.id); else n.delete(h.id); return n })} />}</td>
          <td><b>{h.name}</b>{h.note && <div><small className="sub">{h.note}</small></div>}{!platform && !h.std && h.org_id !== orgId && <div><small className="sub">{h.org_name}</small></div>}</td>
          <td>{h.starts_on === h.ends_on ? vnd(h.starts_on) : `${vnShort(h.starts_on)} – ${vnd(h.ends_on)}`}<div><small className="sub">{days(h)} ngày</small></div></td>
          <td>{weekOf(h)}</td><td>{kindName(h.kind)}</td>
          <td><span className={'gpill ' + (h.status === 'official' ? 'good' : 'warn')}>{h.status === 'official' ? 'Chính thức' : 'Dự kiến'}</span></td>
          <td><small>{h.source ?? ''}</small></td>
          {!platform && <td>{h.std ? <label className="inl"><input type="checkbox" checked={!h.skipped} onChange={() => toggleSkip(h)} /> {h.skipped ? 'Không nghỉ' : 'Nghỉ'}</label> : <small className="sub">Nghỉ</small>}</td>}
        </tr>)}
        {!hs.length && <tr><td colSpan={8} className="sub">Chưa có ngày nghỉ.</td></tr>}
      </Fragment>)}</tbody></table></div>
  </>
}
