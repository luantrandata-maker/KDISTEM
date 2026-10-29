// Kế hoạch tập huấn — bước 2 "Xếp lịch" và bước 3 "Xem kết quả" (khuôn Phân phối chương trình).
// Mỗi nội dung tập huấn là một buổi: ngày, giờ học, hình thức, địa điểm / link họp. Xếp tự động theo từng chương trình
// (ngày bắt đầu hoặc nối tiếp chương trình trước, giờ vào học, số giờ mỗi ngày, nghỉ trưa, bỏ cuối tuần) rồi sửa tay từng buổi.
// Lưu vào training_sessions (giữ buổi đã chốt điểm danh).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip } from '../dist/Editor'
import { colorOf } from '../dist/Grid'

type Mode = 'online' | 'offline'
export type SUnit = { id: string; title: string; hours: number; mode?: Mode | null }
export type SProg = { id: string; code: string; title: string; ct_code: string | null; subjects: (SUnit & { contents: SUnit[] })[] }
export type SItem = { program_id: string; seq: number; units?: string[] | null; trainer?: string | null; trainer_ids?: string[]; assistant_ids?: string[] }
export type SPlan = { id: string; org_id: string; mode: string; starts_on: string | null; ends_on: string | null }
type Sess = { id: string; unit_id: string | null; title: string; starts_at: string; ends_at: string; mode: Mode; location: string | null; meeting_url: string | null; closed_at: string | null }
export type Row = { unit_id: string; program_id: string; subj: string; title: string; hours: number; date: string; from: string; to: string
  mode: Mode; location: string; url: string; sid?: string; locked: boolean }
type Cfg = { start: string; time: string; perDay: number; lunch: boolean; skip: boolean; mode: Mode; location: string; url: string }

const SSEL = 'id, unit_id, title, starts_at, ends_at, mode, location, meeting_url, closed_at'
const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00'); x.setDate(x.getDate() + n); return ymd(x) }
const dow = (d: string) => new Date(d + 'T00:00').getDay()
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
export const vnDay = (d: string) => { const x = new Date(d + 'T00:00'); return `${WD[x.getDay()]} ${pad(x.getDate())}/${pad(x.getMonth() + 1)}` }
const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return ymd(d) }
const LUNCH_FROM = 11 * 60 + 30, LUNCH_TO = 13 * 60 + 30
const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp' }

/** Nội dung tập huấn của kế hoạch theo thứ tự chương trình › môn › nội dung (chỉ nội dung được chọn) */
function contentsOf(items: SItem[], progs: SProg[]) {
  const out: { p: SProg; it: SItem; subj: string; u: SUnit }[] = []
  for (const it of [...items].sort((a, b) => a.seq - b.seq)) {
    const p = progs.find(x => x.id === it.program_id); if (!p) continue
    const pick = it.units ? new Set(it.units) : null
    for (const sj of p.subjects) for (const u of sj.contents) if (!pick || pick.has(u.id)) out.push({ p, it, subj: sj.title, u })
  }
  return out
}

