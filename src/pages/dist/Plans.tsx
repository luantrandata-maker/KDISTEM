// Phân phối chương trình — theo video demo được duyệt (23/10). Một trang gồm:
//  hướng dẫn 3 bước · 3 thẻ số liệu · 3 tab: Bản phân phối (khung phân loại + các bản trong mục + trình soạn),
//  Danh sách bản phân phối (lọc, sắp xếp, xem bản đã phát hành), Gán theo trường (tạo PPCT theo trường).
// Theo dõi thực hiện nằm ở menu riêng "Theo dõi Chương trình/Môn học".
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useEduLevels, gradeRange } from '../../lib/eduLevels'
import { useRowSel } from '../../components/TableSel'
import { useTiers } from './Tiers'
import { PlanBody, Chip, STATUS, errText, useBreadcrumb } from './Editor'
import type { Plan, Status } from './sched'

export type { Plan } from './sched'
type Tab = 'tree' | 'list' | 'assign'
type Meta = { programs: number; subjects: number; lessons: number; periods: number; books: number }
type Book = { id: string; title: string; status: string; year_name: string | null; org_id: string; dist_plan_id: string; program_id: string | null; curriculum_lessons: { count: number }[] }
const BOOK_STATUS: Record<string, string> = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị trả lại', published: 'Đã ban hành' }
const PLAN_SEL = 'id, org_id, code, title, level, grade, tier, status, hk1_weeks, hk2_weeks, note, updated_at, published_at'

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

// ===== Tab "Bản phân phối": khung phân loại + các bản trong mục =====
type Node = { level: string; grade?: number; tier?: string | null }
const nodeKey = (n: Node) => [n.level, n.grade ?? '', n.tier === undefined ? '' : n.tier ?? '-'].join(':')
const inNode = (p: Plan, n: Node) => p.level === n.level && (n.grade == null || p.grade === n.grade) && (n.tier === undefined || (p.tier ?? null) === n.tier)

