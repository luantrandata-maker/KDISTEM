// Phân phối chương trình — theo video demo được duyệt (23/10). Một trang gồm:
//  hướng dẫn 3 bước · 3 thẻ số liệu · các tab: Danh sách bản phân phối (mặc định: lọc, sắp xếp, "+ Tạo bản phân phối"
//  mở trang tạo bản: đặt tên, chọn phân loại), Theo khung phân loại, Gán theo trường (tạo PPCT theo trường),
//  Lịch sử áp dụng (125: các lần gán theo năm học, phiên bản).
// Theo dõi thực hiện nằm ở menu riêng "Theo dõi Chương trình/Môn học".
import { YearSelect } from '../../components/YearSelect'
import { MultiSelect } from '../../components/MultiSelect'
import { SchoolPicker } from '../../components/SchoolPicker'
import { useHiddenBtn } from '../../components/PageButtons'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { useMultiSel, SelAllTh } from '../../components/TableSel'
import type { ClsNode } from './cls'
import { ClsTree } from './ClsTree'
import { Drawer } from '../../components/Drawer'
import { PlanBody, Chip, STATUS, errText, useBreadcrumb } from './Editor'
import type { Plan, Status } from './sched'
import { FlowGuide } from '../../components/FlowGuide'
import { StatCards } from '../../components/StatCards'
import { useCls } from './cls'
import { DistHistory, PlanAssigned } from './History'
import { gradeName } from '../../lib/eduLevels'

export type { Plan } from './sched'
type Tab = 'list' | 'create' | 'tree' | 'assign' | 'history'
type Meta = { programs: number; subjects: number; lessons: number; periods: number; books: number }
type Book = { id: string; title: string; status: string; year_name: string | null; org_id: string; dist_plan_id: string; program_id: string | null; curriculum_lessons: { count: number }[] }
const BOOK_STATUS: Record<string, string> = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị trả lại', published: 'Đã ban hành' }
const PLAN_SEL = 'id, org_id, code, title, level, grade, tier, node_id, status, hk1_weeks, hk2_weeks, note, updated_at, published_at, family_id, version_no'

function useDistData(rk: number) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map())
  const [books, setBooks] = useState<Book[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    (async () => {
      const [pl, it, rw, bk] = await Promise.all([
        supabase.from('dist_plans').select(PLAN_SEL).order('code').order('version_no', { ascending: false }),
        supabase.from('dist_plan_items').select('plan_id, subjects'),
        supabase.from('dist_plan_rows').select('plan_id, periods, skipped'),
        supabase.from('curriculum_books').select('id, title, status, year_name, org_id, dist_plan_id, program_id, curriculum_lessons(count)').not('dist_plan_id', 'is', null).order('updated_at', { ascending: false }),
      ])
      if (pl.error) setErr(errText(pl.error.message))
      const m = new Map<string, Meta>()
      const get = (id: string) => { let x = m.get(id); if (!x) m.set(id, x = { programs: 0, subjects: 0, lessons: 0, periods: 0, books: 0 }); return x }
      for (const r of (it.data ?? []) as { plan_id: string; subjects: { on?: boolean }[] | null }[]) {
        const x = get(r.plan_id); x.programs++; x.subjects += Math.max(1, (r.subjects ?? []).filter(s => s.on !== false).length)
      }
      for (const r of (rw.data ?? []) as { plan_id: string; periods: number; skipped: boolean }[]) if (!r.skipped && r.periods > 0) { const x = get(r.plan_id); x.lessons++; x.periods += r.periods }
      const bs = (bk.data as unknown as Book[]) ?? []
      for (const b of bs) get(b.dist_plan_id).books++
      setPlans((pl.data as Plan[]) ?? []); setMeta(m); setBooks(bs)
    })()
  }, [rk])
  return { plans, meta, books, err }
}

