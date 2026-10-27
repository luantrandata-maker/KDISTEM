// Khung phân loại dùng chung: cấu hình cấp + cây mục + danh sách các bản trong mục đang chọn.
// Dùng cho Bản phân phối (dist_*) và Kế hoạch tập huấn (training_*).
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useHiddenBtn } from '../../components/PageButtons'
import { Drawer } from '../../components/Drawer'
import { useCls, type ClsLevel, type ClsNode, type ClsScope } from './cls'

const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration mới nhất trên Supabase.' : m)
const clsErr = (m: string, mig: string) => /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được khung phân loại.'
  : /23503|foreign key/i.test(m) ? 'Mục đang có mục con hoặc bản đang dùng nên không xoá được.'
  : /schema cache|does not exist/i.test(m) ? `Hãy chạy migration ${mig} trên Supabase.` : errText(m)
type AddForm = { mode: 'add'; level: ClsLevel; parent: ClsNode | null; name: string } | { mode: 'rename'; node: ClsNode; level: ClsLevel | undefined; name: string }
type Cls = ReturnType<typeof useCls> & { admin: boolean }

/** Cấp không tắt / xoá được của từng loại khung */
const LOCKED: Record<ClsScope, ClsLevel['kind'][]> = { dist: ['level', 'grade'], training: ['subject'] }
const MIG: Record<ClsScope, string> = { dist: '082', training: '101' }
const NOUN: Record<ClsScope, string> = { dist: 'Bản phân phối', training: 'Kế hoạch tập huấn' }
const UNSORTED = '__none__'

export function ClsConfig({ cls, used, onMsg }: { cls: Cls; used: (levelId: string) => number; onMsg: (m: [string, boolean]) => void }) {
  const hid = useHiddenBtn()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [pos, setPos] = useState('end')
  const lv = cls.levels, T = cls.tables.levels
  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok?: string) {
    const { error } = await p
    if (error) onMsg([clsErr(error.message, MIG[cls.scope]), true]); else if (ok) onMsg([ok, false])
    await cls.reload()
  }
  /** Thứ tự xen giữa hai cấp kề nhau (thứ tự thưa 10, 20, 30…) */
  const between = (a: number | undefined, b: number | undefined) => a == null ? (b ?? 10) - 10 : b == null ? a + 10 : Math.floor((a + b) / 2)
  function move(i: number, d: -1 | 1) {
    const l = lv[i], j = i + d
    if (!lv[j]) return
    const s = d < 0 ? between(lv[j - 1]?.sort, lv[j].sort) : between(lv[j].sort, lv[j + 1]?.sort)
    if (s === lv[j].sort || s === lv[j + d]?.sort) return onMsg(['Hai cấp đứng quá sát nhau, hãy xoá rồi thêm lại cấp ở vị trí mới.', true])
    run(supabase.from(T).update({ sort: s }).eq('id', l.id))
  }
  async function add() {
    const n = name.trim(); if (!n) return
    const i = pos === 'end' ? lv.length - 1 : lv.findIndex(l => l.id === pos)
    await run(supabase.from(T).insert({ name: n, kind: 'custom', sort: between(lv[i]?.sort, lv[i + 1]?.sort) }), `Đã thêm cấp “${n}”.`)
    setName('')
  }
  const locked = (l: ClsLevel) => LOCKED[cls.scope].includes(l.kind)
  const need = `${NOUN[cls.scope]} cần cấp này`
  return <div className="panel distcls">
    <div className="bar small"><b>Cấu hình cấp phân loại</b>
      {cls.admin && <button type="button" onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : 'Cấu hình cấp'}</button>}</div>
    {!open ? <div className="distclschips">{cls.active.map((l, k) => <span key={l.id}>{k > 0 && <i aria-hidden="true">→</i>}<span className="chip">{l.name}</span></span>)}</div> : <>
      <ol className="distclslist">{lv.map((l, i) => {
        const has = used(l.id) > 0
        return <li key={l.id}>
          <i>{i + 1}</i>
          <input defaultValue={l.name} aria-label={'Tên cấp ' + (i + 1)} maxLength={40}
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== l.name) run(supabase.from(T).update({ name: v }).eq('id', l.id)); else e.target.value = l.name }} />
          <span className={'pill ' + (l.active ? 'active' : 'inactive')}>{l.active ? 'Đang bật' : 'Đang tắt'}</span>
          <button type="button" aria-label="Chuyển lên" disabled={!i || has} title={has ? 'Cấp đã có mục trong cây' : undefined} onClick={() => move(i, -1)}>↑</button>
          <button type="button" aria-label="Chuyển xuống" disabled={i === lv.length - 1 || has} title={has ? 'Cấp đã có mục trong cây' : undefined} onClick={() => move(i, 1)}>↓</button>
          <button type="button" disabled={locked(l)} title={locked(l) ? need : undefined}
            onClick={() => run(supabase.from(T).update({ active: !l.active }).eq('id', l.id))}>{l.active ? 'Tắt cấp' : 'Bật cấp'}</button>
          <button type="button" disabled={locked(l) || has} title={locked(l) ? need : has ? 'Cấp đã có mục trong cây' : undefined}
            onClick={() => confirm(`Xoá cấp “${l.name}”?`) && run(supabase.from(T).delete().eq('id', l.id), `Đã xoá cấp “${l.name}”.`)}>Xóa</button>
        </li>
      })}</ol>
      <div className="distclsadd">
        <input placeholder={cls.scope === 'training' ? 'Tên cấp mới, ví dụ: Đối tượng' : 'Tên cấp mới, ví dụ: Giai đoạn'} value={name} maxLength={40} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} aria-label="Tên cấp mới" />
        <select value={pos} onChange={e => setPos(e.target.value)} aria-label="Vị trí"><option value="end">Đặt ở cuối</option>
          {lv.slice(0, -1).map(l => <option key={l.id} value={l.id}>Sau {l.name}</option>)}</select>
        {!hid('tier') && <button type="button" className="primary" disabled={!name.trim()} onClick={add}>+ Thêm cấp</button>}
      </div>
      <p className="sub" style={{ margin: 0 }}>Tên cấp và việc tắt/bật đổi được bất cứ lúc nào. Đổi thứ tự hoặc xóa cấp chỉ làm được khi cấp đó chưa có mục trong cây. {NOUN[cls.scope]} chỉ gắn vào mục ở cấp cuối đang bật.</p>
    </>}
  </div>
}

