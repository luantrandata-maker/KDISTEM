// Soạn cấu trúc chương trình (học phần → bài → buổi, hoặc môn → nội dung) và yêu cầu cần đạt trên một bảng nháp:
// thêm / sửa / xoá / đổi thứ tự thoải mái, chỉ ghi vào CSDL khi bấm "Lưu tất cả".
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

export type DOut = { key: string; id?: string; code: string; content: string; comp: string | null }
export type DRow<F> = { key: string; id?: string; parent: string | null; type: string; title: string; goal: string; f: F; outs: DOut[] }
export type DLevel = { label: string; child?: string; ph: string }
export type DCol<F> = { label: string; width?: number; cell: (r: DRow<F>, set: (patch: Partial<F>) => void, rows: DRow<F>[]) => React.ReactNode }

let seqKey = 0
export const newKey = () => `n${Date.now().toString(36)}${(seqKey++).toString(36)}`

/** Thứ tự hiển thị: cha trước, con theo thứ tự trong mảng */
export function walkRows<F>(rows: DRow<F>[]) {
  const out: { r: DRow<F>; depth: number; seq: number }[] = []
  const go = (parent: string | null, depth: number) => rows.filter(r => r.parent === parent).forEach((r, i) => { out.push({ r, depth, seq: i + 1 }); go(r.key, depth + 1) })
  go(null, 0)
  return out
}

