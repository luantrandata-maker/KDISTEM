// Xem chi tiết / sửa một dòng ở tab Link tài liệu, Định mức vật tư, Kho hoạt động (Học liệu tập huấn).
// Dòng của nội dung chương trình: sửa hoặc xoá khi chương trình còn nháp / bị trả lại; đã phát hành thì tạo phiên bản mới để sửa.
// Dòng của bài giảng tập huấn: mở bài giảng để sửa.
import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { openFile } from '../../lib/files'
import { Drawer } from '../../components/Drawer'
import { STATUS } from './Programs'
import { LISTS, type Detail } from './Content'

type Kind = 'docs' | 'mats' | 'acts'
const MKIND: Record<string, string> = { supply: 'Vật tư tiêu hao', tool: 'Dụng cụ', equipment: 'Thiết bị' }
const NOUN: Record<Kind, string> = { docs: 'tài liệu', mats: 'vật tư', acts: 'hoạt động' }
const EDITABLE = ['draft', 'rejected']

export type ItemRef = {
  part: Kind; prog: { id: string; code: string; title: string; status: string } | null
  unit: { id: string; title: string } | null; lesson: { id: string; title: string } | null; idx: number | null
  cells: Record<string, string>; url?: string; file?: string
}

/** draftId: bản nháp / bị trả lại đang có cùng họ phiên bản (nếu có) */
export function MaterialItem({ it, admin, draftId, autoEdit, onClose, onDone, onOpenLesson }: {
  it: ItemRef; admin: boolean; draftId: string | null; autoEdit?: boolean; onClose: () => void
  /** toDraft: id bản nháp của chương trình, mở lại đúng dòng này trong bản nháp để sửa */
  onDone: (m: string, toDraft?: string) => void; onOpenLesson?: (id: string) => void
}) {
  const fromUnit = !it.lesson && !!it.unit && it.idx != null
  const status = it.prog?.status ?? ''
  const canEdit = admin && fromUnit && EDITABLE.includes(status)
  const canVersion = admin && fromUnit && status === 'published'
  const [row, setRow] = useState<Record<string, string> | null>(null)
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const cols = LISTS[it.part].cols
  const set = (k: string, v: string) => setRow(r => ({ ...(r ?? {}), [k]: v }))
  useEffect(() => { if (autoEdit && canEdit) startEdit() }, [])

  async function fresh() {
    const { data, error } = await supabase.from('training_program_units').select('detail').eq('id', it.unit!.id).maybeSingle()
    if (error) throw new Error(error.message)
    return ((data as { detail: Detail | null } | null)?.detail ?? {}) as Detail
  }
  async function startEdit() {
    setMsg(''); setBusy(true)
    try { const r = (await fresh())[it.part]?.[it.idx!]; if (!r) throw new Error('Dòng này đã bị thay đổi. Tải lại trang rồi thử lại.'); setRow({ ...r }); setEdit(true) }
    catch (e) { setMsg((e as Error).message) }
    setBusy(false)
  }
  async function write(next: (list: Record<string, string>[]) => Record<string, string>[], done: string) {
    setMsg(''); setBusy(true)
    try {
      const d = await fresh()
      const { error } = await supabase.from('training_program_units').update({ detail: { ...d, [it.part]: next([...(d[it.part] ?? [])]) } }).eq('id', it.unit!.id)
      if (error) throw new Error(error.message)
      setBusy(false); onDone(done)
    } catch (e) { setMsg((e as Error).message); setBusy(false) }
  }
  function save() {
    if (!row) return
    const main = it.part === 'mats' ? 'name' : 'title'
    if (!row[main]?.trim()) return setMsg(`Nhập tên ${NOUN[it.part]}.`)
    if (it.part === 'docs' && !row.file && row.url?.trim() && !/^https?:\/\//i.test(row.url.trim())) return setMsg('Đường dẫn phải bắt đầu bằng http:// hoặc https://')
    if (it.part === 'mats' && !(Number((row.qty ?? '').replace(',', '.')) > 0)) return setMsg('Số lượng phải lớn hơn 0.')
    const clean = Object.fromEntries(Object.entries({ ...row, ...(row.qty != null ? { qty: row.qty.replace(',', '.') } : {}) })
      .map(([k, v]) => [k, String(v ?? '').trim()]).filter(([, v]) => v !== ''))
    write(l => l.map((x, i) => (i === it.idx ? clean : x)), `Đã lưu ${NOUN[it.part]} "${row[main].trim()}".`)
  }
  function del() {
    if (!confirm(`Xoá ${NOUN[it.part]} này khỏi nội dung "${it.unit!.title}"?`)) return
    write(l => l.filter((_, i) => i !== it.idx), `Đã xoá ${NOUN[it.part]}.`)
  }
  async function newVersion() {
    if (!confirm('Chương trình đã phát hành nên không sửa trực tiếp được. Tạo phiên bản mới (bản nháp chép từ phiên bản này) để sửa? Phiên bản đang phát hành vẫn dùng đến khi bản mới được phát hành.')) return
    setMsg(''); setBusy(true)
    const { data, error } = await supabase.rpc('training_program_new_version', { p_program: it.prog!.id })
    setBusy(false)
    if (error) return setMsg(error.message)
    onDone(`Đã tạo phiên bản nháp mới của ${it.prog!.code}. Sửa dòng này trong bản nháp, rồi gửi duyệt và phát hành lại chương trình.`, data as string)
  }

  const progLabel = it.prog ? `${it.prog.code} · ${it.prog.title} · ${STATUS[it.prog.status as keyof typeof STATUS]?.[0] ?? it.prog.status}` : '—'
  const view = <dl className="kv">
    {cols.filter(c => c.key !== 'url').map(c => <Fragment key={c.key}><dt>{c.label}</dt><dd>{it.cells[c.key] || '—'}</dd></Fragment>)}
    {it.part === 'docs' && <><dt>Link / tệp</dt><dd>{it.file ? <button type="button" className="linkbtn" onClick={() => openFile(it.file!)}>Mở tệp</button>
      : it.url ? <a href={it.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{it.url} ↗</a> : '—'}</dd></>}
    <dt>Thuộc</dt><dd>{it.lesson ? `Bài giảng: ${it.lesson.title}` : `Nội dung: ${it.unit?.title ?? '—'}`}</dd>
    <dt>Chương trình</dt><dd>{progLabel}</dd>
  </dl>

  const form = row && <div className="formgrid libgrid4">
    {cols.map(c => {
      if (c.key === 'url' && row.file) return <div key={c.key} className="field" style={{ gridColumn: '1 / -1' }}><span>Tệp</span>
        <span><button type="button" className="linkbtn" onClick={() => openFile(row.file)}>{row.file_name || 'Mở tệp'}</button></span></div>
      const wide = ['title', 'name', 'note', 'url'].includes(c.key)
      return <label key={c.key} className="field" style={wide ? { gridColumn: '1 / -1' } : undefined}><span>{c.label}</span>
        {c.type === 'select' ? <select value={row[c.key] ?? ''} onChange={e => set(c.key, e.target.value)}><option value="">—</option>
            {(c.options ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : c.key === 'note' && it.part === 'acts' ? <textarea rows={3} value={row[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} />
          : <input value={row[c.key] ?? ''} inputMode={c.type === 'number' ? 'decimal' : undefined} placeholder={c.placeholder} onChange={e => set(c.key, e.target.value)} />}</label>
    })}
    {it.part === 'docs' && <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mô tả ngắn</span><textarea rows={2} value={row.summary ?? ''} onChange={e => set('summary', e.target.value)} /></label>}
    {it.part === 'mats' && <>
      <label className="field"><span>Loại</span><select value={row.mkind ?? ''} onChange={e => set('mkind', e.target.value)}><option value="">—</option>
        {Object.entries(MKIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <div className="field"><span>Dùng lại</span><label><input type="checkbox" checked={row.reusable === '1'} onChange={e => set('reusable', e.target.checked ? '1' : '')} /> Dùng lại được</label></div>
    </>}
  </div>

  const note = !admin || edit ? null
    : it.lesson ? 'Dòng này lấy từ bài giảng tập huấn. Bấm “Mở bài giảng để sửa” để sửa trong thẻ học liệu của bài.'
    : canVersion && draftId ? 'Chương trình đã phát hành và đang có một phiên bản nháp. Mở bản nháp đó để sửa, rồi gửi duyệt và phát hành lại.'
    : canVersion ? 'Chương trình đã phát hành nên không sửa trực tiếp. Tạo phiên bản mới để sửa, rồi gửi duyệt và phát hành lại.'
    : !canEdit && fromUnit ? `Chương trình đang ở trạng thái "${STATUS[status as keyof typeof STATUS]?.[0] ?? status}", chưa sửa được.` : null

  return <Drawer closeOnOutside={!edit} onClose={onClose} title={`${edit ? 'Sửa' : 'Chi tiết'} ${NOUN[it.part]}`}
    actions={edit ? <>
      <button type="button" className="primary" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button type="button" disabled={busy} onClick={() => { setEdit(false); setMsg('') }}>Huỷ</button></>
    : <>
      {canEdit && <button type="button" className="primary" disabled={busy} onClick={startEdit}>Sửa</button>}
      {canEdit && <button type="button" className="danger" disabled={busy} onClick={del}>Xoá</button>}
      {canVersion && (draftId
        ? <button type="button" className="primary" onClick={() => onDone('Đang sửa trong phiên bản nháp của chương trình.', draftId)}>Mở bản nháp để sửa</button>
        : <button type="button" className="primary" disabled={busy} onClick={newVersion}>{busy ? 'Đang tạo…' : 'Tạo phiên bản mới để sửa'}</button>)}
      {admin && it.lesson && onOpenLesson && <button type="button" className="primary" onClick={() => onOpenLesson(it.lesson!.id)}>Mở bài giảng để sửa</button>}</>}>
    <div className="panel libform">
      {msg && <p className="msg">{msg}</p>}
      {edit ? form : view}
      {note && <p className="sub" style={{ margin: 0 }}>{note}</p>}
    </div>
  </Drawer>
}
