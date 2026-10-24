// Phân hệ 1 — Kế hoạch tập huấn (084). Khuôn Phân hệ 2: hướng dẫn các bước, thẻ số liệu, danh sách có lọc,
// thêm / xem chi tiết mở view riêng. Luồng: Soạn kế hoạch (chọn chương trình tập huấn đã phát hành) → Phát hành →
// Gán trường → Trường chọn giáo viên, gửi danh sách → Đơn vị lập kế hoạch duyệt hoặc trả lại.
// TrainingPlansPage: KDI và Sở / Phòng (kế hoạch của đơn vị mình). SchoolTrainingAssigned: trường (kế hoạch được giao).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { Chip, STATUS } from '../dist/Editor'
import type { Status } from '../dist/sched'
import { PlanProgress } from './Progress'

type Mode = 'online' | 'offline' | 'hybrid'
type Term = 'summer' | 'hk1' | 'hk2' | 'other'
type OrgSt = 'assigned' | 'submitted' | 'approved' | 'returned'
export type TPlan = {
  id: string; org_id: string; plan_code: string | null; name: string; pub_status: Status; status: string; year_name: string | null; term: Term | null
  mode: Mode; provider: string | null; starts_on: string | null; ends_on: string | null; budget: number | null; note: string | null; hours: number | null
  updated_at: string; published_at: string | null
}
type Item = { plan_id: string; program_id: string; seq: number; quota: number | null; trainer: string | null; note: string | null
  training_programs: { code: string; title: string; ct_code: string | null } | null }
type POrg = { plan_id: string; org_id: string; quota: number | null; status: OrgSt; note: string | null; submitted_at: string | null; decided_at: string | null }
type Prog = { id: string; code: string; title: string; ct_code: string | null; hours: number }
type Enr = { plan_id: string; teacher_id: string; teachers: { full_name: string; subject: string | null; org_id: string } | null }

const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const TERM: Record<Term, string> = { summer: 'Dịp hè', hk1: 'Học kỳ I', hk2: 'Học kỳ II', other: 'Khác' }
export const ORG_ST: Record<OrgSt, [string, string]> = { assigned: ['Chờ trường chọn GV', ''], submitted: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'good'], returned: ['Trả lại', 'bad'] }
const SEL = 'id, org_id, plan_code, name, pub_status, status, year_name, term, mode, provider, starts_on, ends_on, budget, note, hours, updated_at, published_at'
const errText = (m: string) => /schema cache|does not exist|column .* of relation/i.test(m) ? 'Hãy chạy migration 084 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Bạn không có quyền với kế hoạch tập huấn này.' : m
const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
const day = (d: string | null) => d ? new Date(d + (d.length === 10 ? 'T00:00' : '')).toLocaleDateString('vi-VN') : ''
const money = (n: number | null) => n == null ? '—' : n.toLocaleString('vi-VN') + ' đ'
const span = (p: Pick<TPlan, 'starts_on' | 'ends_on'>) => p.starts_on || p.ends_on ? [day(p.starts_on), day(p.ends_on)].filter(Boolean).join(' – ') : ''
function yearOptions() {
  const d = new Date(), y = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1
  return [y - 1, y, y + 1, y + 2].map(a => `${a}-${a + 1}`)
}
/** Tổng giờ nội dung tập huấn của mỗi chương trình đã phát hành */
function usePrograms() {
  const [list, setList] = useState<Prog[]>([])
  useEffect(() => {
    (async () => {
      const [p, u] = await Promise.all([
        supabase.from('training_programs').select('id, code, title, ct_code').eq('status', 'published').order('code'),
        supabase.from('training_program_units').select('program_id, hours').eq('kind', 'content'),
      ])
      const h = new Map<string, number>()
      for (const r of (u.data ?? []) as { program_id: string; hours: number }[]) h.set(r.program_id, (h.get(r.program_id) ?? 0) + (Number(r.hours) || 0))
      setList(((p.data ?? []) as Omit<Prog, 'hours'>[]).map(x => ({ ...x, hours: h.get(x.id) ?? 0 })))
    })()
  }, [])
  return list
}

