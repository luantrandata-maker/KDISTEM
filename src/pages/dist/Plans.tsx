// Phân phối chương trình — theo video demo được duyệt (23/10). Một trang gồm:
//  hướng dẫn 3 bước · 3 thẻ số liệu · 3 tab: Bản phân phối (khung phân loại + các bản trong mục + trình soạn),
//  Danh sách bản phân phối (lọc, sắp xếp, xem bản đã phát hành), Gán theo trường (tạo PPCT theo trường).
// Theo dõi thực hiện nằm ở menu riêng "Theo dõi Chương trình/Môn học".
import { MultiSelect } from '../../components/MultiSelect'
import { useHiddenBtn } from '../../components/PageButtons'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useRowSel } from '../../components/TableSel'
import { useCls, type ClsLevel, type ClsNode } from './cls'
import { Drawer } from '../../components/Drawer'
import { PlanBody, Chip, STATUS, errText, useBreadcrumb } from './Editor'
import type { Plan, Status } from './sched'

export type { Plan } from './sched'
type Tab = 'tree' | 'list' | 'assign'
type Meta = { programs: number; subjects: number; lessons: number; periods: number; books: number }
type Book = { id: string; title: string; status: string; year_name: string | null; org_id: string; dist_plan_id: string; program_id: string | null; curriculum_lessons: { count: number }[] }
const BOOK_STATUS: Record<string, string> = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị trả lại', published: 'Đã ban hành' }
const PLAN_SEL = 'id, org_id, code, title, level, grade, tier, node_id, status, hk1_weeks, hk2_weeks, note, updated_at, published_at'