export function useSchedule(plan: SPlan, items: SItem[], progs: SProg[]) {
  const [sess, setSess] = useState<Sess[] | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [cfg, setCfgs] = useState<Record<string, Cfg>>({})
  const [dirty, setDirty] = useState(false)
  const [rk, setRk] = useState(0)
  const list = useMemo(() => contentsOf(items, progs), [items, progs])
  const defMode: Mode = plan.mode === 'online' ? 'online' : 'offline'
  useEffect(() => {
    supabase.from('training_sessions').select(SSEL).eq('plan_id', plan.id).order('starts_at').then(({ data }) => setSess((data as Sess[]) ?? []))
  }, [plan.id, rk])
  // Dòng xếp lịch: lấy từ buổi đã lưu, nội dung chưa có buổi thì để trống
  useEffect(() => {
    if (!sess) return
    setRows(list.map(({ p, subj, u }) => {
      const s = sess.find(x => x.unit_id === u.id)
      const a = s ? new Date(s.starts_at) : null, b = s ? new Date(s.ends_at) : null
      return { unit_id: u.id, program_id: p.id, subj, title: u.title, hours: u.hours, date: a ? ymd(a) : '', from: a ? hhmm(a.getHours() * 60 + a.getMinutes()) : '',
        to: b ? hhmm(b.getHours() * 60 + b.getMinutes()) : '', mode: s?.mode ?? u.mode ?? defMode, location: s?.location ?? '', url: s?.meeting_url ?? '', sid: s?.id, locked: !!s?.closed_at }
    }))
    setDirty(false)
  }, [sess, list])
  const cfgOf = (pid: string, k: number): Cfg => cfg[pid] ?? { start: k === 0 ? plan.starts_on || nextMonday() : 'after', time: '08:00', perDay: 4, lunch: true, skip: true, mode: defMode, location: '', url: '' }
  const setCfg = (pid: string, k: number, v: Partial<Cfg>) => setCfgs(c => ({ ...c, [pid]: { ...cfgOf(pid, k), ...v } }))
  const setRow = (id: string, v: Partial<Row>) => { setRows(rs => rs.map(r => r.unit_id === id ? { ...r, ...v } : r)); setDirty(true) }
  const order = useMemo(() => [...new Set(list.map(x => x.p.id))], [list])

  /** Xếp tự động các chương trình (theo thứ tự); only = chỉ một chương trình */
  function auto(only?: string) {
    let next = [...rows]
    let cursor: { date: string; at: number } | null = null   // điểm kết thúc của chương trình trước
    order.forEach((pid, k) => {
      const c = cfgOf(pid, k)
      const mine = next.filter(r => r.program_id === pid)
      if (only && only !== pid) {
        const done = mine.filter(r => r.date && r.to).sort((a, b) => (a.date + a.to).localeCompare(b.date + b.to)).pop()
        if (done) cursor = { date: done.date, at: mins(done.to) }
        return
      }
      const start0 = mins(c.time)
      let date = c.start !== 'after' ? c.start : cursor ? cursor.date : plan.starts_on || nextMonday()
      let at = c.start === 'after' && cursor ? cursor.at : start0, used = c.start === 'after' && cursor ? Math.max(0, cursor.at - start0) / 60 : 0
      const skipWk = () => { while (c.skip && (dow(date) === 0 || dow(date) === 6)) date = addDays(date, 1) }
      skipWk()
      for (const r of mine) {
        if (r.locked) continue
        const h = Math.min(Math.max(r.hours || 0, 0.5), 10)
        if (used > 0 && used + h > c.perDay) { date = addDays(date, 1); skipWk(); at = start0; used = 0 }
        let from = at
        if (c.lunch && from < LUNCH_FROM && from + h * 60 > LUNCH_FROM) from = Math.max(from, LUNCH_TO)
        if (c.lunch && from >= LUNCH_FROM && from < LUNCH_TO) from = LUNCH_TO
        const to = from + Math.round(h * 60)
        next = next.map(x => x.unit_id === r.unit_id ? { ...x, date, from: hhmm(from), to: hhmm(to), mode: c.mode, location: c.location || x.location, url: c.url || x.url } : x)
        at = to; used += h
      }
      cursor = { date, at }
    })
    setRows(next); setDirty(true)
  }

  async function save(): Promise<string | null> {
    const at = (d: string, t: string) => new Date(`${d}T${t}`).toISOString()
    for (const r of rows) {
      if (r.locked) continue
      const s = sess?.find(x => x.id === r.sid)
      if (!r.date || !r.from || !r.to) {
        if (s) { const { error } = await supabase.from('training_sessions').delete().eq('id', s.id); if (error) return `Không bỏ được buổi "${r.title}": ${error.message}` }
        continue
      }
      if (mins(r.to) <= mins(r.from)) return `Buổi "${r.title}": giờ kết thúc phải sau giờ bắt đầu.`
      const v = { starts_at: at(r.date, r.from), ends_at: at(r.date, r.to), mode: r.mode, location: r.location.trim() || null, meeting_url: r.url.trim() || null }
      if (v.meeting_url && !/^https?:\/\//i.test(v.meeting_url)) return `Buổi "${r.title}": link họp phải bắt đầu bằng http:// hoặc https://`
      if (s) {
        const same = +new Date(s.starts_at) === +new Date(v.starts_at) && +new Date(s.ends_at) === +new Date(v.ends_at) && s.mode === v.mode
          && (s.location ?? null) === v.location && (s.meeting_url ?? null) === v.meeting_url
        if (same) continue
        const { error } = await supabase.from('training_sessions').update(v).eq('id', s.id)
        if (error) return `Buổi "${r.title}": ${error.message}`
      } else {
        const it = items.find(i => i.program_id === r.program_id)
        const { error } = await supabase.from('training_sessions').insert({ ...v, org_id: plan.org_id, plan_id: plan.id, unit_id: r.unit_id, title: r.title,
          trainer_ids: it?.trainer_ids ?? [], trainer: it?.trainer_ids?.length ? null : it?.trainer ?? null, assistant_ids: it?.assistant_ids ?? [] })
        if (error) return `Buổi "${r.title}": ${error.message}`
      }
    }
    // Kế hoạch chưa có thời gian thì lấy theo lịch vừa xếp
    const ds = rows.filter(r => r.date).map(r => r.date).sort()
    if (ds.length && (!plan.starts_on || !plan.ends_on))
      await supabase.from('training_plans').update({ starts_on: plan.starts_on ?? ds[0], ends_on: plan.ends_on ?? ds[ds.length - 1] }).eq('id', plan.id)
    setRk(k => k + 1)
    return null
  }
  const reset = () => setRk(k => k + 1)
  return { loaded: !!sess, rows, order, cfgOf, setCfg, setRow, auto, save, reset, dirty, progs }
}
export type Schedule = ReturnType<typeof useSchedule>

/** Kiểm tra lịch: chưa xếp, trùng giờ, ngoài thời gian kế hoạch, thiếu địa điểm / link */
export function checks(s: Schedule, plan: SPlan) {
  const out: { level: 'error' | 'warn'; text: string }[] = []
  const none = s.rows.filter(r => !r.date)
  if (none.length) out.push({ level: 'warn', text: `${none.length} nội dung chưa xếp lịch: ${none.slice(0, 4).map(r => r.title).join('; ')}${none.length > 4 ? '…' : ''}` })
  const done = s.rows.filter(r => r.date && r.from && r.to).sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from))
  const bad = done.filter(r => mins(r.to) <= mins(r.from))
  if (bad.length) out.push({ level: 'error', text: `${bad.length} buổi có giờ kết thúc trước giờ bắt đầu: ${bad.map(r => r.title).join('; ')}` })
  for (let i = 1; i < done.length; i++) {
    const a = done[i - 1], b = done[i]
    if (a.date === b.date && mins(b.from) < mins(a.to)) out.push({ level: 'warn', text: `Trùng giờ ngày ${vnDay(a.date)}: “${a.title}” và “${b.title}”` })
  }
  const out_ = done.filter(r => (plan.starts_on && r.date < plan.starts_on) || (plan.ends_on && r.date > plan.ends_on))
  if (out_.length) out.push({ level: 'warn', text: `${out_.length} buổi nằm ngoài thời gian kế hoạch (${plan.starts_on ? vnDay(plan.starts_on) : '…'} – ${plan.ends_on ? vnDay(plan.ends_on) : '…'})` })
  const noLoc = done.filter(r => r.mode === 'offline' && !r.location.trim())
  if (noLoc.length) out.push({ level: 'warn', text: `${noLoc.length} buổi trực tiếp chưa có địa điểm` })
  const noUrl = done.filter(r => r.mode === 'online' && !r.url.trim())
  if (noUrl.length) out.push({ level: 'warn', text: `${noUrl.length} buổi trực tuyến chưa có link họp` })
  return out
}

