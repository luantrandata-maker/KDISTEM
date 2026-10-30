// Phân hệ 1 — Kế hoạch tập huấn (084, 101). Khuôn Phân phối chương trình: khung phân loại (mặc định chỉ cấp Chương trình, cấu hình thêm cấp),
// tạo kế hoạch trong một mục rồi soạn theo bước: Chọn chương trình → Xếp lịch (ngày, giờ, địa điểm) → Xem kết quả → Gán trường.
// Sau phát hành: gán trường → trường chọn giáo viên, gửi danh sách → đơn vị lập kế hoạch duyệt hoặc trả lại.
// TrainingPlansPage: KDI và Sở / Phòng (kế hoạch của đơn vị mình). SchoolTrainingAssigned: trường (kế hoạch được giao).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { OrgFilter, OrgPick, useAllMode, useOrgName, useProvinceOf } from '../../components/OrgScope'
import { MultiSelect } from '../../components/MultiSelect'
import { ElView } from '../../components/ElView'
import { Chip, STATUS } from '../dist/Editor'
import { ClsTree } from '../dist/ClsTree'
import { useCls, type ClsNode } from '../dist/cls'
import { Drawer } from '../../components/Drawer'
import { ScheduleStep, ResultStep, checks, useSchedule } from './PlanSchedule'
import { colorOf } from '../dist/Grid'
import type { Status } from '../dist/sched'
import { PlanProgress } from './Progress'
import { TrainerPick } from './Trainers'
import { PlanResults } from './ResultsWork'
import { PlanCal } from './PlanCal'
import { FlowGuide } from '../../components/FlowGuide'

type Mode = 'online' | 'offline' | 'hybrid'
type Term = 'summer' | 'hk1' | 'hk2' | 'other'
type OrgSt = 'assigned' | 'submitted' | 'approved' | 'returned'
export type TPlan = {
  id: string; org_id: string; plan_code: string | null; name: string; pub_status: Status; status: string; year_name: string | null; term: Term | null
  mode: Mode; provider: string | null; starts_on: string | null; ends_on: string | null; budget: number | null; note: string | null; hours: number | null
  updated_at: string; published_at: string | null; self_register?: boolean; register_until?: string | null; node_id: string | null; max_learners?: number | null
  register_approval?: boolean; closed_at?: string | null; close_note?: string | null
}
type Item = { plan_id: string; program_id: string; seq: number; quota: number | null; trainer: string | null; trainer_ids?: string[]; assistant?: string | null; assistant_ids?: string[]; note: string | null; units?: string[] | null
  training_programs: { code: string; title: string; ct_code: string | null } | null }
type POrg = { plan_id: string; org_id: string; quota: number | null; status: OrgSt; note: string | null; submitted_at: string | null; decided_at: string | null; invited_at?: string | null }
type PUnit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; hours: number; mode: 'online' | 'offline' | null }
type Prog = { id: string; code: string; title: string; ct_code: string | null; levels: string[] | null; status: string; version_no: number; family_id: string; hours: number; subjects: (PUnit & { contents: PUnit[] })[] }
type Enr = { plan_id: string; teacher_id: string; source?: string; units?: string[] | null; exempt_units?: string[]; teachers: { full_name: string; subject: string | null; org_id: string } | null }
type Reg = { plan_id: string; teacher_id: string; org_id: string; units: string[] | null; exempt_units: string[]; note: string | null; warnings: string[]
  status: 'pending' | 'waitlist' | 'accepted' | 'rejected' | 'cancelled'; reason: string | null; created_at: string; teachers: { full_name: string; subject: string | null } | null }
export const REG_ST: Record<Reg['status'], [string, string]> = { pending: ['Chờ duyệt', 'warn'], waitlist: ['Danh sách chờ', 'warn'], accepted: ['Đã nhận', 'good'], rejected: ['Không nhận', 'bad'], cancelled: ['Đã huỷ', ''] }
const RSEL = 'plan_id, teacher_id, org_id, units, exempt_units, note, warnings, status, reason, created_at, teachers(full_name, subject)'

const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const TERM: Record<Term, string> = { summer: 'Dịp hè', hk1: 'Học kỳ I', hk2: 'Học kỳ II', other: 'Khác' }
export const ORG_ST: Record<OrgSt, [string, string]> = { assigned: ['Chờ trường chọn GV', ''], submitted: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'good'], returned: ['Trả lại', 'bad'] }
const SEL = 'id, org_id, plan_code, name, pub_status, status, year_name, term, mode, provider, starts_on, ends_on, budget, note, hours, updated_at, published_at, self_register, register_until, node_id, max_learners, register_approval, closed_at, close_note'
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
/** Chương trình tập huấn đã phát hành, kèm phiên bản đã thay thế (kế hoạch cũ vẫn dùng): cây Môn → Nội dung, tổng giờ */
function usePrograms() {
  const [list, setList] = useState<Prog[]>([])
  useEffect(() => {
    (async () => {
      const [p, u] = await Promise.all([
        supabase.from('training_programs').select('id, code, title, ct_code, levels, status, version_no, family_id').in('status', ['published', 'superseded']).order('code'),
        supabase.from('training_program_units').select('id, program_id, parent_id, kind, seq, title, hours, mode'),
      ])
      const us = ((u.data ?? []) as PUnit[]).map(x => ({ ...x, hours: Number(x.hours) || 0 })).sort((a, b) => a.seq - b.seq)
      setList(((p.data ?? []) as Omit<Prog, 'hours' | 'subjects'>[]).map(x => {
        const subjects = us.filter(v => v.program_id === x.id && v.kind === 'subject').map(sj => ({ ...sj, contents: us.filter(v => v.parent_id === sj.id && v.kind === 'content') }))
        return { ...x, subjects, hours: subjects.reduce((a, sj) => a + sj.contents.reduce((b, c) => b + c.hours, 0), 0) }
      }))
    })()
  }, [])
  return list
}