function useDistData(rk: number) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map())
  const [books, setBooks] = useState<Book[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    (async () => {
      const [pl, it, rw, bk] = await Promise.all([
        supabase.from('dist_plans').select(PLAN_SEL).order('code'),
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
  const [tab, setTab] = useState<Tab>('tree')
  const [rk, setRk] = useState(0)
  const { plans, meta, books, err } = useDistData(rk)
  const [openTree, setOpenTree] = useState<string | null>(null)
  const [openList, setOpenList] = useState<string | null>(null)
  const [assignId, setAssignId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
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
  const pub = (plans ?? []).filter(p => p.status === 'published').length
  const drafts = (plans ?? []).filter(p => p.status === 'draft').length
  const steps: [Tab, string, string][] = [
    ['tree', 'Soạn bản phân phối', 'Chọn nhánh trong Khung phân loại, tick chương trình phù hợp, xếp lịch học kỳ và nhịp tiết/tuần, xem Bảng hoặc Lịch rồi Lưu nháp.'],
    ['list', 'Phát hành bản', 'Soát cảnh báo (lỗi sẽ chặn phát hành), rồi chuyển bản sang Đã phát hành. Xem tất cả bản ở danh sách này.'],
    ['assign', 'Gán theo trường', 'Gán bản đã phát hành cho trường, lớp, năm học và học kỳ để tạo PPCT theo trường.']]
  return (
    <>
      <div className="panel distintro">
        <ol className="distguide">{steps.map(([t, h, d], k) => <li key={t}>
          <button type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}><i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
        <p className="sub" style={{ margin: 0 }}>Bản phân phối là mẫu lắp ghép từ nhiều chương trình. PPCT theo trường là bản đã gán cho từng trường, lớp để theo dõi.</p>
      </div>
      <div className="diststatcards">
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{plans?.length ?? '…'}</b><small>Bản phân phối</small><small>{pub} đã phát hành · {drafts} nháp</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{plans ? pub : '…'}</b><small>Bản có thể gán</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">▦</i><span><b>{books.length}</b><small>PPCT theo trường</small><small>{books.filter(b => b.status === 'published').length} đã ban hành</small></span></div>
      </div>
      <div className="distpills" role="tablist">
        {([['tree', 'Bản phân phối'], ['list', 'Danh sách bản phân phối'], ['assign', 'Gán theo trường']] as [Tab, string][]).map(([t, l]) =>
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setMsg(null) }}>{l}</button>)}
      </div>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      {!plans ? <p className="sub">Đang tải…</p> : <>
        {tab === 'tree' && (openTree && plans.some(p => p.id === openTree)
          ? <PlanBody key={openTree + ':' + rk} plan={plans.find(p => p.id === openTree)!} back={() => { setOpenTree(null); setMsg(null) }} backLabel="Các bản trong mục"
              onChanged={changed('tree')} onAssign={assign} />
          : <DistTree orgId={orgId} plans={plans} meta={meta} focus={openTree} onOpen={id => { setOpenTree(id); setMsg(null) }} onCreated={id => { reload(); setOpenTree(id) }} />)}
        {tab === 'list' && (openList && plans.some(p => p.id === openList)
          ? <PlanBody key={openList + ':' + rk} plan={plans.find(p => p.id === openList)!} back={() => { setOpenList(null); setMsg(null) }} backLabel="Danh sách"
              onChanged={changed('list')} onAssign={assign} />
          : <DistList plans={plans} meta={meta} onOpen={p => { setMsg(null); if (p.status === 'draft') { setOpenTree(p.id); setTab('tree') } else setOpenList(p.id) }}
              onCopied={(id, m) => { reload(); setMsg(m); setOpenTree(id); setTab('tree') }} onAssign={assign} />)}
        {tab === 'assign' && <DistAssign plans={plans} books={books} initial={assignId} onDone={reload} />}
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
    <td><button type="button" className="namelink" onClick={onOpen}>{p.title}</button><br /><small className="sub">{p.code}</small></td>
    {has('cls') && <td>{crumb}</td>}
    {has('parts') && <td>{m?.programs ?? 0} chương trình · {m?.subjects ?? 0} môn</td>}
    {has('lessons') && <td>{m?.lessons ?? 0} bài · {m?.periods ?? 0} tiết</td>}
    {has('books') && <td>{m?.books ?? 0} PPCT</td>}
    {has('status') && <td><Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip></td>}
    {has('updated') && <td><small>{new Date(p.updated_at).toLocaleDateString('vi-VN')}</small></td>}
  </>
}

// ===== Tab "Bản phân phối": cấu hình cấp + khung phân loại + các bản trong mục =====
const clsErr = (m: string) => /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được khung phân loại.'
  : /23503|foreign key/i.test(m) ? 'Mục đang có mục con hoặc bản phân phối nên không xoá được.'
  : /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 082 trên Supabase.' : errText(m)
type AddForm = { mode: 'add'; level: ClsLevel; parent: ClsNode | null; name: string } | { mode: 'rename'; node: ClsNode; level: ClsLevel | undefined; name: string }

function ClsConfig({ cls, used, onMsg }: { cls: ReturnType<typeof useCls> & { admin: boolean }; used: (levelId: string) => number; onMsg: (m: [string, boolean]) => void }) {
  const hid = useHiddenBtn()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [pos, setPos] = useState('end')
  const lv = cls.levels
  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    const { error } = await p
    if (error) onMsg([clsErr(error.message), true]); else if (ok) onMsg([ok, false])
    await cls.reload()
  }
  /** Thứ tự xen giữa hai cấp kề nhau (thứ tự thưa 10, 20, 30…) */
  const between = (a: number | undefined, b: number | undefined) => a == null ? (b ?? 10) - 10 : b == null ? a + 10 : Math.floor((a + b) / 2)
  function move(i: number, d: -1 | 1) {
    const l = lv[i], j = i + d
    if (!lv[j]) return
    const s = d < 0 ? between(lv[j - 1]?.sort, lv[j].sort) : between(lv[j].sort, lv[j + 1]?.sort)
    if (s === lv[j].sort || s === lv[j + d]?.sort) return onMsg(['Hai cấp đứng quá sát nhau, hãy xoá rồi thêm lại cấp ở vị trí mới.', true])
    run(supabase.from('dist_cls_levels').update({ sort: s }).eq('id', l.id))
  }
  async function add() {
    const n = name.trim(); if (!n) return
    const i = pos === 'end' ? lv.length - 1 : lv.findIndex(l => l.id === pos)
    await run(supabase.from('dist_cls_levels').insert({ name: n, kind: 'custom', sort: between(lv[i]?.sort, lv[i + 1]?.sort) }), `Đã thêm cấp “${n}”.`)
    setName('')
  }
  const locked = (l: ClsLevel) => l.kind === 'level' || l.kind === 'grade'
  return <div className="panel distcls">
    <div className="bar small"><b>Cấu hình cấp phân loại</b>
      {cls.admin && <button type="button" onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : 'Cấu hình cấp'}</button>}</div>
    {!open ? <div className="distclschips">{cls.active.map((l, k) => <span key={l.id}>{k > 0 && <i aria-hidden="true">→</i>}<span className="chip">{l.name}</span></span>)}</div> : <>
      <ol className="distclslist">{lv.map((l, i) => {
        const has = used(l.id) > 0
        return <li key={l.id}>
          <i>{i + 1}</i>
          <input defaultValue={l.name} aria-label={'Tên cấp ' + (i + 1)} maxLength={40}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== l.name) run(supabase.from('dist_cls_levels').update({ name: v }).eq('id', l.id)); else e.target.value = l.name }} />
          <span className={'pill ' + (l.active ? 'active' : 'inactive')}>{l.active ? 'Đang bật' : 'Đang tắt'}</span>
          <button type="button" aria-label="Chuyển lên" disabled={!i || has} title={has ? 'Cấp đã có mục trong cây' : undefined} onClick={() => move(i, -1)}>↑</button>
          <button type="button" aria-label="Chuyển xuống" disabled={i === lv.length - 1 || has} title={has ? 'Cấp đã có mục trong cây' : undefined} onClick={() => move(i, 1)}>↓</button>
          <button type="button" disabled={locked(l)} title={locked(l) ? 'Bản phân phối cần cấp này' : undefined}
            onClick={() => run(supabase.from('dist_cls_levels').update({ active: !l.active }).eq('id', l.id))}>{l.active ? 'Tắt cấp' : 'Bật cấp'}</button>
          <button type="button" disabled={locked(l) || has} title={locked(l) ? 'Bản phân phối cần cấp này' : has ? 'Cấp đã có mục trong cây' : undefined}
            onClick={() => confirm(`Xoá cấp “${l.name}”?`) && run(supabase.from('dist_cls_levels').delete().eq('id', l.id), `Đã xoá cấp “${l.name}”.`)}>Xóa</button>
        </li>
      })}</ol>
      <div className="distclsadd">
        <input placeholder="Tên cấp mới, ví dụ: Giai đoạn" value={name} maxLength={40} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} aria-label="Tên cấp mới" />
        <select value={pos} onChange={e => setPos(e.target.value)} aria-label="Vị trí"><option value="end">Đặt ở cuối</option>
          {lv.slice(0, -1).map(l => <option key={l.id} value={l.id}>Sau {l.name}</option>)}</select>
        {!hid('tier') && <button type="button" className="primary" disabled={!name.trim()} onClick={add}>+ Thêm cấp</button>}
      </div>
      <p className="sub" style={{ margin: 0 }}>Tên cấp và việc tắt/bật đổi được bất cứ lúc nào. Đổi thứ tự hoặc xóa cấp chỉ làm được khi cấp đó chưa có mục trong cây. Bản phân phối chỉ gắn vào mục ở cấp cuối đang bật.</p>
    </>}
  </div>
}

