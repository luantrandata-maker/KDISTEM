// Phân hệ 1 — Lịch tập huấn & điểm danh (085). Tab "Lịch" của mục Kế hoạch & lịch tập huấn (KDI, Sở / Phòng).
// Xếp lịch tự động từ kế hoạch (mỗi nội dung tập huấn một buổi) hoặc thêm buổi; xem theo danh sách / tuần / tháng;
// mở buổi để đưa mã điểm danh (QR), nhắc lịch, ghi có mặt / vắng, duyệt xin vắng, chốt điểm danh, xem GV trùng lịch.
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'

type Mode = 'online' | 'offline'
type Plan = { id: string; plan_code: string | null; name: string; mode: string; pub_status: string }
export type Sess = { id: string; plan_id: string; unit_id: string | null; title: string; starts_at: string; ends_at: string; mode: Mode; location: string | null
  meeting_url: string | null; trainer: string | null; note: string | null; closed_at: string | null; recording_url?: string | null }
type Att = { session_id: string; teacher_id: string; present: boolean | null; excuse_status: string | null; excuse_reason?: string | null; checked_in_at?: string | null; method?: string | null
  teachers?: { full_name: string; subject: string | null; organizations: { name: string } | null } | null }
type Unit = { id: string; program_id: string; parent_id: string | null; kind: string; seq: number; title: string; hours: number; mode: Mode | null }
type Item = { program_id: string; seq: number; trainer: string | null; units?: string[] | null }
type St = 'upcoming' | 'live' | 'toclose' | 'closed'

const SSEL = 'id, plan_id, unit_id, title, starts_at, ends_at, mode, location, meeting_url, trainer, note, closed_at, recording_url'
const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp' }
const ST: Record<St, [string, string]> = { upcoming: ['Sắp diễn ra', ''], live: ['Đang diễn ra', 'bad'], toclose: ['Chờ chốt điểm danh', 'warn'], closed: ['Đã chốt', 'good'] }
const errText = (m: string) => /schema cache|does not exist|column .* of relation/i.test(m) ? 'Hãy chạy migration 085 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Bạn không có quyền với buổi tập huấn này.' : m
export const sessSt = (s: Pick<Sess, 'starts_at' | 'ends_at' | 'closed_at'>, now = Date.now()): St =>
  s.closed_at ? 'closed' : now < +new Date(s.starts_at) ? 'upcoming' : now <= +new Date(s.ends_at) ? 'live' : 'toclose'