function DistTree({ orgId, plans, meta, focus, onOpen, onCreated }: {
  orgId: string | null; plans: Plan[]; meta: Map<string, Meta>; focus: string | null; onOpen: (id: string) => void; onCreated: (id: string) => void
}) {
  const { levels, name: levelName } = useEduLevels()
  const { tiers, all: allTiers, name: tierName, reload: reloadTiers } = useTiers()
  const crumb = useBreadcrumb()
  const [admin, setAdmin] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [depth, setDepth] = useState<1 | 2 | 3>(2)
  const [exp, setExp] = useState<Set<string>>(new Set())
  const [sel, setSel] = useState<Node | null>(null)
  const { has, menu } = useCols('dist-tree-cols', COLS, ['cls', 'lessons', 'status'])
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)) }, [])
  // Mở sẵn nhánh có bản; chọn nhánh của bản vừa xem hoặc nhánh đầu tiên có bản
  useEffect(() => {
    const f = plans.find(p => p.id === focus) ?? plans[0]
    const e = new Set<string>(levels.map(l => 'l:' + l.code))
    for (const p of plans) e.add(`g:${p.level}:${p.grade}`)
    setExp(e)
    if (!sel) setSel(f ? { level: f.level, grade: f.grade, tier: f.tier ?? null } : levels[0] ? { level: levels[0].code } : null)
  }, [levels.length, plans.length])
  function showTo(d: 1 | 2 | 3) {
    setDepth(d)
    const e = new Set<string>()
    if (d >= 2) levels.forEach(l => e.add('l:' + l.code))
    if (d >= 3) levels.forEach(l => gradeRange(l.grade_from, l.grade_to).forEach(g => e.add(`g:${l.code}:${g}`)))
    setExp(e)
  }
  const toggle = (k: string) => setExp(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const count = (n: Node) => plans.filter(p => inNode(p, n)).length

  async function create() {
    if (!orgId || !sel || sel.grade == null) return
    const { data, error } = await supabase.from('dist_plans').insert({ org_id: orgId, title: 'Bản phân phối mới', level: sel.level, grade: sel.grade, tier: sel.tier ?? null }).select('id').single()
    if (error) return setMsg([errText(error.message), true])
    onCreated((data as { id: string }).id)
  }
  async function addTier() {
    const name = prompt('Tên mức độ mới (vd. Chuyên sâu):')?.trim(); if (!name) return
    const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    const code = (/^[a-z]/.test(base) ? base : 'm_' + base).slice(0, 20).replace(/_+$/, '') || 'muc_' + Date.now() % 1000
    const { error } = await supabase.from('dist_tiers').insert({ code: code.length < 2 ? code + '_1' : code, name, sort: allTiers.reduce((m, t) => Math.max(m, t.sort), 0) + 1 })
    if (error) return setMsg([/23505|duplicate/.test(error.message + error.code) ? 'Đã có mức độ trùng mã, hãy đặt tên khác.' : errText(error.message), true])
    setMsg([`Đã thêm mức độ “${name}” cho mọi khối.`, false]); reloadTiers()
  }
  async function renameTier(code: string) {
    const name = prompt('Tên mới của mức độ (đổi ở mọi khối):', tierName(code))?.trim(); if (!name) return
    const { error } = await supabase.from('dist_tiers').update({ name }).eq('code', code)
    if (error) return setMsg([errText(error.message), true])
    reloadTiers()
  }
  async function removeTier(code: string) {
    if (plans.some(p => p.tier === code)) return setMsg(['Mức độ đang có bản phân phối nên không xoá được. Có thể ngừng dùng ở Chương trình giáo dục › Danh mục › Mức độ phân phối.', true])
    if (!confirm(`Xoá mức độ “${tierName(code)}” ở mọi khối?`)) return
    const { error } = await supabase.from('dist_tiers').delete().eq('code', code)
    if (error) return setMsg([errText(error.message), true])
    setSel(sel ? { level: sel.level, grade: sel.grade } : null); reloadTiers()
  }

  const shown = sel ? plans.filter(p => inNode(p, sel)) : []
  const selName = !sel ? '' : sel.tier !== undefined ? (sel.tier ? tierName(sel.tier) : 'Chưa phân loại') : sel.grade != null ? `Khối ${sel.grade}` : levelName(sel.level)
  const selCrumb = !sel ? '' : [levelName(sel.level), sel.grade != null ? `Khối ${sel.grade}` : null, sel.tier !== undefined ? (sel.tier ? tierName(sel.tier) : 'Chưa phân loại') : null].filter(Boolean).join(' › ')
  const row = (n: Node, label: string, kind: string, lvl: number, k?: string): ReactNode => {
    const c = count(n), on = sel && nodeKey(sel) === nodeKey(n)
    return <div className={'distnode d' + lvl + (on ? ' on' : '')}>
      {k ? <button type="button" className="caret" aria-label={exp.has(k) ? 'Thu gọn' : 'Mở'} aria-expanded={exp.has(k)} onClick={() => toggle(k)}>{exp.has(k) ? '▾' : '▸'}</button> : <span className="caret" />}
      <button type="button" className="nodebtn" aria-current={on || undefined} onClick={() => setSel(n)}><b>{label}</b> <small>{kind}</small>{c > 0 && <span className="count">{c}</span>}</button>
    </div>
  }
  return (
    <div className="distlayout">
      <nav className="panel disttree" aria-label="Khung phân loại">
        <div className="bar small"><b>Khung phân loại</b>{admin && <button type="button" className="linkbtn" onClick={addTier}>+ Thêm mức độ</button>}</div>
        <div className="distdepth"><small className="sub">Hiển thị đến:</small>
          <div className="segmented">{([[1, 'Cấp học'], [2, 'Khối lớp'], [3, 'Mức độ']] as [1 | 2 | 3, string][]).map(([d, l]) =>
            <button key={d} type="button" className={depth === d ? 'on' : ''} onClick={() => showTo(d)}>{l}</button>)}</div></div>
        {levels.map(l => <div key={l.code}>
          {row({ level: l.code }, l.name, 'Cấp học', 0, 'l:' + l.code)}
          {exp.has('l:' + l.code) && gradeRange(l.grade_from, l.grade_to).map(g => <div key={g}>
            {row({ level: l.code, grade: g }, `Khối ${g}`, 'Khối lớp', 1, `g:${l.code}:${g}`)}
            {exp.has(`g:${l.code}:${g}`) && <>
              {tiers.map(t => <div key={t.code}>{row({ level: l.code, grade: g, tier: t.code }, t.name, 'Mức độ', 2)}</div>)}
              {count({ level: l.code, grade: g, tier: null }) > 0 && row({ level: l.code, grade: g, tier: null }, 'Chưa phân loại', 'Mức độ', 2)}
            </>}
          </div>)}
        </div>)}
        {admin && sel?.tier && <div className="distnodefoot"><b>{tierName(sel.tier)}</b>
          <span className="tools"><button type="button" onClick={() => renameTier(sel.tier!)}>Đổi tên</button><button type="button" onClick={() => removeTier(sel.tier!)}>Xóa</button></span></div>}
      </nav>
      <div className="panel">
        <div className="bar">
          <div><h3 style={{ margin: 0 }}>{selName || 'Chọn một nhánh'}</h3><small className="sub">{selCrumb}</small></div>
          <div className="tools">
            <button type="button" className="primary" disabled={!sel || sel.grade == null || !orgId} title={sel?.grade == null ? 'Chọn đến Khối lớp hoặc Mức độ để tạo bản' : undefined} onClick={create}>+ Tạo bản phân phối</button>
            {menu}
          </div>
        </div>
        {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
        <div className="wrap"><table className="libtable">
          <thead><tr>{COLS.filter(c => has(c.key)).map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
          <tbody>{shown.map(p => <tr key={p.id}><PlanCells p={p} m={meta.get(p.id)} has={has} crumb={crumb(p)} onOpen={() => onOpen(p.id)} /></tr>)}
            {shown.length === 0 && <tr><td colSpan={COLS.length}>{sel?.grade == null ? 'Chưa có bản nào trong mục này. Chọn Khối lớp hoặc Mức độ để tạo bản.' : 'Chưa có bản nào trong mục này. Bấm “+ Tạo bản phân phối”.'}</td></tr>}</tbody>
        </table></div>
      </div>
    </div>
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
  const [q, setQ] = useState('')
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
  const schools = orgs.filter(o => o.type === 'school' && (!q || o.name.toLowerCase().includes(q.toLowerCase())))
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
          <div className="bar"><b>Chọn trường ({picked.length})</b><input placeholder="Tìm trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm trường" /></div>
          <div className="distschools">{schools.map(o => <label key={o.id}><input type="checkbox" checked={picked.includes(o.id)}
            onChange={e => setPicked(e.target.checked ? [...picked, o.id] : picked.filter(x => x !== o.id))} /> {o.name}</label>)}
            {schools.length === 0 && <small className="sub">Không có trường nào trong phạm vi.</small>}</div>
          {picked.length === 1 && <fieldset className="libtargets"><legend>Lớp khối {plan.grade} (không chọn = áp dụng cả khối)</legend>
            {classes.map(c => <label key={c.id}><input type="checkbox" checked={cls.includes(c.id)} onChange={e => setCls(e.target.checked ? [...cls, c.id] : cls.filter(x => x !== c.id))} /> {c.name}</label>)}
            {classes.length === 0 && <small className="sub">Trường chưa có lớp khối {plan.grade}.</small>}</fieldset>}
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
