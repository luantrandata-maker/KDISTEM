// Chương trình tập huấn: bảng Môn → Nội dung tập huấn và yêu cầu cần đạt, cùng cách làm với Chương trình giáo dục:
// thẻ số liệu, "Chỉnh sửa cấu trúc" mở bảng nháp (thêm / sửa / xoá / đổi thứ tự) rồi "Lưu tất cả" một lần, nhập / tải Excel.
import { Fragment, useState } from 'react'
import { StructureDraft, newKey, saveDraftTree, type DCol, type DRow } from '../../components/StructureDraft'
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
type TF = { hours: number; mode: 'online' | 'offline' | null; has_test: boolean; detail: Detail }
const TLEVELS = { subject: { label: 'Môn', child: 'content', ph: 'Tên môn, ví dụ: Phương pháp dạy học STEM' }, content: { label: 'Nội dung', ph: 'Tên nội dung tập huấn' } }
const reqsOf = (d: Detail | null | undefined) => (d?.body?.reqs ?? []).map(x => x.trim()).filter(Boolean)
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
  const [draft, setDraft] = useState<DRow<TF>[] | null>(null)
  const kids = (parent: string | null) => units.filter(u => u.parent_id === parent).sort((a, b) => a.seq - b.seq)
  const subjs = kids(null).filter(u => u.kind === 'subject')
  const contents = units.filter(u => u.kind === 'content')
  const hours = contents.reduce((a, u) => a + (Number(u.hours) || 0), 0)
  const hoursOf = (s: TUnit) => kids(s.id).reduce((a, u) => a + (Number(u.hours) || 0), 0)
  const ordered: { u: TUnit; depth: number }[] = []
  subjs.forEach(s => { ordered.push({ u: s, depth: 0 }); kids(s.id).forEach(c => ordered.push({ u: c, depth: 1 })) })
  const lc = (x: string) => x.trim().toLowerCase()

  // ----- Chỉnh sửa cấu trúc trên bảng nháp, lưu một lần -----
  const toDraft = (): DRow<TF>[] => ordered.map(({ u }) => ({
    key: u.id, id: u.id, parent: u.parent_id, type: u.kind, title: u.title, goal: u.note ?? '',
    f: { hours: Number(u.hours) || 0, mode: u.mode, has_test: u.has_test, detail: u.detail ?? {} },
    outs: reqsOf(u.detail).map((c, i) => ({ key: `${u.id}:${i}`, code: '', content: c, comp: null })),
  }))
  function startDraft(addSubject: boolean) {
    const rows = toDraft()
    if (addSubject) rows.push({ key: newKey(), parent: null, type: 'subject', title: '', goal: '', f: { hours: 0, mode: null, has_test: false, detail: {} }, outs: [] })
    setDraft(rows)
  }
  const cols: DCol<TF>[] = [
    { label: 'Hình thức', width: 150, cell: (r, set) => r.type === 'content' ? <select value={r.f.mode ?? ''} onChange={e => set({ mode: (e.target.value || null) as TF['mode'] })} aria-label="Hình thức">
      <option value="">Theo chương trình</option><option value="online">Trực tuyến</option><option value="offline">Trực tiếp</option></select> : null },
    { label: 'Số giờ', width: 90, cell: (r, set) => r.type === 'content' ? <input type="number" min={0} max={500} step={0.5} value={r.f.hours} onChange={e => set({ hours: Math.max(0, Number(e.target.value) || 0) })} aria-label="Số giờ" style={{ width: 76 }} /> : null },
    { label: 'Bài test', width: 70, cell: (r, set) => r.type === 'content' ? <input type="checkbox" checked={r.f.has_test} onChange={e => set({ has_test: e.target.checked })} aria-label="Có bài test" /> : null },
  ]
  // Môn: chọn nhanh từ danh mục (môn chưa có trong chương trình)
  const catalogPick = (r: DRow<TF>, patch: (x: Partial<DRow<TF>>) => void, rows: DRow<TF>[]) => {
    if (r.type !== 'subject') return null
    const free = catalog.filter(n => lc(n) === lc(r.title) || !rows.some(x => x.type === 'subject' && lc(x.title) === lc(n)))
    if (!free.length) return null
    return <select value={free.find(n => lc(n) === lc(r.title)) ?? ''} onChange={e => patch({ title: e.target.value })} aria-label="Chọn môn trong danh mục" style={{ width: '100%', marginBottom: 6 }}>
      <option value="">— Chọn môn trong danh mục ({free.length}) hoặc nhập tên bên dưới —</option>{free.map(n => <option key={n} value={n}>{n}</option>)}</select>
  }
  const withReqs = (r: DRow<TF>): Detail => {
    const reqs = r.outs.map(o => o.content.trim()).filter(Boolean)
    const d = r.f.detail ?? {}
    return reqs.length || d.body?.reqs?.length ? { ...d, body: { ...d.body, reqs } } : d
  }
  async function saveDraft(rows: DRow<TF>[]) {
    const errs = await saveDraftTree(toDraft(), rows, {
      table: 'training_program_units',
      toRow: (r, parentId, seq) => r.type === 'subject'
        ? { program_id: programId, parent_id: null, kind: 'subject', seq, title: r.title.trim(), note: r.goal.trim() || null, detail: withReqs(r) }
        : { program_id: programId, parent_id: parentId, kind: 'content', seq, title: r.title.trim(), hours: r.f.hours, mode: r.f.mode, has_test: r.f.has_test, note: r.goal.trim() || null, detail: withReqs(r) },
    })
    await onReload()
    if (errs.length) return 'Một số mục chưa lưu được: ' + errs.join('; ')
    setDraft(null); onMessage('Đã lưu cấu trúc và yêu cầu cần đạt.')
    return null
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
        {editable && !draft && <ImportExcel columns={IMPORT} template="Mau-chuong-trinh-tap-huan"
          sample={[['Môn', 'Phương pháp dạy học STEM', '', '', '', 'Nắm quy trình thiết kế bài học STEM'], ['Nội dung', 'Quy trình 4 bước thiết kế bài học STEM', '3', 'Trực tiếp', 'Có', ''],
            ['Nội dung', 'Thực hành soạn kế hoạch bài dạy', '4', 'Trực tuyến', '', '']]}
          onRecords={importRows} onMessage={(m, e) => onMessage(m, e)} />}
        {units.length > 0 && !draft && <button type="button" onClick={exportRows}>Tải Excel</button>}
        {editable && !draft && units.length > 0 && <button type="button" onClick={() => startDraft(false)}>Chỉnh sửa cấu trúc</button>}
        {editable && !draft && <button type="button" className="primary" onClick={() => startDraft(true)}>Thêm môn</button>}
      </div>
    </div>
    {draft ? <StructureDraft<TF> levels={TLEVELS} root="subject" initial={draft} cols={cols} titleExtra={catalogPick} outCode={false}
      newFields={t => ({ hours: t === 'content' ? 1 : 0, mode: null, has_test: false, detail: {} })} onSave={saveDraft} onCancel={() => setDraft(null)} />
    : !units.length ? <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có môn nào.{editable && ' Bấm "Thêm môn" hoặc "Nhập Excel".'}</p></div> : (
      <div className="wrap"><table>
        <thead><tr><th style={{ width: 90 }}>Mục</th><th>Tên · mục tiêu · yêu cầu cần đạt</th><th style={{ width: 140 }}>Hình thức</th><th style={{ width: 80 }}>Số giờ</th><th style={{ width: 70 }}>Bài test</th><th></th></tr></thead>
        <tbody>
          {ordered.map(({ u, depth }) => <Fragment key={u.id}>
            {<tr>
              <td style={{ paddingLeft: 8 + depth * 22 }}><small className="sub">{KIND[u.kind]}</small> <b>{u.seq}</b></td>
              <td>{u.kind === 'subject' ? <b>{u.title}</b> : <button type="button" className="namelink" onClick={() => onOpen(u.id)}>{u.title}</button>}
                {u.note && <><br /><small className="sub">Mục tiêu: {u.note}</small></>}
                {reqsOf(u.detail).map((x, i) => <div key={i} style={{ fontSize: 13, marginTop: 2 }}>✓ {x}</div>)}
                {u.kind === 'content' && <><br /><small className="sub">{detailCount(u.detail) || 'Chưa soạn chi tiết'}</small></>}</td>
              <td>{u.kind === 'content' ? (u.mode ? MODE[u.mode] : <small className="sub">{MODE[programMode]}</small>) : ''}</td>
              <td>{u.kind === 'content' ? num(Number(u.hours)) : <small className="sub">{num(hoursOf(u))}</small>}</td>
              <td>{u.kind === 'content' ? (u.has_test ? 'Có' : '—') : ''}</td>
              <td className="tools">
                {u.kind === 'content' && <button type="button" onClick={() => onOpen(u.id)}>{editable ? 'Soạn nội dung' : 'Xem nội dung'}</button>}
              </td>
            </tr>}
          </Fragment>)}
        </tbody>
      </table></div>
    )}
  </>
}