export function StructureDraft<F>({ levels, root, initial, cols, newFields, titleExtra, titleOptions, outCode = true, comps, goalLabel = 'Mục tiêu', onSave, onCancel, saving }: {
  levels: Record<string, DLevel>; root: string; initial: DRow<F>[]; cols: DCol<F>[]
  newFields: (type: string, parent: DRow<F> | null, rows: DRow<F>[]) => F
  titleExtra?: (r: DRow<F>, patch: (p: Partial<DRow<F>>) => void, rows: DRow<F>[]) => React.ReactNode
  /** Gợi ý tên (gõ hoặc chọn trong cùng một ô) */
  titleOptions?: (r: DRow<F>, rows: DRow<F>[]) => string[] | null
  outCode?: boolean; comps?: [string, string][]; goalLabel?: string
  onSave: (rows: DRow<F>[]) => Promise<string | null>; onCancel: () => void; saving?: boolean
}) {
  const [rows, setRows] = useState<DRow<F>[]>(initial)
  const [err, setErr] = useState('')
  const [bad, setBad] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState<string | null>(null)
  const start = useRef(JSON.stringify(initial))
  const dirty = JSON.stringify(rows) !== start.current
  const order = useMemo(() => walkRows(rows), [rows])

  // Rời trang khi còn thay đổi chưa lưu thì hỏi lại
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
  useEffect(() => { if (focus) { document.querySelector<HTMLInputElement>(`[data-k="${focus}"]`)?.focus(); setFocus(null) } }, [focus])

  const patch = (key: string, p: Partial<DRow<F>>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...p } : r))
  const setF = (key: string, p: Partial<F>) => setRows(rs => rs.map(r => r.key === key ? { ...r, f: { ...r.f, ...p } } : r))
  const desc = (key: string): string[] => rows.filter(r => r.parent === key).flatMap(r => [r.key, ...desc(r.key)])
  function add(parent: DRow<F> | null) {
    const type = parent ? levels[parent.type]?.child ?? root : root
    const r: DRow<F> = { key: newKey(), parent: parent?.key ?? null, type, title: '', goal: '', f: newFields(type, parent, rows), outs: [] }
    setRows(rs => [...rs, r])   // thứ tự giữa các mục cùng cha = thứ tự trong mảng
    setFocus(r.key)
  }
  function remove(r: DRow<F>) {
    const kids = desc(r.key)
    if ((kids.length || r.outs.length) && !confirm(`Xoá ${levels[r.type]?.label.toLowerCase() ?? 'mục'} "${r.title || '(chưa đặt tên)'}"${kids.length ? ` cùng ${kids.length} mục con` : ''}? (Chỉ xoá hẳn khi bấm Lưu tất cả)`)) return
    const gone = new Set([r.key, ...kids])
    setRows(rs => rs.filter(x => !gone.has(x.key)))
  }
  function move(r: DRow<F>, d: -1 | 1) {
    setRows(rs => {
      const sibs = rs.filter(x => x.parent === r.parent)
      const i = sibs.findIndex(x => x.key === r.key), j = i + d
      if (j < 0 || j >= sibs.length) return rs
      const a = rs.findIndex(x => x.key === r.key), b = rs.findIndex(x => x.key === sibs[j].key)
      const n = [...rs]; [n[a], n[b]] = [n[b], n[a]]
      return n
    })
  }
  const setOut = (r: DRow<F>, k: string, p: Partial<DOut>) => patch(r.key, { outs: r.outs.map(o => o.key === k ? { ...o, ...p } : o) })
  function addOut(r: DRow<F>) { const k = newKey(); patch(r.key, { outs: [...r.outs, { key: k, code: '', content: '', comp: null }] }); setFocus(k) }

  async function save() {
    const empty = rows.filter(r => !r.title.trim()).map(r => r.key)
    setBad(new Set(empty))
    if (empty.length) return setErr(`Còn ${empty.length} mục chưa có tên (tô đỏ). Nhập tên hoặc xoá mục đó rồi lưu lại.`)
    setErr(''); setBusy(true)
    const clean = rows.map(r => ({ ...r, title: r.title.trim(), goal: r.goal.trim(), outs: r.outs.map(o => ({ ...o, code: o.code.trim(), content: o.content.trim() })).filter(o => o.content) }))
    const e = await onSave(clean)
    setBusy(false)
    if (e) setErr(e)
  }

  const isBusy = busy || saving
  return (
    <div className="sdraft">
      <div className="sdbar">
        <b>Đang chỉnh sửa cấu trúc</b>
        <small className="sub">{dirty ? 'Có thay đổi chưa lưu. Thay đổi chỉ ghi lại khi bấm "Lưu tất cả".' : 'Chưa có thay đổi.'}</small>
        <span style={{ marginLeft: 'auto' }} className="tools">
          <button type="button" onClick={() => add(null)}>+ {levels[root].label}</button>
          <button type="button" onClick={() => { if (!dirty || confirm('Bỏ mọi thay đổi chưa lưu?')) onCancel() }} disabled={isBusy}>Huỷ</button>
          <button type="button" className="primary" onClick={save} disabled={isBusy || !dirty}>{isBusy ? 'Đang lưu…' : 'Lưu tất cả'}</button>
        </span>
      </div>
      {err && <p className="msg" role="alert">{err}</p>}
      <div className="wrap"><table className="sdtable">
        <thead><tr><th style={{ width: 120 }}>Mục</th><th>Tên · {goalLabel.toLowerCase()} · yêu cầu cần đạt</th>{cols.map(c => <th key={c.label} style={{ width: c.width }}>{c.label}</th>)}<th style={{ width: 250 }}></th></tr></thead>
        <tbody>
          {order.map(({ r, depth, seq }) => {
            const lv = levels[r.type]
            const sibs = rows.filter(x => x.parent === r.parent)
            return <Fragment key={r.key}>
              <tr className={'uedit' + (bad.has(r.key) && !r.title.trim() ? ' sdbad' : '')}>
                <td style={{ paddingLeft: 8 + depth * 22 }}><small className="sub">{lv?.label}</small> <b>{seq}</b>
                  <span className="sdmove"><button type="button" aria-label="Lên trên" title="Lên trên" disabled={sibs[0]?.key === r.key} onClick={() => move(r, -1)}>↑</button>
                    <button type="button" aria-label="Xuống dưới" title="Xuống dưới" disabled={sibs[sibs.length - 1]?.key === r.key} onClick={() => move(r, 1)}>↓</button></span></td>
                <td>
                  {titleExtra?.(r, p => patch(r.key, p), rows)}
                  {(() => { const opts = titleOptions?.(r, rows); return <>
                    <input data-k={r.key} value={r.title} onChange={e => patch(r.key, { title: e.target.value })} placeholder={opts?.length ? `${lv?.ph ?? 'Tên'} — gõ hoặc chọn trong danh mục (${opts.length})` : lv?.ph ?? 'Tên'}
                      list={opts?.length ? 'sd-opts-' + r.key : undefined} aria-label="Tên" maxLength={200} style={{ width: '100%' }} />
                    {!!opts?.length && <datalist id={'sd-opts-' + r.key}>{opts.map(n => <option key={n} value={n} />)}</datalist>}</> })()}
                  <input value={r.goal} onChange={e => patch(r.key, { goal: e.target.value })} placeholder={goalLabel} aria-label={goalLabel} maxLength={1000} style={{ width: '100%', marginTop: 6 }} />
                  {r.outs.map((o, i) => (
                    <div key={o.key} className="sdout">
                      <span className="sub" aria-hidden="true">✓</span>
                      {outCode && <input value={o.code} onChange={e => setOut(r, o.key, { code: e.target.value })} placeholder="Mã" aria-label="Mã yêu cầu" style={{ width: 70 }} maxLength={20} />}
                      <input data-k={o.key} value={o.content} onChange={e => setOut(r, o.key, { content: e.target.value })} placeholder={`Yêu cầu cần đạt ${i + 1}`} aria-label="Yêu cầu cần đạt" style={{ flex: 1, minWidth: 180 }} maxLength={1000} />
                      {comps && <select value={o.comp ?? ''} onChange={e => setOut(r, o.key, { comp: e.target.value || null })} aria-label="Năng lực" style={{ maxWidth: 200 }}>
                        <option value="">Năng lực —</option>{comps.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
                      <button type="button" className="sdx" aria-label="Xoá yêu cầu" title="Xoá yêu cầu" onClick={() => patch(r.key, { outs: r.outs.filter(x => x.key !== o.key) })}>×</button>
                    </div>))}
                </td>
                {cols.map(c => <td key={c.label}>{c.cell(r, p => setF(r.key, p), rows)}</td>)}
                <td><span className="tools sdtools">
                  {lv?.child && <button type="button" onClick={() => add(r)}>+ {levels[lv.child].label}</button>}
                  <button type="button" onClick={() => addOut(r)}>+ YCCĐ</button>
                  <button type="button" className="danger" onClick={() => remove(r)}>Xoá</button>
                </span></td>
              </tr>
            </Fragment>
          })}
          {!order.length && <tr><td colSpan={cols.length + 3}><span className="sub">Chưa có mục nào. Bấm "+ {levels[root].label}".</span></td></tr>}
        </tbody>
      </table></div>
      <div className="sdbar bottom">
        <button type="button" onClick={() => add(null)}>+ {levels[root].label}</button>
        <span style={{ marginLeft: 'auto' }} className="tools">
          <button type="button" onClick={() => { if (!dirty || confirm('Bỏ mọi thay đổi chưa lưu?')) onCancel() }} disabled={isBusy}>Huỷ</button>
          <button type="button" className="primary" onClick={save} disabled={isBusy || !dirty}>{isBusy ? 'Đang lưu…' : 'Lưu tất cả'}</button>
        </span>
      </div>
    </div>
  )
}

/**
 * Ghi bảng nháp vào CSDL: xoá mục / yêu cầu đã bỏ, sửa mục thay đổi, thêm mục mới (cha trước con).
 * `toRow` dựng dòng cần ghi; chỉ ghi khi khác bản gốc. Trả về danh sách lỗi (rỗng = thành công).
 */
export async function saveDraftTree<F>(orig: DRow<F>[], cur: DRow<F>[], o: {
  table: string
  toRow: (r: DRow<F>, parentId: string | null, seq: number) => Record<string, unknown>
  outs?: { table: string; toRow: (x: DOut, unitId: string, seq: number) => Record<string, unknown> }
  afterInsert?: (r: DRow<F>, id: string) => Promise<void>
}): Promise<string[]> {
  const errs: string[] = []
  const ids = new Map<string, string>()
  orig.forEach(r => r.id && ids.set(r.key, r.id))
  const keep = new Set(cur.map(r => r.id).filter(Boolean) as string[])
  const gone = orig.filter(r => r.id && !keep.has(r.id)).map(r => r.id!)
  if (gone.length) {
    const { error } = await supabase.from(o.table).delete().in('id', gone)
    if (error) return [error.message]
  }
  if (o.outs) {
    const keepO = new Set(cur.flatMap(r => r.outs.map(x => x.id)).filter(Boolean) as string[])
    const goneO = orig.flatMap(r => r.outs).filter(x => x.id && !keepO.has(x.id)).map(x => x.id!)
    if (goneO.length) {
      const { error } = await supabase.from(o.outs.table).delete().in('id', goneO)
      if (error) errs.push(error.message)
    }
  }
  const origWalk = new Map(walkRows(orig).map(x => [x.r.key, x]))
  for (const { r, seq } of walkRows(cur)) {
    const parentId = r.parent ? ids.get(r.parent) ?? null : null
    if (r.parent && !parentId) { errs.push(`"${r.title}": mục cha chưa lưu được`); continue }
    const row = o.toRow(r, parentId, seq)
    if (r.id) {
      const ow = origWalk.get(r.key)
      const before = ow ? JSON.stringify(o.toRow(ow.r, ow.r.parent ? ids.get(ow.r.parent) ?? null : null, ow.seq)) : ''
      if (before !== JSON.stringify(row)) {
        const { error } = await supabase.from(o.table).update(row).eq('id', r.id)
        if (error) errs.push(`"${r.title}": ${error.message}`)
      }
    } else {
      const { data, error } = await supabase.from(o.table).insert(row).select('id').single()
      if (error) { errs.push(`"${r.title}": ${error.message}`); continue }
      const id = (data as { id: string }).id
      ids.set(r.key, id)
      if (o.afterInsert) await o.afterInsert(r, id)
    }
    if (o.outs) {
      const uid = ids.get(r.key)!
      const before = new Map((origWalk.get(r.key)?.r.outs ?? []).map((x, i) => [x.id, JSON.stringify(o.outs!.toRow(x, uid, i + 1))]))
      for (const [i, x] of r.outs.entries()) {
        const orow = o.outs.toRow(x, uid, i + 1)
        if (x.id) {
          if (before.get(x.id) !== JSON.stringify(orow)) {
            const { error } = await supabase.from(o.outs.table).update(orow).eq('id', x.id)
            if (error) errs.push(`Yêu cầu "${x.content.slice(0, 40)}": ${error.message}`)
          }
        } else {
          const { error } = await supabase.from(o.outs.table).insert(orow)
          if (error) errs.push(`Yêu cầu "${x.content.slice(0, 40)}": ${error.message}`)
        }
      }
    }
  }
  return errs
}