function DistTree({ orgId, plans, meta, focus, onOpen, onCreated }: {
  orgId: string | null; plans: Plan[]; meta: Map<string, Meta>; focus: string | null; onOpen: (id: string) => void; onCreated: (id: string) => void
}) {
  const hid = useHiddenBtn()
  const base = useCls()
  const crumb = useBreadcrumb()
  const [admin, setAdmin] = useState(false)
  const cls = { ...base, admin }
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [depth, setDepth] = useState<number | null>(null)
  const [exp, setExp] = useState<Set<string>>(new Set())
  const [selId, setSelId] = useState<string | null>(null)
  const [form, setForm] = useState<AddForm | null>(null)
  const { has, menu } = useCols('dist-tree-cols', COLS, ['cls', 'lessons', 'status'])
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)) }, [])

  const { nodes, active, byId, lvOf } = base
  const lvIdx = (n: ClsNode) => active.findIndex(l => l.id === n.cls_level_id)
  const last = active[active.length - 1]
  /** Cha hiển thị: mục cha gần nhất thuộc cấp đang bật (mục của cấp đang tắt được ẩn, mục con lên thay) */
  const shownParent = (n: ClsNode) => { let p = n.parent_id ? byId.get(n.parent_id) : undefined; while (p && !lvOf(p)?.active) p = p.parent_id ? byId.get(p.parent_id) : undefined; return p?.id ?? null }
  const kids = useMemo(() => {
    const m = new Map<string | null, ClsNode[]>()
    for (const n of nodes) if (lvOf(n)?.active) { const k = shownParent(n); m.set(k, [...(m.get(k) ?? []), n]) }
    for (const a of m.values()) a.sort((x, y) => lvIdx(x) - lvIdx(y) || x.sort - y.sort || x.name.localeCompare(y.name, 'vi', { numeric: true }))
    return m
  }, [nodes, active.map(l => l.id).join()])
  // Số bản trong mỗi mục (tính cả mục con) và danh sách mục chứa từng bản
  const under = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const p of plans) for (let n = p.node_id ? byId.get(p.node_id) : undefined; n; n = n.parent_id ? byId.get(n.parent_id) : undefined) {
      if (!m.has(n.id)) m.set(n.id, new Set()); m.get(n.id)!.add(p.id)
    }
    return m
  }, [plans, nodes])
  const sel = selId ? byId.get(selId) ?? null : null
  // Mở sẵn nhánh có bản; chọn mục của bản vừa xem hoặc mục đầu tiên
  useEffect(() => {
    if (!nodes.length) return
    const e = new Set<string>(kids.get(null)?.map(n => n.id))
    for (const p of plans) for (let n = p.node_id ? byId.get(p.node_id) : undefined; n; n = n.parent_id ? byId.get(n.parent_id) : undefined) if (n.id !== p.node_id) e.add(n.id)
    setExp(e)
    if (!sel) { const f = plans.find(p => p.id === focus) ?? plans.find(p => p.node_id); setSelId(f?.node_id ?? kids.get(null)?.[0]?.id ?? null) }
  }, [nodes.length, plans.length])
  function showTo(d: number) {
    setDepth(d)
    setExp(new Set(nodes.filter(n => { const i = lvIdx(n); return i >= 0 && i < d }).map(n => n.id)))
  }
  const toggle = (k: string) => setExp(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const isFinal = !!sel && !!last && sel.cls_level_id === last.id
  const nextLv = (n: ClsNode | null) => n ? active[lvIdx(n) + 1] : active[0]
  async function create() {
    if (!orgId || !sel || !isFinal) return
    const { data, error } = await supabase.from('dist_plans').insert({ org_id: orgId, title: 'Bản phân phối mới', node_id: sel.id }).select('id').single()
    if (error) return setMsg([/22023/.test(error.code ?? '') || /chưa thuộc cấp học/.test(error.message) ? clsErr(error.message) : errText(error.message), true])
    onCreated((data as { id: string }).id)
  }
  async function saveForm(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const name = form.name.trim(); if (!name) return
    if (form.mode === 'add') {
      const sibs = form.parent ? (kids.get(form.parent.id) ?? []) : (kids.get(null) ?? [])
      const { data, error } = await supabase.from('dist_nodes').insert({ cls_level_id: form.level.id, parent_id: form.parent?.id ?? null, name, sort: sibs.reduce((m, n) => Math.max(m, n.sort), 0) + 1 }).select('id').single()
      if (error) return setMsg([clsErr(error.message), true])
      setMsg([`Đã thêm ${form.level.name.toLowerCase()} “${name}”.`, false])
      if (form.parent) setExp(s => new Set(s).add(form.parent!.id))
      setSelId((data as { id: string }).id)
    } else {
      const { error } = await supabase.from('dist_nodes').update({ name }).eq('id', form.node.id)
      if (error) return setMsg([clsErr(error.message), true])
    }
    setForm(null); base.reload()
  }
  async function remove(n: ClsNode) {
    if (nodes.some(x => x.parent_id === n.id)) return setMsg(['Mục còn mục con, hãy xoá các mục con trước.', true])
    if (under.get(n.id)?.size) return setMsg(['Mục đang có bản phân phối nên không xoá được.', true])
    if (!confirm(`Xoá “${n.name}” khỏi khung phân loại?`)) return
    const { error } = await supabase.from('dist_nodes').delete().eq('id', n.id)
    if (error) return setMsg([clsErr(error.message), true])
    setSelId(shownParent(n)); base.reload()
  }

  const shown = sel ? plans.filter(p => under.get(sel.id)?.has(p.id)) : []
  const selCrumb = sel ? base.path(sel.id).map(n => n.name).join(' › ') : ''
  const tree = (pid: string | null): ReactNode => (kids.get(pid) ?? []).map(n => {
    const c = under.get(n.id)?.size ?? 0, on = sel?.id === n.id, open = exp.has(n.id), sub = kids.get(n.id)?.length
    return <div key={n.id}>
      <div className={'distnode' + (on ? ' on' : '')} style={{ paddingLeft: Math.max(0, base.path(n.id).length - 1) * 16 }}>
        {sub ? <button type="button" className="caret" aria-label={open ? 'Thu gọn' : 'Mở'} aria-expanded={open} onClick={() => toggle(n.id)}>{open ? '▾' : '▸'}</button> : <span className="caret" />}
        <button type="button" className="nodebtn" aria-current={on || undefined} onClick={() => setSelId(n.id)}><b>{n.name}</b> <small>{lvOf(n)?.name}</small>{c > 0 && <span className="count">{c}</span>}</button>
      </div>
      {open && tree(n.id)}
    </div>
  })
  const nx = nextLv(sel)
  return (
    <>
      <ClsConfig cls={cls} used={id => nodes.filter(n => n.cls_level_id === id).length} onMsg={setMsg} />
      <div className="distlayout">
        <nav className="panel disttree" aria-label="Khung phân loại">
          <div className="bar small"><b>Khung phân loại</b>{admin && active[0] && <button type="button" onClick={() => setForm({ mode: 'add', level: active[0], parent: null, name: '' })}>+ Thêm {active[0].name.toLowerCase()}</button>}</div>
          <div className="distdepth"><small className="sub">Hiển thị đến:</small>
            <div className="segmented">{active.map((l, i) =>
              <button key={l.id} type="button" className={depth === i ? 'on' : ''} onClick={() => showTo(i)}>{l.name}</button>)}</div></div>
          {base.ready && !nodes.length && <small className="sub">Chưa có mục nào. {admin ? `Bấm “+ Thêm ${active[0]?.name.toLowerCase() ?? 'mục'}”.` : ''}</small>}
          {tree(null)}
          {admin && sel && <div className="distnodefoot"><b>{sel.name}</b>
            <span className="tools">
              {nx && <button type="button" onClick={() => setForm({ mode: 'add', level: nx, parent: sel, name: '' })}>+ Thêm {nx.name.toLowerCase()}</button>}
              <button type="button" onClick={() => setForm({ mode: 'rename', node: sel, level: lvOf(sel), name: sel.name })}>Đổi tên</button>
              <button type="button" onClick={() => remove(sel)}>Xóa</button></span></div>}
        </nav>
        <div className="panel">
          <div className="bar">
            <div><h3 style={{ margin: 0 }}>{sel?.name ?? 'Chọn một mục'}</h3><small className="sub">{selCrumb}</small></div>
            <div className="tools">
              {isFinal && !hid('create') && <button type="button" className="primary" disabled={!orgId} onClick={create}>+ Tạo bản phân phối</button>}
              {menu}
            </div>
          </div>
          {sel && !isFinal && <p className="sub">Đây chưa phải cấp cuối. Chọn mục {last?.name.toLowerCase()} bên trong để tạo bản; bên dưới là các bản đã có trong mục này.</p>}
          {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
          <div className="wrap"><table className="libtable">
            <thead><tr>{COLS.filter(c => has(c.key)).map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{shown.map(p => <tr key={p.id}><PlanCells p={p} m={meta.get(p.id)} has={has} crumb={crumb(p)} onOpen={() => onOpen(p.id)} /></tr>)}
              {shown.length === 0 && <tr><td colSpan={COLS.length}>{isFinal ? 'Chưa có bản nào trong mục này. Bấm “+ Tạo bản phân phối”.' : 'Chưa có bản nào trong mục này.'}</td></tr>}</tbody>
          </table></div>
        </div>
      </div>
      {form && <Drawer title={form.mode === 'add' ? `Thêm ${form.level.name.toLowerCase()}` : 'Đổi tên'} onClose={() => setForm(null)} closeOnOutside={false}>
        <form className="formgrid" onSubmit={saveForm}>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>{form.level?.name ?? 'Tên'}</span>
            <input autoFocus required maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder={'Ví dụ: ' + (({ level: 'Mầm non', grade: 'Khối 6', tier: 'Tăng cường', custom: 'Giai đoạn 1' } as Record<string, string>)[form.level?.kind ?? 'custom'])} />
            {form.mode === 'add' && form.parent && <small className="sub">Thuộc: {base.path(form.parent.id).map(n => n.name).join(' › ')}</small>}
          </label>
          <div className="formactions" style={{ gridColumn: '1 / -1' }}><button type="submit" className="primary" disabled={!form.name.trim()}>Lưu</button><button type="button" onClick={() => setForm(null)}>Hủy</button></div>
        </form>
      </Drawer>}
    </>
  )
}

// ===== Tab "Danh sách bản phân phối" =====
type SortKey = 'title' | 'cls' | 'parts' | 'lessons' | 'books' | 'status' | 'updated'
function DistList({ plans, meta, onOpen, onCopied, onAssign }: {
  plans: Plan[]; meta: Map<string, Meta>; onOpen: (p: Plan) => void; onCopied: (id: string, msg: string) => void; onAssign: (id: string) => void
}) {
  const crumb = useBreadcrumb()
  const [fs, setFs] = useState<Status | ''>('')
  const [q, setQ] = useState('')
  const [fc, setFc] = useState('')
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
    return plans.filter(p => (!fs || p.status === fs) && (!fc || crumb(p) === fc)
      && (!q || `${p.code} ${p.title} ${crumb(p)}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort[1] })
  }, [plans, meta, fs, fc, q, sort, crumb])
  const sel = useRowSel(shown)
  const cur = sel.cur
  async function copy(p: Plan) {
    const { data, error } = await supabase.rpc('dist_plan_copy', { p_plan: p.id })
    if (error) return setErr(errText(error.message))
    onCopied(data as string, `Đã nhân bản ${p.code} thành bản nháp mới.`)
  }
  const n = (s: Status) => plans.filter(p => p.status === s).length
  const th = (k: SortKey, label: string) => <th key={k}><button type="button" className="distsort" onClick={() => setSort([k, sort[0] === k ? (-sort[1] as 1 | -1) : 1])}>
    {label} <small aria-hidden="true">{sort[0] === k ? (sort[1] === 1 ? '↑' : '↓') : '↕'}</small></button></th>
  return (
    <>
      <div className="distfilter">
        {([['', 'Tất cả', plans.length], ['draft', 'Nháp', n('draft')], ['published', 'Đã phát hành', n('published')], ['archived', 'Ngừng dùng', n('archived')]] as [Status | '', string, number][]).map(([s, l, c]) =>
          <button key={l} type="button" className={'distfchip' + (fs === s ? ' on' : '')} aria-pressed={fs === s} onClick={() => setFs(s)}>{l} <b>{c}</b></button>)}
      </div>
      <div className="distfilter">
        <input placeholder="Tìm tên, mã, phân loại…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        <select value={fc} onChange={e => setFc(e.target.value)} aria-label="Phân loại"><option value="">Mọi phân loại</option>{classes.map(c => <option key={c} value={c}>{c}</option>)}</select>
        <small className="sub">{shown.length}/{plans.length} bản</small>
      </div>
      {err && <p className="msg">{err}</p>}
      <div className="panel">
        <div className="bar"><b>Bản phân phối</b>
          <div className="tools">
            {cur && <small className="sub">Đã chọn: <b>{cur.code}</b></small>}
            <button type="button" disabled={!cur} onClick={() => cur && copy(cur)}>Nhân bản</button>
            <button type="button" className="primary" disabled={!cur || cur.status !== 'published'} title={cur && cur.status !== 'published' ? 'Chỉ gán bản đã phát hành' : undefined}
              onClick={() => cur && onAssign(cur.id)}>Gán trường</button>
            {menu}
          </div>
        </div>
        <div className="wrap"><table className="libtable">
          <thead><tr><th className="sel"><span className="sronly">Chọn</span></th>
            {th('title', 'Bản phân phối')}{has('cls') && th('cls', 'Phân loại')}{has('parts') && th('parts', 'Thành phần')}{has('lessons') && th('lessons', 'Bài · tiết')}
            {has('books') && th('books', 'Đã gán')}{has('status') && th('status', 'Trạng thái')}{has('updated') && th('updated', 'Cập nhật')}</tr></thead>
          <tbody>{shown.map(p => <tr key={p.id} className={sel.is(p) ? 'picked' : undefined}>
            <td className="sel"><input type="checkbox" checked={sel.is(p)} onChange={() => sel.toggle(p)} aria-label={'Chọn ' + p.code} /></td>
            <PlanCells p={p} m={meta.get(p.id)} has={has} crumb={crumb(p)} onOpen={() => onOpen(p)} /></tr>)}
            {shown.length === 0 && <tr><td colSpan={COLS.length + 1}>{plans.length ? 'Không có bản nào khớp bộ lọc.' : 'Chưa có bản phân phối nào. Soạn ở tab "Bản phân phối".'}</td></tr>}</tbody>
        </table></div>
      </div>
    </>
  )
}

// ===== Tab "Gán theo trường" =====
type Org = { id: string; name: string; type: string; parent_id: string | null }
type Cls = { id: string; name: string; grade: number; org_id: string }

function DistAssign({ plans, books, initial, onDone }: { plans: Plan[]; books: Book[]; initial: string; onDone: () => void }) {
  const crumb = useBreadcrumb()
  const [pid, setPid] = useState(initial)
  const [orgs, setOrgs] = useState<Org[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [year, setYear] = useState('')
  const [classes, setClasses] = useState<Cls[]>([])
  const [cls, setCls] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const pub = plans.filter(p => p.status === 'published')
  const plan = pub.find(p => p.id === pid) ?? null
  useEffect(() => { setPid(initial) }, [initial])
  useEffect(() => { supabase.from('organizations').select('id, name, type, parent_id').order('name').then(({ data }) => setOrgs((data as Org[]) ?? [])) }, [])
  useEffect(() => {
    setCls([])
    if (picked.length !== 1 || !plan) { setClasses([]); return }
    supabase.from('classes').select('id, name, grade, org_id').eq('org_id', picked[0]).eq('grade', plan.grade).order('name').then(({ data }) => setClasses((data as Cls[]) ?? []))
  }, [picked.join(','), plan?.id])
  const schools = orgs.filter(o => o.type === 'school')
  const orgName = (id: string) => orgs.find(o => o.id === id)?.name ?? '—'
  const planOf = (id: string) => plans.find(p => p.id === id)

  async function assign() {
    if (!plan || !picked.length) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('dist_plan_assign', { p_plan: plan.id, p_orgs: picked, p_year: year.trim() || null, p_classes: cls.length ? cls : null })
    setBusy(false)
    if (error) return setMsg([errText(error.message), true])
    const r = data as { books: number; skipped: number }
    setMsg([`Đã tạo ${r.books} PPCT nháp cho ${picked.length} trường${r.skipped ? `; ${r.skipped} PPCT đã có từ trước nên bỏ qua` : ''}. Trường kiểm tra rồi ban hành PPCT như thường lệ.`, false])
    setPicked([]); onDone()
  }

  return (
    <>
      <div className="panel">
        <div className="formgrid">
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Bản phân phối đã phát hành</span>
            <select value={pid} onChange={e => setPid(e.target.value)}><option value="">— chọn bản —</option>{pub.map(p => <option key={p.id} value={p.id}>{p.code} · {p.title} ({crumb(p)})</option>)}</select></label>
          <label className="field"><span>Năm học</span><input value={year} onChange={e => setYear(e.target.value)} placeholder="Để trống = năm học hiện tại của trường" /></label>
        </div>
        {pub.length === 0 && <p className="sub">Chưa có bản nào đã phát hành. Phát hành bản ở tab “Bản phân phối”.</p>}
        {plan && <>
          <div className="field" style={{ marginBottom: 10 }}><span>Chọn trường ({picked.length})</span>
            <MultiSelect value={picked} onChange={setPicked} options={schools.map(o => [o.id, o.name])} placeholder="Chọn trường…" ariaLabel="Trường" empty="Không có trường nào trong phạm vi." /></div>
          {picked.length === 1 && <fieldset className="libtargets wide"><legend>Lớp khối {plan.grade} (không chọn = áp dụng cả khối)</legend>
            <MultiSelect value={cls} onChange={setCls} options={classes.map(c => [c.id, c.name])} placeholder="Cả khối" ariaLabel="Lớp" empty={`Trường chưa có lớp khối ${plan.grade}.`} /></fieldset>}
          <div className="formactions"><button type="button" className="primary" disabled={busy || !picked.length} onClick={assign}>Gán và tạo PPCT</button>
            <small className="sub"> Mỗi chương trình trong bản thành một PPCT nháp của trường, tiết xếp đúng tuần của bản. Gán lại không tạo trùng.</small></div>
        </>}
        {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      </div>
      <h4>PPCT theo trường từ bản phân phối</h4>
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Trường</th><th>Bản phân phối</th><th>PPCT</th><th>Năm học</th><th>Số tiết</th><th>Trạng thái</th></tr></thead>
        <tbody>{books.map(b => <tr key={b.id}>
          <td>{orgName(b.org_id)}</td><td>{planOf(b.dist_plan_id)?.code ?? '—'}</td><td>{b.title}</td><td>{b.year_name ?? '—'}</td>
          <td>{b.curriculum_lessons?.[0]?.count ?? 0}</td><td>{BOOK_STATUS[b.status] ?? b.status}</td></tr>)}
          {books.length === 0 && <tr><td colSpan={6}>Chưa gán bản phân phối nào.</td></tr>}</tbody>
      </table></div>
    </>
  )
}