export type TreeCtx = { sel: ClsNode | null; isFinal: boolean; unsorted: boolean; crumb: string; last: ClsLevel | undefined }

/** Cấu hình cấp + cây phân loại bên trái + vùng danh sách bên phải (do nơi dùng vẽ) */
export function ClsTree<T extends { id: string; node_id: string | null }>({ scope, items, focus, header, children }: {
  scope: ClsScope; items: T[]; focus?: string | null
  /** Nút trên thanh tiêu đề vùng danh sách (vd. "+ Tạo bản") */
  header: (ctx: TreeCtx) => ReactNode
  children: (shown: T[], ctx: TreeCtx) => ReactNode
}) {
  const base = useCls(scope)
  const [admin, setAdmin] = useState(false)
  const cls = { ...base, admin }
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [depth, setDepth] = useState<number | null>(null)
  const [exp, setExp] = useState<Set<string>>(new Set())
  const [selId, setSelId] = useState<string | null>(null)
  const [form, setForm] = useState<AddForm | null>(null)
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)) }, [])
  // Gợi ý khi thêm mục ở cấp gốc: tên chương trình tập huấn (kế hoạch tập huấn) hoặc danh mục môn học
  const [subjects, setSubjects] = useState<string[]>([])
  useEffect(() => {
    if (!base.levels.some(l => l.kind === 'subject')) return
    const q = scope === 'training' ? supabase.from('training_programs').select('name:title').eq('status', 'published').order('title') : supabase.from('subjects').select('name').order('sort')
    q.then(({ data }) => setSubjects([...new Set(((data ?? []) as { name: string }[]).map(x => x.name))]))
  }, [base.levels.length, scope])

  const { nodes, active, byId, lvOf, tables } = base
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
  // Các bản trong mỗi mục (tính cả mục con)
  const under = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const p of items) {
      if (!p.node_id || !byId.has(p.node_id)) { if (!m.has(UNSORTED)) m.set(UNSORTED, new Set()); m.get(UNSORTED)!.add(p.id); continue }
      for (let n = byId.get(p.node_id); n; n = n.parent_id ? byId.get(n.parent_id) : undefined) {
        if (!m.has(n.id)) m.set(n.id, new Set()); m.get(n.id)!.add(p.id)
      }
    }
    return m
  }, [items, nodes])
  const unsorted = selId === UNSORTED
  const sel = selId && !unsorted ? byId.get(selId) ?? null : null
  // Mở sẵn nhánh có bản; chọn mục của bản vừa xem hoặc mục đầu tiên
  useEffect(() => {
    if (!nodes.length) return
    const e = new Set<string>(kids.get(null)?.map(n => n.id))
    for (const p of items) for (let n = p.node_id ? byId.get(p.node_id) : undefined; n; n = n.parent_id ? byId.get(n.parent_id) : undefined) if (n.id !== p.node_id) e.add(n.id)
    setExp(e)
    if (!selId) { const f = items.find(p => p.id === focus) ?? items.find(p => p.node_id); setSelId(f ? f.node_id ?? UNSORTED : kids.get(null)?.[0]?.id ?? null) }
  }, [nodes.length, items.length])
  function showTo(d: number) {
    setDepth(d)
    setExp(new Set(nodes.filter(n => { const i = lvIdx(n); return i >= 0 && i < d }).map(n => n.id)))
  }
  const toggle = (k: string) => setExp(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  const isFinal = !!sel && !!last && sel.cls_level_id === last.id
  const nextLv = (n: ClsNode | null) => n ? active[lvIdx(n) + 1] : active[0]
  async function saveForm(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const name = form.name.trim(); if (!name) return
    if (form.mode === 'add') {
      const sibs = form.parent ? (kids.get(form.parent.id) ?? []) : (kids.get(null) ?? [])
      const { data, error } = await supabase.from(tables.nodes).insert({ cls_level_id: form.level.id, parent_id: form.parent?.id ?? null, name, sort: sibs.reduce((m, n) => Math.max(m, n.sort), 0) + 1 }).select('id').single()
      if (error) return setMsg([clsErr(error.message, MIG[scope]), true])
      setMsg([`Đã thêm ${form.level.name.toLowerCase()} “${name}”.`, false])
      if (form.parent) setExp(s => new Set(s).add(form.parent!.id))
      setSelId((data as { id: string }).id)
    } else {
      const { error } = await supabase.from(tables.nodes).update({ name }).eq('id', form.node.id)
      if (error) return setMsg([clsErr(error.message, MIG[scope]), true])
    }
    setForm(null); base.reload()
  }
  async function remove(n: ClsNode) {
    if (nodes.some(x => x.parent_id === n.id)) return setMsg(['Mục còn mục con, hãy xoá các mục con trước.', true])
    if (under.get(n.id)?.size) return setMsg([`Mục đang có ${NOUN[scope].toLowerCase()} nên không xoá được.`, true])
    if (!confirm(`Xoá “${n.name}” khỏi khung phân loại?`)) return
    const { error } = await supabase.from(tables.nodes).delete().eq('id', n.id)
    if (error) return setMsg([clsErr(error.message, MIG[scope]), true])
    setSelId(shownParent(n)); base.reload()
  }

  const shown = unsorted ? items.filter(p => under.get(UNSORTED)?.has(p.id)) : sel ? items.filter(p => under.get(sel.id)?.has(p.id)) : []
  const crumb = sel ? base.path(sel.id).map(n => n.name).join(' › ') : unsorted ? 'Chưa gắn mục trong khung phân loại' : ''
  const ctx: TreeCtx = { sel, isFinal, unsorted, crumb, last }
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
  const nUnsorted = under.get(UNSORTED)?.size ?? 0
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
          {nUnsorted > 0 && <div className={'distnode' + (unsorted ? ' on' : '')}><span className="caret" />
            <button type="button" className="nodebtn" aria-current={unsorted || undefined} onClick={() => setSelId(UNSORTED)}><b>Chưa phân loại</b><span className="count">{nUnsorted}</span></button></div>}
          {admin && sel && <div className="distnodefoot"><b>{sel.name}</b>
            <span className="tools">
              {nx && <button type="button" onClick={() => setForm({ mode: 'add', level: nx, parent: sel, name: '' })}>+ Thêm {nx.name.toLowerCase()}</button>}
              <button type="button" onClick={() => setForm({ mode: 'rename', node: sel, level: lvOf(sel), name: sel.name })}>Đổi tên</button>
              <button type="button" onClick={() => remove(sel)}>Xóa</button></span></div>}
        </nav>
        <div className="panel">
          <div className="bar">
            <div><h3 style={{ margin: 0 }}>{sel?.name ?? (unsorted ? 'Chưa phân loại' : 'Chọn một mục')}</h3><small className="sub">{crumb}</small></div>
            <div className="tools">{header(ctx)}</div>
          </div>
          {sel && !isFinal && <p className="sub">Đây chưa phải cấp cuối. Chọn mục {last?.name.toLowerCase()} bên trong để tạo mới; bên dưới là các bản đã có trong mục này.</p>}
          {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
          {children(shown, ctx)}
        </div>
      </div>
      {form && <Drawer title={form.mode === 'add' ? `Thêm ${form.level.name.toLowerCase()}` : 'Đổi tên'} onClose={() => setForm(null)} closeOnOutside={false}>
        <form className="formgrid" onSubmit={saveForm}>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>{form.level?.name ?? 'Tên'}</span>
            <input autoFocus required maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              list={form.level?.kind === 'subject' ? 'cls-subjects' : undefined}
              placeholder={'Ví dụ: ' + (({ subject: scope === 'training' ? 'Tập huấn STEM cho giáo viên' : 'Tin học', level: 'Tiểu học', grade: 'Khối 6', tier: scope === 'training' ? 'Nâng cao' : 'Tăng cường', custom: scope === 'training' ? 'Cán bộ quản lý' : 'Giai đoạn 1' } as Record<string, string>)[form.level?.kind ?? 'custom'])} />
            {form.level?.kind === 'subject' && <><datalist id="cls-subjects">{subjects.map(n => <option key={n} value={n} />)}</datalist>
              <small className="sub">{scope === 'training' ? 'Gõ hoặc chọn trong danh sách chương trình tập huấn.' : 'Gõ hoặc chọn môn trong danh mục môn học. Môn mới có sẵn các mục Cơ bản, Nâng cao.'}</small></>}
            {form.mode === 'add' && form.parent && <small className="sub">Thuộc: {base.path(form.parent.id).map(n => n.name).join(' › ')}</small>}
          </label>
          <div className="formactions" style={{ gridColumn: '1 / -1' }}><button type="submit" className="primary" disabled={!form.name.trim()}>Lưu</button></div>
        </form>
      </Drawer>}
    </>
  )
}