// ===== Danh sách kế hoạch của đơn vị (KDI, Sở, Phòng) =====
export function TrainingPlansPage({ orgId }: { orgId: string }) {
  const [list, setList] = useState<TPlan[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [orgs, setOrgs] = useState<POrg[]>([])
  const [can, setCan] = useState(false)
  const [rk, setRk] = useState(0)
  const [view, setView] = useState<{ kind: 'new' } | { kind: 'open'; id: string } | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [fs, setFs] = useState<Status | 'wait' | ''>('')
  const [q, setQ] = useState('')
  const [yr, setYr] = useState('')
  const reload = () => setRk(k => k + 1)
  useEffect(() => { supabase.rpc('training_can_write', { p_org: orgId }).then(({ data }) => setCan(!!data)) }, [orgId])
  useEffect(() => {
    (async () => {
      const p = await supabase.from('training_plans').select(SEL).eq('org_id', orgId).order('plan_code', { ascending: false })
      if (p.error) { setMsg([errText(p.error.message), true]); setList([]); return }
      const ids = ((p.data ?? []) as TPlan[]).map(x => x.id)
      const [i, o] = ids.length ? await Promise.all([
        supabase.from('training_plan_items').select('plan_id, program_id, seq, quota, trainer, note, training_programs(code, title, ct_code)').in('plan_id', ids),
        supabase.from('training_plan_orgs').select('plan_id, org_id, quota, status, note, submitted_at, decided_at').in('plan_id', ids),
      ]) : [{ data: [] }, { data: [] }]
      setList((p.data as TPlan[]) ?? []); setItems((i.data as unknown as Item[]) ?? []); setOrgs((o.data as POrg[]) ?? [])
    })()
  }, [rk, orgId])

  const wait = (id: string) => orgs.filter(o => o.plan_id === id && o.status === 'submitted').length
  const shown = useMemo(() => (list ?? []).filter(p => (!fs || (fs === 'wait' ? wait(p.id) > 0 : p.pub_status === fs)) && (!yr || p.year_name === yr)
    && (!q || `${p.plan_code ?? ''} ${p.name} ${p.provider ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [list, orgs, fs, yr, q])

  if (view?.kind === 'new') return <PlanForm orgId={orgId} onBack={() => setView(null)} onSaved={id => { reload(); setView({ kind: 'open', id }) }} />
  if (view?.kind === 'open') return <PlanDetail key={view.id} id={view.id} can={can} onBack={() => { setView(null); reload() }} onMsg={m => { setMsg(m); reload() }} />

  const n = (s: Status) => (list ?? []).filter(p => p.pub_status === s).length
  const waiting = orgs.filter(o => o.status === 'submitted').length
  const years = [...new Set((list ?? []).map(p => p.year_name).filter(Boolean) as string[])].sort().reverse()
  const steps: [string, string, Status | 'wait' | ''][] = [
    ['Soạn kế hoạch', 'Chọn năm học, đợt, các chương trình tập huấn đã phát hành, chỉ tiêu và giảng viên.', 'draft'],
    ['Phát hành', 'Kiểm tra đủ thông tin rồi phát hành. Kế hoạch đã phát hành mới gán được cho trường.', 'published'],
    ['Gán trường', 'Chọn các trường tham gia và chỉ tiêu giáo viên của mỗi trường.', 'published'],
    ['Duyệt danh sách', 'Trường chọn giáo viên rồi gửi lên; đơn vị lập kế hoạch duyệt hoặc trả lại kèm lý do.', 'wait']]
  return (
    <>
      <div className="panel distintro">
        <ol className="distguide four">{steps.map(([h, d, f], k) => <li key={h}><button type="button" onClick={() => setFs(f)}>
          <i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
        <p className="sub" style={{ margin: 0 }}>Kế hoạch tập huấn gom các chương trình tập huấn vào một đợt của năm học, giao cho trường. Mở một kế hoạch để xem chương trình, trường được gán và danh sách giáo viên.</p>
      </div>
      <div className="diststatcards">
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{list?.length ?? '…'}</b><small>Kế hoạch tập huấn</small><small>{n('published')} đã phát hành · {n('draft')} nháp</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">⌂</i><span><b>{new Set(orgs.map(o => o.org_id)).size}</b><small>Trường được gán</small><small>{orgs.filter(o => o.status === 'approved').length} danh sách đã duyệt</small></span></div>
        <div className="panel"><i aria-hidden="true" className={waiting ? 'warn' : 'good'}>!</i><span><b>{waiting}</b><small>Danh sách chờ duyệt</small></span></div>
      </div>
      <div className="distfilter">
        {([['', 'Tất cả', list?.length ?? 0], ['draft', 'Nháp', n('draft')], ['published', 'Đã phát hành', n('published')], ['wait', 'Có danh sách chờ duyệt', (list ?? []).filter(p => wait(p.id)).length], ['archived', 'Ngừng dùng', n('archived')]] as [Status | 'wait' | '', string, number][]).map(([s, l, c]) =>
          <button key={l} type="button" className={'distfchip' + (fs === s ? ' on' : '')} aria-pressed={fs === s} onClick={() => setFs(s)}>{l} <b>{c}</b></button>)}
      </div>
      <div className="bar">
        <div className="tools">
          <input placeholder="Tìm mã, tên, đơn vị tập huấn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <select value={yr} onChange={e => setYr(e.target.value)} aria-label="Năm học"><option value="">Mọi năm học</option>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
          <small className="sub">{shown.length}/{list?.length ?? 0} kế hoạch</small>
        </div>
        {can && <div className="tools"><button type="button" className="primary" onClick={() => { setMsg(null); setView({ kind: 'new' }) }}>Lập kế hoạch tập huấn</button></div>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {!list ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Kế hoạch tập huấn</th><th>Năm học · đợt</th><th>Chương trình</th><th>Trường</th><th>Hình thức</th><th>Trạng thái</th></tr></thead>
        <tbody>{shown.map(p => { const its = items.filter(i => i.plan_id === p.id), os = orgs.filter(o => o.plan_id === p.id), w = wait(p.id)
          return <tr key={p.id}>
            <td><button type="button" className="namelink" onClick={() => { setMsg(null); setView({ kind: 'open', id: p.id }) }}>{p.name}</button><br /><small className="sub">{[p.plan_code, span(p)].filter(Boolean).join(' · ')}</small></td>
            <td>{[p.year_name, p.term && TERM[p.term]].filter(Boolean).join(' · ') || '—'}</td>
            <td style={{ whiteSpace: 'normal' }}>{its.length ? its.sort((a, b) => a.seq - b.seq).map(i => i.training_programs?.title).join('; ') : <small className="sub">{p.pub_status === 'draft' ? 'Chưa chọn' : 'Kế hoạch cũ'}</small>}
              {p.hours ? <><br /><small className="sub">{p.hours} giờ</small></> : null}</td>
            <td>{os.length ? <>{os.length} trường{w > 0 && <><br /><Chip tone="warn">{w} chờ duyệt</Chip></>}</> : '—'}</td>
            <td>{MODE[p.mode] ?? p.mode}</td>
            <td><Chip tone={STATUS[p.pub_status][1]}>{STATUS[p.pub_status][0]}</Chip></td>
          </tr> })}
          {shown.length === 0 && <tr><td colSpan={6}>{list.length ? 'Không có kế hoạch nào khớp bộ lọc.' : can ? 'Chưa có kế hoạch tập huấn nào. Bấm "Lập kế hoạch tập huấn".' : 'Chưa có kế hoạch tập huấn nào.'}</td></tr>}</tbody>
      </table></div>}
    </>
  )
}

// ===== Thông tin kế hoạch =====
const BLANK = { name: '', year_name: '' as string, term: 'summer' as Term | '', mode: 'hybrid' as Mode, provider: '', starts_on: '', ends_on: '', budget: '' as string, note: '' }
type Info = typeof BLANK
const toRow = (f: Info) => ({ name: f.name.trim(), year_name: f.year_name || null, term: f.term || null, mode: f.mode, provider: f.provider.trim() || null,
  starts_on: f.starts_on || null, ends_on: f.ends_on || null, budget: f.budget === '' ? null : Math.max(0, Math.round(Number(f.budget) || 0)), note: f.note.trim() || null })
const badDates = (f: Info) => !!(f.starts_on && f.ends_on && f.ends_on < f.starts_on)

function InfoFields({ f, set }: { f: Info; set: (f: Info) => void }) {
  const years = [...new Set([...yearOptions(), ...(f.year_name ? [f.year_name] : [])])]
  return <div className="formgrid">
    <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên kế hoạch tập huấn *</span><input required maxLength={200} value={f.name} onChange={e => set({ ...f, name: e.target.value })} placeholder="VD: Tập huấn STEM hè 2027 cho giáo viên THCS" /></label>
    <label className="field"><span>Năm học *</span><select value={f.year_name} onChange={e => set({ ...f, year_name: e.target.value })}><option value="">— Chọn năm học —</option>
      {years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
    <label className="field"><span>Đợt</span><select value={f.term} onChange={e => set({ ...f, term: e.target.value as Term | '' })}><option value="">— Không chọn —</option>
      {(Object.keys(TERM) as Term[]).map(t => <option key={t} value={t}>{TERM[t]}</option>)}</select></label>
    <label className="field"><span>Hình thức</span><select value={f.mode} onChange={e => set({ ...f, mode: e.target.value as Mode })}>
      {(Object.keys(MODE) as Mode[]).map(m => <option key={m} value={m}>{MODE[m]}</option>)}</select></label>
    <label className="field"><span>Đơn vị tập huấn</span><input maxLength={200} value={f.provider} onChange={e => set({ ...f, provider: e.target.value })} placeholder="VD: KDI Education STEM" /></label>
    <label className="field"><span>Từ ngày</span><input type="date" value={f.starts_on} onChange={e => set({ ...f, starts_on: e.target.value })} /></label>
    <label className="field"><span>Đến ngày</span><input type="date" value={f.ends_on} onChange={e => set({ ...f, ends_on: e.target.value })} /></label>
    <label className="field"><span>Kinh phí dự kiến (đồng)</span><input type="number" min={0} step={100000} value={f.budget} onChange={e => set({ ...f, budget: e.target.value })} /></label>
    <label className="field" style={{ gridColumn: '1/-1' }}><span>Ghi chú</span><textarea rows={2} maxLength={2000} value={f.note} onChange={e => set({ ...f, note: e.target.value })} /></label>
    {badDates(f) && <p className="warnline" style={{ gridColumn: '1/-1' }}>Ngày kết thúc phải sau ngày bắt đầu.</p>}
  </div>
}

function PlanForm({ orgId, onBack, onSaved }: { orgId: string; onBack: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<Info>({ ...BLANK, year_name: yearOptions()[1] })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (badDates(f)) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('training_plans').insert({ ...toRow(f), org_id: orgId, pub_status: 'draft', status: 'planned' }).select('id').single()
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onSaved((data as { id: string }).id)
  }
  return <ElView back="Kế hoạch tập huấn" onBack={onBack} title="Lập kế hoạch tập huấn" sub="Lưu xong thì chọn các chương trình tập huấn, rồi phát hành và gán trường.">
    <form className="panel" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <InfoFields f={f} set={setF} />
      {err && <p className="msg">{err}</p>}
      <div className="formactions"><button type="submit" className="primary" disabled={busy || !f.name.trim() || badDates(f)}>Tạo bản nháp</button> <button type="button" onClick={onBack}>Huỷ</button></div>
    </form>
  </ElView>
}

// ===== Chi tiết kế hoạch: thông tin, chương trình, trường được gán =====
function PlanDetail({ id, can, onBack, onMsg }: { id: string; can: boolean; onBack: () => void; onMsg: (m: [string, boolean]) => void }) {
  const [p, setP] = useState<TPlan | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [orgs, setOrgs] = useState<POrg[]>([])
  const [enr, setEnr] = useState<Enr[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [f, setF] = useState<Info | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [pick, setPick] = useState('')
  const [assign, setAssign] = useState(false)
  const [openOrg, setOpenOrg] = useState<string | null>(null)
  const progs = usePrograms()
  async function load() {
    const [a, b, c, d] = await Promise.all([
      supabase.from('training_plans').select(SEL).eq('id', id).single(),
      supabase.from('training_plan_items').select('plan_id, program_id, seq, quota, trainer, note, training_programs(code, title, ct_code)').eq('plan_id', id).order('seq'),
      supabase.from('training_plan_orgs').select('plan_id, org_id, quota, status, note, submitted_at, decided_at').eq('plan_id', id),
      supabase.from('training_enrollments').select('plan_id, teacher_id, teachers(full_name, subject, org_id)').eq('plan_id', id),
    ])
    if (a.error) return setMsg([errText(a.error.message), true])
    const x = a.data as TPlan, os = (c.data as POrg[]) ?? []
    setP(x); setItems((b.data as unknown as Item[]) ?? []); setOrgs(os); setEnr((d.data as unknown as Enr[]) ?? [])
    setF({ name: x.name, year_name: x.year_name ?? '', term: x.term ?? '', mode: x.mode, provider: x.provider ?? '', starts_on: x.starts_on ?? '', ends_on: x.ends_on ?? '',
      budget: x.budget == null ? '' : String(x.budget), note: x.note ?? '' })
    if (os.length) {
      const { data } = await supabase.from('organizations').select('id, name').in('id', os.map(o => o.org_id))
      setNames(new Map(((data ?? []) as { id: string; name: string }[]).map(o => [o.id, o.name])))
    }
  }
  useEffect(() => { load() }, [id])
  if (!p || !f) return <ElView back="Kế hoạch tập huấn" onBack={onBack} title="Đang tải…">{msg && <p className="msg">{msg[0]}</p>}</ElView>

  const edit = can && p.pub_status === 'draft'
  const run = async (q: PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    const { error } = await q
    if (error) setMsg([errText(error.message), true]); else if (ok) setMsg([ok, false])
    await load()
    return !error
  }
  if (assign) return <AssignSchools plan={p} taken={new Set(orgs.map(o => o.org_id))} onBack={() => setAssign(false)}
    onDone={m => { setAssign(false); setMsg([m, false]); load() }} />

  const hoursOf = (pid: string) => progs.find(x => x.id === pid)?.hours ?? 0
  const totalHours = items.reduce((a, i) => a + hoursOf(i.program_id), 0)
  const totalQuota = items.reduce((a, i) => a + (i.quota ?? 0), 0)
  const free = progs.filter(x => !items.some(i => i.program_id === x.id))
  const warn = [!p.year_name && 'chưa chọn năm học', !items.length && 'chưa chọn chương trình tập huấn'].filter(Boolean) as string[]
  const enrOf = (org: string) => enr.filter(e => e.teachers?.org_id === org)
  const patchItem = (i: Item, v: Partial<Item>) => run(supabase.from('training_plan_items').update(v).eq('plan_id', i.plan_id).eq('program_id', i.program_id))
  async function addItem() {
    if (!pick) return
    if (await run(supabase.from('training_plan_items').insert({ plan_id: p!.id, program_id: pick, seq: items.reduce((m, i) => Math.max(m, i.seq), 0) + 1 }))) setPick('')
  }
  async function move(k: number, d: -1 | 1) {
    const a = items[k], b = items[k + d]; if (!b) return
    await supabase.from('training_plan_items').update({ seq: b.seq }).eq('plan_id', a.plan_id).eq('program_id', a.program_id)
    await run(supabase.from('training_plan_items').update({ seq: a.seq }).eq('plan_id', b.plan_id).eq('program_id', b.program_id))
  }
  async function setStatus(s: Status, ok: string) {
    if (await run(supabase.from('training_plans').update({ pub_status: s }).eq('id', p!.id), ok)) onMsg([ok, false])
  }
  async function del() {
    if (!confirm(`Xoá bản nháp "${p!.name}"?`)) return
    const { error } = await supabase.from('training_plans').delete().eq('id', p!.id)
    if (error) return setMsg([errText(error.message), true])
    onMsg(['Đã xoá bản nháp.', false]); onBack()
  }
  const review = (o: POrg, ok: boolean) => {
    const note = ok ? null : prompt(`Lý do trả lại danh sách của ${names.get(o.org_id) ?? 'trường'}:`)
    if (!ok && !note?.trim()) return
    run(supabase.rpc('training_plan_review', { p_plan: p!.id, p_org: o.org_id, p_approve: ok, p_note: note }), ok ? 'Đã duyệt danh sách.' : 'Đã trả lại danh sách cho trường.')
  }
  const unassign = (o: POrg) => confirm(`Bỏ gán ${names.get(o.org_id) ?? 'trường'}? ${enrOf(o.org_id).length} giáo viên đã chọn cũng bị bỏ khỏi kế hoạch.`)
    && run(supabase.rpc('training_plan_unassign', { p_plan: p!.id, p_org: o.org_id }), 'Đã bỏ gán trường.')
  const setQuota = (o: POrg, v: string) => run(supabase.rpc('training_plan_assign', { p_plan: p!.id, p_orgs: [o.org_id], p_quota: v === '' ? null : Number(v) }))
  const sortedOrgs = [...orgs].sort((a, b) => (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1) || (names.get(a.org_id) ?? '').localeCompare(names.get(b.org_id) ?? '', 'vi'))

  return <ElView back="Kế hoạch tập huấn" onBack={onBack} title={p.name}
    sub={<>{p.plan_code} · <Chip tone={STATUS[p.pub_status][1]}>{STATUS[p.pub_status][0]}</Chip> · {items.length} chương trình · {num(totalHours)} giờ · {orgs.length} trường</>}
    actions={can && <>
      {p.pub_status === 'draft' && <button type="button" className="primary" disabled={warn.length > 0} onClick={() => setStatus('published', `Đã phát hành ${p.plan_code}.`)}>Phát hành</button>}
      {p.pub_status === 'published' && <button type="button" className="primary" onClick={() => setAssign(true)}>Gán trường</button>}
      {p.pub_status === 'published' && !orgs.length && <button type="button" onClick={() => setStatus('draft', 'Đã chuyển về nháp.')}>Chuyển về nháp</button>}
      {p.pub_status === 'published' && <button type="button" onClick={() => confirm('Ngừng dùng kế hoạch này? Trường đã gán vẫn giữ danh sách.') && setStatus('archived', 'Đã chuyển sang Ngừng dùng.')}>Ngừng dùng</button>}
      {p.pub_status === 'archived' && <button type="button" onClick={() => setStatus('published', 'Đã dùng lại kế hoạch.')}>Dùng lại</button>}
      {p.pub_status === 'draft' && <button type="button" className="danger" onClick={del}>Xoá</button>}
    </>}>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {edit && warn.length > 0 && <p className="warnline">Chưa phát hành được: {warn.join('; ')}.</p>}
    {can && p.pub_status === 'published' && <p className="sub">{orgs.length ? 'Kế hoạch đã gán cho trường nên không sửa nội dung được.' : 'Muốn sửa nội dung thì bấm "Chuyển về nháp" (chỉ khi chưa gán trường).'}</p>}

    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Thông tin kế hoạch</h3>
      {edit ? <>
        <InfoFields f={f} set={setF} />
        <div className="formactions"><button type="button" className="primary" disabled={!f.name.trim() || badDates(f)} onClick={() => run(supabase.from('training_plans').update(toRow(f)).eq('id', p.id), 'Đã lưu thông tin.')}>Lưu thông tin</button></div>
      </> : <dl className="tpkv">
        <dt>Năm học · đợt</dt><dd>{[p.year_name, p.term && TERM[p.term]].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Thời gian</dt><dd>{span(p) || '—'}</dd>
        <dt>Hình thức</dt><dd>{MODE[p.mode] ?? p.mode}</dd>
        <dt>Đơn vị tập huấn</dt><dd>{p.provider || '—'}</dd>
        <dt>Kinh phí dự kiến</dt><dd>{money(p.budget)}</dd>
        {p.note && <><dt>Ghi chú</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.note}</dd></>}
      </dl>}
    </section>

    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Chương trình tập huấn</h3><small className="sub">{items.length} chương trình · {num(totalHours)} giờ{totalQuota ? ` · chỉ tiêu ${totalQuota} GV` : ''}</small></div>
      <div className="wrap"><table className="libtable">
        <thead><tr><th style={{ width: 40 }}>STT</th><th>Chương trình</th><th style={{ width: 80 }}>Số giờ</th><th style={{ width: 110 }}>Chỉ tiêu GV</th><th>Giảng viên</th>{edit && <th style={{ width: 120 }}></th>}</tr></thead>
        <tbody>{items.map((i, k) => <tr key={i.program_id}>
          <td>{k + 1}</td>
          <td style={{ whiteSpace: 'normal' }}><b>{i.training_programs?.title ?? '—'}</b><br /><small className="sub">{[i.training_programs?.code, i.training_programs?.ct_code].filter(Boolean).join(' · ')}</small></td>
          <td>{num(hoursOf(i.program_id))}</td>
          <td>{edit ? <input type="number" min={0} defaultValue={i.quota ?? ''} aria-label="Chỉ tiêu GV" style={{ width: 80 }}
            onBlur={e => { const v = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))); if (v !== i.quota) patchItem(i, { quota: v }) }} /> : i.quota ?? '—'}</td>
          <td>{edit ? <input defaultValue={i.trainer ?? ''} maxLength={200} aria-label="Giảng viên" placeholder="Họ tên giảng viên" style={{ width: '100%' }}
            onBlur={e => { const v = e.target.value.trim() || null; if (v !== i.trainer) patchItem(i, { trainer: v }) }} /> : i.trainer || '—'}</td>
          {edit && <td><div className="tools"><button type="button" aria-label="Chuyển lên" disabled={!k} onClick={() => move(k, -1)}>↑</button>
            <button type="button" aria-label="Chuyển xuống" disabled={k === items.length - 1} onClick={() => move(k, 1)}>↓</button>
            <button type="button" aria-label="Bỏ chương trình" onClick={() => run(supabase.from('training_plan_items').delete().eq('plan_id', i.plan_id).eq('program_id', i.program_id))}>×</button></div></td>}
        </tr>)}
          {!items.length && <tr><td colSpan={edit ? 6 : 5}><small className="sub">{p.pub_status === 'draft' ? 'Chưa chọn chương trình tập huấn nào.' : 'Kế hoạch cũ, chưa gắn chương trình tập huấn.'}</small></td></tr>}</tbody>
      </table></div>
      {edit && <div className="actions">
        <select value={pick} onChange={e => setPick(e.target.value)} aria-label="Chương trình tập huấn" style={{ flex: 1, minWidth: 240 }}>
          <option value="">{free.length ? '— Chọn chương trình tập huấn đã phát hành —' : progs.length ? 'Đã chọn hết chương trình' : 'Chưa có chương trình tập huấn nào được phát hành'}</option>
          {free.map(x => <option key={x.id} value={x.id}>{x.code} · {x.title} ({num(x.hours)} giờ)</option>)}</select>
        <button type="button" disabled={!pick} onClick={addItem}>+ Thêm chương trình</button>
      </div>}
    </section>

    {p.pub_status !== 'draft' && <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Trường được gán</h3>
        <small className="sub">{orgs.length} trường · {enr.length} giáo viên · {orgs.filter(o => o.status === 'submitted').length} chờ duyệt</small></div>
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Trường</th><th style={{ width: 100 }}>Chỉ tiêu</th><th>Giáo viên đã chọn</th><th>Trạng thái</th>{can && <th></th>}</tr></thead>
        <tbody>{sortedOrgs.map(o => { const es = enrOf(o.org_id); const over = o.quota != null && es.length > o.quota
          return [<tr key={o.org_id}>
            <td><b>{names.get(o.org_id) ?? '…'}</b></td>
            <td>{can && p.pub_status === 'published' ? <input type="number" min={0} defaultValue={o.quota ?? ''} aria-label="Chỉ tiêu của trường" style={{ width: 70 }}
              onBlur={e => { if ((e.target.value === '' ? null : Number(e.target.value)) !== o.quota && e.target.value !== '') setQuota(o, e.target.value) }} /> : o.quota ?? '—'}</td>
            <td><button type="button" className="linkbtn" onClick={() => setOpenOrg(openOrg === o.org_id ? null : o.org_id)}>{es.length} giáo viên {openOrg === o.org_id ? '▴' : '▾'}</button>
              {over && <><br /><small className="warnline">Vượt chỉ tiêu</small></>}</td>
            <td><Chip tone={ORG_ST[o.status][1]}>{ORG_ST[o.status][0]}</Chip>
              {o.status === 'returned' && o.note && <><br /><small className="sub">Lý do: {o.note}</small></>}
              {o.submitted_at && o.status === 'submitted' && <><br /><small className="sub">Gửi {new Date(o.submitted_at).toLocaleDateString('vi-VN')}</small></>}</td>
            {can && <td><div className="tools">
              {o.status === 'submitted' && <button type="button" className="primary" onClick={() => review(o, true)}>Duyệt</button>}
              {(o.status === 'submitted' || o.status === 'approved') && <button type="button" onClick={() => review(o, false)}>Trả lại</button>}
              <button type="button" onClick={() => unassign(o)}>Bỏ gán</button></div></td>}
          </tr>,
          openOrg === o.org_id && <tr key={o.org_id + ':list'}><td colSpan={can ? 5 : 4}>
            {es.length ? <ol style={{ margin: 0, paddingLeft: 20 }}>{es.sort((a, b) => (a.teachers?.full_name ?? '').localeCompare(b.teachers?.full_name ?? '', 'vi'))
              .map(e => <li key={e.teacher_id}>{e.teachers?.full_name}{e.teachers?.subject && <small className="sub"> · {e.teachers.subject}</small>}</li>)}</ol>
              : <small className="sub">Trường chưa chọn giáo viên.</small>}
          </td></tr>] })}
          {!orgs.length && <tr><td colSpan={can ? 5 : 4}><small className="sub">Chưa gán trường nào.{can && p.pub_status === 'published' && ' Bấm "Gán trường".'}</small></td></tr>}</tbody>
      </table></div>
    </section>}
    {p.pub_status !== 'draft' && enr.length > 0 && <PlanProgress planId={p.id} manage={can} />}
  </ElView>
}

// ===== Gán trường (view riêng) =====
function AssignSchools({ plan, taken, onBack, onDone }: { plan: TPlan; taken: Set<string>; onBack: () => void; onDone: (m: string) => void }) {
  const [schools, setSchools] = useState<{ id: string; name: string; parent: string | null }[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [quota, setQuota] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // RLS chỉ trả về trường trong phạm vi quản lý (KDI thấy mọi trường); RPC gán kiểm tra lại phạm vi
    supabase.from('organizations').select('id, name, parent:parent_id(name)').eq('type', 'school').order('name').then(({ data }) =>
      setSchools(((data ?? []) as unknown as { id: string; name: string; parent: { name: string } | null }[]).map(o => ({ id: o.id, name: o.name, parent: o.parent?.name ?? null }))))
  }, [])
  const shown = (schools ?? []).filter(s => !taken.has(s.id) && (!q || `${s.name} ${s.parent ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  async function save() {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('training_plan_assign', { p_plan: plan.id, p_orgs: [...sel], p_quota: quota === '' ? null : Math.max(0, Math.round(Number(quota))) })
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onDone(`Đã gán ${sel.size} trường. Trường sẽ thấy kế hoạch ở mục Kế hoạch tập huấn và chọn giáo viên.`)
  }
  return <ElView back={plan.name} onBack={onBack} title="Gán trường" sub={`${plan.plan_code} · chọn các trường tham gia kế hoạch`}
    actions={<button type="button" className="primary" disabled={!sel.size || busy} onClick={save}>Gán {sel.size || ''} trường</button>}>
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}>
        <div className="tools">
          <input placeholder="Tìm trường, đơn vị quản lý…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm trường" />
          <input type="number" min={0} value={quota} onChange={e => setQuota(e.target.value)} placeholder="Chỉ tiêu GV mỗi trường" title="Để trống = không giới hạn" style={{ width: 190 }} aria-label="Chỉ tiêu mỗi trường" />
        </div>
        <div className="tools"><button type="button" onClick={() => setSel(new Set(shown.map(s => s.id)))} disabled={!shown.length}>Chọn tất cả ({shown.length})</button>
          <button type="button" onClick={() => setSel(new Set())} disabled={!sel.size}>Bỏ chọn</button></div>
      </div>
      {err && <p className="msg">{err}</p>}
      {!schools ? <p className="sub">Đang tải…</p> : <div className="reggrid">
        {shown.map(s => <label className="roomrow" key={s.id}><span>{s.name}{s.parent && <><br /><small className="sub">{s.parent}</small></>}</span>
          <input type="checkbox" checked={sel.has(s.id)} onChange={e => { const n = new Set(sel); if (e.target.checked) n.add(s.id); else n.delete(s.id); setSel(n) }} /></label>)}
        {!shown.length && <small className="sub">{schools.length ? 'Không còn trường nào để gán.' : 'Không có trường nào trong phạm vi quản lý.'}</small>}
      </div>}
    </section>
  </ElView>
}

// ===== Trường: kế hoạch được giao, chọn giáo viên, gửi duyệt =====
type Assigned = POrg & { training_plans: TPlan | null }
export function SchoolTrainingAssigned({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Assigned[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [enr, setEnr] = useState<{ plan_id: string; teacher_id: string }[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [rk, setRk] = useState(0)
  useEffect(() => {
    (async () => {
      const a = await supabase.from('training_plan_orgs').select(`plan_id, org_id, quota, status, note, submitted_at, decided_at, training_plans(${SEL})`).eq('org_id', orgId)
      if (a.error) { setMsg([errText(a.error.message), true]); setRows([]); return }
      const r = ((a.data ?? []) as unknown as Assigned[]).filter(x => x.training_plans)
      const ids = r.map(x => x.plan_id)
      const [i, e] = ids.length ? await Promise.all([
        supabase.from('training_plan_items').select('plan_id, program_id, seq, quota, trainer, note, training_programs(code, title, ct_code)').in('plan_id', ids),
        supabase.from('training_enrollments').select('plan_id, teacher_id, teachers!inner(org_id)').in('plan_id', ids).eq('teachers.org_id', orgId),
      ]) : [{ data: [] }, { data: [] }]
      setRows(r.sort((x, y) => (y.training_plans!.year_name ?? '').localeCompare(x.training_plans!.year_name ?? '') || (x.training_plans!.plan_code ?? '').localeCompare(y.training_plans!.plan_code ?? '')))
      setItems((i.data as unknown as Item[]) ?? []); setEnr((e.data as unknown as { plan_id: string; teacher_id: string }[]) ?? [])
    })()
  }, [rk, orgId])
  const [fs, setFs] = useState<'' | 'todo' | 'sent'>('')
  const cur = open ? rows?.find(r => r.plan_id === open) : undefined
  if (cur) return <SchoolPlanTeachers row={cur} orgId={orgId} items={items.filter(i => i.plan_id === cur.plan_id)} onBack={() => { setOpen(null); setRk(k => k + 1) }}
    onMsg={m => { setMsg(m); setOpen(null); setRk(k => k + 1) }} />
  const n = (s: OrgSt) => (rows ?? []).filter(r => r.status === s).length
  return <>
    <div className="panel distintro">
      <ol className="distguide">{([['Nhận kế hoạch', 'KDI, Sở hoặc Phòng gán kế hoạch tập huấn cho trường, kèm chỉ tiêu giáo viên.'],
        ['Chọn giáo viên', 'Mở kế hoạch, đánh dấu giáo viên tham gia, không vượt chỉ tiêu.'],
        ['Gửi duyệt', 'Gửi danh sách lên. Bị trả lại thì sửa theo lý do rồi gửi lại.']] as [string, string][]).map(([h, d], k) =>
        <li key={h}><button type="button" onClick={() => setFs(k === 0 ? '' : k === 1 ? 'todo' : 'sent')}><i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
    </div>
    <div className="diststatcards">
      <div className="panel"><i aria-hidden="true">≋</i><span><b>{rows?.length ?? '…'}</b><small>Kế hoạch được giao</small></span></div>
      <div className="panel"><i aria-hidden="true" className={n('assigned') + n('returned') ? 'warn' : 'good'}>!</i><span><b>{n('assigned') + n('returned')}</b><small>Cần chọn giáo viên</small><small>{n('returned')} bị trả lại</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{n('approved')}</b><small>Đã duyệt</small><small>{n('submitted')} chờ duyệt</small></span></div>
    </div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Kế hoạch tập huấn</th><th>Năm học · đợt</th><th>Chương trình</th><th>Giáo viên / chỉ tiêu</th><th>Trạng thái</th></tr></thead>
      <tbody>{rows.filter(r => !fs || (fs === 'todo' ? r.status === 'assigned' || r.status === 'returned' : r.status === 'submitted' || r.status === 'approved')).map(r => { const p = r.training_plans!, its = items.filter(i => i.plan_id === r.plan_id).sort((a, b) => a.seq - b.seq), c = enr.filter(e => e.plan_id === r.plan_id).length
        return <tr key={r.plan_id}>
          <td><button type="button" className="namelink" onClick={() => { setMsg(null); setOpen(r.plan_id) }}>{p.name}</button><br /><small className="sub">{[p.plan_code, span(p), p.provider].filter(Boolean).join(' · ')}</small></td>
          <td>{[p.year_name, p.term && TERM[p.term]].filter(Boolean).join(' · ') || '—'}</td>
          <td style={{ whiteSpace: 'normal' }}>{its.map(i => i.training_programs?.title).join('; ') || '—'}</td>
          <td>{c}{r.quota != null && ` / ${r.quota}`} GV</td>
          <td><Chip tone={ORG_ST[r.status][1]}>{ORG_ST[r.status][0]}</Chip>{r.status === 'returned' && r.note && <><br /><small className="sub">Lý do: {r.note}</small></>}</td>
        </tr> })}
        {!rows.length && <tr><td colSpan={5}>Chưa có kế hoạch tập huấn nào được giao cho trường.</td></tr>}</tbody>
    </table></div>}
  </>
}

function SchoolPlanTeachers({ row, orgId, items, onBack, onMsg }: { row: Assigned; orgId: string; items: Item[]; onBack: () => void; onMsg: (m: [string, boolean]) => void }) {
  const p = row.training_plans!
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; subject: string | null }[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  async function load() {
    const [t, e] = await Promise.all([
      supabase.from('teachers').select('id, full_name, subject').eq('org_id', orgId).order('full_name'),
      supabase.from('training_enrollments').select('teacher_id, teachers!inner(org_id)').eq('plan_id', row.plan_id).eq('teachers.org_id', orgId),
    ])
    setTeachers((t.data as { id: string; full_name: string; subject: string | null }[]) ?? [])
    setChosen(new Set(((e.data ?? []) as { teacher_id: string }[]).map(x => x.teacher_id)))
  }
  useEffect(() => { load() }, [row.plan_id])
  const edit = row.status === 'assigned' || row.status === 'returned'
  const over = row.quota != null && chosen.size > row.quota
  async function toggle(id: string, on: boolean) {
    setMsg(null)
    const { error } = on ? await supabase.from('training_enrollments').insert({ org_id: orgId, plan_id: row.plan_id, teacher_id: id })
      : await supabase.from('training_enrollments').delete().eq('plan_id', row.plan_id).eq('teacher_id', id)
    if (error) setMsg([errText(error.message), true])
    load()
  }
  async function submit() {
    setBusy(true)
    const { error } = await supabase.rpc('training_plan_submit', { p_plan: row.plan_id, p_org: orgId })
    setBusy(false)
    if (error) return setMsg([errText(error.message), true])
    onMsg([`Đã gửi danh sách ${chosen.size} giáo viên để duyệt.`, false])
  }
  const shown = (teachers ?? []).filter(t => !q || `${t.full_name} ${t.subject ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return <ElView back="Kế hoạch được giao" onBack={onBack} title={p.name}
    sub={<>{p.plan_code} · <Chip tone={ORG_ST[row.status][1]}>{ORG_ST[row.status][0]}</Chip> · {chosen.size}{row.quota != null && ` / ${row.quota}`} giáo viên</>}
    actions={edit && <button type="button" className="primary" disabled={busy || !chosen.size || over} onClick={submit}>{row.status === 'returned' ? 'Gửi lại danh sách' : 'Gửi danh sách duyệt'}</button>}>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {row.status === 'returned' && row.note && <p className="warnline">Bị trả lại: {row.note}</p>}
    {row.status === 'submitted' && <p className="sub">Danh sách đã gửi, đang chờ duyệt. Muốn sửa thì nhờ đơn vị lập kế hoạch trả lại.</p>}
    {row.status === 'approved' && <p className="sub">Danh sách đã được duyệt.</p>}
    {over && <p className="warnline">Đã chọn {chosen.size} giáo viên, vượt chỉ tiêu {row.quota}.</p>}
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Thông tin kế hoạch</h3>
      <dl className="tpkv">
        <dt>Năm học · đợt</dt><dd>{[p.year_name, p.term && TERM[p.term]].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Thời gian</dt><dd>{span(p) || '—'}</dd>
        <dt>Hình thức</dt><dd>{MODE[p.mode] ?? p.mode}{p.provider ? ` · ${p.provider}` : ''}</dd>
        <dt>Chương trình</dt><dd>{items.length ? <ol style={{ margin: 0, paddingLeft: 18 }}>{[...items].sort((a, b) => a.seq - b.seq).map(i => <li key={i.program_id}>{i.training_programs?.title}{i.trainer && <small className="sub"> · GV: {i.trainer}</small>}</li>)}</ol> : '—'}</dd>
        {p.note && <><dt>Ghi chú</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.note}</dd></>}
      </dl>
    </section>
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Giáo viên tham gia</h3>
        <div className="tools"><input placeholder="Tìm giáo viên, môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo viên" />
          <small className="sub">Đã chọn {chosen.size}{row.quota != null && ` / ${row.quota}`}</small></div></div>
      {!teachers ? <p className="sub">Đang tải…</p> : <div className="reggrid">
        {shown.map(t => <label className="roomrow" key={t.id}><span>{t.full_name}{t.subject && <small className="sub"> · {t.subject}</small>}</span>
          <input type="checkbox" disabled={!edit} checked={chosen.has(t.id)} onChange={e => toggle(t.id, e.target.checked)} aria-label={`Chọn ${t.full_name}`} /></label>)}
        {!shown.length && <small className="sub">{teachers.length ? 'Không có giáo viên nào khớp.' : 'Trường chưa có giáo viên.'}</small>}
      </div>}
    </section>
    {chosen.size > 0 && <PlanProgress planId={row.plan_id} manage={false} />}
  </ElView>
}