export function DistPage({ orgId }: { orgId: string | null }) {
  const [tab, setTab] = useState<Tab>('list')
  const [rk, setRk] = useState(0)
  const { plans, meta, books, err } = useDistData(rk)
  const [openTree, setOpenTree] = useState<string | null>(null)
  const [openList, setOpenList] = useState<string | null>(null)
  const [assignId, setAssignId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [lf, setLf] = useState<ListF>({ fs: '', q: '', fc: '', card: null })
  const crumb = useBreadcrumb()
  const reload = () => setRk(k => k + 1)
  const assign = (id: string) => { setAssignId(id); setTab('assign') }
  /** Sau khi lưu / phát hành / nhân bản: mở bản (nháp mở ở trình soạn) và tải lại số liệu. */
  const changed = (where: Tab) => (id?: string, m?: string) => {
    reload(); setMsg(m ?? null)
    if (!id) { setOpenTree(null); setOpenList(null); return }
    if (where === 'tree') { setOpenTree(null); setTimeout(() => setOpenTree(id)) }
    else { setOpenList(null); setTimeout(() => setOpenList(id)) }
  }
  if (err) return <p className="msg">{err}</p>
  // Số trên thẻ chạy theo ô tìm và phân loại của danh sách
  const cardBase = (plans ?? []).filter(p => listMatch(p, lf, crumb))
  const baseIds = new Set(cardBase.map(p => p.id))
  const cardBooks = books.filter(b => baseIds.has(b.dist_plan_id))
  const pub = cardBase.filter(p => p.status === 'published').length
  const drafts = cardBase.filter(p => p.status === 'draft').length
  const steps: [Tab, string, string][] = [
    ['create', 'Soạn bản phân phối', 'Bấm “+ Tạo bản phân phối”, đặt tên và chọn phân loại, tick chương trình phù hợp, xếp lịch học kỳ và nhịp tiết/tuần, xem Bảng hoặc Lịch rồi Lưu nháp.'],
    ['list', 'Phát hành bản', 'Soát cảnh báo (lỗi sẽ chặn phát hành), rồi chuyển bản sang Đã phát hành. Xem tất cả bản ở danh sách này.'],
    ['assign', 'Gán theo trường', 'Gán bản đã phát hành cho trường, lớp, năm học và học kỳ để tạo PPCT theo trường.']]
  return (
    <>
      <FlowGuide id="dist-plans">
        <ol className="distguide">{steps.map(([t, h, d], k) => <li key={t}>
          <button type="button" className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setMsg(null); if (t === 'list') setOpenList(null) }}><i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
        <p className="sub" style={{ margin: 0 }}>Bản phân phối là mẫu lắp ghép từ nhiều chương trình. PPCT theo trường là bản đã gán cho từng trường, lớp để theo dõi.</p>
      </FlowGuide>
      <StatCards active={lf.card} onPick={k => { setLf({ ...lf, card: k, fs: '' }); setTab('list'); setOpenList(null); setMsg(null) }} items={[
        { icon: 'layers', value: plans ? cardBase.length : '…', label: 'Bản phân phối', sub: `${pub} đã phát hành · ${drafts} nháp` },
        { k: 'published', icon: 'checkCircle', tone: 'good', value: plans ? pub : '…', label: 'Bản có thể gán' },
        { k: 'books', icon: 'grid', tone: 'good', value: cardBooks.length, label: 'PPCT theo trường', sub: `${cardBooks.filter(b => b.status === 'published').length} đã ban hành` },
      ]} />
      <div className="distpills" role="tablist">
        {([['list', 'Danh sách bản phân phối'], ['tree', 'Theo khung phân loại'], ['assign', 'Gán theo trường'], ['history', 'Lịch sử áp dụng']] as [Tab, string][]).map(([t, l]) => {
          const on = tab === t || (t === 'list' && tab === 'create')
          return <button key={t} type="button" role="tab" aria-selected={on} className={on ? 'on' : ''} onClick={() => { setTab(t); setMsg(null); if (t === 'list') setOpenList(null) }}>{l}</button>
        })}
      </div>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      {!plans ? <p className="sub">Đang tải…</p> : <>
        {tab === 'tree' && (openTree && plans.some(p => p.id === openTree)
          ? <PlanBody key={openTree + ':' + rk} plan={plans.find(p => p.id === openTree)!} orgId={orgId} back={() => { setOpenTree(null); setMsg(null) }} backLabel="Các bản trong mục"
              onChanged={changed('tree')} onAssign={assign} />
          : <DistTree orgId={orgId} plans={plans} meta={meta} focus={openTree} onOpen={id => { setOpenTree(id); setMsg(null) }} onCreated={id => { reload(); setOpenTree(id) }} />)}
        {tab === 'list' && (openList && plans.some(p => p.id === openList)
          ? <PlanBody key={openList + ':' + rk} plan={plans.find(p => p.id === openList)!} orgId={orgId} back={() => { setOpenList(null); setMsg(null) }} backLabel="Danh sách"
              onChanged={changed('list')} onAssign={assign} />
          : <DistList plans={plans} meta={meta} f={lf} setF={setLf} canCreate={!!orgId} onCreate={() => { setMsg(null); setTab('create') }} onOpen={p => { setMsg(null); setOpenList(p.id) }}
              onCopied={(id, m) => { reload(); setMsg(m); if (id) setOpenList(id) }} onAssign={assign} />)}
        {tab === 'create' && orgId && <CreatePlan orgId={orgId} onCancel={() => setTab('list')}
          onCreated={id => { reload(); setOpenList(id); setTab('list'); setMsg('Đã tạo bản phân phối nháp. Tiếp tục chọn chương trình và xếp lịch.') }} />}
        {tab === 'assign' && <DistAssign orgId={orgId} plans={plans} initial={assignId} onDone={reload} onHistory={() => setTab('history')} />}
        {tab === 'history' && <DistHistory plans={plans} rk={rk} />}
      </>}
    </>
  )
}

// ===== Thiết lập cột (nhớ theo trình duyệt) =====
type Col = { key: string; label: string; fixed?: boolean }
function useCols(store: string, cols: Col[], defaults: string[]) {
  const [on, setOn] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(store) ?? 'null'); return Array.isArray(v) ? v : defaults } catch { return defaults } })
  const set = (k: string, v: boolean) => { const n = v ? [...on, k] : on.filter(x => x !== k); setOn(n); try { localStorage.setItem(store, JSON.stringify(n)) } catch { /* bỏ qua */ } }
  const has = (k: string) => cols.find(c => c.key === k)?.fixed || on.includes(k)
  const menu = <details className="distmore distcols"><summary>⚙ Thiết lập cột</summary><div className="distmenu">
    {cols.map(c => <label key={c.key}><input type="checkbox" disabled={c.fixed} checked={!!has(c.key)} onChange={e => set(c.key, e.target.checked)} /> {c.label}</label>)}</div></details>
  return { has, menu }
}
const COLS: Col[] = [{ key: 'plan', label: 'Bản phân phối', fixed: true }, { key: 'cls', label: 'Phân loại' }, { key: 'parts', label: 'Thành phần' },
  { key: 'lessons', label: 'Bài · tiết' }, { key: 'books', label: 'Đã gán' }, { key: 'status', label: 'Trạng thái' }, { key: 'updated', label: 'Cập nhật' }]