const progName = (p: SProg | undefined) => p ? (p.code ? p.code + ' · ' : '') + p.title : '—'

// ===== Bước 2: Xếp lịch =====
export function ScheduleStep({ s, plan, edit, onNext }: { s: Schedule; plan: SPlan; edit: boolean; onNext: () => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set(s.order.slice(0, 1)))
  if (!s.loaded) return <p className="sub">Đang tải…</p>
  if (!s.order.length) return <p className="sub">Chọn chương trình tập huấn ở bước 1 trước.</p>
  return <>
    <div className="distcards tpcards">{s.order.map((pid, k) => {
      const p = s.progs.find(x => x.id === pid), c = s.cfgOf(pid, k)
      const mine = s.rows.filter(r => r.program_id === pid), done = mine.filter(r => r.date)
      const ds = done.map(r => r.date).sort(), hours = mine.reduce((a, r) => a + r.hours, 0)
      const shut = !open.has(pid)
      const subjs = [...new Set(mine.map(r => r.subj))]
      return <div key={pid} className="distcard" style={{ borderTopColor: colorOf(k) }}>
        <div className="distcardhead"><i style={{ background: colorOf(k) }} />{p?.ct_code && <Chip tone="ct">{p.ct_code}</Chip>}<b>{progName(p)}</b></div>
        <small className="sub">{mine.length} nội dung · {num(hours)} giờ</small>
        {edit && <><div className="distcardrow tpschedcfg">
          <label className="field"><span>Bắt đầu</span><select value={c.start === 'after' ? 'after' : 'date'} onChange={e => s.setCfg(pid, k, { start: e.target.value === 'after' ? 'after' : plan.starts_on || nextMonday() })}>
            <option value="date">Từ ngày…</option>{k > 0 && <option value="after">Nối tiếp chương trình trước</option>}</select></label>
          {c.start !== 'after' && <label className="field"><span>Ngày</span><input type="date" value={c.start} onChange={e => s.setCfg(pid, k, { start: e.target.value })} /></label>}
          <label className="field"><span>Giờ vào học</span><input type="time" value={c.time} onChange={e => s.setCfg(pid, k, { time: e.target.value || '08:00' })} /></label>
          <label className="field narrow"><span>Giờ/ngày</span><input type="number" min={1} max={10} step={0.5} value={c.perDay} onChange={e => s.setCfg(pid, k, { perDay: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} /></label>
          <label className="field"><span>Hình thức</span><select value={c.mode} onChange={e => s.setCfg(pid, k, { mode: e.target.value as Mode })}>
            {(Object.keys(MODE) as Mode[]).map(m => <option key={m} value={m}>{MODE[m]}</option>)}</select></label>
          {c.mode === 'offline'
            ? <label className="field wide"><span>Địa điểm</span><input value={c.location} maxLength={200} placeholder="VD: Hội trường Sở GD&ĐT" onChange={e => s.setCfg(pid, k, { location: e.target.value })} /></label>
            : <label className="field wide"><span>Link họp</span><input value={c.url} maxLength={500} placeholder="https://meet.google.com/…" onChange={e => s.setCfg(pid, k, { url: e.target.value })} /></label>}
        </div>
        <div className="tools tpschedopts">
          <label className="tpcheck"><input type="checkbox" checked={c.lunch} onChange={e => s.setCfg(pid, k, { lunch: e.target.checked })} /> Nghỉ trưa 11:30–13:30</label>
          <label className="tpcheck"><input type="checkbox" checked={c.skip} onChange={e => s.setCfg(pid, k, { skip: e.target.checked })} /> Bỏ qua thứ Bảy, Chủ nhật</label>
          <button type="button" className="primary" onClick={() => { s.auto(pid); setOpen(o => new Set(o).add(pid)) }}>Xếp tự động</button>
        </div></>}
        <div className={'distresult ' + (done.length === mine.length ? 'good' : done.length ? 'warn' : '')}>
          {done.length ? <>{done.length === mine.length ? '✓' : '⚠'} <b>{ds[0] === ds[ds.length - 1] ? vnDay(ds[0]) : `${vnDay(ds[0])} – ${vnDay(ds[ds.length - 1])}`}</b> · {done.length}/{mine.length} buổi · {new Set(ds).size} ngày</>
            : 'Chưa xếp lịch. Chọn ngày bắt đầu, giờ vào học rồi bấm “Xếp tự động”, hoặc nhập từng buổi.'}
        </div>
        <button type="button" className="linkbtn" aria-expanded={!shut} onClick={() => setOpen(o => { const n = new Set(o); if (shut) n.add(pid); else n.delete(pid); return n })}>
          {shut ? '▸ Xem và sửa từng buổi' : '▾ Thu gọn danh sách buổi'}</button>
        {!shut && <div className="wrap"><table className="libtable tpschedtable">
          <thead><tr><th style={{ width: 36 }}>#</th><th>Nội dung tập huấn</th><th style={{ width: 150 }}>Ngày học</th><th style={{ width: 200 }}>Thời gian</th><th style={{ width: 130 }}>Hình thức</th><th>Địa điểm / link họp</th></tr></thead>
          <tbody>{subjs.map(sj => <Fragment key={sj}>
            <tr className="distgsubj"><th colSpan={6}><b>{sj}</b></th></tr>
            {mine.filter(r => r.subj === sj).map((r, j) => {
              const ro = !edit || r.locked
              return <tr key={r.unit_id}>
                <td>{j + 1}</td>
                <td style={{ whiteSpace: 'normal' }}>{r.title}<br /><small className="sub">{num(r.hours)} giờ{r.locked ? ' · đã chốt điểm danh' : ''}</small></td>
                <td>{ro ? (r.date ? vnDay(r.date) : '—') : <input type="date" value={r.date} aria-label={'Ngày học ' + r.title} onChange={e => s.setRow(r.unit_id, { date: e.target.value })} />}</td>
                <td>{ro ? (r.from ? `${r.from}–${r.to}` : '—') : <span className="tptime">
                  <input type="time" value={r.from} aria-label="Giờ bắt đầu" onChange={e => { const f = e.target.value; s.setRow(r.unit_id, { from: f, to: r.to && mins(r.to) > mins(f) ? r.to : f ? hhmm(mins(f) + Math.round(r.hours * 60)) : '' }) }} />
                  <span>–</span><input type="time" value={r.to} aria-label="Giờ kết thúc" onChange={e => s.setRow(r.unit_id, { to: e.target.value })} /></span>}</td>
                <td>{ro ? MODE[r.mode] : <select value={r.mode} aria-label="Hình thức" onChange={e => s.setRow(r.unit_id, { mode: e.target.value as Mode })}>
                  {(Object.keys(MODE) as Mode[]).map(m => <option key={m} value={m}>{MODE[m]}</option>)}</select>}</td>
                <td>{ro ? (r.mode === 'online' ? r.url : r.location) || '—'
                  : r.mode === 'online' ? <input value={r.url} placeholder="https://…" aria-label="Link họp" onChange={e => s.setRow(r.unit_id, { url: e.target.value })} style={{ width: '100%' }} />
                  : <input value={r.location} placeholder="Địa điểm" aria-label="Địa điểm" onChange={e => s.setRow(r.unit_id, { location: e.target.value })} style={{ width: '100%' }} />}
                  {!ro && r.date && <button type="button" className="linkbtn" onClick={() => s.setRow(r.unit_id, { date: '', from: '', to: '' })}>Bỏ lịch</button>}</td>
              </tr>
            })}
          </Fragment>)}</tbody>
        </table></div>}
      </div>
    })}</div>
    <h4 className="distsec">Chi tiết theo ngày</h4>
    <DayGrid s={s} />
    <div className="formactions" style={{ textAlign: 'right' }}><button type="button" className="primary" onClick={onNext}>Tiếp tục: Xem kết quả →</button></div>
  </>
}

/** Lưới ngày: mỗi chương trình một vạch, mỗi môn một hàng; số trong ô là giờ học của môn trong ngày */
export function DayGrid({ s }: { s: Schedule }) {
  const done = s.rows.filter(r => r.date)
  if (!done.length) return <p className="sub">Chưa có buổi nào được xếp.</p>
  const ds = done.map(r => r.date).sort()
  const days: string[] = []
  for (let d = ds[0]; d <= ds[ds.length - 1] && days.length < 62; d = addDays(d, 1)) days.push(d)
  const cols = `150px repeat(${days.length}, minmax(34px, 1fr))`
  const hoursOn = (rs: Row[], d: string) => rs.filter(r => r.date === d).reduce((a, r) => a + r.hours, 0)
  const wk = (d: string) => dow(d) === 0 || dow(d) === 6 ? ' hol' : ''
  return <div className="distgridouter"><div className="distgridwrap">
    <div className="distgrid" role="table" aria-label="Lịch theo ngày">
      <div className="grow weeks" style={{ gridTemplateColumns: cols }}><b className="lab">Ngày</b>{days.map(d => <small key={d} className={'wk' + wk(d)} title={vnDay(d)}>{WD[dow(d)]}<br />{d.slice(8)}/{d.slice(5, 7)}</small>)}</div>
      {s.order.map((pid, k) => {
        const p = s.progs.find(x => x.id === pid), mine = done.filter(r => r.program_id === pid), color = colorOf(k)
        const subjs = [...new Set(s.rows.filter(r => r.program_id === pid).map(r => r.subj))]
        return <Fragment key={pid}>
          <div className="grow progrow" style={{ gridTemplateColumns: cols }}><span className="lab prog"><i style={{ background: color }} /><b>{p?.code || p?.title}</b></span>
            <span className="track" style={{ gridColumn: '2 / -1' }} /></div>
          {subjs.map(sj => <div key={sj} className="grow subjrow" style={{ gridTemplateColumns: cols }}><span className="lab subj">{sj}</span>
            {days.map(d => { const h = hoursOn(mine.filter(r => r.subj === sj), d)
              return h ? <span key={d} className={'cell on' + wk(d)} style={{ background: color }} title={`${sj} · ${vnDay(d)}: ${num(h)} giờ`}>{num(h)}</span> : <span key={d} className={'cell' + wk(d)} /> })}</div>)}
        </Fragment>
      })}
      <div className="grow totrow" style={{ gridTemplateColumns: cols }}><b className="lab total">Giờ/ngày</b>
        {days.map(d => { const h = hoursOn(done, d); return <small key={d} className={'tot' + (h > 8 ? ' over' : '')}>{h ? num(h) : ''}</small> })}</div>
    </div></div></div>
}

// ===== Bước 3: Xem kết quả =====
export function ResultStep({ s, plan }: { s: Schedule; plan: SPlan }) {
  const [view, setView] = useState<'table' | 'cal'>('table')
  if (!s.loaded) return <p className="sub">Đang tải…</p>
  const done = s.rows.filter(r => r.date && r.from).sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from))
  const days = [...new Set(done.map(r => r.date))]
  const list = checks(s, plan)
  const errors = list.filter(c => c.level === 'error')
  const pIdx = (pid: string) => s.order.indexOf(pid)
  return <>
    <div className="diststats">
      <div><b>{s.order.length}</b><small>chương trình</small></div>
      <div><b>{done.length}/{s.rows.length}</b><small>buổi đã xếp / nội dung</small></div>
      <div><b>{days.length}</b><small>ngày học{days.length ? ` · ${vnDay(days[0])} – ${vnDay(days[days.length - 1])}` : ''}</small></div>
      <div><b>{num(done.reduce((a, r) => a + r.hours, 0))}</b><small>giờ tập huấn</small></div>
    </div>
    <div className={'distchecks ' + (errors.length ? 'bad' : list.length ? 'warn' : 'good')}>
      <b>{errors.length ? 'Có lỗi cần sửa' : list.length ? 'Lưu ý' : 'Lịch hợp lệ'}</b>
      {list.length > 0 && <ul>{list.map((c, k) => <li key={k} className={c.level}>{c.level === 'error' ? '⊗' : '⚠'} {c.text}</li>)}</ul>}
    </div>
    <div className="distviewbar"><div className="segmented distseg" role="group" aria-label="Kiểu xem">
      <button type="button" className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>Bảng</button>
      <button type="button" className={view === 'cal' ? 'on' : ''} aria-pressed={view === 'cal'} onClick={() => setView('cal')}>Lịch</button></div>
      {s.dirty && <Chip tone="warn">Có thay đổi chưa lưu</Chip>}</div>
    {view === 'cal' ? <DayGrid s={s} /> : <div className="wrap"><table className="libtable disttable">
      <thead><tr><th style={{ width: 130 }}>Thời gian</th><th>Nội dung tập huấn</th><th>Chương trình · môn</th><th style={{ width: 110 }}>Hình thức</th><th>Địa điểm / link họp</th></tr></thead>
      <tbody>{days.map(d => <Fragment key={d}>
        <tr className="distgprog"><th colSpan={5}><b>{vnDay(d)}</b>/{d.slice(0, 4)} <small className="sub">{done.filter(r => r.date === d).length} buổi · {num(done.filter(r => r.date === d).reduce((a, r) => a + r.hours, 0))} giờ</small></th></tr>
        {done.filter(r => r.date === d).map(r => <tr key={r.unit_id}>
          <td>{r.from}–{r.to}</td>
          <td style={{ whiteSpace: 'normal' }}><i className="tpdot" style={{ background: colorOf(pIdx(r.program_id)) }} />{r.title}</td>
          <td style={{ whiteSpace: 'normal' }}><small>{s.progs.find(p => p.id === r.program_id)?.code} · {r.subj}</small></td>
          <td>{MODE[r.mode]}</td>
          <td style={{ whiteSpace: 'normal' }}>{(r.mode === 'online' ? r.url : r.location) || <small className="warnline">Chưa có</small>}</td>
        </tr>)}
      </Fragment>)}
        {!days.length && <tr><td colSpan={5}><small className="sub">Chưa có buổi nào. Quay lại bước “Xếp lịch”.</small></td></tr>}</tbody>
    </table></div>}
  </>
}