const dd = (d: string) => new Date(d).toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
const hm = (d: string) => new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
const toLocal = (d: string) => { const x = new Date(d); return new Date(+x - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const ymd = (d: Date) => new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const monday = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x }
const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

/** Nội dung tập huấn của các chương trình trong kế hoạch, theo thứ tự chương trình › môn › nội dung */
async function planContents(planId: string) {
  const { data: it } = await supabase.from('training_plan_items').select('program_id, seq, trainer, units').eq('plan_id', planId).order('seq')
  const items = (it ?? []) as Item[]
  if (!items.length) return [] as (Unit & { trainer: string | null })[]
  const { data: us } = await supabase.from('training_program_units').select('id, program_id, parent_id, kind, seq, title, hours, mode').in('program_id', items.map(i => i.program_id))
  const units = (us ?? []) as Unit[]
  const out: (Unit & { trainer: string | null })[] = []
  for (const i of items) {
    const subs = units.filter(u => u.program_id === i.program_id && u.kind === 'subject').sort((a, b) => a.seq - b.seq)
    const pick = i.units ? new Set(i.units) : null   // kế hoạch chọn một phần nội dung (097)
    for (const s of subs) for (const u of units.filter(x => x.parent_id === s.id && (!pick || pick.has(x.id))).sort((a, b) => a.seq - b.seq)) out.push({ ...u, trainer: i.trainer })
  }
  return out
}

export function TrainingCalendarPage({ orgId }: { orgId: string }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [rows, setRows] = useState<Sess[]>([])
  const [att, setAtt] = useState<Att[]>([])
  const [can, setCan] = useState(false)
  const [rk, setRk] = useState(0)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [plan, setPlan] = useState('')
  const [fs, setFs] = useState<St | ''>('')
  const [view, setView] = useState<'list' | 'week' | 'month'>('list')
  const [anchor, setAnchor] = useState(() => new Date())
  const [open, setOpen] = useState<{ kind: 'auto' } | { kind: 'new' } | { kind: 'sess'; id: string } | null>(null)
  const reload = () => setRk(k => k + 1)
  useEffect(() => { supabase.rpc('training_can_write', { p_org: orgId }).then(({ data }) => setCan(!!data)) }, [orgId])
  useEffect(() => {
    (async () => {
      const p = await supabase.from('training_plans').select('id, plan_code, name, mode, pub_status').eq('org_id', orgId).neq('pub_status', 'draft').order('plan_code', { ascending: false })
      if (p.error) { setMsg([errText(p.error.message), true]); setPlans([]); return }
      const ps = (p.data as Plan[]) ?? []
      const s = ps.length ? await supabase.from('training_sessions').select(SSEL).in('plan_id', ps.map(x => x.id)).order('starts_at') : { data: [] }
      const ss = (s.data as Sess[]) ?? []
      const a = ss.length ? await supabase.from('training_attendance').select('session_id, teacher_id, present, excuse_status').in('session_id', ss.map(x => x.id)) : { data: [] }
      setPlans(ps); setRows(ss); setAtt((a.data as Att[]) ?? [])
    })()
  }, [rk, orgId])

  const now = Date.now()
  const pl = (id: string) => plans?.find(p => p.id === id)
  const base = rows.filter(s => !plan || s.plan_id === plan)
  const shown = base.filter(s => !fs || sessSt(s, now) === fs)
  const n = (k: St) => base.filter(s => sessSt(s, now) === k).length
  const pend = att.filter(a => a.excuse_status === 'pending' && base.some(s => s.id === a.session_id)).length
  const info = (id: string) => { const a = att.filter(x => x.session_id === id); return { total: a.length, present: a.filter(x => x.present).length, pend: a.filter(x => x.excuse_status === 'pending').length } }

  if (open?.kind === 'auto') return <AutoSchedule plans={plans ?? []} initial={plan} onBack={() => setOpen(null)} onDone={m => { setOpen(null); setMsg([m, false]); reload() }} />
  if (open?.kind === 'new') return <SessionForm orgId={orgId} plans={plans ?? []} initial={plan} onBack={() => setOpen(null)} onDone={id => { reload(); setOpen({ kind: 'sess', id }) }} />
  if (open?.kind === 'sess') return <SessionDetail key={open.id} id={open.id} plan={pl(rows.find(s => s.id === open.id)?.plan_id ?? '')} can={can}
    onBack={() => { setOpen(null); reload() }} onMsg={m => { setMsg(m); setOpen(null); reload() }} />

  const steps: [string, string, St | ''][] = [
    ['Xếp lịch', 'Xếp tự động từ kế hoạch (mỗi nội dung tập huấn một buổi) hoặc thêm từng buổi; sửa giờ, địa điểm, link họp, giảng viên.', 'upcoming'],
    ['Nhắc lịch & điểm danh', 'Gửi nhắc lịch cho giáo viên. Buổi trực tiếp có mã 6 số / QR: giáo viên nhập mã để điểm danh; buổi trực tuyến điểm danh khi bấm Tham gia.', 'live'],
    ['Chốt điểm danh', 'Duyệt xin vắng, ghi có mặt / vắng còn thiếu rồi chốt. Chưa ghi thì tính vắng.', 'toclose']]
  const Card = ({ s }: { s: Sess }) => { const st = sessSt(s, now), i = info(s.id)
    return <button type="button" className={'tsevt ' + st} onClick={() => { setMsg(null); setOpen({ kind: 'sess', id: s.id }) }}>
      <b>{hm(s.starts_at)}–{hm(s.ends_at)}</b> {s.title}<small>{pl(s.plan_id)?.plan_code} · {MODE[s.mode]}{i.total ? ` · ${i.present}/${i.total}` : ''}{i.pend ? ` · ${i.pend} xin vắng` : ''}</small></button> }
  const wk = monday(anchor), days = Array.from({ length: 7 }, (_, k) => { const d = new Date(wk); d.setDate(wk.getDate() + k); return d })
  const m0 = new Date(anchor.getFullYear(), anchor.getMonth(), 1), mStart = monday(m0)
  const mDays = Array.from({ length: 42 }, (_, k) => { const d = new Date(mStart); d.setDate(mStart.getDate() + k); return d })
  const on = (d: Date) => shown.filter(s => sameDay(new Date(s.starts_at), d))
  const shift = (k: number) => { const d = new Date(anchor); if (view === 'month') d.setMonth(d.getMonth() + k); else d.setDate(d.getDate() + 7 * k); setAnchor(d) }

  return <>
    <div className="panel distintro">
      <ol className="distguide">{steps.map(([h, d, f], k) => <li key={h}><button type="button" onClick={() => setFs(f)}><i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
    </div>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">◷</i><span><b>{plans ? n('upcoming') : '…'}</b><small>Buổi sắp diễn ra</small><small>{base.length} buổi trong lịch</small></span></div>
      <div className="panel"><i aria-hidden="true" className={n('live') ? 'warn' : 'good'}>●</i><span><b>{n('live')}</b><small>Đang diễn ra</small></span></div>
      <div className="panel"><i aria-hidden="true" className={n('toclose') ? 'warn' : 'good'}>✓</i><span><b>{n('toclose')}</b><small>Chờ chốt điểm danh</small><small>{n('closed')} đã chốt</small></span></div>
      <div className="panel"><i aria-hidden="true" className={pend ? 'warn' : 'good'}>!</i><span><b>{pend}</b><small>Xin vắng chờ duyệt</small></span></div>
    </div>
    <div className="distfilter">
      {([['', 'Tất cả', base.length], ...(Object.keys(ST) as St[]).map(k => [k, ST[k][0], n(k)])] as [St | '', string, number][]).map(([s, l, c]) =>
        <button key={l} type="button" className={'distfchip' + (fs === s ? ' on' : '')} aria-pressed={fs === s} onClick={() => setFs(s)}>{l} <b>{c}</b></button>)}
    </div>
    <div className="bar">
      <div className="tools">
        <select value={plan} onChange={e => setPlan(e.target.value)} aria-label="Kế hoạch"><option value="">Mọi kế hoạch</option>
          {(plans ?? []).map(p => <option key={p.id} value={p.id}>{p.plan_code} · {p.name}</option>)}</select>
        <div className="segmented" style={{ margin: 0 }}>{([['list', 'Danh sách'], ['week', 'Tuần'], ['month', 'Tháng']] as const).map(([k, l]) =>
          <button key={k} type="button" className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
      </div>
      {can && <div className="tools">
        <button type="button" onClick={() => { setMsg(null); setOpen({ kind: 'new' }) }} disabled={!plans?.length}>Thêm buổi</button>
        <button type="button" className="primary" onClick={() => { setMsg(null); setOpen({ kind: 'auto' }) }} disabled={!plans?.length}>Xếp lịch từ kế hoạch</button></div>}
    </div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {!plans ? <p className="sub">Đang tải…</p> : view === 'list' ? <div className="wrap"><table className="libtable">
      <thead><tr><th>Buổi tập huấn</th><th>Thời gian</th><th>Hình thức</th><th>Giảng viên</th><th>Điểm danh</th><th>Trạng thái</th></tr></thead>
      <tbody>{shown.map(s => { const st = sessSt(s, now), i = info(s.id), p = pl(s.plan_id)
        return <tr key={s.id}>
          <td style={{ whiteSpace: 'normal' }}><button type="button" className="namelink" onClick={() => { setMsg(null); setOpen({ kind: 'sess', id: s.id }) }}>{s.title}</button><br /><small className="sub">{p?.plan_code} · {p?.name}</small></td>
          <td>{dd(s.starts_at)}<br /><small className="sub">{hm(s.starts_at)}–{hm(s.ends_at)}</small></td>
          <td>{MODE[s.mode]}{s.mode === 'offline' ? s.location && <><br /><small className="sub">{s.location}</small></> : !s.meeting_url ? <><br /><small className="warnline">Chưa có link họp</small></> : s.recording_url ? <><br /><small className="sub">▶ Có bản ghi</small></> : null}</td>
          <td>{s.trainer || '—'}</td>
          <td>{i.total ? `${i.present}/${i.total} có mặt` : <small className="sub">Chưa có GV</small>}{i.pend > 0 && <><br /><Chip tone="warn">{i.pend} xin vắng</Chip></>}</td>
          <td><Chip tone={ST[st][1]}>{ST[st][0]}</Chip></td>
        </tr> })}
        {!shown.length && <tr><td colSpan={6}>{rows.length ? 'Không có buổi nào khớp bộ lọc.' : plans.length ? (can ? 'Chưa có buổi nào. Bấm "Xếp lịch từ kế hoạch".' : 'Chưa có buổi nào.') : 'Chưa có kế hoạch nào đã phát hành. Phát hành kế hoạch ở tab Kế hoạch trước.'}</td></tr>}</tbody>
    </table></div> : <section className="panel" style={{ display: 'grid', gap: 10 }}>
      <div className="bar" style={{ margin: 0 }}>
        <div className="tools"><button type="button" aria-label="Trước" onClick={() => shift(-1)}>‹</button>
          <b>{view === 'week' ? `${days[0].toLocaleDateString('vi-VN')} – ${days[6].toLocaleDateString('vi-VN')}` : `Tháng ${anchor.getMonth() + 1}/${anchor.getFullYear()}`}</b>
          <button type="button" aria-label="Sau" onClick={() => shift(1)}>›</button><button type="button" onClick={() => setAnchor(new Date())}>Hôm nay</button></div>
        <small className="sub">Màu: xanh = sắp diễn ra · đỏ = đang diễn ra · vàng = chờ chốt · xám = đã chốt</small>
      </div>
      <div className={'tscal ' + view}>
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => <div key={d} className="tscalh">{d}</div>)}
        {(view === 'week' ? days : mDays).map(d => <div key={+d} className={'tscald' + (view === 'month' && d.getMonth() !== anchor.getMonth() ? ' out' : '') + (sameDay(d, new Date()) ? ' today' : '')}>
          <small>{d.getDate()}{view === 'week' && `/${d.getMonth() + 1}`}</small>{on(d).map(s => <Card key={s.id} s={s} />)}</div>)}
      </div>
    </section>}
  </>
}

// ===== Xếp lịch tự động =====
function AutoSchedule({ plans, initial, onBack, onDone }: { plans: Plan[]; initial: string; onBack: () => void; onDone: (m: string) => void }) {
  const [plan, setPlan] = useState(initial || plans.find(p => p.pub_status === 'published')?.id || '')
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return ymd(d) })
  const [time, setTime] = useState('08:00')
  const [perDay, setPerDay] = useState(4)
  const [skip, setSkip] = useState(true)
  const [units, setUnits] = useState<(Unit & { trainer: string | null })[] | null>(null)
  const [done, setDone] = useState<Set<string>>(new Set())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!plan) return
    setUnits(null)
    Promise.all([planContents(plan), supabase.from('training_sessions').select('unit_id').eq('plan_id', plan)]).then(([u, s]) => {
      setUnits(u); setDone(new Set(((s.data ?? []) as { unit_id: string | null }[]).map(x => x.unit_id).filter(Boolean) as string[]))
    })
  }, [plan])
  const todo = (units ?? []).filter(u => !done.has(u.id))
  // Xem trước giống cách hàm trong CSDL xếp: gom theo số giờ mỗi ngày, bỏ qua thứ Bảy, Chủ nhật nếu chọn
  const preview = useMemo(() => {
    const out: { u: Unit; day: Date; from: string; to: string }[] = []
    if (!start) return out
    let d = new Date(start + 'T00:00'), used = 0
    const [hh, mm] = time.split(':').map(Number)
    const fmt = (h: number) => { const t = hh * 60 + mm + Math.round(h * 60); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}` }
    for (const u of todo) {
      const h = Math.min(Math.max(Number(u.hours) || 0, 0.5), 12)
      if (used > 0 && used + h > perDay) { d = new Date(d); d.setDate(d.getDate() + 1); used = 0 }
      while (skip && (d.getDay() === 0 || d.getDay() === 6)) { d = new Date(d); d.setDate(d.getDate() + 1) }
      out.push({ u, day: d, from: fmt(used), to: fmt(used + h) }); used += h
    }
    return out
  }, [todo.length, units, start, time, perDay, skip])
  async function go() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('training_plan_schedule', { p_plan: plan, p_start: start, p_time: time, p_hours_per_day: perDay, p_skip_weekend: skip })
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onDone(`Đã xếp ${data} buổi tập huấn. Mở từng buổi để thêm địa điểm, link họp và gửi nhắc lịch.`)
  }
  const p = plans.find(x => x.id === plan)
  return <ElView back="Lịch tập huấn" onBack={onBack} title="Xếp lịch từ kế hoạch" sub="Mỗi nội dung tập huấn thành một buổi, theo thứ tự chương trình › môn › nội dung. Nội dung đã có buổi thì bỏ qua."
    actions={<button type="button" className="primary" disabled={busy || !todo.length || !start} onClick={go}>Xếp {todo.length || ''} buổi</button>}>
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="formgrid">
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Kế hoạch tập huấn</span><select value={plan} onChange={e => setPlan(e.target.value)}>
          {plans.filter(x => x.pub_status === 'published').map(x => <option key={x.id} value={x.id}>{x.plan_code} · {x.name}</option>)}</select></label>
        <label className="field"><span>Ngày bắt đầu</span><input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
        <label className="field"><span>Giờ bắt đầu mỗi ngày</span><input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
        <label className="field"><span>Số giờ tối đa mỗi ngày</span><input type="number" min={1} max={12} step={0.5} value={perDay} onChange={e => setPerDay(Math.min(12, Math.max(1, Number(e.target.value) || 1)))} /></label>
        <label className="field"><span>Ngày nghỉ</span><select value={skip ? 'y' : 'n'} onChange={e => setSkip(e.target.value === 'y')}><option value="y">Bỏ qua thứ Bảy, Chủ nhật</option><option value="n">Xếp cả cuối tuần</option></select></label>
      </div>
      {err && <p className="msg">{err}</p>}
    </section>
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Xem trước</h3><small className="sub">{p?.plan_code} · {todo.length} buổi mới · {done.size} nội dung đã có buổi</small></div>
      {!units ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th style={{ width: 40 }}>#</th><th>Nội dung tập huấn</th><th>Ngày</th><th>Giờ</th><th>Hình thức</th><th>Giảng viên</th></tr></thead>
        <tbody>{preview.map((x, k) => <tr key={x.u.id}><td>{k + 1}</td><td style={{ whiteSpace: 'normal' }}>{x.u.title}<br /><small className="sub">{num(Number(x.u.hours))} giờ</small></td>
          <td>{x.day.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td><td>{x.from}–{x.to}</td>
          <td>{x.u.mode ? MODE[x.u.mode] : p?.mode === 'online' ? 'Trực tuyến' : 'Trực tiếp'}</td><td>{(x.u as Unit & { trainer: string | null }).trainer || '—'}</td></tr>)}
          {!preview.length && <tr><td colSpan={6}><small className="sub">{units.length ? 'Mọi nội dung đã có buổi.' : 'Kế hoạch chưa có nội dung tập huấn (kế hoạch cũ hoặc chưa chọn chương trình). Dùng "Thêm buổi".'}</small></td></tr>}</tbody>
      </table></div>}
    </section>
  </ElView>
}

// ===== Thông tin buổi (thêm / sửa) =====
type Info = { plan_id: string; unit_id: string; title: string; starts_at: string; ends_at: string; mode: Mode; location: string; meeting_url: string; trainer: string; note: string; recording_url: string }
const fromSess = (s: Sess): Info => ({ plan_id: s.plan_id, unit_id: s.unit_id ?? '', title: s.title, starts_at: toLocal(s.starts_at), ends_at: toLocal(s.ends_at), mode: s.mode,
  location: s.location ?? '', meeting_url: s.meeting_url ?? '', trainer: s.trainer ?? '', note: s.note ?? '', recording_url: s.recording_url ?? '' })
const toRow = (f: Info) => ({ plan_id: f.plan_id, unit_id: f.unit_id || null, title: f.title.trim(), starts_at: new Date(f.starts_at).toISOString(), ends_at: new Date(f.ends_at).toISOString(),
  mode: f.mode, location: f.location.trim() || null, meeting_url: f.meeting_url.trim() || null, trainer: f.trainer.trim() || null, note: f.note.trim() || null, recording_url: f.recording_url.trim() || null })
const badInfo = (f: Info) => !f.plan_id || !f.title.trim() || !f.starts_at || !f.ends_at ? 'Nhập kế hoạch, tên buổi, giờ bắt đầu và kết thúc.'
  : f.ends_at <= f.starts_at ? 'Giờ kết thúc phải sau giờ bắt đầu.' : f.meeting_url.trim() && !/^https?:\/\//i.test(f.meeting_url.trim()) ? 'Link họp phải bắt đầu bằng http:// hoặc https://'
  : f.recording_url.trim() && !/^https?:\/\//i.test(f.recording_url.trim()) ? 'Link bản ghi phải bắt đầu bằng http:// hoặc https://' : ''

function InfoFields({ f, set, plans, lockPlan }: { f: Info; set: (f: Info) => void; plans: Plan[]; lockPlan?: boolean }) {
  const [units, setUnits] = useState<(Unit & { trainer: string | null })[]>([])
  useEffect(() => { if (f.plan_id) planContents(f.plan_id).then(setUnits); else setUnits([]) }, [f.plan_id])
  return <div className="formgrid">
    <label className="field" style={{ gridColumn: '1/-1' }}><span>Kế hoạch tập huấn *</span><select value={f.plan_id} disabled={lockPlan} onChange={e => set({ ...f, plan_id: e.target.value, unit_id: '' })}>
      <option value="">— Chọn kế hoạch —</option>{plans.filter(p => p.pub_status === 'published' || p.id === f.plan_id).map(p => <option key={p.id} value={p.id}>{p.plan_code} · {p.name}</option>)}</select></label>
    <label className="field" style={{ gridColumn: '1/-1' }}><span>Nội dung tập huấn</span><select value={f.unit_id} onChange={e => {
      const u = units.find(x => x.id === e.target.value)
      set({ ...f, unit_id: e.target.value, title: u && (!f.title.trim() || units.some(x => x.title === f.title)) ? u.title : f.title, mode: u?.mode ?? f.mode, trainer: f.trainer || u?.trainer || '' })
    }}><option value="">— Không gắn nội dung —</option>{units.map(u => <option key={u.id} value={u.id}>{u.title} ({num(Number(u.hours))} giờ)</option>)}</select></label>
    <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên buổi *</span><input maxLength={200} value={f.title} onChange={e => set({ ...f, title: e.target.value })} /></label>
    <label className="field"><span>Bắt đầu *</span><input type="datetime-local" value={f.starts_at} onChange={e => set({ ...f, starts_at: e.target.value })} /></label>
    <label className="field"><span>Kết thúc *</span><input type="datetime-local" value={f.ends_at} onChange={e => set({ ...f, ends_at: e.target.value })} /></label>
    <label className="field"><span>Hình thức</span><select value={f.mode} onChange={e => set({ ...f, mode: e.target.value as Mode })}><option value="offline">Trực tiếp</option><option value="online">Trực tuyến</option></select></label>
    <label className="field"><span>Giảng viên</span><input maxLength={200} value={f.trainer} onChange={e => set({ ...f, trainer: e.target.value })} /></label>
    {f.mode === 'offline' ? <label className="field" style={{ gridColumn: '1/-1' }}><span>Địa điểm</span><input maxLength={300} value={f.location} onChange={e => set({ ...f, location: e.target.value })} placeholder="VD: Phòng STEM, THCS Phố Hiến" /></label>
      : <label className="field" style={{ gridColumn: '1/-1' }}><span>Link phòng họp</span><input type="url" maxLength={500} value={f.meeting_url} onChange={e => set({ ...f, meeting_url: e.target.value })} placeholder="https://meet…" /></label>}
    {f.mode === 'online' && <label className="field" style={{ gridColumn: '1/-1' }}><span>Link bản ghi (sau buổi học)</span><input type="url" maxLength={1000} value={f.recording_url} onChange={e => set({ ...f, recording_url: e.target.value })} placeholder="https://… (video ghi lại buổi học)" /></label>}
    <label className="field" style={{ gridColumn: '1/-1' }}><span>Ghi chú</span><textarea rows={2} maxLength={1000} value={f.note} onChange={e => set({ ...f, note: e.target.value })} /></label>
  </div>
}

function SessionForm({ orgId, plans, initial, onBack, onDone }: { orgId: string; plans: Plan[]; initial: string; onBack: () => void; onDone: (id: string) => void }) {
  const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(8, 0, 0, 0)
  const e = new Date(d); e.setHours(11)
  const [f, setF] = useState<Info>({ plan_id: initial && plans.some(p => p.id === initial && p.pub_status === 'published') ? initial : '', unit_id: '', title: '', starts_at: toLocal(d.toISOString()), ends_at: toLocal(e.toISOString()),
    mode: 'offline', location: '', meeting_url: '', trainer: '', note: '', recording_url: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    const b = badInfo(f); if (b) return setErr(b)
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('training_sessions').insert({ ...toRow(f), org_id: orgId }).select('id').single()
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onDone((data as { id: string }).id)
  }
  return <ElView back="Lịch tập huấn" onBack={onBack} title="Thêm buổi tập huấn" sub="Giáo viên đã ghi danh vào kế hoạch tự có tên trong danh sách điểm danh của buổi."
    actions={<button type="button" className="primary" disabled={busy} onClick={save}>Lưu buổi</button>}>
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <InfoFields f={f} set={setF} plans={plans} />
      {err && <p className="msg">{err}</p>}
    </section>
  </ElView>
}

// ===== Chi tiết buổi: mã điểm danh, thông tin, danh sách điểm danh =====
function SessionDetail({ id, plan, can, onBack, onMsg }: { id: string; plan: Plan | undefined; can: boolean; onBack: () => void; onMsg: (m: [string, boolean]) => void }) {
  const [s, setS] = useState<Sess | null>(null)
  const [rows, setRows] = useState<Att[]>([])
  const [code, setCode] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [conf, setConf] = useState<Map<string, string[]>>(new Map())
  const [f, setF] = useState<Info | null>(null)
  const [edit, setEdit] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  async function load() {
    const [a, b, c] = await Promise.all([
      supabase.from('training_sessions').select(SSEL).eq('id', id).single(),
      supabase.from('training_attendance').select('session_id, teacher_id, present, excuse_status, excuse_reason, checked_in_at, method, teachers(full_name, subject, organizations(name))').eq('session_id', id),
      supabase.from('training_session_codes').select('code').eq('session_id', id).maybeSingle(),
    ])
    if (a.error || !a.data) return setMsg([errText(a.error?.message ?? 'Không tìm thấy buổi tập huấn.'), true])
    const x = a.data as Sess
    setS(x); setF(fromSess(x)); setRows((b.data as unknown as Att[]) ?? [])
    const k = (c.data as { code: string } | null)?.code ?? null
    setCode(k); setQr(k ? await QRCode.toDataURL(k, { margin: 1, width: 180, errorCorrectionLevel: 'M' }) : '')
    const { data: cf } = await supabase.rpc('training_plan_conflicts', { p_plan: x.plan_id })
    const m = new Map<string, string[]>()
    for (const r of ((cf ?? []) as { session_id: string; teacher_id: string; detail: string }[]).filter(r => r.session_id === id)) m.set(r.teacher_id, [...(m.get(r.teacher_id) ?? []), r.detail])
    setConf(m)
    if (plan) setPlans([plan])
  }
  useEffect(() => { load() }, [id])
  if (!s || !f) return <ElView back="Lịch tập huấn" onBack={onBack} title="Đang tải…">{msg && <p className="msg">{msg[0]}</p>}</ElView>

  const st = sessSt(s), closed = !!s.closed_at
  const run = async (q: PromiseLike<{ data?: unknown; error: { message: string } | null }>, ok?: string | ((d: unknown) => string)) => {
    const { data, error } = await q
    if (error) setMsg([errText(error.message), true]); else if (ok) setMsg([typeof ok === 'string' ? ok : ok(data), false])
    await load()
    return !error
  }
  async function saveInfo() {
    const b = badInfo(f!); if (b) return setMsg([b, true])
    if (await run(supabase.from('training_sessions').update(toRow(f!)).eq('id', id), 'Đã lưu thông tin buổi.')) setEdit(false)
  }
  async function del() {
    if (!confirm(`Xoá buổi "${s!.title}"? Điểm danh của buổi cũng bị xoá.`)) return
    const { error } = await supabase.from('training_sessions').delete().eq('id', id)
    if (error) return setMsg([errText(error.message), true])
    onMsg(['Đã xoá buổi tập huấn.', false])
  }
  const mark = (a: Att, v: string) => run(supabase.rpc('training_attendance_mark', { p_session: id, p_teacher: a.teacher_id, p_present: v === '' ? null : v === '1' }))
  const review = (a: Att, ok: boolean) => run(supabase.rpc('training_excuse_review', { p_session: id, p_teacher: a.teacher_id, p_approve: ok }), ok ? 'Đã duyệt xin vắng.' : 'Đã từ chối xin vắng.')
  const sorted = [...rows].sort((a, b) => (a.excuse_status === 'pending' ? 0 : 1) - (b.excuse_status === 'pending' ? 0 : 1) || (a.teachers?.full_name ?? '').localeCompare(b.teachers?.full_name ?? '', 'vi'))
  const present = rows.filter(a => a.present).length, absent = rows.filter(a => a.present === false).length, pend = rows.filter(a => a.excuse_status === 'pending').length
  const how = (a: Att) => a.method === 'code' ? 'nhập mã' : a.method === 'self' ? 'tự điểm danh' : a.method === 'manual' ? 'quản lý ghi' : ''

  return <ElView back="Lịch tập huấn" onBack={onBack} title={s.title}
    sub={<>{plan?.plan_code} · {dd(s.starts_at)} {hm(s.starts_at)}–{hm(s.ends_at)} · {MODE[s.mode]} · <Chip tone={ST[st][1]}>{ST[st][0]}</Chip></>}
    actions={can && <>
      {!closed && st !== 'upcoming' && <button type="button" className="primary" onClick={() => confirm(`Chốt điểm danh? ${rows.filter(a => a.present == null).length} giáo viên chưa ghi sẽ tính vắng.`)
        && run(supabase.rpc('training_session_close', { p_session: id, p_close: true }), 'Đã chốt điểm danh.')}>Chốt điểm danh</button>}
      {closed && <button type="button" onClick={() => run(supabase.rpc('training_session_close', { p_session: id, p_close: false }), 'Đã mở lại điểm danh.')}>Mở lại điểm danh</button>}
      {!closed && st !== 'toclose' && <button type="button" onClick={() => run(supabase.rpc('training_session_remind', { p_session: id }), d => Number(d) ? `Đã gửi nhắc lịch cho ${d} giáo viên.` : 'Vừa gửi nhắc lịch, hoặc chưa giáo viên nào có tài khoản.')}>Gửi nhắc lịch</button>}
      <button type="button" className="danger" onClick={del}>Xoá buổi</button>
    </>}>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {conf.size > 0 && <p className="warnline">{conf.size} giáo viên bị trùng lịch (xem cột Ghi chú).</p>}

    <div className="tsgrid">
      {can && s.mode === 'offline' && code && <section className="panel tscode">
        <h3 style={{ margin: 0 }}>Mã điểm danh</h3>
        <b className="tscodenum">{code}</b>
        {qr && <img src={qr} alt={`QR mã điểm danh ${code}`} width={150} height={150} />}
        <small className="sub">Chiếu mã hoặc QR trong buổi học. Giáo viên vào Lịch tập huấn › Nhập mã điểm danh (mở 15 phút trước giờ học đến 15 phút sau khi kết thúc).</small>
      </section>}
      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Thông tin buổi</h3>{can && !edit && <button type="button" onClick={() => setEdit(true)}>Sửa</button>}</div>
        {edit ? <>
          <InfoFields f={f} set={setF} plans={plans} lockPlan />
          <div className="formactions"><button type="button" className="primary" onClick={saveInfo}>Lưu</button> <button type="button" onClick={() => { setF(fromSess(s)); setEdit(false) }}>Huỷ</button></div>
        </> : <dl className="tpkv">
          <dt>Kế hoạch</dt><dd>{plan ? `${plan.plan_code} · ${plan.name}` : '—'}</dd>
          <dt>Thời gian</dt><dd>{dd(s.starts_at)}, {hm(s.starts_at)}–{hm(s.ends_at)}</dd>
          <dt>{s.mode === 'online' ? 'Link họp' : 'Địa điểm'}</dt><dd>{s.mode === 'online' ? (s.meeting_url ? <a href={s.meeting_url} target="_blank" rel="noreferrer">Mở phòng họp ↗</a> : <span className="warnline">Chưa có link họp</span>) : s.location || '—'}</dd>
          {s.mode === 'online' && <><dt>Bản ghi</dt><dd>{s.recording_url ? <a href={s.recording_url} target="_blank" rel="noreferrer">Xem bản ghi ↗</a> : <small className="sub">Chưa có</small>}
            {can && st !== 'upcoming' && <> <button type="button" className="linkbtn" onClick={() => {
              const u = prompt('Link bản ghi buổi học (https://…):', s.recording_url ?? '')
              if (u === null) return
              if (u.trim() && !/^https?:\/\//i.test(u.trim())) return setMsg(['Link bản ghi phải bắt đầu bằng http:// hoặc https://', true])
              run(supabase.from('training_sessions').update({ recording_url: u.trim() || null }).eq('id', id), u.trim() ? 'Đã gắn bản ghi, giáo viên xem lại được.' : 'Đã bỏ bản ghi.')
            }}>{s.recording_url ? 'Đổi' : 'Gắn bản ghi'}</button></>}</dd></>}
          <dt>Giảng viên</dt><dd>{s.trainer || '—'}</dd>
          {s.note && <><dt>Ghi chú</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{s.note}</dd></>}
        </dl>}
      </section>
    </div>

    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Điểm danh</h3>
        <small className="sub">{rows.length} giáo viên · {present} có mặt · {absent} vắng{pend ? ` · ${pend} xin vắng chờ duyệt` : ''}{closed ? ' · đã chốt' : ''}</small></div>
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Giáo viên</th><th>Trường</th><th style={{ width: 150 }}>Điểm danh</th><th>Xin vắng</th><th>Ghi chú</th></tr></thead>
        <tbody>{sorted.map(a => <tr key={a.teacher_id}>
          <td><b>{a.teachers?.full_name ?? '—'}</b>{a.teachers?.subject && <><br /><small className="sub">{a.teachers.subject}</small></>}</td>
          <td>{a.teachers?.organizations?.name ?? '—'}</td>
          <td>{can && !closed ? <select value={a.present == null ? '' : a.present ? '1' : '0'} aria-label={`Điểm danh ${a.teachers?.full_name ?? ''}`} onChange={e => mark(a, e.target.value)}>
            <option value="">Chưa ghi</option><option value="1">Có mặt</option><option value="0">Vắng</option></select>
            : a.present == null ? '—' : a.present ? <Chip tone="good">Có mặt</Chip> : <Chip tone={a.excuse_status === 'approved' ? 'warn' : 'bad'}>{a.excuse_status === 'approved' ? 'Vắng có phép' : 'Vắng'}</Chip>}
            {a.checked_in_at && <><br /><small className="sub">{hm(a.checked_in_at)} · {how(a)}</small></>}</td>
          <td style={{ whiteSpace: 'normal' }}>{a.excuse_status ? <>{a.excuse_status === 'pending' ? <Chip tone="warn">Chờ duyệt</Chip> : a.excuse_status === 'approved' ? <Chip tone="good">Đã duyệt</Chip> : <Chip tone="bad">Từ chối</Chip>}
            {a.excuse_reason && <><br /><small className="sub">{a.excuse_reason}</small></>}
            {can && a.excuse_status === 'pending' && <div className="tools" style={{ marginTop: 4 }}><button type="button" className="primary" onClick={() => review(a, true)}>Duyệt</button><button type="button" onClick={() => review(a, false)}>Từ chối</button></div>}</> : '—'}</td>
          <td style={{ whiteSpace: 'normal' }}>{conf.get(a.teacher_id)?.map((c, k) => <small key={k} className="warnline" style={{ display: 'block' }}>{c}</small>) ?? '—'}</td>
        </tr>)}
          {!rows.length && <tr><td colSpan={5}><small className="sub">Chưa có giáo viên. Giáo viên được trường chọn trong kế hoạch sẽ tự có tên ở đây.</small></td></tr>}</tbody>
      </table></div>
    </section>
  </ElView>
}