function PlanCells({ p, m, has, crumb, onOpen }: { p: Plan; m: Meta | undefined; has: (k: string) => boolean | undefined; crumb: string; onOpen: () => void }) {
  return <>
    <td><button type="button" className="namelink" onClick={onOpen}>{p.title}</button><br /><small className="sub">{p.code} · Phiên bản {p.version_no ?? 1}</small></td>
    {has('cls') && <td>{crumb}</td>}
    {has('parts') && <td>{m?.programs ?? 0} chương trình · {m?.subjects ?? 0} môn</td>}
    {has('lessons') && <td>{m?.lessons ?? 0} bài · {m?.periods ?? 0} tiết</td>}
    {has('books') && <td>{m?.books ?? 0} PPCT</td>}
    {has('status') && <td><Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip></td>}
    {has('updated') && <td><small>{new Date(p.updated_at).toLocaleDateString('vi-VN')}</small></td>}
  </>
}

// ===== Tab "Bản phân phối": cấu hình cấp + khung phân loại + các bản trong mục =====
function DistTree({ orgId, plans, meta, focus, onOpen, onCreated }: {
  orgId: string | null; plans: Plan[]; meta: Map<string, Meta>; focus: string | null; onOpen: (id: string) => void; onCreated: (id: string) => void
}) {
  const hid = useHiddenBtn()
  const crumb = useBreadcrumb()
  const [err, setErr] = useState('')
  const { has, menu } = useCols('dist-tree-cols', COLS, ['cls', 'lessons', 'status'])
  async function create(sel: ClsNode) {
    if (!orgId) return
    const { data, error } = await supabase.from('dist_plans').insert({ org_id: orgId, title: 'Bản phân phối mới', node_id: sel.id }).select('id').single()
    if (error) return setErr(errText(error.message))
    onCreated((data as { id: string }).id)
  }
  return <ClsTree scope="dist" items={plans} focus={focus}
    header={({ sel, isFinal }) => <>
      {isFinal && sel && !hid('create') && <button type="button" className="primary" disabled={!orgId} onClick={() => create(sel)}>+ Tạo bản phân phối</button>}
      {menu}</>}>
    {(shown, { isFinal }) => <>
      {err && <p className="msg">{err}</p>}
      <div className="wrap"><table className="libtable">
        <thead><tr>{COLS.filter(c => has(c.key)).map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>{shown.map(p => <tr key={p.id}><PlanCells p={p} m={meta.get(p.id)} has={has} crumb={crumb(p)} onOpen={() => onOpen(p.id)} /></tr>)}
          {shown.length === 0 && <tr><td colSpan={COLS.length}>{isFinal ? 'Chưa có bản nào trong mục này. Bấm “+ Tạo bản phân phối”.' : 'Chưa có bản nào trong mục này.'}</td></tr>}</tbody>
      </table></div></>}
  </ClsTree>
}

// ===== Tab "Danh sách bản phân phối" =====
type SortKey = 'title' | 'cls' | 'parts' | 'lessons' | 'books' | 'status' | 'updated'
/** Bộ lọc danh sách, giữ ở trang để thẻ tổng số tính theo (card: thẻ đang bấm) */
type ListF = { fs: Status | ''; q: string; fc: string; card: string | null }
const listMatch = (p: Plan, f: ListF, crumb: (p: Plan) => string) =>
  (!f.fc || crumb(p) === f.fc) && (!f.q || `${p.code} ${p.title} ${crumb(p)}`.toLowerCase().includes(f.q.toLowerCase()))
function DistList({ plans, meta, f, setF, canCreate, onCreate, onOpen, onCopied, onAssign }: {
  plans: Plan[]; meta: Map<string, Meta>; f: ListF; setF: (f: ListF) => void; canCreate: boolean; onCreate: () => void; onOpen: (p: Plan) => void; onCopied: (id: string | null, msg: string) => void; onAssign: (id: string) => void
}) {
  const crumb = useBreadcrumb()
  const hid = useHiddenBtn()
  const { fs, q, fc, card } = f
  const setFs = (fs: Status | '') => setF({ ...f, fs, card: null })
  const setQ = (q: string) => setF({ ...f, q })
  const setFc = (fc: string) => setF({ ...f, fc })
  const [sort, setSort] = useState<[SortKey, 1 | -1]>(['title', 1])
  const [err, setErr] = useState('')
  const { has, menu } = useCols('dist-list-cols', COLS, COLS.map(c => c.key))
  const classes = useMemo(() => [...new Set(plans.map(p => crumb(p)))].sort(), [plans, crumb])
  const shown = useMemo(() => {
    const val = (p: Plan): string | number => {
      const m = meta.get(p.id)
      switch (sort[0]) {
        case 'cls': return crumb(p); case 'parts': return m?.programs ?? 0; case 'lessons': return m?.periods ?? 0; case 'books': return m?.books ?? 0
        case 'status': return p.status; case 'updated': return p.updated_at; default: return p.code + ' ' + p.title
      }
    }
    return plans.filter(p => (!fs || p.status === fs) && listMatch(p, f, crumb)
      && (card !== 'published' || p.status === 'published') && (card !== 'books' || (meta.get(p.id)?.books ?? 0) > 0))
      .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort[1] })
  }, [plans, meta, f, sort, crumb])
  const sel = useMultiSel(shown)
  const picked = sel.list
  const one = picked.length === 1 ? picked[0] : null
  const [busy, setBusy] = useState(false)
  async function copy(ps: Plan[]) {
    setBusy(true); setErr('')
    let last: string | null = null
    for (const p of ps) {
      const { data, error } = await supabase.rpc('dist_plan_copy', { p_plan: p.id })
      if (error) { setBusy(false); return setErr(`${p.code}: ${errText(error.message)}`) }
      last = data as string
    }
    setBusy(false); sel.clear()
    if (ps.length === 1) onCopied(last, `Đã nhân bản ${ps[0].code} thành bản nháp mới.`)
    else onCopied(null, `Đã nhân bản ${ps.length} bản thành bản nháp mới.`)
  }
  const n = (s: Status) => plans.filter(p => p.status === s && listMatch(p, f, crumb)).length
  const th = (k: SortKey, label: string) => <th key={k}><button type="button" className="distsort" onClick={() => setSort([k, sort[0] === k ? (-sort[1] as 1 | -1) : 1])}>
    {label} <small aria-hidden="true">{sort[0] === k ? (sort[1] === 1 ? '↑' : '↓') : '↕'}</small></button></th>
  return (
    <>
      <div className="distfilter">
        {([['', 'Tất cả', plans.filter(p => listMatch(p, f, crumb)).length], ['draft', 'Nháp', n('draft')], ['published', 'Đã phát hành', n('published')], ['superseded', 'Đã thay thế', n('superseded')], ['archived', 'Ngừng dùng', n('archived')]] as [Status | '', string, number][]).map(([s, l, c]) =>
          <button key={l} type="button" className={'distfchip' + (fs === s ? ' on' : '')} aria-pressed={fs === s} onClick={() => setFs(s)}>{l} <b>{c}</b></button>)}
      </div>
      <div className="distfilter">
        <input placeholder="Tìm tên, mã, phân loại…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        <select value={fc} onChange={e => setFc(e.target.value)} aria-label="Phân loại"><option value="">Tất cả phân loại</option>{classes.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <small className="sub">{shown.length}/{plans.length} bản</small>
        {!hid('create') && <button type="button" className="primary distcreate" disabled={!canCreate} onClick={onCreate}>+ Tạo bản phân phối</button>}
      </div>
      {err && <p className="msg">{err}</p>}
      <div className="panel">
        <div className="bar"><b>Bản phân phối</b>
          <div className="tools">
            {picked.length > 0 && <small className="sub">Đã chọn: <b>{one ? one.code : picked.length + ' bản'}</b> <button type="button" className="linkbtn" onClick={sel.clear}>Bỏ chọn</button></small>}
            <button type="button" disabled={!picked.length || busy} onClick={() => copy(picked)}>Nhân bản{picked.length > 1 ? ` (${picked.length})` : ''}</button>
            <button type="button" className="primary" disabled={!one || one.status !== 'published'}
              title={picked.length > 1 ? 'Gán trường làm cho từng bản một' : one && one.status !== 'published' ? 'Chỉ gán bản đã phát hành' : undefined}
              onClick={() => one && onAssign(one.id)}>Gán trường</button>
            {menu}
          </div>
        </div>
        <div className="wrap"><table className="libtable">
          <thead><tr><SelAllTh all={sel.all} some={sel.some} onToggle={sel.toggleAll} />
            {th('title', 'Bản phân phối')}{has('cls') && th('cls', 'Phân loại')}{has('parts') && th('parts', 'Thành phần')}{has('lessons') && th('lessons', 'Bài · tiết')}
            {has('books') && th('books', 'Đã gán')}{has('status') && th('status', 'Trạng thái')}{has('updated') && th('updated', 'Cập nhật')}</tr></thead>
          <tbody>{shown.map(p => <tr key={p.id} className={sel.is(p) ? 'picked' : undefined}>
            <td className="sel"><input type="checkbox" checked={sel.is(p)} onChange={() => sel.toggle(p)} aria-label={'Chọn ' + p.code} /></td>
            <PlanCells p={p} m={meta.get(p.id)} has={has} crumb={crumb(p)} onOpen={() => onOpen(p)} /></tr>)}
            {shown.length === 0 && <tr><td colSpan={COLS.length + 1}>{plans.length ? 'Không có bản nào khớp bộ lọc.' : 'Chưa có bản phân phối nào. Bấm “+ Tạo bản phân phối”.'}</td></tr>}</tbody>
        </table></div>
      </div>
    </>
  )
}

