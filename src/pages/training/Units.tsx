// Chương trình tập huấn: bảng Môn → Nội dung tập huấn, cùng cách làm với bảng Học phần → Bài ở Chương trình giáo dục:
// thẻ số liệu, nút "Thêm môn", mỗi dòng có "+ Nội dung" / "Sửa" / "Xoá", thêm / sửa ngay trong bảng, nhập / tải Excel.
import { Fragment, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx, importSummary, norm, type Column } from '../../lib/sheet'
import ImportExcel from '../../components/ImportExcel'
import { Tiles } from '../department/charts'
import { detailCount, type Detail } from './Content'

export type TUnit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; hours: number
  mode: 'online' | 'offline' | null; has_test: boolean; note: string | null; detail: Detail }
type Mode = 'online' | 'offline' | 'hybrid'
const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const KIND = { subject: 'Môn', content: 'Nội dung' }
const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

const IMPORT: Column[] = [
  { key: 'type', label: 'Loại', required: true, aliases: ['Cấp', 'Loại mục'], width: 12 },
  { key: 'title', label: 'Tên', required: true, aliases: ['Tên môn / nội dung', 'Nội dung tập huấn', 'Tên môn'], width: 44 },
  { key: 'hours', label: 'Số giờ', aliases: ['Giờ'], width: 8 },
  { key: 'mode', label: 'Hình thức', width: 14 },
  { key: 'test', label: 'Bài test', aliases: ['Có bài test', 'Kiểm tra'], width: 10 },
  { key: 'note', label: 'Mục tiêu', aliases: ['Ghi chú'], width: 40 },
]
const typeOf = (s: string): 'subject' | 'content' | null => {
  const n = norm(s)
  if (n.startsWith('mon') || n === 'subject') return 'subject'
  if (n.startsWith('noi dung') || n.startsWith('bai') || n === 'content') return 'content'
  return null
}
const modeOf = (s: string): 'online' | 'offline' | null => { const n = norm(s); return n.startsWith('truc tuyen') || n === 'online' ? 'online' : n.startsWith('truc tiep') || n === 'offline' ? 'offline' : null }
const yes = (s: string) => ['co', 'x', '1', 'yes', 'true', 'c'].includes(norm(s))