// ===== Kế hoạch của đơn vị (KDI, Sở, Phòng): khung phân loại + danh sách =====
export function TrainingPlansPage({ orgId }: { orgId: string }) {
  const [list, setList] = useState<TPlan[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [orgs, setOrgs] = useState<POrg[]>([])
  const [can, setCan] = useState(false)
  const [rk, setRk] = useState(0)
  const [tab, setTab] = useState<'tree' | 'list'>('list')
  // Danh sách kế hoạch: xem dạng bảng hoặc dạng lịch (nhớ trên trình duyệt này)
  const [look, setLookS] = useState<'table' | 'cal'>(() => { try { return localStorage.getItem('tplan.look') === 'cal' ? 'cal' : 'table' } catch { return 'table' } })
  const setLook = (v: 'table' | 'cal') => { setLookS(v); try { localStorage.setItem('tplan.look', v) } catch { /* chỉ đổi trong phiên */ } }
  const [open, setOpen] = useState<string | null>(null)
  const [create, setCreate] = useState<{ node: ClsNode | null } | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [fs, setFs] = useState<Status | 'wait' | ''>('')
  const [q, setQ] = useState('')
  const [yr, setYr] = useState('')
  const [fp, setFp] = useState('')
  const cls = useCls('training')
  // Quản trị hệ thống: kế hoạch của mọi đơn vị trong một danh sách, sửa thẳng
  const all = useAllMode(), orgName = useOrgName()
  const [fo, setFo] = useState('')
  const reload = () => setRk(k => k + 1)
  useEffect(() => { supabase.rpc('training_can_write', { p_org: orgId }).then(({ data }) => setCan(!!data)) }, [orgId])
  useEffect(() => {
    (async () => {
      const base = supabase.from('training_plans').select(SEL)
      const p = await (all ? base : base.eq('org_id', orgId)).order('plan_code', { ascending: false })
      if (p.error) { setMsg([errText(p.error.message), true]); setList([]); return }
      const ids = ((p.data ?? []) as TPlan[]).map(x => x.id)
      const [i, o] = ids.length ? await Promise.all([
        supabase.from('training_plan_items').select('plan_id, program_id, seq, quota, trainer, trainer_ids, assistant, assistant_ids, note, units, training_programs(code, title, ct_code)').in('plan_id', ids),
        supabase.from('training_plan_orgs').select('plan_id, org_id, quota, status, note, submitted_at, decided_at').in('plan_id', ids),
      ]) : [{ data: [] }, { data: [] }]
      setList((p.data as TPlan[]) ?? []); setItems((i.data as unknown as Item[]) ?? []); setOrgs((o.data as POrg[]) ?? [])
    })()
  }, [rk, orgId])

  const wait = (id: string) => orgs.filter(o => o.plan_id === id && o.status === 'submitted').length
  const shown = useMemo(() => (list ?? []).filter(p => (!fs || (fs === 'wait' ? wait(p.id) > 0 : p.pub_status === fs)) && (!yr || p.year_name === yr) && (!fo || p.org_id === fo)
    && (!fp || items.some(i => i.plan_id === p.id && i.program_id === fp))
    && (!q || `${p.plan_code ?? ''} ${p.name} ${p.provider ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [list, orgs, items, fs, yr, q, fo, fp])

  if (open) return <PlanDetail key={open} id={open} can={can} onBack={() => { setOpen(null); reload() }} onMsg={m => { setMsg(m); reload() }} />

  const n = (s: Status) => (list ?? []).filter(p => p.pub_status === s).length
  const waiting = orgs.filter(o => o.status === 'submitted').length
  const years = [...new Set((list ?? []).map(p => p.year_name).filter(Boolean) as string[])].sort().reverse()
  const crumb = (p: TPlan) => cls.path(p.node_id).map(x => x.name).join(' › ') || 'Chưa phân loại'
  const table = (rows: TPlan[], empty: string) => <div className="wrap"><table className="libtable">
    <thead><tr><th>Kế hoạch tập huấn</th><th>Phân loại</th><th>Năm học · đợt</th><th>Chương trình</th><th>Trường</th><th>Trạng thái</th></tr></thead>
    <tbody>{rows.map(p => { const its = items.filter(i => i.plan_id === p.id), os = orgs.filter(o => o.plan_id === p.id), w = wait(p.id)
      return <tr key={p.id}>
        <td><button type="button" className="namelink" onClick={() => { setMsg(null); setOpen(p.id) }}>{p.name}</button><br /><small className="sub">{[all && orgName(p.org_id), p.plan_code, span(p)].filter(Boolean).join(' · ')}</small></td>
        <td><small>{crumb(p)}</small></td>
        <td>{[p.year_name, p.term && TERM[p.term]].filter(Boolean).join(' · ') || '—'}</td>
        <td style={{ whiteSpace: 'normal' }}>{its.length ? its.sort((a, b) => a.seq - b.seq).map(i => i.training_programs?.title).join('; ') : <small className="sub">{p.pub_status === 'draft' ? 'Chưa chọn' : 'Kế hoạch cũ'}</small>}
          {p.hours ? <><br /><small className="sub">{p.hours} giờ</small></> : null}</td>
        <td>{os.length ? <>{os.length} trường{w > 0 && <><br /><Chip tone="warn">{w} chờ duyệt</Chip></>}</> : '—'}</td>
        <td><Chip tone={STATUS[p.pub_status][1]}>{STATUS[p.pub_status][0]}</Chip>{p.closed_at && <><br /><Chip tone="off">Đã kết thúc</Chip></>}</td>
      </tr> })}
      {rows.length === 0 && <tr><td colSpan={6}>{empty}</td></tr>}</tbody>
  </table></div>
  const steps: [string, string][] = [
    ['Tạo kế hoạch', 'Chọn mục trong khung phân loại (cấp học, cấp độ…) rồi bấm “Lập kế hoạch tập huấn”.'],
    ['Chọn chương trình', 'Tick các chương trình tập huấn đã phát hành, chọn nội dung, chỉ tiêu và giảng viên.'],
    ['Xếp lịch', 'Chọn ngày, giờ học, địa điểm hoặc link họp; xếp tự động rồi chỉnh từng buổi.'],
    ['Xem kết quả & phát hành', 'Soát lịch theo ngày, cảnh báo trùng giờ; phát hành rồi gán trường.']]
  return (
    <>
      <FlowGuide id="training-plans">
        <ol className="distguide four">{steps.map(([h, d], k) => <li key={h}><button type="button" onClick={() => setTab('tree')}>
          <i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
        <p className="sub" style={{ margin: 0 }}>Kế hoạch tập huấn gom các chương trình tập huấn vào một đợt, xếp lịch học cụ thể rồi giao cho trường.</p>
      </FlowGuide>
      <div className="diststatcards">
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{list?.length ?? '…'}</b><small>Kế hoạch tập huấn</small><small>{n('published')} đã phát hành · {n('draft')} nháp</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">⌂</i><span><b>{new Set(orgs.map(o => o.org_id)).size}</b><small>Trường được gán</small><small>{orgs.filter(o => o.status === 'approved').length} danh sách đã duyệt</small></span></div>
        <div className="panel"><i aria-hidden="true" className={waiting ? 'warn' : 'good'}>!</i><span><b>{waiting}</b><small>Danh sách chờ duyệt</small></span></div>
      </div>
      <div className="distpills" role="tablist">
        {([['list', 'Danh sách kế hoạch'], ['tree', 'Khung phân loại']] as ['tree' | 'list', string][]).map(([t, l]) =>
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setMsg(null) }}>{l}</button>)}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {!list ? <p className="sub">Đang tải…</p> : tab === 'tree'
        ? <ClsTree scope="training" items={all && fo ? list.filter(p => p.org_id === fo) : list}
            header={({ sel, isFinal }) => <>
              <OrgFilter ids={list.map(p => p.org_id)} value={fo} onChange={setFo} />
              <select value={fp} onChange={e => setFp(e.target.value)} aria-label="Chương trình tập huấn"><option value="">Mọi chương trình</option>
                {[...new Map(items.map(i => [i.program_id, i.training_programs?.title ?? '—'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi')).map(([id, t]) => <option key={id} value={id}>{t}</option>)}</select>
              {can && isFinal && sel && <button type="button" className="primary" onClick={() => setCreate({ node: sel })}>+ Lập kế hoạch tập huấn</button>}</>}>
            {(rows, { isFinal, unsorted }) => table(rows, unsorted ? 'Không có kế hoạch nào.' : isFinal && can ? 'Chưa có kế hoạch nào trong mục này. Bấm “+ Lập kế hoạch tập huấn”.' : 'Chưa có kế hoạch nào trong mục này.')}
          </ClsTree>
        : <>
          <div className="distfilter">
            {([['', 'Tất cả', list.length], ['draft', 'Nháp', n('draft')], ['published', 'Đã phát hành', n('published')], ['wait', 'Có danh sách chờ duyệt', list.filter(p => wait(p.id)).length], ['archived', 'Ngừng dùng', n('archived')]] as [Status | 'wait' | '', string, number][]).map(([s, l, c]) =>
              <button key={l} type="button" className={'distfchip' + (fs === s ? ' on' : '')} aria-pressed={fs === s} onClick={() => setFs(s)}>{l} <b>{c}</b></button>)}
          </div>
          <div className="bar">
            <div className="tools">
              <input placeholder="Tìm mã, tên, đơn vị tập huấn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
              <select value={yr} onChange={e => setYr(e.target.value)} aria-label="Năm học"><option value="">Mọi năm học</option>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
              <OrgFilter ids={list.map(p => p.org_id)} value={fo} onChange={setFo} />
              <small className="sub">{shown.length}/{list.length} kế hoạch</small>
            </div>
            <div className="tools">
              <span className="segmented viewtoggle" role="group" aria-label="Kiểu xem">{([['table', 'Bảng'], ['cal', 'Lịch']] as const).map(([k, l]) =>
                <button key={k} type="button" className={look === k ? 'on' : ''} aria-pressed={look === k} onClick={() => setLook(k)}>{l}</button>)}</span>
              {can && <button type="button" className="primary" onClick={() => { setMsg(null); setCreate({ node: null }) }}>Lập kế hoạch tập huấn</button>}</div>
          </div>
          {look === 'cal' ? <PlanCal plans={shown} label={p => [all && orgName(p.org_id), p.plan_code].filter(Boolean).join(' · ')} onOpen={id => { setMsg(null); setOpen(id) }} />
            : table(shown, list.length ? 'Không có kế hoạch nào khớp bộ lọc.' : can ? 'Chưa có kế hoạch tập huấn nào. Bấm "Lập kế hoạch tập huấn".' : 'Chưa có kế hoạch tập huấn nào.')}
        </>}
      {create && <PlanCreate orgId={orgId} node={create.node} onClose={() => setCreate(null)} onSaved={id => { setCreate(null); reload(); setOpen(id) }} />}
    </>
  )
}

// ===== Thông tin kế hoạch =====
const BLANK = { name: '', year_name: '' as string, term: 'summer' as Term | '', mode: 'hybrid' as Mode, provider: '', starts_on: '', ends_on: '', budget: '' as string, note: '', max_learners: '' as string }
type Info = typeof BLANK
const toRow = (f: Info) => ({ name: f.name.trim(), year_name: f.year_name || null, term: f.term || null, mode: f.mode, provider: f.provider.trim() || null,
  starts_on: f.starts_on || null, ends_on: f.ends_on || null, budget: f.budget === '' ? null : Math.max(0, Math.round(Number(f.budget) || 0)), note: f.note.trim() || null,
  max_learners: f.max_learners === '' ? null : Math.max(1, Math.round(Number(f.max_learners) || 1)) })
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
    <label className="field"><span>Số lượng tối đa (GV, cả kế hoạch)</span><input type="number" min={1} value={f.max_learners} onChange={e => set({ ...f, max_learners: e.target.value })} placeholder="Để trống = không giới hạn" /></label>
    <label className="field" style={{ gridColumn: '1/-1' }}><span>Ghi chú</span><textarea rows={2} maxLength={2000} value={f.note} onChange={e => set({ ...f, note: e.target.value })} /></label>
    {badDates(f) && <p className="warnline" style={{ gridColumn: '1/-1' }}>Ngày kết thúc phải sau ngày bắt đầu.</p>}
  </div>
}

/** Mục ở cấp cuối của khung phân loại kế hoạch tập huấn (để chọn / đổi phân loại) */
function useFinalNodes() {
  const cls = useCls('training')
  const last = cls.active[cls.active.length - 1]
  return { cls, finals: last ? cls.nodes.filter(n => n.cls_level_id === last.id).map(n => ({ id: n.id, label: cls.path(n.id).map(x => x.name).join(' › ') })).sort((a, b) => a.label.localeCompare(b.label, 'vi')) : [] }
}

function PlanCreate({ orgId, node, onClose, onSaved }: { orgId: string; node: ClsNode | null; onClose: () => void; onSaved: (id: string) => void }) {
  const { cls, finals } = useFinalNodes()
  const [f, setF] = useState({ name: '', year_name: yearOptions()[1], node_id: node?.id ?? '' })
  const [org, setOrg] = useState(orgId)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('training_plans').insert({ name: f.name.trim(), year_name: f.year_name || null, node_id: f.node_id || null, mode: 'hybrid', term: 'summer',
      org_id: org, pub_status: 'draft', status: 'planned' }).select('id').single()
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onSaved((data as { id: string }).id)
  }
  return <Drawer title="Lập kế hoạch tập huấn" onClose={onClose} closeOnOutside={false}>
    <form className="formgrid" onSubmit={save}>
      <OrgPick kind="unit" value={org} onChange={setOrg} title="Đơn vị lập kế hoạch" />
      <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên kế hoạch tập huấn *</span><input autoFocus required maxLength={200} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="VD: Tập huấn STEM hè 2027 cho giáo viên THCS" /></label>
      <label className="field"><span>Năm học *</span><select value={f.year_name} onChange={e => setF({ ...f, year_name: e.target.value })}>{yearOptions().map(y => <option key={y} value={y}>{y}</option>)}</select></label>
      <label className="field"><span>Phân loại</span>{node ? <input disabled value={cls.path(node.id).map(x => x.name).join(' › ')} />
        : <select value={f.node_id} onChange={e => setF({ ...f, node_id: e.target.value })}><option value="">— Chưa phân loại —</option>{finals.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select>}</label>
      {err && <p className="msg" style={{ gridColumn: '1/-1' }}>{err}</p>}
      <div className="formactions" style={{ gridColumn: '1/-1' }}><button type="submit" className="primary" disabled={busy || !org || !f.name.trim()}>Tạo và soạn tiếp</button></div>
      <small className="sub" style={{ gridColumn: '1/-1' }}>Tạo xong thì soạn theo bước: chọn chương trình → xếp lịch → xem kết quả, rồi phát hành và gán trường.</small>
    </form>
  </Drawer>
}

// ===== Soạn kế hoạch theo bước: Chọn chương trình → Xếp lịch → Xem kết quả → Gán trường =====
type Step = 1 | 2 | 3 | 4 | 5
export function PlanDetail({ id, can, onBack, onMsg }: { id: string; can: boolean; onBack: () => void; onMsg: (m: [string, boolean]) => void }) {
  const [p, setP] = useState<TPlan | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [orgs, setOrgs] = useState<POrg[]>([])
  const [enr, setEnr] = useState<Enr[]>([])
  const [regs, setRegs] = useState<Reg[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [f, setF] = useState<Info | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [assign, setAssign] = useState(false)
  const [openOrg, setOpenOrg] = useState<string | null>(null)
  const [step, setStep] = useState<Step>(1)
  const [busy, setBusy] = useState(false)
  const progs = usePrograms()
  const { cls, finals } = useFinalNodes()
  async function load() {
    const [a, b, c, d, r] = await Promise.all([
      supabase.from('training_plans').select(SEL).eq('id', id).single(),
      supabase.from('training_plan_items').select('plan_id, program_id, seq, quota, trainer, trainer_ids, assistant, assistant_ids, note, units, training_programs(code, title, ct_code)').eq('plan_id', id).order('seq'),
      supabase.from('training_plan_orgs').select('plan_id, org_id, quota, status, note, submitted_at, decided_at, invited_at').eq('plan_id', id),
      supabase.from('training_enrollments').select('plan_id, teacher_id, source, units, exempt_units, teachers(full_name, subject, org_id)').eq('plan_id', id),
      supabase.from('training_registrations').select(RSEL).eq('plan_id', id),
    ])
    if (a.error) return setMsg([errText(a.error.message), true])
    const x = a.data as TPlan, os = (c.data as POrg[]) ?? []
    setP(x); setItems((b.data as unknown as Item[]) ?? []); setOrgs(os); setEnr((d.data as unknown as Enr[]) ?? []); setRegs((r.data as unknown as Reg[]) ?? [])
    setF({ name: x.name, year_name: x.year_name ?? '', term: x.term ?? '', mode: x.mode, provider: x.provider ?? '', starts_on: x.starts_on ?? '', ends_on: x.ends_on ?? '',
      budget: x.budget == null ? '' : String(x.budget), note: x.note ?? '', max_learners: x.max_learners == null ? '' : String(x.max_learners) })
    if (os.length) {
      const { data } = await supabase.from('organizations').select('id, name').in('id', os.map(o => o.org_id))
      setNames(new Map(((data ?? []) as { id: string; name: string }[]).map(o => [o.id, o.name])))
    }
  }
  useEffect(() => { load() }, [id])
  const sProgs = useMemo(() => progs.map(g => ({ id: g.id, code: g.code, title: g.title, ct_code: g.ct_code,
    subjects: g.subjects.map(sj => ({ id: sj.id, title: sj.title, hours: sj.hours, contents: sj.contents.map(c => ({ id: c.id, title: c.title, hours: c.hours, mode: c.mode })) })) })), [progs])
  const sched = useSchedule(p ?? { id, org_id: '', mode: 'hybrid', starts_on: null, ends_on: null }, items, sProgs)
  if (!p || !f) return <ElView back="Kế hoạch tập huấn" onBack={onBack} title="Đang tải…">{msg && <p className="msg">{msg[0]}</p>}</ElView>

  const edit = can && p.pub_status === 'draft'
  const editSched = can && p.pub_status !== 'archived'
  // Duyệt / từ chối đăng ký của GV (đơn vị tổ chức): danh sách chờ duyệt và danh sách chờ chỗ
  const reviewReg = (r: Reg, ok: boolean) => {
    const reason = ok ? null : prompt(`Lý do không duyệt ${r.teachers?.full_name ?? 'giáo viên'} (giáo viên sẽ nhận được thông báo):`)
    if (!ok && !reason?.trim()) return
    run(supabase.rpc('training_registration_review', { p_plan: r.plan_id, p_teacher: r.teacher_id, p_accept: ok, p_reason: reason }),
      ok ? `Đã duyệt ${r.teachers?.full_name ?? 'giáo viên'}. Giáo viên có tên tham gia và nhận được thông báo.` : 'Đã từ chối và báo cho giáo viên.')
  }
  const run = async (q: PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    const { error } = await q
    if (error) setMsg([errText(error.message), true]); else if (ok) setMsg([ok, false])
    await load()
    return !error
  }
  if (assign) return <AssignSchools plan={p} taken={new Set(orgs.map(o => o.org_id))} onBack={() => setAssign(false)}
    onDone={m => { setAssign(false); setMsg([m, false]); load() }} />

  const hoursOf = (i: Item) => { const g = progs.find(x => x.id === i.program_id); if (!g) return 0
    if (!i.units) return g.hours
    const pick = new Set(i.units); return g.subjects.reduce((a, sj) => a + sj.contents.filter(c => pick.has(c.id)).reduce((b, c) => b + c.hours, 0), 0) }
  const totalHours = items.reduce((a, i) => a + hoursOf(i), 0)
  const verOf = (i: Item) => { const g = progs.find(x => x.id === i.program_id); return g ? `v${g.version_no}` : '' }
  const newerOf = (i: Item) => { const g = progs.find(x => x.id === i.program_id)
    return g && g.status !== 'published' ? progs.find(x => x.family_id === g.family_id && x.status === 'published' && x.version_no > g.version_no) : undefined }
  const totalQuota = items.reduce((a, i) => a + (i.quota ?? 0), 0)
  const warn = [!p.year_name && 'chưa chọn năm học', !items.length && 'chưa chọn chương trình tập huấn'].filter(Boolean) as string[]
  const sc = checks(sched, p)
  const scErr = sc.filter(c => c.level === 'error')
  const scheduled = sched.rows.filter(r => r.date).length
  const enrOf = (org: string) => enr.filter(e => e.teachers?.org_id === org)
  // Chuyển chương trình trong kế hoạch sang phiên bản phát hành mới nhất (126)
  const upgrade = async (i: Item) => {
    const n = newerOf(i); if (!n) return
    if (!confirm(`Chuyển "${i.training_programs?.title ?? n.title}" trong kế hoạch sang phiên bản v${n.version_no}?\n\nNội dung đã chọn, buổi đã xếp và nội dung giáo viên đăng ký được nối sang nội dung cùng tên của v${n.version_no}. Nội dung không còn trong v${n.version_no} sẽ bỏ khỏi lựa chọn; buổi của nội dung đó giữ nguyên nhưng không gắn nội dung.`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('training_plan_item_upgrade', { p_plan: i.plan_id, p_program: i.program_id })
    setBusy(false)
    if (error) { setMsg([errText(error.message), true]); return }
    const d = data as { version: number; sessions: number; dropped: number }
    setMsg([`Đã chuyển sang v${d.version}.${d.sessions ? ` ${d.sessions} buổi đã xếp được nối nội dung.` : ''}${d.dropped ? ` ${d.dropped} nội dung không còn trong phiên bản mới: kiểm tra lại lịch.` : ''}`, false])
    await load()
  }
  const patchItem = (i: Item, v: Partial<Item>) => run(supabase.from('training_plan_items').update(v).eq('plan_id', i.plan_id).eq('program_id', i.program_id))
  // Chương trình gợi ý theo cấp học của mục phân loại
  const lvl = cls.path(p.node_id).map(n => n.edu_level).find(Boolean) ?? null
  const fits = (g: Prog) => !lvl || !g.levels?.length || g.levels.includes(lvl)
  async function toggleProg(g: Prog, on: boolean) {
    if (on) await run(supabase.from('training_plan_items').insert({ plan_id: p!.id, program_id: g.id, seq: items.reduce((m, i) => Math.max(m, i.seq), 0) + 1 }))
    else if (confirm(`Bỏ chương trình "${g.title}" khỏi kế hoạch? Lịch đã xếp của chương trình này cần xoá ở bước Xếp lịch.`)) await run(supabase.from('training_plan_items').delete().eq('plan_id', p!.id).eq('program_id', g.id))
  }
  async function move(k: number, d: -1 | 1) {
    const a = items[k], b = items[k + d]; if (!b) return
    await supabase.from('training_plan_items').update({ seq: b.seq }).eq('plan_id', a.plan_id).eq('program_id', a.program_id)
    await run(supabase.from('training_plan_items').update({ seq: a.seq }).eq('plan_id', b.plan_id).eq('program_id', b.program_id))
  }
  async function saveSched() {
    setBusy(true)
    const e = await sched.save()
    setBusy(false)
    if (e) return setMsg([e, true])
    setMsg([`Đã lưu lịch tập huấn.`, false]); load()
  }
  async function setStatus(s: Status, ok: string) {
    if (s === 'published' && sched.dirty) await saveSched()
    if (await run(supabase.from('training_plans').update({ pub_status: s }).eq('id', p!.id), ok)) onMsg([ok, false])
  }
  // Kết thúc kế hoạch (118): chốt điểm danh các buổi, đóng đăng ký, báo GV; kết quả và chứng chỉ vẫn làm tiếp ở bước 5
  async function closePlan() {
    const note = prompt('Kết thúc kế hoạch tập huấn?\n\nHệ thống chốt điểm danh mọi buổi (chưa điểm danh = vắng), đóng đăng ký, không ghi danh thêm và báo cho giáo viên có tên. Kết quả, chứng chỉ vẫn làm tiếp ở bước 5. Mở lại được nếu cần.\n\nGhi chú (không bắt buộc):', '')
    if (note === null) return
    const { data, error } = await supabase.rpc('training_plan_close', { p_plan: p!.id, p_note: note.trim() || null })
    if (error) { setMsg([errText(error.message), true]); return }
    const r = data as { enrolled: number; passed: number; failed: number; pending: number }
    setMsg([`Đã kết thúc kế hoạch: ${r.enrolled} giáo viên · ${r.passed} Đạt · ${r.failed} Chưa đạt · ${r.pending} chưa kết luận. Chuyển sang bước 5 để kết luận và cấp chứng chỉ.`, false])
    setStep(5); load()
  }
  async function reopenPlan() {
    if (!confirm('Mở lại kế hoạch đã kết thúc? Tự đăng ký vẫn tắt, bật lại ở bước 4 nếu cần.')) return
    run(supabase.rpc('training_plan_reopen', { p_plan: p!.id }), 'Đã mở lại kế hoạch.')
  }
  async function del() {
    if (!confirm(`Xoá bản nháp "${p!.name}"? Lịch đã xếp cũng bị xoá.`)) return
    await supabase.from('training_sessions').delete().eq('plan_id', p!.id)
    const { error } = await supabase.from('training_plans').delete().eq('id', p!.id)
    if (error) return setMsg([errText(error.message), true])
    onMsg(['Đã xoá bản nháp.', false]); onBack()
  }
  const leave = () => { if (!sched.dirty || confirm('Lịch đang có thay đổi chưa lưu. Rời đi và bỏ thay đổi?')) onBack() }
  const review = (o: POrg, ok: boolean) => {
    const note = ok ? null : prompt(`Lý do trả lại danh sách của ${names.get(o.org_id) ?? 'trường'}:`)
    if (!ok && !note?.trim()) return
    run(supabase.rpc('training_plan_review', { p_plan: p!.id, p_org: o.org_id, p_approve: ok, p_note: note }), ok ? 'Đã duyệt danh sách.' : 'Đã trả lại danh sách cho trường.')
  }
  const unassign = (o: POrg) => confirm(`Bỏ gán ${names.get(o.org_id) ?? 'trường'}? ${enrOf(o.org_id).length} giáo viên đã chọn cũng bị bỏ khỏi kế hoạch.`)
    && run(supabase.rpc('training_plan_unassign', { p_plan: p!.id, p_org: o.org_id }), 'Đã bỏ gán trường.')
  const setQuota = (o: POrg, v: string) => run(supabase.rpc('training_plan_assign', { p_plan: p!.id, p_orgs: [o.org_id], p_quota: v === '' ? null : Number(v) }))
  const outside = enr.filter(e => !orgs.some(o => o.org_id === e.teachers?.org_id))
  const removeEnr = (e: Enr) => confirm(`Bỏ ${e.teachers?.full_name ?? 'giáo viên'} khỏi kế hoạch?`)
    && run(supabase.from('training_enrollments').delete().eq('plan_id', e.plan_id).eq('teacher_id', e.teacher_id), `Đã bỏ ${e.teachers?.full_name ?? 'giáo viên'} khỏi kế hoạch.`)
  const sortedOrgs = [...orgs].sort((a, b) => (a.status === 'submitted' ? 0 : 1) - (b.status === 'submitted' ? 0 : 1) || (names.get(a.org_id) ?? '').localeCompare(names.get(b.org_id) ?? '', 'vi'))
  const crumbTxt = cls.path(p.node_id).map(n => n.name).join(' › ') || 'Chưa phân loại'
  const validity = !items.length ? null : scErr.length ? <Chip tone="bad">⊗ {scErr.length} lỗi lịch</Chip> : sc.length ? <Chip tone="warn">⚠ {sc.length} lưu ý</Chip> : <Chip tone="good">✓ Lịch hợp lệ</Chip>

  const head = <div className="disthead">
    <button type="button" className="distback" onClick={leave}>← Kế hoạch tập huấn</button>
    <span className="distcrumb">{crumbTxt} · {p.plan_code}</span>
    <span className="distheadright">
      <Chip tone={STATUS[p.pub_status][1]}>{STATUS[p.pub_status][0]}</Chip>
      {p.closed_at && <Chip tone="off">Đã kết thúc {new Date(p.closed_at).toLocaleDateString('vi-VN')}</Chip>}
      {editSched && (sched.dirty ? <Chip tone="warn">Lịch chưa lưu</Chip> : <Chip tone="good">Đã lưu</Chip>)}
      {validity}
      {editSched && <button type="button" disabled={!sched.dirty || busy} onClick={sched.reset}>Hủy thay đổi</button>}
      {editSched && <button type="button" className={sched.dirty ? 'primary' : ''} disabled={!sched.dirty || busy} onClick={saveSched}>{busy ? 'Đang lưu…' : 'Lưu lịch'}</button>}
      {can && p.pub_status === 'draft' && <button type="button" className="primary" disabled={warn.length > 0 || scErr.length > 0 || busy}
        title={warn.length ? 'Chưa phát hành được: ' + warn.join('; ') : scErr.length ? 'Lịch còn lỗi' : undefined} onClick={() => setStatus('published', `Đã phát hành ${p.plan_code}.`)}>Phát hành</button>}
      {can && p.pub_status === 'published' && <button type="button" className="primary" onClick={() => { setStep(4); setAssign(true) }}>Gán trường</button>}
      {can && <details className="distmore"><summary aria-label="Thao tác khác">···</summary><div className="distmenu">
        {p.pub_status === 'published' && !p.closed_at && <button type="button" onClick={closePlan}>Kết thúc kế hoạch</button>}
        {p.closed_at && <button type="button" onClick={reopenPlan}>Mở lại kế hoạch</button>}
        {p.pub_status === 'published' && !orgs.length && <button type="button" onClick={() => setStatus('draft', 'Đã chuyển về nháp.')}>Chuyển về nháp</button>}
        {p.pub_status === 'published' && <button type="button" onClick={() => confirm('Ngừng dùng kế hoạch này? Trường đã gán vẫn giữ danh sách.') && setStatus('archived', 'Đã chuyển sang Ngừng dùng.')}>Ngừng dùng</button>}
        {p.pub_status === 'archived' && <button type="button" onClick={() => setStatus('published', 'Đã dùng lại kế hoạch.')}>Dùng lại</button>}
        {p.pub_status === 'draft' && <button type="button" className="danger" onClick={del}>Xoá kế hoạch</button>}
      </div></details>}
    </span>
  </div>

  return <div className="panel distpanel">
    {head}
    {p.closed_at && <p className="sub" style={{ margin: '0 0 8px' }}>Kế hoạch đã kết thúc ngày {new Date(p.closed_at).toLocaleDateString('vi-VN')}: đã chốt điểm danh, không nhận đăng ký, ghi danh thêm.{p.close_note ? ` Ghi chú: ${p.close_note}` : ''}</p>}
    {edit ? <input className="disttitlein" defaultValue={p.name} maxLength={200} aria-label="Tên kế hoạch" onFocus={e => e.target.select()}
      onBlur={e => { const v = e.target.value.trim(); if (v && v !== p.name) run(supabase.from('training_plans').update({ name: v }).eq('id', p.id)); else e.target.value = p.name }} />
      : <h2 className="disttitle">{p.name}</h2>}
    <p className="sub" style={{ margin: '0 0 8px' }}>{[p.year_name, p.term && TERM[p.term], span(p), p.provider].filter(Boolean).join(' · ') || 'Chưa nhập năm học, thời gian'}</p>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {edit && warn.length > 0 && <p className="warnline">Chưa phát hành được: {warn.join('; ')}.</p>}
    {can && p.pub_status === 'published' && <p className="sub">{orgs.length ? 'Kế hoạch đã gán cho trường: không thêm, bỏ chương trình được (vẫn chuyển được sang phiên bản mới của chương trình), lịch vẫn chỉnh được.' : 'Muốn đổi chương trình thì vào ··· › "Chuyển về nháp" (khi chưa gán trường). Lịch vẫn chỉnh được.'}</p>}
    <ol className="diststeps five">
      {([[1, 'Chọn chương trình', `${items.length} chương trình · ${num(totalHours)} giờ`],
        [2, 'Xếp lịch', items.length ? `${scheduled}/${sched.rows.length} buổi đã xếp` : 'Chưa có nội dung'],
        [3, 'Xem kết quả', `${new Set(sched.rows.filter(r => r.date).map(r => r.date)).size} ngày · ${scErr.length ? scErr.length + ' lỗi' : sc.length + ' lưu ý'}`],
        [4, 'Gán trường & giáo viên', p.pub_status === 'draft' ? 'Sau khi phát hành' : `${orgs.length} trường · ${enr.length}${p.max_learners ? `/${p.max_learners}` : ''} GV`],
        [5, 'Kết quả & chứng chỉ', p.pub_status === 'draft' ? 'Sau khi phát hành' : 'Chấm điểm, kết luận, cấp chứng chỉ']] as [Step, string, string][]).map(([k, t, sub]) =>
        <li key={k}><button type="button" className={step === k ? 'on' : ''} aria-current={step === k ? 'step' : undefined} onClick={() => setStep(k)}>
          <i>{k}</i><span><b>{t}</b><small>{sub}</small></span></button></li>)}
    </ol>

    {step === 1 && <>
      <details className="panel tpinfo" open={!p.year_name}>
        <summary><b>Thông tin kế hoạch</b> <small className="sub">năm học, đợt, hình thức, thời gian, kinh phí, phân loại</small></summary>
        {edit ? <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <InfoFields f={f} set={setF} />
          <label className="field"><span>Phân loại</span><select value={p.node_id ?? ''} onChange={e => run(supabase.from('training_plans').update({ node_id: e.target.value || null }).eq('id', p.id), 'Đã đổi phân loại.')}>
            <option value="">— Chưa phân loại —</option>{finals.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
          <div className="formactions"><button type="button" className="primary" disabled={!f.name.trim() || badDates(f)} onClick={() => run(supabase.from('training_plans').update(toRow(f)).eq('id', p.id), 'Đã lưu thông tin.')}>Lưu thông tin</button></div>
        </div> : <dl className="tpkv" style={{ marginTop: 12 }}>
          <dt>Phân loại</dt><dd>{crumbTxt}</dd>
          <dt>Năm học · đợt</dt><dd>{[p.year_name, p.term && TERM[p.term]].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>Thời gian</dt><dd>{span(p) || '—'}</dd>
          <dt>Hình thức</dt><dd>{MODE[p.mode] ?? p.mode}</dd>
          <dt>Đơn vị tập huấn</dt><dd>{p.provider || '—'}</dd>
          <dt>Kinh phí dự kiến</dt><dd>{money(p.budget)}</dd>
          <dt>Số lượng tối đa</dt><dd>{p.max_learners ? `${p.max_learners} giáo viên` : 'Không giới hạn'}</dd>
          {p.note && <><dt>Ghi chú</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.note}</dd></>}
        </dl>}
      </details>
      <div className={edit ? "tppick" : ""}>
        {edit && <div>
          <p className="distpickhead"><b>Chương trình tập huấn đã phát hành</b> <span className="sub">{lvl ? `ưu tiên chương trình dùng cho ${cls.path(p.node_id).find(n => n.edu_level)?.name}` : 'tick để thêm vào kế hoạch'}</span></p>
          {[...progs].filter(g => g.status === 'published').sort((a, b) => Number(fits(b)) - Number(fits(a))).map(g => { const on = items.some(i => i.program_id === g.id)
            return <div key={g.id} className={'distprogcard' + (on ? ' on' : '') + (fits(g) ? '' : ' off')}>
              <label className="distproghead"><input type="checkbox" checked={on} onChange={() => toggleProg(g, !on)} />
                <span>{g.ct_code && <Chip tone="ct">{g.ct_code}</Chip>} <b>{g.code} · {g.title}</b><br />
                  <small className="sub">{g.subjects.length} môn · {g.subjects.reduce((a, sj) => a + sj.contents.length, 0)} nội dung · {num(g.hours)} giờ{!fits(g) ? ' · khác cấp học' : ''}</small></span></label>
            </div> })}
          {!progs.some(g => g.status === 'published') && <p className="sub">Chưa có chương trình tập huấn nào được phát hành.</p>}
        </div>}
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Chương trình trong kế hoạch</h3><small className="sub">{items.length} chương trình · {num(totalHours)} giờ{totalQuota ? ` · chỉ tiêu ${totalQuota} GV` : ''}</small></div>
          <div className="wrap"><table className="libtable">
            <thead><tr><th style={{ width: 40 }}>STT</th><th>Chương trình</th><th style={{ width: 70 }}>Số giờ</th><th style={{ width: 100 }}>Chỉ tiêu GV</th><th>Giảng viên</th><th>Trợ giảng</th>{edit && <th style={{ width: 90 }}></th>}</tr></thead>
            <tbody>{items.map((i, k) => <tr key={i.program_id}>
              <td>{k + 1}</td>
              <td style={{ whiteSpace: 'normal' }}><i className="tpdot" style={{ background: colorOf(k) }} /><b>{i.training_programs?.title ?? '—'}</b><br /><small className="sub">{[i.training_programs?.code, verOf(i), i.training_programs?.ct_code].filter(Boolean).join(' · ')}</small>
                {newerOf(i) && <div className="tpnewer"><small className={p.pub_status === 'draft' ? 'holwarn' : 'sub'}>Đã có phiên bản mới v{newerOf(i)!.version_no}. Kế hoạch vẫn dùng v{progs.find(x => x.id === i.program_id)?.version_no} bình thường{p.pub_status === 'draft' ? ', nhưng cần chuyển sang bản mới trước khi phát hành' : ''}.</small>
                  {can && p.pub_status !== 'archived' && !p.closed_at && <button type="button" disabled={busy} onClick={() => upgrade(i)}>Chuyển sang v{newerOf(i)!.version_no}</button>}</div>}
                <UnitPick prog={progs.find(x => x.id === i.program_id)} value={i.units ?? null} edit={edit} onSave={v => patchItem(i, { units: v })} /></td>
              <td>{num(hoursOf(i))}</td>
              <td>{edit ? <input type="number" min={0} defaultValue={i.quota ?? ''} aria-label="Chỉ tiêu GV" style={{ width: 76 }}
                onBlur={e => { const v = e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))); if (v !== i.quota) patchItem(i, { quota: v }) }} /> : i.quota ?? '—'}</td>
              <td style={{ minWidth: 200, whiteSpace: 'normal' }}>{edit ? <TrainerPick orgId={p.org_id} value={i.trainer_ids ?? []} ariaLabel={`Giảng viên ${i.training_programs?.title ?? ''}`}
                onChange={ids => patchItem(i, { trainer_ids: ids, trainer: null })} /> : i.trainer || '—'}
                {edit && !i.trainer_ids?.length && i.trainer && <small className="sub">Đang ghi tay: {i.trainer}</small>}</td>
              <td style={{ minWidth: 180, whiteSpace: 'normal' }}>{edit ? <TrainerPick orgId={p.org_id} value={i.assistant_ids ?? []} ariaLabel={`Trợ giảng ${i.training_programs?.title ?? ''}`} placeholder="Chọn trợ giảng…"
                onChange={ids => patchItem(i, { assistant_ids: ids })} /> : i.assistant || '—'}</td>
              {edit && <td><div className="tools"><button type="button" aria-label="Chuyển lên" disabled={!k} onClick={() => move(k, -1)}>↑</button>
                <button type="button" aria-label="Chuyển xuống" disabled={k === items.length - 1} onClick={() => move(k, 1)}>↓</button></div></td>}
            </tr>)}
              {!items.length && <tr><td colSpan={edit ? 7 : 6}><small className="sub">{edit ? 'Tick chương trình bên trái để thêm vào kế hoạch.' : 'Kế hoạch chưa gắn chương trình tập huấn.'}</small></td></tr>}</tbody>
          </table></div>
          <button type="button" className="primary" style={{ justifySelf: 'end' }} disabled={!items.length} onClick={() => setStep(2)}>Tiếp tục: Xếp lịch →</button>
        </div>
      </div>
    </>}
    {step === 2 && <ScheduleStep s={sched} plan={p} edit={editSched} onNext={() => setStep(3)} />}
    {step === 3 && <>
      <ResultStep s={sched} plan={p} />
      {can && p.pub_status === 'draft' && <div className="formactions" style={{ textAlign: 'right' }}>
        <button type="button" onClick={() => setStep(2)}>← Sửa lịch</button>
        <button type="button" className="primary" disabled={warn.length > 0 || scErr.length > 0 || busy} onClick={() => setStatus('published', `Đã phát hành ${p.plan_code}.`)}>{sched.dirty ? 'Lưu lịch và phát hành' : 'Phát hành kế hoạch'}</button></div>}
      {p.pub_status === 'published' && <div className="formactions" style={{ textAlign: 'right' }}><button type="button" className="primary" onClick={() => setStep(4)}>Tiếp tục: Gán trường →</button></div>}
    </>}
    {step === 4 && (p.pub_status === 'draft' ? <p className="sub">Phát hành kế hoạch ở bước 3 trước, rồi gán trường và mở cho giáo viên đăng ký.</p> : <div style={{ display: 'grid', gap: 12 }}>
      <SelfRegister p={p} can={can} regs={regs} orgs={orgs} names={names} onSave={(v, ok) => run(supabase.from('training_plans').update(v).eq('id', p.id), ok)}
        onInvite={() => load()} onReview={reviewReg} />
      <Capacity p={p} can={can} enr={enr.length} regs={regs} orgs={orgs} names={names}
        onSave={v => run(supabase.from('training_plans').update({ max_learners: v }).eq('id', p.id), v ? `Đã đặt số lượng tối đa ${v} giáo viên.` : 'Đã bỏ giới hạn số lượng.')}
        onReview={reviewReg} />
      {can && p.pub_status === 'published' && <DirectAdd planId={p.id} enr={enr} onDone={m => { setMsg(m); load() }} />}
      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Trường được gán</h3>
          <div className="tools"><small className="sub">{orgs.length} trường · {enr.length} giáo viên · {orgs.filter(o => o.status === 'submitted').length} chờ duyệt</small>
            {can && p.pub_status === 'published' && <button type="button" className="primary" onClick={() => setAssign(true)}>Gán trường</button>}</div></div>
        <div className="wrap"><table className="libtable">
          <thead><tr><th>Trường</th><th style={{ width: 100 }}>Chỉ tiêu</th><th>Giáo viên đã chọn</th><th>Trạng thái</th>{can && <th></th>}</tr></thead>
          <tbody>{sortedOrgs.map(o => { const es = enrOf(o.org_id); const over = o.quota != null && es.length > o.quota
            const pend = regs.filter(r => r.org_id === o.org_id && r.status === 'pending').length
            return [<tr key={o.org_id}>
              <td><b>{names.get(o.org_id) ?? '…'}</b></td>
              <td>{can && p.pub_status === 'published' ? <input type="number" min={0} defaultValue={o.quota ?? ''} aria-label="Chỉ tiêu của trường" style={{ width: 70 }}
                onBlur={e => { if ((e.target.value === '' ? null : Number(e.target.value)) !== o.quota && e.target.value !== '') setQuota(o, e.target.value) }} /> : o.quota ?? '—'}</td>
              <td><button type="button" className="linkbtn" onClick={() => setOpenOrg(openOrg === o.org_id ? null : o.org_id)}>{es.length} giáo viên {openOrg === o.org_id ? '▴' : '▾'}</button>
                {over && <><br /><small className="warnline">Vượt chỉ tiêu</small></>}
                {pend > 0 && <><br /><Chip tone="warn">{pend} GV đăng ký chờ duyệt</Chip></>}
                {o.quota != null && !over && es.length + pend >= o.quota && <><br /><small className="sub">Đủ chỉ tiêu</small></>}</td>
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
                .map(e => <li key={e.teacher_id}>{e.teachers?.full_name}{e.teachers?.subject && <small className="sub"> · {e.teachers.subject}</small>}
                  {e.source === 'self' && <small className="sub"> · tự đăng ký</small>}
                  {e.source === 'admin' && <small className="sub"> · đơn vị lập kế hoạch thêm</small>}
                  {can && <button type="button" className="linkbtn" style={{ marginLeft: 8 }} onClick={() => removeEnr(e)}>Bỏ</button>}
                  {(e.units || e.exempt_units?.length) ? <small className="sub"> · {e.units ? `học ${e.units.length} nội dung` : 'học toàn bộ'}{e.exempt_units?.length ? `, miễn ${e.exempt_units.length}` : ''}</small> : null}</li>)}</ol>
                : <small className="sub">Trường chưa chọn giáo viên.</small>}
            </td></tr>] })}
            {!orgs.length && <tr><td colSpan={can ? 5 : 4}><small className="sub">Chưa gán trường nào.{can && p.pub_status === 'published' && ' Bấm "Gán trường".'}</small></td></tr>}</tbody>
        </table></div>
      </section>
      {outside.length > 0 && <section className="panel" style={{ display: 'grid', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Ghi danh ngoài trường được gán</h3>
        <small className="sub">Người được ghi danh trực tiếp, không thuộc trường nào trong danh sách trên (ví dụ cán bộ của đơn vị lập kế hoạch).</small>
        <ol style={{ margin: 0, paddingLeft: 20 }}>{outside.map(e => <li key={e.teacher_id}>{e.teachers?.full_name ?? '…'}{e.teachers?.subject && <small className="sub"> · {e.teachers.subject}</small>}
          {can && <button type="button" className="linkbtn" style={{ marginLeft: 8 }} onClick={() => removeEnr(e)}>Bỏ</button>}</li>)}</ol>
      </section>}
      {enr.length > 0 && <PlanProgress planId={p.id} manage={can} />}
      {enr.length > 0 && <div className="formactions" style={{ textAlign: 'right' }}><button type="button" className="primary" onClick={() => setStep(5)}>Tiếp tục: Kết quả & chứng chỉ →</button></div>}
    </div>)}
    {step === 5 && (p.pub_status === 'draft' ? <p className="sub">Phát hành kế hoạch và ghi danh giáo viên trước, rồi chấm kết quả và cấp chứng chỉ ở đây.</p>
      : <PlanResults plan={p} embedded />)}
  </div>
}

// ===== Đơn vị lập kế hoạch thêm thẳng giáo viên (104): chọn duyệt luôn hoặc để chờ duyệt; tự ghi danh mình =====
type PoolT = { id: string; full_name: string; subject: string | null; enrolled: boolean }
function DirectAdd({ planId, enr, onDone }: { planId: string; enr: Enr[]; onDone: (m: [string, boolean]) => void }) {
  const [schools, setSchools] = useState<{ org_id: string; name: string; assigned: boolean }[]>([])
  const [org, setOrg] = useState('')
  const [pool, setPool] = useState<PoolT[] | null>(null)
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [approve, setApprove] = useState(true)
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('training_plan_schools', { p_plan: planId }).then(({ data }) => setSchools((data ?? []) as { org_id: string; name: string; assigned: boolean }[]))
  }, [planId])
  useEffect(() => { supabase.rpc('my_teacher_id').then(({ data }) => setMe((data as string | null) ?? null)) }, [planId, enr.length])
  useEffect(() => {
    setPick(new Set())
    if (!org) return setPool(null)
    setPool(null)
    supabase.rpc('training_plan_teacher_pool', { p_plan: planId, p_org: org }).then(({ data }) => setPool((data ?? []) as PoolT[]))
  }, [org, planId, enr.length])
  const meIn = !!me && enr.some(e => e.teacher_id === me)
  const shown = (pool ?? []).filter(t => !q || `${t.full_name} ${t.subject ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const free = shown.filter(t => !t.enrolled)
  async function add() {
    setBusy(true)
    const { data, error } = await supabase.rpc('training_plan_add_teachers', { p_plan: planId, p_teachers: [...pick], p_approve: approve })
    setBusy(false)
    if (error) return onDone([errText(error.message), true])
    onDone([`Đã thêm ${data ?? pick.size} giáo viên${approve ? ', danh sách đã duyệt' : ', danh sách đang chờ duyệt'}.`, false])
  }
  async function addMe() {
    setBusy(true)
    const { error } = await supabase.rpc('training_plan_add_me', { p_plan: planId, p_approve: true })
    setBusy(false)
    onDone(error ? [errText(error.message), true] : ['Đã ghi danh anh/chị vào kế hoạch. Chuyển sang vai trò Giáo viên để xem lịch, học và quét QR điểm danh.', false])
  }
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Thêm giáo viên trực tiếp</h3>
      <div className="tools">{meIn ? <Chip tone="good">✓ Bạn đã có tên trong kế hoạch</Chip>
        : <button type="button" disabled={busy} onClick={addMe}>Ghi danh tôi vào khoá này</button>}</div></div>
    <small className="sub">Chọn giáo viên của bất kỳ trường nào, không cần chờ trường gửi danh sách. Trường chưa được gán sẽ tự được gán.</small>
    <div className="tools" style={{ flexWrap: 'wrap' }}>
      <select value={org} onChange={e => setOrg(e.target.value)} aria-label="Trường">
        <option value="">Chọn trường…</option>
        {schools.map(s => <option key={s.org_id} value={s.org_id}>{s.name}{s.assigned ? ' (đã gán)' : ''}</option>)}
      </select>
      {org && <input placeholder="Tìm giáo viên, môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo viên" />}
      {org && free.length > 0 && <button type="button" onClick={() => setPick(pick.size === free.length ? new Set() : new Set(free.map(t => t.id)))}>{pick.size === free.length ? 'Bỏ chọn' : `Chọn cả ${free.length}`}</button>}
    </div>
    {org && (!pool ? <p className="sub">Đang tải…</p> : <div className="reggrid">
      {shown.map(t => <label className="roomrow" key={t.id}><span>{t.full_name}{t.subject && <small className="sub"> · {t.subject}</small>}
        {t.enrolled && <small className="sub" style={{ display: 'block' }}>Đã có tên</small>}</span>
        <input type="checkbox" disabled={t.enrolled} checked={t.enrolled || pick.has(t.id)} aria-label={`Chọn ${t.full_name}`}
          onChange={e => setPick(x => { const n = new Set(x); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n })} /></label>)}
      {!shown.length && <small className="sub">{pool.length ? 'Không có giáo viên nào khớp.' : 'Trường chưa có giáo viên.'}</small>}
    </div>)}
    {org && <div className="tools" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <label className="tpcheck"><input type="checkbox" checked={approve} onChange={e => setApprove(e.target.checked)} /> Duyệt luôn (bỏ qua bước duyệt danh sách)</label>
      <button type="button" className="primary" disabled={busy || !pick.size} onClick={add}>Thêm {pick.size || ''} giáo viên</button>
    </div>}
    {org && !approve && <small className="sub">Danh sách của trường sẽ ở trạng thái Chờ duyệt. Bấm Duyệt ở bảng Trường được gán khi sẵn sàng.</small>}
  </section>
}

// ===== Nội dung tập huấn chọn trong kế hoạch (097): toàn bộ hoặc một phần =====
function UnitPick({ prog, value, edit, onSave }: { prog?: Prog; value: string[] | null; edit: boolean; onSave: (v: string[] | null) => Promise<boolean> }) {
  const [open, setOpen] = useState(false)
  const all = prog ? prog.subjects.flatMap(sj => sj.contents.map(c => c.id)) : []
  const [sel, setSel] = useState<Set<string>>(new Set(value ?? all))
  useEffect(() => { setSel(new Set(value ?? all)) }, [value?.join(','), prog?.id])
  if (!prog || !all.length) return null
  const n = value ? value.length : all.length
  const label = !value ? `Toàn bộ ${all.length} nội dung` : `${n}/${all.length} nội dung đã chọn`
  const toggle = (ids: string[], on: boolean) => setSel(o => { const x = new Set(o); ids.forEach(id => on ? x.add(id) : x.delete(id)); return x })
  const dirty = sel.size !== n || (value ? value.some(id => !sel.has(id)) : sel.size !== all.length)
  const save = async () => { if (!sel.size) return; if (await onSave(sel.size === all.length ? null : all.filter(id => sel.has(id)))) setOpen(false) }
  return <div className="tpunits">
    <button type="button" className="linkbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
      {value ? <span className="tpunitpart">{label}</span> : label} {open ? '▴' : '▾'}</button>
    {open && <div className="tpunittree">
      {prog.subjects.map(sj => { const ids = sj.contents.map(c => c.id), k = ids.filter(id => sel.has(id)).length
        return <fieldset key={sj.id} disabled={!edit}>
          <legend><label><input type="checkbox" checked={k === ids.length && k > 0} ref={el => { if (el) el.indeterminate = k > 0 && k < ids.length }}
            onChange={e => toggle(ids, e.target.checked)} /> <b>{sj.title}</b> <small className="sub">{k}/{ids.length} nội dung</small></label></legend>
          {sj.contents.map(c => <label key={c.id} className="tpunit"><input type="checkbox" checked={sel.has(c.id)} onChange={e => toggle([c.id], e.target.checked)} />
            <span>{c.title}</span><small className="sub">{num(c.hours)} giờ</small></label>)}
        </fieldset> })}
      {edit && <div className="tools">
        <button type="button" className="primary" disabled={!sel.size || !dirty} onClick={save}>Lưu nội dung chọn</button>
        <button type="button" disabled={sel.size === all.length} onClick={() => setSel(new Set(all))}>Chọn toàn bộ</button>
        {!sel.size && <small className="warnline">Chọn ít nhất một nội dung.</small>}
        <small className="sub">Xếp lịch, học trực tuyến và kết quả chỉ tính nội dung đã chọn.</small></div>}
    </div>}
  </div>
}

// ===== Giáo viên tự đăng ký (098): bật / tắt, hạn đăng ký =====
const today = () => { const d = new Date(); return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
/** Gửi thông báo mời GV đăng ký (đơn vị lập kế hoạch: mọi trường được gán; trường: GV của trường) */
async function invite(planId: string, orgId: string | null): Promise<[string, boolean]> {
  const { data, error } = await supabase.rpc('training_register_invite', { p_plan: planId, p_org: orgId })
  if (error) return [errText(error.message), true]
  const n = Number(data) || 0
  return [n ? `Đã gửi thông báo mời đăng ký cho ${n} giáo viên.` : 'Không còn giáo viên nào chưa đăng ký để mời.', false]
}
/** Link đăng ký gửi cho GV: mở thẳng màn đăng ký của kế hoạch (chưa đăng nhập thì đăng nhập trước) */
export const regLink = (planId: string) => `${location.origin}${location.pathname}?dk=${planId}`
function CopyLink({ planId }: { planId: string }) {
  const [done, setDone] = useState(false)
  const link = regLink(planId)
  return <span className="reglink">
    <input readOnly value={link} aria-label="Link đăng ký" onFocus={e => e.target.select()} />
    <button type="button" onClick={() => { navigator.clipboard?.writeText(link).then(() => { setDone(true); setTimeout(() => setDone(false), 2000) }, () => undefined) }}>{done ? 'Đã chép' : 'Sao chép link'}</button>
  </span>
}
/** Mời đăng ký: gửi thông báo + link, kèm tình trạng đã gửi / đã xem / đã đăng ký. Ẩn khi kế hoạch chưa mở / đã hết hạn đăng ký */
type IStat = { org_id: string; org_name: string; invited_at: string | null; teachers: number; no_account: number; sent: number; seen: number; registered: number; last_sent: string | null }
const hmd = (d: string) => new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
function InviteBar({ p, orgs, org, onDone }: { p: TPlan; orgs: POrg[]; org: string | null; onDone?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<[string, boolean, string] | null>(null)
  const [st, setSt] = useState<IStat[] | null>(null)
  const openOrgs = orgs.filter(o => o.status === 'assigned' || o.status === 'returned')
  const loadSt = () => supabase.rpc('training_invite_status', { p_plan: p.id }).then(({ data, error }) => setSt(error ? [] : ((data as IStat[]) ?? []).filter(x => !org || x.org_id === org)))
  useEffect(() => { loadSt() }, [p.id, org])
  if (!p.self_register || p.pub_status !== 'published' || (p.register_until && p.register_until < today())) return null
  async function send() {
    setBusy(true); setRes(null)
    const r = await invite(p.id, org)
    setRes([r[0], r[1], new Date().toISOString()]); await loadSt(); setBusy(false); onDone?.()
  }
  const sum = (k: keyof IStat) => (st ?? []).reduce((a, x) => a + (Number(x[k]) || 0), 0)
  const sent = sum('sent'), last = (st ?? []).map(x => x.last_sent).filter(Boolean).sort().pop()
  return <div className="invitebar">
    <div className="tools" style={{ flexWrap: 'wrap' }}>
      <button type="button" className="primary" disabled={busy || !openOrgs.length} title={openOrgs.length ? undefined : 'Chưa có trường nào đang nhận đăng ký'} onClick={send}>
        {busy ? 'Đang gửi…' : 'Gửi thông báo mời đăng ký'}</button>
      <CopyLink planId={p.id} />
    </div>
    {res && <p className={'invres' + (res[1] ? ' bad' : '')} role="status"><b>{res[1] ? '✕' : '✓'}</b> {res[0]}{!res[1] && ` (${hmd(res[2])})`}</p>}
    {st && sent > 0 && <details className="invstat">
      <summary><b>Đã gửi tới {sent} giáo viên</b> · {sum('seen')} đã xem thông báo · {sum('registered')} đã đăng ký / có tên{last ? ` · lần gửi gần nhất ${hmd(last)}` : ''}</summary>
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Trường</th><th>GV của trường</th><th>Đã nhận thông báo</th><th>Đã xem</th><th>Đã đăng ký / có tên</th><th>Chưa có tài khoản</th></tr></thead>
        <tbody>{st.map(x => <tr key={x.org_id}><td>{x.org_name}{x.invited_at && <><br /><small className="sub">mời {hmd(x.invited_at)}</small></>}</td>
          <td>{x.teachers}</td><td>{x.sent}</td><td>{x.seen}{x.sent ? <small className="sub"> ({Math.round(x.seen * 100 / x.sent)}%)</small> : null}</td><td>{x.registered}</td>
          <td>{x.no_account ? <span className="warnline">{x.no_account}</span> : 0}</td></tr>)}</tbody>
      </table></div>
      <small className="sub">"Đã nhận" là thông báo đã vào chuông của giáo viên; "Đã xem" là giáo viên đã mở thông báo. GV chưa có tài khoản không nhận được thông báo: gửi link qua Zalo, email.</small>
    </details>}
    <small className="sub">Thông báo đến chuông của giáo viên {openOrgs.length > 1 ? `ở ${openOrgs.length} trường đang nhận đăng ký` : 'của trường'} chưa đăng ký; người đã đăng ký hoặc đã có tên không bị làm phiền.
      Link dán vào Zalo, email: giáo viên bấm vào, đăng nhập là tới đúng màn đăng ký.</small>
  </div>
}

function SelfRegister({ p, can, regs, orgs, names, onSave, onInvite, onReview }: { p: TPlan; can: boolean; regs: Reg[]; orgs: POrg[]; names: Map<string, string>
  onSave: (v: Partial<TPlan>, ok: string) => Promise<boolean>; onInvite: () => void; onReview: (r: Reg, ok: boolean) => void }) {
  const [on, setOn] = useState(!!p.self_register)
  const [until, setUntil] = useState(p.register_until ?? '')
  const [appr, setAppr] = useState(p.register_approval !== false)
  useEffect(() => { setOn(!!p.self_register); setUntil(p.register_until ?? ''); setAppr(p.register_approval !== false) }, [p.self_register, p.register_until, p.register_approval])
  const dirty = on !== !!p.self_register || (until || null) !== (p.register_until ?? null) || appr !== (p.register_approval !== false)
  const closed = p.register_until && p.register_until < today()
  const n = (s: Reg['status']) => regs.filter(r => r.status === s).length
  const pend = regs.filter(r => r.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at))
  if (!can && !p.self_register) return null
  return <section className="panel" style={{ display: 'grid', gap: 10 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Giáo viên tự đăng ký</h3>
      {p.self_register && <small className="sub">{regs.length} lượt đăng ký · {n('pending')} chờ duyệt{n('waitlist') ? ` · ${n('waitlist')} trong danh sách chờ` : ''} · {n('accepted')} đã duyệt · {n('rejected')} không duyệt</small>}</div>
    {can ? <>
      <div className="tools" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="tpcheck"><input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} /> Cho giáo viên của trường được gán tự đăng ký, chọn nội dung muốn học</label>
        <label className="field" style={{ margin: 0 }}><span>Hạn đăng ký</span><input type="date" value={until} disabled={!on} onChange={e => setUntil(e.target.value)} /></label>
      </div>
      <fieldset className="regappr" disabled={!on}><legend>Khi giáo viên đăng ký</legend>
        <label><input type="radio" name={'appr' + p.id} checked={appr} onChange={() => setAppr(true)} /> <b>Cần duyệt</b> <small className="sub">— trường hoặc đơn vị tổ chức duyệt rồi giáo viên mới có tên tham gia; không duyệt thì giáo viên nhận thông báo kèm lý do</small></label>
        <label><input type="radio" name={'appr' + p.id} checked={!appr} onChange={() => setAppr(false)} /> <b>Không cần duyệt</b> <small className="sub">— còn chỗ là có tên tham gia ngay; hết chỗ thì vào danh sách chờ</small></label>
      </fieldset>
      <div className="tools">
        <button type="button" className="primary" disabled={!dirty || (on && !until)} onClick={() => onSave({ self_register: on, register_until: on ? until || null : p.register_until ?? null, register_approval: appr },
          on ? `Đã mở đăng ký đến ${day(until)} (${appr ? 'cần duyệt' : 'không cần duyệt'}).` : 'Đã tắt tự đăng ký.')}>Lưu</button>
        {on && !until && <small className="warnline">Chọn hạn đăng ký.</small>}
        {dirty && <small className="sub">Lưu trước khi gửi lời mời.</small>}
      </div>
    </> : <p className="sub" style={{ margin: 0 }}>Mở đến hết {day(p.register_until ?? null) || 'khi trường gửi danh sách'} · {p.register_approval !== false ? 'cần duyệt' : 'không cần duyệt'}.</p>}
    {p.self_register && closed && <p className="warnline" style={{ margin: 0 }}>Đã hết hạn đăng ký ({day(p.register_until!)}).</p>}
    {can && !dirty && <InviteBar p={p} orgs={orgs} org={null} onDone={onInvite} />}
    {can && pend.length > 0 && <>
      <h4 style={{ margin: '4px 0 0' }}>Chờ duyệt ({pend.length})</h4>
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Giáo viên</th><th>Trường</th><th>Lưu ý</th><th>Gửi lúc</th><th></th></tr></thead>
        <tbody>{pend.map(r => <tr key={r.teacher_id}>
          <td><b>{r.teachers?.full_name ?? '—'}</b>{r.teachers?.subject && <small className="sub"> · {r.teachers.subject}</small>}</td>
          <td>{names.get(r.org_id) ?? '…'}</td>
          <td style={{ whiteSpace: 'normal' }}>{r.note && <small>“{r.note}”<br /></small>}{r.warnings.map((w, k) => <small key={k} className="warnline" style={{ display: 'block' }}>{w}</small>)}{!r.note && !r.warnings.length && <small className="sub">—</small>}</td>
          <td>{new Date(r.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td><div className="tools"><button type="button" className="primary" onClick={() => onReview(r, true)}>Duyệt</button>
            <button type="button" onClick={() => onReview(r, false)}>Không duyệt</button></div></td>
        </tr>)}</tbody>
      </table></div>
    </>}
    <small className="sub">Giáo viên đăng ký ở mục Đăng ký tập huấn (hoặc bấm link mời). Hệ thống kiểm tra hạn đăng ký, chương trình tiên quyết, chỉ tiêu của trường và trùng lịch;
      nội dung đã đạt ở kế hoạch trước được đề xuất miễn. Trường gửi danh sách duyệt như thường lệ.{p.pub_status === 'draft' ? ' Giáo viên chỉ thấy kế hoạch sau khi phát hành và gán trường.' : ''}</small>
  </section>
}

// ===== Số lượng tối đa của cả kế hoạch, danh sách chờ (111) =====
function Capacity({ p, can, enr, regs, orgs, names, onSave, onReview }: { p: TPlan; can: boolean; enr: number; regs: Reg[]; orgs: POrg[]; names: Map<string, string>
  onSave: (v: number | null) => void; onReview: (r: Reg, ok: boolean) => void }) {
  const [v, setV] = useState(p.max_learners == null ? '' : String(p.max_learners))
  useEffect(() => { setV(p.max_learners == null ? '' : String(p.max_learners)) }, [p.max_learners])
  const max = p.max_learners ?? null
  const pend = regs.filter(r => r.status === 'pending').length
  const used = enr + pend
  const wait = regs.filter(r => r.status === 'waitlist').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const sumQuota = orgs.every(o => o.quota != null) ? orgs.reduce((a, o) => a + (o.quota ?? 0), 0) : null
  const next = v === '' ? null : Math.max(1, Math.round(Number(v) || 1))
  const pct = max ? Math.min(100, Math.round(used * 100 / max)) : 0
  return <section className="panel" style={{ display: 'grid', gap: 10 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Số lượng</h3>
      <small className="sub">{max ? `${used}/${max} chỗ đã dùng` : `${used} giáo viên`} ({enr} có tên{pend ? `, ${pend} chờ duyệt` : ''}){wait.length ? ` · ${wait.length} trong danh sách chờ` : ''}</small></div>
    {max != null && <div className="capbar" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={used} aria-label="Chỗ đã dùng">
      <i style={{ width: pct + '%' }} className={used >= max ? 'full' : pct >= 90 ? 'near' : ''} /></div>}
    {can ? <div className="tools" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
      <label className="field" style={{ margin: 0 }}><span>Số lượng tối đa (GV, cả kế hoạch)</span>
        <input type="number" min={1} value={v} onChange={e => setV(e.target.value)} placeholder="Không giới hạn" style={{ width: 170 }} /></label>
      <button type="button" className="primary" disabled={next === max} onClick={() => onSave(next)}>Lưu</button>
      {next != null && next < used && <small className="warnline">Thấp hơn số đã dùng ({used}): người đã có tên giữ nguyên, chỉ chặn đăng ký mới.</small>}
    </div> : <p className="sub" style={{ margin: 0 }}>{max ? `Tối đa ${max} giáo viên cho cả kế hoạch.` : 'Không giới hạn số lượng cho cả kế hoạch.'}</p>}
    {max != null && sumQuota != null && sumQuota > max && <small className="sub">Tổng chỉ tiêu các trường ({sumQuota}) lớn hơn số lượng tối đa ({max}): trường nào đăng ký trước được trước.</small>}
    <small className="sub">Số đã dùng gồm giáo viên có tên và đăng ký đang chờ duyệt. Khi đủ, giáo viên được báo "Kế hoạch đã đủ số lượng" và có thể gửi đăng ký chờ;
      đơn vị lập kế hoạch nhận thông báo lúc đạt 90% và 100%, và khi có chỗ trống mà còn người chờ. Chỉ tiêu từng trường (bảng bên dưới) vẫn áp dụng.</small>
    {wait.length > 0 && <div className="wrap"><table className="libtable">
      <thead><tr><th style={{ width: 40 }}>Thứ tự</th><th>Giáo viên</th><th>Trường</th><th>Gửi lúc</th>{can && <th></th>}</tr></thead>
      <tbody>{wait.map((r, k) => <tr key={r.teacher_id}>
        <td>{k + 1}</td>
        <td><b>{r.teachers?.full_name ?? '—'}</b>{r.teachers?.subject && <small className="sub"> · {r.teachers.subject}</small>}</td>
        <td>{names.get(r.org_id) ?? '…'}</td>
        <td>{new Date(r.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</td>
        {can && <td><div className="tools"><button type="button" className="primary" disabled={max != null && used >= max} title={max != null && used >= max ? 'Chưa có chỗ trống' : undefined} onClick={() => onReview(r, true)}>Nhận</button>
          <button type="button" onClick={() => onReview(r, false)}>Từ chối</button></div></td>}
      </tr>)}</tbody>
    </table></div>}
  </section>
}

/** Trường xét đăng ký của giáo viên: nội dung chọn, đề nghị miễn, cảnh báo trùng lịch; nhận hoặc từ chối kèm lý do */
function SchoolRegs({ regs, unitTitle, total, edit, onReview }: { regs: Reg[]; unitTitle: (id: string) => string; total: number; edit: boolean
  onReview: (r: Reg, ok: boolean) => void }) {
  const [all, setAll] = useState(false)
  if (!regs.length) return null
  const open = (r: Reg) => r.status === 'pending' || r.status === 'waitlist'
  const pend = regs.filter(r => r.status === 'pending')
  const wait = regs.filter(r => r.status === 'waitlist').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const shown = all ? [...regs].sort((a, b) => (open(a) ? 0 : 1) - (open(b) ? 0 : 1) || b.created_at.localeCompare(a.created_at)) : [...pend, ...wait]
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Giáo viên tự đăng ký</h3>
      <div className="tools"><small className="sub">{pend.length} chờ duyệt{wait.length ? ` · ${wait.length} danh sách chờ` : ''} · {regs.length} lượt</small>
        {regs.length > pend.length + wait.length && <button type="button" className="linkbtn" onClick={() => setAll(!all)}>{all ? 'Chỉ hiện chờ duyệt' : 'Xem cả đã xử lý'}</button>}</div></div>
    {wait.length > 0 && <p className="sub" style={{ margin: 0 }}>Danh sách chờ: giáo viên đăng ký khi đã hết chỗ, xếp theo thứ tự gửi. Khi có chỗ trống (có người bị từ chối hoặc huỷ) thì nhận được.</p>}
    {pend.length > 0 && <p className="sub" style={{ margin: 0 }}>Duyệt thì giáo viên có tên trong danh sách bên dưới (chỉ học nội dung đã chọn) và nhận thông báo; không duyệt thì giáo viên nhận thông báo kèm lý do. Cần xử lý hết đăng ký chờ duyệt trước khi gửi danh sách.</p>}
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Giáo viên</th><th>Nội dung đăng ký</th><th>Lưu ý</th><th>Trạng thái</th>{edit && <th></th>}</tr></thead>
      <tbody>{shown.map(r => { const learn = r.units ? r.units.filter(u => !r.exempt_units.includes(u)) : null
        return <tr key={r.teacher_id}>
          <td><b>{r.teachers?.full_name ?? '—'}</b>{r.teachers?.subject && <small className="sub"> · {r.teachers.subject}</small>}<br /><small className="sub">{new Date(r.created_at).toLocaleDateString('vi-VN')}</small></td>
          <td style={{ whiteSpace: 'normal' }}>{learn ? `${learn.length}/${total} nội dung: ${learn.map(unitTitle).join('; ')}` : `Toàn bộ${r.exempt_units.length ? ` (${total - r.exempt_units.length}/${total} nội dung)` : ` ${total} nội dung`}`}
            {r.exempt_units.length > 0 && <><br /><small className="sub">Đề nghị miễn (đã đạt trước đây): {r.exempt_units.map(unitTitle).join('; ')}</small></>}</td>
          <td style={{ whiteSpace: 'normal' }}>{r.note && <small>“{r.note}”<br /></small>}{r.warnings.map((w, k) => <small key={k} className="warnline" style={{ display: 'block' }}>{w}</small>)}
            {!r.note && !r.warnings.length && <small className="sub">—</small>}</td>
          <td><Chip tone={REG_ST[r.status][1]}>{REG_ST[r.status][0]}{r.status === 'waitlist' ? ` · thứ ${wait.indexOf(r) + 1}` : ''}</Chip>{r.reason && r.status === 'rejected' && <><br /><small className="sub">{r.reason}</small></>}</td>
          {edit && <td>{open(r) && <div className="tools"><button type="button" className="primary" onClick={() => onReview(r, true)}>Duyệt</button>
            <button type="button" onClick={() => onReview(r, false)}>Không duyệt</button></div>}</td>}
        </tr> })}</tbody>
    </table></div>
  </section>
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
  // Trường ngoài phạm vi áp dụng của chương trình trong kế hoạch: làm mờ, không chọn được
  const [out, setOut] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!schools?.length) return
    supabase.rpc('training_plan_out_of_scope', { p_plan: plan.id, p_orgs: schools.map(s => s.id) }).then(({ data }) => setOut(new Set((data as string[] | null) ?? [])))
  }, [schools, plan.id])
  const match = (schools ?? []).filter(s => !taken.has(s.id) && (!q || `${s.name} ${s.parent ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const shown = match.filter(s => !out.has(s.id)), outShown = match.filter(s => out.has(s.id))
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
      {outShown.length > 0 && <details className="outscope"><summary>{outShown.length} trường ngoài phạm vi áp dụng của chương trình tập huấn (không gán được)</summary>
        <div className="reggrid">{outShown.map(s => <label className="roomrow off" key={s.id}><span>{s.name}{s.parent && <><br /><small className="sub">{s.parent}</small></>}</span>
          <input type="checkbox" disabled /></label>)}</div></details>}
    </section>
  </ElView>
}

// ===== Trường: kế hoạch được giao, chọn giáo viên, gửi duyệt =====
type Assigned = POrg & { training_plans: TPlan | null }
export function SchoolTrainingAssigned({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Assigned[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [enr, setEnr] = useState<{ plan_id: string; teacher_id: string; teachers: { org_id: string } | null }[]>([])
  const [pend, setPend] = useState<{ plan_id: string; org_id: string }[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [rk, setRk] = useState(0)
  // Quản trị hệ thống: kế hoạch giao cho mọi trường trong một danh sách; mở một dòng để chọn GV, gửi duyệt thay trường
  const all = useAllMode(), orgName = useOrgName()
  const provOf = useProvinceOf()
  // Bộ lọc chọn nhiều: năm học, tỉnh, trường, chương trình tập huấn (rỗng = tất cả)
  const [fYear, setFYear] = useState<string[]>([])
  const [fProv, setFProv] = useState<string[]>([])
  const [fOrg, setFOrg] = useState<string[]>([])
  const [fProg, setFProg] = useState<string[]>([])
  const key = (r: { plan_id: string; org_id: string }) => r.plan_id + ':' + r.org_id
  useEffect(() => {
    (async () => {
      const base = supabase.from('training_plan_orgs').select(`plan_id, org_id, quota, status, note, submitted_at, decided_at, training_plans(${SEL})`)
      const a = await (all ? base : base.eq('org_id', orgId))
      if (a.error) { setMsg([errText(a.error.message), true]); setRows([]); return }
      const r = ((a.data ?? []) as unknown as Assigned[]).filter(x => x.training_plans)
      const ids = [...new Set(r.map(x => x.plan_id))]
      const enrQ = supabase.from('training_enrollments').select('plan_id, teacher_id, teachers!inner(org_id)').in('plan_id', ids)
      const regQ = supabase.from('training_registrations').select('plan_id, org_id').in('plan_id', ids).eq('status', 'pending')
      const [i, e, g] = ids.length ? await Promise.all([
        supabase.from('training_plan_items').select('plan_id, program_id, seq, quota, trainer, trainer_ids, assistant, assistant_ids, note, units, training_programs(code, title, ct_code)').in('plan_id', ids),
        all ? enrQ : enrQ.eq('teachers.org_id', orgId),
        all ? regQ : regQ.eq('org_id', orgId),
      ]) : [{ data: [] }, { data: [] }, { data: [] }]
      setRows(r.sort((x, y) => (y.training_plans!.year_name ?? '').localeCompare(x.training_plans!.year_name ?? '') || (x.training_plans!.plan_code ?? '').localeCompare(y.training_plans!.plan_code ?? '')))
      setItems((i.data as unknown as Item[]) ?? []); setEnr((e.data as unknown as typeof enr) ?? []); setPend((g.data as typeof pend) ?? [])
    })()
  }, [rk, orgId])
  const [fs, setFs] = useState<'' | 'todo' | 'sent'>('')
  const cur = open ? rows?.find(r => key(r) === open) : undefined
  if (cur) return <SchoolPlanTeachers row={cur} orgId={cur.org_id} items={items.filter(i => i.plan_id === cur.plan_id)} onBack={() => { setOpen(null); setRk(k => k + 1) }}
    onMsg={m => { setMsg(m); setOpen(null); setRk(k => k + 1) }} />
  const n = (s: OrgSt) => (rows ?? []).filter(r => r.status === s).length
  const uniq = (xs: [string, string][]) => [...new Map(xs).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  const yearOpts = uniq((rows ?? []).map(r => r.training_plans!.year_name).filter(Boolean).map(y => [y!, y!] as [string, string])).reverse()
  const provOpts = uniq((rows ?? []).map(r => provOf(r.org_id)).filter(Boolean).map(o => [o!.id, o!.name] as [string, string]))
  const orgOpts = uniq((rows ?? []).filter(r => !fProv.length || fProv.includes(provOf(r.org_id)?.id ?? '')).map(r => [r.org_id, orgName(r.org_id)] as [string, string]))
  const progOpts = uniq(items.map(i => [i.program_id, i.training_programs?.title ?? '—'] as [string, string]))
  const fit = (r: Assigned) => (!fs || (fs === 'todo' ? r.status === 'assigned' || r.status === 'returned' : r.status === 'submitted' || r.status === 'approved'))
    && (!fYear.length || fYear.includes(r.training_plans!.year_name ?? '')) && (!fProv.length || fProv.includes(provOf(r.org_id)?.id ?? ''))
    && (!fOrg.length || fOrg.includes(r.org_id)) && (!fProg.length || items.some(i => i.plan_id === r.plan_id && fProg.includes(i.program_id)))
  const nShown = (rows ?? []).filter(fit).length
  const ms = { width: 168, flex: '0 0 168px' }
  return <>
    <FlowGuide id="training-school">
      <ol className="distguide">{([['Nhận kế hoạch', 'KDI, Sở hoặc Phòng gán kế hoạch tập huấn cho trường, kèm chỉ tiêu giáo viên.'],
        ['Chọn giáo viên', 'Mở kế hoạch, đánh dấu giáo viên tham gia, không vượt chỉ tiêu.'],
        ['Gửi duyệt', 'Gửi danh sách lên. Bị trả lại thì sửa theo lý do rồi gửi lại.']] as [string, string][]).map(([h, d], k) =>
        <li key={h}><button type="button" onClick={() => setFs(k === 0 ? '' : k === 1 ? 'todo' : 'sent')}><i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
    </FlowGuide>
    <div className="diststatcards">
      <div className="panel"><i aria-hidden="true">≋</i><span><b>{rows?.length ?? '…'}</b><small>Kế hoạch được giao</small></span></div>
      <div className="panel"><i aria-hidden="true" className={n('assigned') + n('returned') ? 'warn' : 'good'}>!</i><span><b>{n('assigned') + n('returned')}</b><small>Cần chọn giáo viên</small><small>{n('returned')} bị trả lại</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{n('approved')}</b><small>Đã duyệt</small><small>{n('submitted')} chờ duyệt</small></span></div>
    </div>
    <div className="bar"><div className="tools">
      <MultiSelect value={fYear} onChange={setFYear} options={yearOpts} placeholder="Mọi năm học" ariaLabel="Năm học" style={ms} compact />
      {all && <MultiSelect value={fProv} onChange={v => { setFProv(v); setFOrg([]) }} options={provOpts} placeholder="Mọi tỉnh" ariaLabel="Tỉnh" style={ms} compact />}
      {all && <MultiSelect value={fOrg} onChange={setFOrg} options={orgOpts} placeholder="Mọi trường" ariaLabel="Trường" style={ms} compact />}
      <MultiSelect value={fProg} onChange={setFProg} options={progOpts} placeholder="Mọi chương trình" ariaLabel="Chương trình tập huấn" style={ms} compact />
      {(fYear.length + fProv.length + fOrg.length + fProg.length > 0) && <button type="button" className="fclear" onClick={() => { setFYear([]); setFProv([]); setFOrg([]); setFProg([]) }}>Bỏ lọc</button>}
      <small className="sub">{nShown}/{rows?.length ?? 0} kế hoạch</small>
    </div></div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Kế hoạch tập huấn</th>{all && <th>Trường</th>}<th>Năm học · đợt</th><th>Chương trình</th><th>Giáo viên / chỉ tiêu</th><th>Trạng thái</th></tr></thead>
      <tbody>{rows.filter(fit).map(r => {
        const p = r.training_plans!, its = items.filter(i => i.plan_id === r.plan_id).sort((a, b) => a.seq - b.seq), c = enr.filter(e => e.plan_id === r.plan_id && e.teachers?.org_id === r.org_id).length
        const pd = pend.filter(x => x.plan_id === r.plan_id && x.org_id === r.org_id).length
        return <tr key={key(r)}>
          <td><button type="button" className="namelink" onClick={() => { setMsg(null); setOpen(key(r)) }}>{p.name}</button><br /><small className="sub">{[p.plan_code, span(p), p.provider].filter(Boolean).join(' · ')}</small></td>
          {all && <td>{orgName(r.org_id)}</td>}
          <td>{[p.year_name, p.term && TERM[p.term]].filter(Boolean).join(' · ') || '—'}</td>
          <td style={{ whiteSpace: 'normal' }}>{its.map(i => i.training_programs?.title).join('; ') || '—'}</td>
          <td>{c}{r.quota != null && ` / ${r.quota}`} GV{pd > 0 && <><br /><Chip tone="warn">{pd} GV đăng ký chờ duyệt</Chip></>}
            {p.self_register && !pd && <><br /><small className="sub">Mở tự đăng ký{p.register_until ? ` đến ${day(p.register_until)}` : ''}</small></>}</td>
          <td><Chip tone={ORG_ST[r.status][1]}>{ORG_ST[r.status][0]}</Chip>{r.status === 'returned' && r.note && <><br /><small className="sub">Lý do: {r.note}</small></>}</td>
        </tr> })}
        {!rows.length ? <tr><td colSpan={all ? 6 : 5}>Chưa có kế hoạch tập huấn nào được giao cho trường.</td></tr> : !nShown && <tr><td colSpan={all ? 6 : 5}>Không có kế hoạch nào khớp bộ lọc.</td></tr>}</tbody>
    </table></div>}
  </>
}

// Mở thẳng danh sách GV của một trường trong một kế hoạch (từ màn Giám sát)
export function SchoolPlanWork({ planId, orgId, onBack }: { planId: string; orgId: string; onBack: (m?: [string, boolean]) => void }) {
  const [row, setRow] = useState<Assigned | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    (async () => {
      const [a, i] = await Promise.all([
        supabase.from('training_plan_orgs').select(`plan_id, org_id, quota, status, note, submitted_at, decided_at, invited_at, training_plans(${SEL})`).eq('plan_id', planId).eq('org_id', orgId).maybeSingle(),
        supabase.from('training_plan_items').select('plan_id, program_id, seq, quota, trainer, trainer_ids, assistant, assistant_ids, note, units, training_programs(code, title, ct_code)').eq('plan_id', planId),
      ])
      if (a.error || !a.data || !(a.data as unknown as Assigned).training_plans) return setErr(a.error ? errText(a.error.message) : 'Không tìm thấy kế hoạch được giao cho trường này.')
      setRow(a.data as unknown as Assigned); setItems((i.data as unknown as Item[]) ?? [])
    })()
  }, [planId, orgId])
  if (err) return <><button type="button" className="distback" onClick={() => onBack()}>← Giám sát</button><p className="msg">{err}</p></>
  if (!row) return <p className="sub">Đang tải…</p>
  return <SchoolPlanTeachers row={row} orgId={orgId} items={items} backLabel="Giám sát" onBack={() => onBack()} onMsg={m => onBack(m)} />
}

function SchoolPlanTeachers({ row, orgId, items, onBack, onMsg, backLabel = 'Kế hoạch được giao' }: { row: Assigned; orgId: string; items: Item[]; onBack: () => void; onMsg: (m: [string, boolean]) => void; backLabel?: string }) {
  const p = row.training_plans!
  const progs = usePrograms()
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; subject: string | null }[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [self, setSelf] = useState<Map<string, Pick<Enr, 'units' | 'exempt_units'>>>(new Map())
  const [regs, setRegs] = useState<Reg[]>([])
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  // GV đang thiếu năng lực mà kế hoạch bồi dưỡng (từ đánh giá năng lực, 088)
  const [hint, setHint] = useState<Map<string, string[]>>(new Map())
  useEffect(() => {
    supabase.rpc('training_plan_gap_hint', { p_plan: row.plan_id }).then(({ data }) =>
      setHint(new Map(((data ?? []) as { teacher_id: string; competencies: string[] }[]).map(h => [h.teacher_id, h.competencies]))))
  }, [row.plan_id])
  async function load() {
    const [t, e, r] = await Promise.all([
      supabase.from('teachers').select('id, full_name, subject').eq('org_id', orgId).order('full_name'),
      supabase.from('training_enrollments').select('teacher_id, source, units, exempt_units, teachers!inner(org_id)').eq('plan_id', row.plan_id).eq('teachers.org_id', orgId),
      supabase.from('training_registrations').select(RSEL).eq('plan_id', row.plan_id).eq('org_id', orgId),
    ])
    setTeachers((t.data as { id: string; full_name: string; subject: string | null }[]) ?? [])
    const es = (e.data ?? []) as unknown as Enr[]
    setChosen(new Set(es.map(x => x.teacher_id)))
    setSelf(new Map(es.filter(x => x.source === 'self' || x.units || x.exempt_units?.length).map(x => [x.teacher_id, x])))
    setRegs((r.data as unknown as Reg[]) ?? [])
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
  const hinted = (teachers ?? []).filter(t => hint.has(t.id) && !chosen.has(t.id))
  async function pickHinted() {
    const room = row.quota != null ? Math.max(0, row.quota - chosen.size) : hinted.length
    const add = hinted.slice(0, room)
    if (!add.length) return setMsg(['Đã đủ chỉ tiêu, không thêm được giáo viên.', true])
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('training_enrollments').insert(add.map(t => ({ org_id: orgId, plan_id: row.plan_id, teacher_id: t.id })))
    setBusy(false)
    setMsg(error ? [errText(error.message), true] : [`Đã thêm ${add.length} giáo viên được gợi ý${add.length < hinted.length ? ` (còn ${hinted.length - add.length} người vượt chỉ tiêu)` : ''}.`, false])
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
  // Tên nội dung để hiện đăng ký của GV
  const planUnits = [...items].sort((a, b) => a.seq - b.seq).flatMap(i => { const g = progs.find(x => x.id === i.program_id)
    return g ? g.subjects.flatMap(sj => sj.contents).filter(c => !i.units || i.units.includes(c.id)) : [] })
  const unitTitle = (id: string) => planUnits.find(u => u.id === id)?.title ?? '…'
  async function review(r: Reg, ok: boolean) {
    const reason = ok ? null : prompt(`Lý do không duyệt ${r.teachers?.full_name ?? 'giáo viên'} (giáo viên sẽ nhận được thông báo):`)
    if (!ok && !reason?.trim()) return
    setMsg(null)
    const { error } = await supabase.rpc('training_registration_review', { p_plan: r.plan_id, p_teacher: r.teacher_id, p_accept: ok, p_reason: reason })
    setMsg(error ? [errText(error.message), true] : [ok ? `Đã nhận ${r.teachers?.full_name}. Giáo viên đã có tên trong danh sách.` : 'Đã từ chối và báo cho giáo viên.', false])
    load()
  }
  const pendN = regs.filter(r => r.status === 'pending').length
  return <ElView back={backLabel} onBack={onBack} title={p.name}
    sub={<>{p.plan_code} · <Chip tone={ORG_ST[row.status][1]}>{ORG_ST[row.status][0]}</Chip> · {chosen.size}{row.quota != null && ` / ${row.quota}`} giáo viên</>}
    actions={edit && <button type="button" className="primary" disabled={busy || !chosen.size || over || pendN > 0} title={pendN ? 'Xử lý hết đăng ký của giáo viên trước' : undefined} onClick={submit}>{row.status === 'returned' ? 'Gửi lại danh sách' : 'Gửi danh sách duyệt'}</button>}>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {row.status === 'returned' && row.note && <p className="warnline">Bị trả lại: {row.note}</p>}
    {row.status === 'submitted' && <p className="sub">Danh sách đã gửi, đang chờ duyệt. Muốn sửa thì nhờ đơn vị lập kế hoạch trả lại.</p>}
    {row.status === 'approved' && <p className="sub">Danh sách đã được duyệt.</p>}
    {over && <p className="warnline">Đã chọn {chosen.size} giáo viên, vượt chỉ tiêu {row.quota}.</p>}
    {edit && pendN > 0 && <p className="warnline">Còn {pendN} đăng ký của giáo viên chờ duyệt: duyệt hoặc không duyệt trước khi gửi danh sách.</p>}
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Thông tin kế hoạch</h3>
      <dl className="tpkv">
        <dt>Năm học · đợt</dt><dd>{[p.year_name, p.term && TERM[p.term]].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Thời gian</dt><dd>{span(p) || '—'}</dd>
        <dt>Hình thức</dt><dd>{MODE[p.mode] ?? p.mode}{p.provider ? ` · ${p.provider}` : ''}</dd>
        {p.self_register && <><dt>Tự đăng ký</dt><dd>Giáo viên tự đăng ký ở mục Đăng ký tập huấn{p.register_until ? `, hạn ${day(p.register_until)}` : ''} · {p.register_approval !== false ? 'cần duyệt' : 'không cần duyệt (đăng ký là có tên)'}</dd></>}
        <dt>Chương trình</dt><dd>{items.length ? <ol style={{ margin: 0, paddingLeft: 18 }}>{[...items].sort((a, b) => a.seq - b.seq).map(i => <li key={i.program_id}>{i.training_programs?.title}{i.trainer && <small className="sub"> · GV: {i.trainer}</small>}{i.assistant && <small className="sub"> · Trợ giảng: {i.assistant}</small>}
          <UnitPick prog={progs.find(x => x.id === i.program_id)} value={i.units ?? null} edit={false} onSave={async () => false} /></li>)}</ol> : '—'}</dd>
        {p.note && <><dt>Ghi chú</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.note}</dd></>}
      </dl>
    </section>
    {edit && p.self_register && p.pub_status === 'published' && (!p.register_until || p.register_until >= today()) && <section className="panel" style={{ display: 'grid', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Mời giáo viên của trường đăng ký</h3>
      <InviteBar p={p} orgs={[row]} org={orgId} onDone={() => load()} />
    </section>}
    <SchoolRegs regs={regs} unitTitle={unitTitle} total={planUnits.length} edit={edit} onReview={review} />
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Giáo viên tham gia</h3>
        <div className="tools"><input placeholder="Tìm giáo viên, môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo viên" />
          <small className="sub">Đã chọn {chosen.size}{row.quota != null && ` / ${row.quota}`}</small>
          {edit && hinted.length > 0 && <button type="button" disabled={busy} onClick={pickHinted}>Chọn {hinted.length} GV được gợi ý</button>}</div></div>
      {hint.size > 0 && <p className="sub" style={{ margin: 0 }}>Gợi ý dựa trên đánh giá năng lực: giáo viên có nhãn <span className="gaptag">thiếu …</span> đang dưới mức Đạt ở năng lực mà kế hoạch này bồi dưỡng.</p>}
      {!teachers ? <p className="sub">Đang tải…</p> : <div className="reggrid">
        {shown.map(t => <label className="roomrow" key={t.id}><span>{t.full_name}{t.subject && <small className="sub"> · {t.subject}</small>}
          {hint.has(t.id) && <span className="gaptag" title={hint.get(t.id)!.join(', ')}>thiếu {hint.get(t.id)!.join(', ')}</span>}
          {self.has(t.id) && chosen.has(t.id) && <small className="sub" style={{ display: 'block' }}>Tự đăng ký · {self.get(t.id)!.units ? `học ${self.get(t.id)!.units!.filter(u => !self.get(t.id)!.exempt_units?.includes(u)).length}/${planUnits.length} nội dung`
            : `học ${planUnits.length - (self.get(t.id)!.exempt_units?.length ?? 0)}/${planUnits.length} nội dung`}{self.get(t.id)!.exempt_units?.length ? `, miễn ${self.get(t.id)!.exempt_units!.length}` : ''}</small>}</span>
          <input type="checkbox" disabled={!edit} checked={chosen.has(t.id)} onChange={e => toggle(t.id, e.target.checked)} aria-label={`Chọn ${t.full_name}`} /></label>)}
        {!shown.length && <small className="sub">{teachers.length ? 'Không có giáo viên nào khớp.' : 'Trường chưa có giáo viên.'}</small>}
      </div>}
    </section>
    {chosen.size > 0 && <PlanProgress planId={row.plan_id} manage={false} />}
  </ElView>
}