// ===== Tab "Gán theo trường" =====
type Org = { id: string; name: string; type: string; parent_id: string | null; level?: string | null }
type Cls = { id: string; name: string; grade: number; org_id: string }
const LEVEL_RE: Record<string, RegExp> = { mamnon: /mầm non|mẫu giáo|nhà trẻ/i, tieuhoc: /tiểu học|\bTH\b/, thcs: /THCS|trung học cơ sở/i, thpt: /THPT|trung học phổ thông/i }

function DistAssign({ orgId, plans, initial, onDone, onHistory }: { orgId: string | null; plans: Plan[]; initial: string; onDone: () => void; onHistory: () => void }) {
  const crumb = useBreadcrumb()
  const [pid, setPid] = useState(initial)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [year, setYear] = useState('')
  const [classes, setClasses] = useState<Cls[]>([])
  const [cls, setCls] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [rk, setRk] = useState(0)
  const pub = plans.filter(p => p.status === 'published')
  const plan = pub.find(p => p.id === pid) ?? null
  useEffect(() => { setPid(initial) }, [initial])
  // Chỉ có một bản đã phát hành: chọn sẵn để thấy ngay phần chọn trường
  useEffect(() => { if (!pid && pub.length === 1) setPid(pub[0].id) }, [pub.length, pid]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(() => supabase.from('organizations').select('id, name, type, parent_id, level').order('name').order('id')).then(({ data }) => setOrgs((data as Org[]) ?? [])) }, [])
  useEffect(() => {
    setCls([])
    if (picked.length !== 1 || !plan) { setClasses([]); return }
    supabase.from('classes').select('id, name, grade, org_id').eq('org_id', picked[0]).eq('grade', plan.grade).order('name').then(({ data }) => setClasses((data as Cls[]) ?? []))
  }, [picked.join(','), plan?.id])
  // Chỉ hiện trường đúng cấp học của bản (bản THCS khối 6 thì không hiện trường mầm non, tiểu học);
  // trường liên cấp nhận ra qua tên (vd. "TH, THCS và THPT …"), trường chưa khai báo cấp vẫn hiện
  const fitsLevel = (o: Org) => !plan?.level || !o.level || o.level === plan.level || LEVEL_RE[plan.level]?.test(o.name)
  const schools = orgs.filter(o => o.type === 'school' && fitsLevel(o))
  // Đổi bản khác cấp: bỏ các trường đã chọn không còn hợp
  useEffect(() => { setPicked(p => p.filter(id => schools.some(o => o.id === id))) }, [plan?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Trường tự gán vẫn gửi duyệt PPCT như thường lệ; cấp trên / quản trị nền tảng mới áp dụng thẳng (DB cũng chặn, migration 134)
  const canApply = !orgId || orgs.find(o => o.id === orgId)?.type !== 'school'

  /** publish = áp dụng luôn: PPCT ban hành ngay, lớp theo dõi tiến độ được luôn (không chờ trường ban hành) */
  async function assign(publish = false) {
    if (!plan || !picked.length) return
    if (publish && !confirm(`Gán và áp dụng ngay cho ${picked.length} trường? PPCT chuyển sang "Đang dùng", ${cls.length ? 'các lớp đã chọn' : 'lớp khối ' + plan.grade} theo dõi tiến độ theo PPCT này.`)) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('dist_plan_assign', { p_plan: plan.id, p_orgs: picked, p_year: year.trim() || null, p_classes: cls.length ? cls : null, ...(publish ? { p_publish: true } : {}) })
    setBusy(false)
    if (error) return setMsg([/p_publish|function .*does not exist|schema cache/i.test(error.message) ? 'Chưa chạy migration 134 trên cơ sở dữ liệu nên chưa áp dụng ngay được.' : errText(error.message), true])
    const r = data as { books: number; skipped: number; published?: number }
    setMsg([publish
      ? `Đã áp dụng ${r.published ?? 0} PPCT cho ${picked.length} trường (tạo mới ${r.books}${r.skipped ? `, ${r.skipped} đã có từ trước` : ''}). PPCT đang dùng, lớp theo dõi tiến độ được ngay.`
      : `Đã tạo ${r.books} PPCT nháp cho ${picked.length} trường${r.skipped ? `; ${r.skipped} PPCT đã có từ trước nên bỏ qua` : ''}. Trường kiểm tra rồi ban hành PPCT như thường lệ.`, false])
    setPicked([]); setRk(k => k + 1); onDone()
  }

  return (
    <>
      <div className="panel">
        <div className="formgrid">
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Bản phân phối đã phát hành</span>
            <select value={pid} onChange={e => setPid(e.target.value)}><option value="">— chọn bản —</option>{pub.map(p => <option key={p.id} value={p.id}>{p.code} v{p.version_no ?? 1} · {p.title} ({crumb(p)})</option>)}</select></label>
          <label className="field"><span>Năm học</span><YearSelect value={year} onChange={setYear} emptyLabel="Năm học hiện tại của trường" /></label>
        </div>
        {pub.length === 0 && <p className="sub">Chưa có bản nào đã phát hành. Phát hành bản ở tab “Danh sách bản phân phối”.</p>}
        {!plan && pub.length > 0 && <>
          <p className="sub">Chọn một bản đã phát hành để chọn trường và gán.</p>
          <div className="wrap"><table className="libtable">
            <thead><tr><th>Bản phân phối</th><th>Phân loại</th><th>Khối</th></tr></thead>
            <tbody>{pub.map(p => <tr key={p.id}><td><button type="button" className="namelink" onClick={() => setPid(p.id)}>{p.code} · {p.title}</button> <small className="sub">v{p.version_no ?? 1}</small></td>
              <td><small>{crumb(p)}</small></td><td>{p.grade ? gradeName(p.grade) : '—'}</td></tr>)}</tbody>
          </table></div>
        </>}
        {plan && <>
          <div className="field" style={{ marginBottom: 10 }}><span>Tỉnh / Sở và trường ({picked.length} đã chọn)</span>
            <SchoolPicker value={picked} onChange={setPicked} options={schools} empty="Không có trường nào đúng cấp học trong phạm vi." /></div>
          {picked.length === 1 && <fieldset className="libtargets wide"><legend>Lớp khối {plan.grade} (không chọn = áp dụng cả khối)</legend>
            <MultiSelect value={cls} onChange={setCls} options={classes.map(c => [c.id, c.name])} placeholder="Cả khối" ariaLabel="Lớp" empty={`Trường chưa có lớp khối ${plan.grade}.`} /></fieldset>}
          <div className="formactions"><button type="button" className="primary" disabled={busy || !picked.length} onClick={() => assign()}>Gán và tạo PPCT</button>
            {canApply && <button type="button" disabled={busy || !picked.length} onClick={() => assign(true)}>Gán và áp dụng ngay</button>}
            <small className="sub"> Gán và tạo PPCT: mỗi chương trình trong bản thành một PPCT nháp, trường kiểm tra rồi ban hành.{canApply && ' Gán và áp dụng ngay: PPCT ban hành luôn, lớp dùng được ngay.'} Tiết xếp đúng tuần của bản; gán lại không tạo trùng.</small></div>
        </>}
        {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      </div>
      <PlanAssigned plans={plans} plan={plan} rk={rk} />
      <p className="sub">Các lần đã gán, theo năm học và phiên bản: <button type="button" className="linkbtn" onClick={onHistory}>Xem lịch sử áp dụng</button></p>
    </>
  )
}

// ===== Tạo bản phân phối: đặt tên, chọn phân loại (mục cấp cuối), ghi chú =====
function CreatePlan({ orgId, onCancel, onCreated }: { orgId: string; onCancel: () => void; onCreated: (id: string) => void }) {
  const { active, nodes, path, ready } = useCls('dist')
  const last = active[active.length - 1]
  const finals = useMemo(() => nodes.filter(n => n.cls_level_id === last?.id)
    .map(n => [n.id, path(n.id).map(x => x.name).join(' › ')] as [string, string]).sort((a, b) => a[1].localeCompare(b[1], 'vi')), [nodes, last?.id])
  const [title, setTitle] = useState('')
  const [node, setNode] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setErr('Nhập tên bản phân phối.')
    if (!node) return setErr('Chọn phân loại cho bản.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('dist_plans').insert({ org_id: orgId, title: title.trim(), node_id: node, note: note.trim() || null }).select('id').single()
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onCreated((data as { id: string }).id)
  }
  return <form className="panel distpanel" onSubmit={submit}>
    <div className="disthead"><button type="button" className="distback" onClick={onCancel}>← Danh sách bản phân phối</button></div>
    <h2 className="disttitle">Tạo bản phân phối</h2>
    <p className="sub">Đặt tên và chọn phân loại. Bước sau: chọn chương trình, xếp lịch và phát hành.</p>
    <div className="distnamegrid">
      <label className="field"><span>Tên bản phân phối *</span>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} autoFocus placeholder="VD: Phân phối STEM Tiểu học khối 1 — cơ bản" /></label>
      <label className="field"><span>Phân loại ({active.map(l => l.name.toLowerCase()).join(' › ') || '…'}) *</span>
        <select value={node} onChange={e => setNode(e.target.value)} aria-label="Phân loại"><option value="">— chọn —</option>
          {finals.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
      <label className="field distnamewide"><span>Ghi chú</span>
        <input value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="Mục tiêu, đối tượng áp dụng…" /></label>
    </div>
    {ready && finals.length === 0 && <p className="sub">Khung phân loại chưa có mục {last?.name.toLowerCase() ?? ''} nào. Thêm mục ở tab “Theo khung phân loại”.</p>}
    {err && <p className="msg">{err}</p>}
    <div className="formactions"><button type="submit" className="primary" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo và soạn tiếp'}</button>
      <button type="button" onClick={onCancel}>Huỷ</button></div>
  </form>
}