export function TrainingUnits({ programId, programTitle, programMode, units, editable, catalog, onReload, onMessage, onOpen }: {
  programId: string; programTitle: string; programMode: Mode; units: TUnit[]; editable: boolean; catalog: string[]
  onReload: () => Promise<void>; onMessage: (m: string, err?: boolean) => void; onOpen: (id: string) => void
}) {
  const [edit, setEdit] = useState<Partial<TUnit> | null>(null)
  const kids = (parent: string | null) => units.filter(u => u.parent_id === parent).sort((a, b) => a.seq - b.seq)
  const subjs = kids(null).filter(u => u.kind === 'subject')
  const contents = units.filter(u => u.kind === 'content')
  const hours = contents.reduce((a, u) => a + (Number(u.hours) || 0), 0)
  const hoursOf = (s: TUnit) => kids(s.id).reduce((a, u) => a + (Number(u.hours) || 0), 0)
  const ordered: { u: TUnit; depth: number }[] = []
  subjs.forEach(s => { ordered.push({ u: s, depth: 0 }); kids(s.id).forEach(c => ordered.push({ u: c, depth: 1 })) })
  const lc = (x: string) => x.trim().toLowerCase()
  const freeCatalog = catalog.filter(n => !subjs.some(s => lc(s.title) === lc(n)) || (edit?.id && lc(edit.title ?? '') === lc(n)))

  const addChild = (parent: TUnit | null) => setEdit({ parent_id: parent?.id ?? null, kind: parent ? 'content' : 'subject', title: '',
    seq: kids(parent?.id ?? null).reduce((m, u) => Math.max(m, u.seq), 0) + 1, hours: parent ? 1 : 0, mode: null, has_test: false, note: '' })

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return
    const title = (edit.title ?? '').trim()
    if (!title) return onMessage(edit.kind === 'subject' ? 'Chọn hoặc nhập tên môn.' : 'Nhập tên nội dung tập huấn.', true)
    const row: Record<string, unknown> = edit.kind === 'subject'
      ? { program_id: programId, parent_id: null, kind: 'subject', seq: Number(edit.seq) || 1, title, note: edit.note?.trim() || null }
      : { program_id: programId, parent_id: edit.parent_id, kind: 'content', seq: Number(edit.seq) || 1, title, hours: Math.max(0, Number(edit.hours) || 0),
          mode: edit.mode ?? null, has_test: !!edit.has_test, note: edit.note?.trim() || null }
    const { error } = edit.id ? await supabase.from('training_program_units').update(row).eq('id', edit.id) : await supabase.from('training_program_units').insert(row)
    if (error) return onMessage(error.message, true)
    setEdit(null); await onReload()
  }
  async function del(u: TUnit) {
    if (!confirm(u.kind === 'subject' ? `Xoá môn "${u.title}" và ${kids(u.id).length} nội dung bên trong?` : `Xoá nội dung "${u.title}"?`)) return
    const { error } = await supabase.from('training_program_units').delete().eq('id', u.id)
    if (error) return onMessage(error.message, true)
    await onReload()
  }

  async function importRows(recs: (Record<string, string> & { _line: number })[]) {
    const bad: string[] = []
    type R = { kind: 'subject' | 'content'; title: string; hours: number; mode: 'online' | 'offline' | null; has_test: boolean; note: string | null }
    const rows: R[] = []
    let hasSubject = false
    for (const r of recs) {
      const k = typeOf(r.type)
      if (!k) { bad.push(`dòng ${r._line}: loại "${r.type}" không rõ (Môn / Nội dung)`); continue }
      if (!r.title.trim()) { bad.push(`dòng ${r._line}: thiếu tên`); continue }
      if (k === 'content' && !hasSubject) { bad.push(`dòng ${r._line}: nội dung chưa thuộc môn nào`); continue }
      if (k === 'subject') hasSubject = true
      const h = Number(String(r.hours).replace(',', '.'))
      rows.push({ kind: k, title: r.title.trim(), hours: Number.isFinite(h) && h > 0 ? h : k === 'content' ? 1 : 0, mode: modeOf(r.mode), has_test: yes(r.test), note: r.note.trim() || null })
    }
    if (!rows.length) return importSummary(0, 'mục', bad)
    if (units.length && !confirm(`Thay toàn bộ ${units.length} mục hiện có bằng ${rows.length} mục trong file?`)) return 'Đã huỷ nhập.'
    if (units.length) {
      const { error } = await supabase.from('training_program_units').delete().eq('program_id', programId)
      if (error) return error.message
    }
    let subject: string | null = null
    let sSeq = 0, cSeq = 0
    for (const r of rows) {
      const ins: Record<string, unknown> = r.kind === 'subject'
        ? { program_id: programId, kind: 'subject', seq: ++sSeq, title: r.title, note: r.note }
        : { program_id: programId, parent_id: subject, kind: 'content', seq: ++cSeq, title: r.title, hours: r.hours, mode: r.mode, has_test: r.has_test, note: r.note }
      const res = await supabase.from('training_program_units').insert(ins).select('id').single()
      if (res.error) { bad.push(`"${r.title}": ${res.error.message}`); continue }
      if (r.kind === 'subject') { subject = (res.data as { id: string }).id; cSeq = 0 }
    }
    await onReload()
    return importSummary(rows.length, 'mục', bad)
  }
  function exportRows() {
    downloadXlsx(`Chuong-trinh-tap-huan ${programTitle}`, IMPORT, ordered.map(({ u }) => [KIND[u.kind], u.title, u.kind === 'content' ? Number(u.hours) : hoursOf(u),
      u.kind === 'content' ? (u.mode ? MODE[u.mode] : '') : '', u.kind === 'content' ? (u.has_test ? 'Có' : '') : '', u.note ?? '']), 'Cấu trúc')
  }

  const form = (depth: number) => (
    <tr className="tpformrow uedit">
      <td style={{ paddingLeft: 8 + depth * 22 }}><small>{KIND[edit?.kind ?? 'subject']}</small><br />
        <input type="number" min={1} value={edit?.seq ?? ''} onChange={e => setEdit({ ...edit, seq: Number(e.target.value) })} aria-label="Thứ tự" style={{ width: 56 }} /></td>
      <td>{edit?.kind === 'subject' && (
          <select value={freeCatalog.find(n => lc(n) === lc(edit.title ?? '')) ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} aria-label="Chọn môn trong danh mục" style={{ width: '100%', marginBottom: 4 }}>
            <option value="">{freeCatalog.length ? `— Chọn môn trong danh mục (${freeCatalog.length}) hoặc nhập tên bên dưới —` : 'Danh mục chưa có môn phù hợp, nhập tên bên dưới'}</option>
            {freeCatalog.map(n => <option key={n} value={n}>{n}</option>)}
          </select>)}
        <input value={edit?.title ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} aria-label="Tên" autoFocus maxLength={200} style={{ width: '100%', minWidth: 200 }}
          placeholder={edit?.kind === 'subject' ? 'Tên môn, ví dụ: Phương pháp dạy học STEM' : 'Tên nội dung tập huấn'} />
        <input value={edit?.note ?? ''} onChange={e => setEdit({ ...edit, note: e.target.value })} aria-label="Mục tiêu" placeholder="Mục tiêu" maxLength={2000} style={{ width: '100%', marginTop: 4 }} /></td>
      <td>{edit?.kind === 'content' ? <select value={edit.mode ?? ''} onChange={e => setEdit({ ...edit, mode: (e.target.value || null) as TUnit['mode'] })} aria-label="Hình thức">
        <option value="">Theo chương trình</option><option value="online">Trực tuyến</option><option value="offline">Trực tiếp</option></select> : ''}</td>
      <td>{edit?.kind === 'content' ? <input type="number" min={0} max={500} step={0.5} value={edit.hours ?? 0} onChange={e => setEdit({ ...edit, hours: Number(e.target.value) })} aria-label="Số giờ" style={{ width: 70 }} /> : ''}</td>
      <td>{edit?.kind === 'content' ? <input type="checkbox" checked={!!edit.has_test} onChange={e => setEdit({ ...edit, has_test: e.target.checked })} aria-label="Có bài test" /> : ''}</td>
      <td><span className="tools"><button className="primary" type="submit" form="tp-unit">Lưu</button><button type="button" onClick={() => setEdit(null)}>Huỷ</button></span></td>
    </tr>
  )
  const newParent = edit && !edit.id ? edit.parent_id ?? null : null
  const lastKid = newParent ? kids(newParent)[kids(newParent).length - 1] : undefined
  const addAfter = newParent ? (lastKid?.id ?? newParent) : null

  return <>
    <Tiles items={[
      { label: 'Môn', value: subjs.length, sub: subjs.some(s => !kids(s.id).length) ? 'có môn chưa có nội dung' : undefined },
      { label: 'Nội dung tập huấn', value: contents.length, sub: `${contents.filter(u => detailCount(u.detail)).length} nội dung đã soạn chi tiết` },
      { label: 'Tổng số giờ', value: num(hours) },
      { label: 'Có bài test', value: contents.filter(u => u.has_test).length, sub: `${contents.filter(u => (u.mode ?? programMode) === 'online').length} nội dung trực tuyến` },
    ]} />
    <div className="bar">
      <p className="sub" style={{ margin: 0 }}>Cấu trúc: môn → nội dung tập huấn. Số giờ tính theo nội dung. Bấm "Soạn nội dung" để thêm bài giảng, tài liệu, định mức vật tư, hoạt động và bài test.</p>
      <div className="tools">
        {editable && <ImportExcel columns={IMPORT} template="Mau-chuong-trinh-tap-huan"
          sample={[['Môn', 'Phương pháp dạy học STEM', '', '', '', 'Nắm quy trình thiết kế bài học STEM'], ['Nội dung', 'Quy trình 4 bước thiết kế bài học STEM', '3', 'Trực tiếp', 'Có', ''],
            ['Nội dung', 'Thực hành soạn kế hoạch bài dạy', '4', 'Trực tuyến', '', '']]}
          onRecords={importRows} onMessage={(m, e) => onMessage(m, e)} />}
        {units.length > 0 && <button type="button" onClick={exportRows}>Tải Excel</button>}
        {editable && <button type="button" className="primary" onClick={() => addChild(null)}>Thêm môn</button>}
      </div>
    </div>
    <form id="tp-unit" onSubmit={save} />
    {!units.length && !edit ? <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có môn nào.{editable && ' Bấm "Thêm môn" hoặc "Nhập Excel".'}</p></div> : (
      <div className="wrap"><table>
        <thead><tr><th style={{ width: 90 }}>Mục</th><th>Tên · mục tiêu</th><th style={{ width: 140 }}>Hình thức</th><th style={{ width: 80 }}>Số giờ</th><th style={{ width: 70 }}>Bài test</th><th></th></tr></thead>
        <tbody>
          {ordered.map(({ u, depth }) => <Fragment key={u.id}>
            {edit?.id === u.id ? form(depth) : <tr>
              <td style={{ paddingLeft: 8 + depth * 22 }}><small className="sub">{KIND[u.kind]}</small> <b>{u.seq}</b></td>
              <td>{u.kind === 'subject' ? <b>{u.title}</b> : <button type="button" className="namelink" onClick={() => onOpen(u.id)}>{u.title}</button>}
                {u.note && <><br /><small className="sub">Mục tiêu: {u.note}</small></>}
                {u.kind === 'content' && <><br /><small className="sub">{detailCount(u.detail) || 'Chưa soạn chi tiết'}</small></>}</td>
              <td>{u.kind === 'content' ? (u.mode ? MODE[u.mode] : <small className="sub">{MODE[programMode]}</small>) : ''}</td>
              <td>{u.kind === 'content' ? num(Number(u.hours)) : <small className="sub">{num(hoursOf(u))}</small>}</td>
              <td>{u.kind === 'content' ? (u.has_test ? 'Có' : '—') : ''}</td>
              <td className="tools">
                {u.kind === 'content' && <button type="button" onClick={() => onOpen(u.id)}>{editable ? 'Soạn nội dung' : 'Xem nội dung'}</button>}
                {editable && <>
                  {u.kind === 'subject' && <button type="button" onClick={() => addChild(u)}>+ Nội dung</button>}
                  <button type="button" onClick={() => setEdit({ ...u })}>Sửa</button>
                  <button type="button" className="danger" onClick={() => del(u)}>Xoá</button>
                </>}</td>
            </tr>}
            {addAfter === u.id && form(1)}
          </Fragment>)}
          {edit && !edit.id && edit.kind === 'subject' && form(0)}
        </tbody>
      </table></div>
    )}
  </>
}
