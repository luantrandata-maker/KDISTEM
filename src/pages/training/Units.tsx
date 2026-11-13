// Chương trình đào tạo: bảng Môn → Nội dung đào tạo và yêu cầu cần đạt, cùng cách làm với Chương trình giáo dục:
// thẻ số liệu, "Chỉnh sửa cấu trúc" mở bảng nháp (thêm / sửa / xoá / đổi thứ tự) rồi "Lưu tất cả" một lần, nhập / tải Excel.
import { useEffect, useState } from 'react'
import { DataTable, type Col } from '../../components/DataTable'
import { StructureDraft, newKey, saveDraftTree, type DCol, type DRow } from '../../components/StructureDraft'
import { supabase } from '../../lib/supabase'
import { downloadXlsx, importSummary, norm, type Column } from '../../lib/sheet'
import ImportExcel from '../../components/ImportExcel'
import { type Detail } from './Content'

export type TUnit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; hours: number
  mode: 'online' | 'offline' | null; has_test: boolean; note: string | null; detail: Detail }
type Mode = 'online' | 'offline' | 'hybrid'
const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const KIND = { subject: 'Môn', content: 'Nội dung' }
type TF = { hours: number; mode: 'online' | 'offline' | null; has_test: boolean; detail: Detail }
const TLEVELS = { subject: { label: 'Môn', child: 'content', ph: 'Tên môn, ví dụ: Phương pháp dạy học STEM' }, content: { label: 'Nội dung', ph: 'Tên nội dung đào tạo' } }
const reqsOf = (d: Detail | null | undefined) => (d?.body?.reqs ?? []).map(x => x.trim()).filter(Boolean)
const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')

const IMPORT: Column[] = [
  { key: 'type', label: 'Loại', required: true, aliases: ['Cấp', 'Loại mục'], width: 12 },
  { key: 'title', label: 'Tên', required: true, aliases: ['Tên môn / nội dung', 'Nội dung đào tạo', 'Tên môn'], width: 44 },
  { key: 'hours', label: 'Số giờ', aliases: ['Giờ'], width: 8 },
  { key: 'test', label: 'Bài test', aliases: ['Có bài test', 'Kiểm tra'], width: 10 },
  { key: 'mode', label: 'Hình thức', width: 14 },
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
  const [cur, setCur] = useState('')
  const [q, setQ] = useState('')
  const [addS, setAddS] = useState(false)
  const [newSubj, setNewSubj] = useState('')
  const [nd, setNd] = useState({ subj: '', title: '', reqs: '', mode: '' as '' | 'online' | 'offline', hours: '1', test: false })
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  // Bài giảng (Học liệu đào tạo) đã gắn với từng nội dung
  const [kit, setKit] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    supabase.from('training_lessons').select('unit_id, status').eq('program_id', programId).then(({ data }) => {
      const m = new Map<string, string>()
      for (const r of (data ?? []) as { unit_id: string | null; status: string }[]) if (r.unit_id && m.get(r.unit_id) !== 'published') m.set(r.unit_id, r.status)
      setKit(m)
    })
  }, [programId, units])
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
    { label: 'Số giờ', width: 90, cell: (r, set) => r.type === 'content' ? <input type="number" min={0} max={500} step={0.5} value={r.f.hours} onChange={e => set({ hours: Math.max(0, Number(e.target.value) || 0) })} aria-label="Số giờ" style={{ width: 76 }} /> : null },
    { label: 'Bài test', width: 70, cell: (r, set) => r.type === 'content' ? <input type="checkbox" checked={r.f.has_test} onChange={e => set({ has_test: e.target.checked })} aria-label="Có bài test" /> : null },
    { label: 'Hình thức', width: 150, cell: (r, set) => r.type === 'content' ? <select value={r.f.mode ?? ''} onChange={e => set({ mode: (e.target.value || null) as TF['mode'] })} aria-label="Hình thức">
      <option value="">Theo chương trình</option><option value="online">Trực tuyến</option><option value="offline">Trực tiếp</option></select> : null },
  ]
  // Môn: một ô duy nhất, gõ tên hoặc chọn nhanh từ danh mục (môn chưa có trong chương trình)
  const catalogOpts = (r: DRow<TF>, rows: DRow<TF>[]) => r.type !== 'subject' ? null
    : catalog.filter(n => lc(n) === lc(r.title) || !rows.some(x => x.type === 'subject' && lc(x.title) === lc(n)))
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

  // ----- Xem / sửa ngay trên bảng: danh sách môn bên trái, bảng nội dung bên phải (như Môn & bài học của chương trình giáo dục) -----
  type CRow = { u: TUnit; subj: TUnit }
  const rowsAll: CRow[] = subjs.flatMap(s => kids(s.id).filter(c => c.kind === 'content').map(c => ({ u: c, subj: s })))
  const sel = subjs.find(s => s.id === cur) ?? null
  const inSel = sel ? rowsAll.filter(r => r.subj.id === sel.id) : rowsAll
  const shown = q.trim() ? inSel.filter(r => lc(r.u.title).includes(lc(q)) || reqsOf(r.u.detail).some(x => lc(x).includes(lc(q)))) : inSel
  const target = sel ?? subjs.find(s => s.id === nd.subj) ?? subjs[0] ?? null
  const fail = (e: { message: string } | null) => { if (e) onMessage(e.message, true); return !e }
  const upd = async (u: TUnit, patch: Partial<TUnit>) => { if (fail((await supabase.from('training_program_units').update(patch).eq('id', u.id)).error)) await onReload() }
  const setReqs = (u: TUnit, text: string) => { const reqs = text.split(/\n|;/).map(x => x.trim()).filter(Boolean), d = u.detail ?? {}
    return upd(u, { detail: { ...d, body: { ...d.body, reqs } } as Detail }) }
  async function addSubject() {
    const t = newSubj.trim(); if (!t) return
    if (subjs.some(s => lc(s.title) === lc(t))) return onMessage(`Môn "${t}" đã có trong chương trình.`, true)
    const res = await supabase.from('training_program_units').insert({ program_id: programId, parent_id: null, kind: 'subject', seq: Math.max(0, ...subjs.map(s => s.seq)) + 1, title: t }).select('id').single()
    if (!fail(res.error)) return
    setNewSubj(''); setAddS(false); await onReload(); setCur((res.data as { id: string }).id)
  }
  async function removeSubject(s: TUnit) {
    const n = kids(s.id).length
    if (!confirm(`Bạn có muốn xoá môn "${s.title}" khỏi chương trình không?${n ? ` Môn này đang có ${n} nội dung, các nội dung cũng bị xoá.` : ''}`)) return
    if (n && !fail((await supabase.from('training_program_units').delete().eq('parent_id', s.id)).error)) return
    if (!fail((await supabase.from('training_program_units').delete().eq('id', s.id)).error)) return
    if (cur === s.id) setCur(''); await onReload()
  }
  async function addContent() {
    const t = nd.title.trim(); if (!t || !target || busy) return
    setBusy(true)
    const h = Number(nd.hours.replace(',', '.'))
    const reqs = nd.reqs.split(/\n|;/).map(x => x.trim()).filter(Boolean)
    const { error } = await supabase.from('training_program_units').insert({ program_id: programId, parent_id: target.id, kind: 'content', seq: Math.max(0, ...kids(target.id).map(c => c.seq)) + 1,
      title: t, hours: Number.isFinite(h) && h > 0 ? h : 1, mode: nd.mode || null, has_test: nd.test, detail: reqs.length ? { body: { reqs } } : {} })
    setBusy(false)
    if (!fail(error)) return
    setNd(d => ({ ...d, title: '', reqs: '' })); await onReload(); document.getElementById('tu-new-title')?.focus()
  }
  async function duplicate(r: CRow) {
    setBusy(true)
    for (const c of kids(r.subj.id).filter(c => c.seq > r.u.seq).sort((a, b) => b.seq - a.seq))
      if (!fail((await supabase.from('training_program_units').update({ seq: c.seq + 1 }).eq('id', c.id)).error)) { setBusy(false); return }
    const { error } = await supabase.from('training_program_units').insert({ program_id: programId, parent_id: r.subj.id, kind: 'content', seq: r.u.seq + 1, title: r.u.title,
      hours: r.u.hours, mode: r.u.mode, has_test: r.u.has_test, note: r.u.note, detail: r.u.detail ?? {} })
    setBusy(false)
    if (fail(error)) { await onReload(); onMessage(`Đã nhân bản "${r.u.title}" ngay bên dưới.`) }
  }
  async function removeContent(r: CRow) {
    if (!confirm(`Xoá nội dung "${r.u.title}"?`)) return
    if (fail((await supabase.from('training_program_units').delete().eq('id', r.u.id)).error)) await onReload()
  }
  // Kéo thả: đổi thứ tự trong môn; thả vào dòng của môn khác thì chuyển nội dung sang môn đó
  async function moveTo(id: string, over: CRow) {
    const r = rowsAll.find(x => x.u.id === id); if (!r || r.u.id === over.u.id) return
    const same = r.subj.id === over.subj.id
    const sibs = kids(over.subj.id), rest = sibs.filter(c => c.id !== r.u.id)
    const at = rest.findIndex(c => c.id === over.u.id) + (same && sibs.findIndex(c => c.id === r.u.id) < sibs.findIndex(c => c.id === over.u.id) ? 1 : 0)
    const next = [...rest]; next.splice(at, 0, r.u)
    const res = await Promise.all(next.map((c, i) => c.seq !== i + 1 || c.id === r.u.id && !same
      ? supabase.from('training_program_units').update(c.id === r.u.id && !same ? { seq: i + 1, parent_id: over.subj.id } : { seq: i + 1 }).eq('id', c.id) : Promise.resolve({ error: null })))
    fail(res.find(x => x.error)?.error ?? null); await onReload()
  }
  const cell = (u: TUnit, key: 'title' | 'hours' | 'reqs') => {
    const val = key === 'title' ? u.title : key === 'hours' ? num(Number(u.hours)) : reqsOf(u.detail).join('\n')
    if (!editable) return key === 'reqs' ? (val ? <span className="yc" style={{ whiteSpace: 'pre-line' }}>{val}</span> : '—') : key === 'title' ? <button type="button" className="namelink" onClick={() => onOpen(u.id)}>{u.title}</button> : val
    const save = (v: string) => { if (v === val) return
      if (key === 'title') return v.trim() ? upd(u, { title: v.trim() }) : undefined
      if (key === 'hours') { const h = Number(v.replace(',', '.')); return Number.isFinite(h) && h >= 0 ? upd(u, { hours: h }) : undefined }
      return setReqs(u, v) }
    return key === 'reqs'
      ? <textarea key={u.id + val} className="slcell" defaultValue={val} rows={Math.min(4, Math.max(1, reqsOf(u.detail).length))} placeholder="Mỗi dòng một yêu cầu" aria-label={`Yêu cầu cần đạt của ${u.title}`} onBlur={e => save(e.target.value)} />
      : <input key={u.id + val} className="slcell" defaultValue={val} inputMode={key === 'hours' ? 'decimal' : undefined} aria-label={`${key === 'title' ? 'Tên' : 'Số giờ'} ${u.title}`}
          onBlur={e => save(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  }
  const kitChip = (u: TUnit) => { const k = kit.get(u.id); return k === 'published' ? <span className="gpill good">Đã phát hành</span> : k ? <span className="gpill warn">Đang soạn</span> : <span className="gpill warn">Chưa có</span> }
  const noOf = (r: CRow) => inSel.indexOf(r) + 1
  const tcols: Col<CRow>[] = [
    { key: 'no', label: '#', thClass: 'c-no', fixed: true, cell: r => <span className="sub">{noOf(r)}</span> },
    ...(!sel ? [{ key: 'subj', label: 'Môn', thClass: 'c-subj', text: (r: CRow) => r.subj.title, cell: (r: CRow) => <button type="button" className="slsubjlink" onClick={() => setCur(r.subj.id)}>{r.subj.title}</button> }] : []),
    { key: 'title', label: 'Tên nội dung', thClass: 'c-title', fixed: true, text: r => r.u.title, cell: r => cell(r.u, 'title') },
    { key: 'reqs', label: 'Yêu cầu cần đạt', thClass: 'c-outs', cell: r => cell(r.u, 'reqs') },
    { key: 'hours', label: 'Số giờ', thClass: 'c-per', text: r => num(Number(r.u.hours)), cell: r => cell(r.u, 'hours') },
    { key: 'test', label: 'Bài test', thClass: 'c-test', text: r => r.u.has_test ? 'Có' : '', cell: r => editable
      ? <input type="checkbox" checked={r.u.has_test} aria-label={`Bài test ${r.u.title}`} onChange={e => upd(r.u, { has_test: e.target.checked })} /> : r.u.has_test ? 'Có' : '—' },
    { key: 'mode', label: 'Hình thức', thClass: 'c-mode', text: r => r.u.mode ? MODE[r.u.mode] : MODE[programMode], cell: r => editable
      ? <select className="slcell" value={r.u.mode ?? ''} aria-label={`Hình thức ${r.u.title}`} onChange={e => upd(r.u, { mode: (e.target.value || null) as TUnit['mode'] })}>
          <option value="">{MODE[programMode]} (theo CT)</option><option value="online">Trực tuyến</option><option value="offline">Trực tiếp</option></select>
      : r.u.mode ? MODE[r.u.mode] : <small className="sub">{MODE[programMode]}</small> },
    { key: 'mat', label: 'Học liệu', thClass: 'c-mat', text: r => kit.get(r.u.id) === 'published' ? 'Đã phát hành' : kit.get(r.u.id) ? 'Đang soạn' : 'Chưa có',
      cell: r => <button type="button" className="slopen" onClick={() => onOpen(r.u.id)} title={editable ? 'Soạn nội dung: bài giảng, tài liệu, hoạt động, bài test' : 'Xem nội dung'}>{kitChip(r.u)}<span className="slmore">{editable ? 'Soạn ›' : 'Xem ›'}</span></button> },
    ...(editable ? [{ key: 'act', label: '', thClass: 'c-act', fixed: true, cell: (r: CRow) =>
      <span className="slact"><span className="sldrag" draggable title="Kéo để đổi vị trí" aria-label={`Kéo ${r.u.title} để đổi vị trí`}
        onDragStart={e => { setDrag(r.u.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.u.id); const tr = (e.target as HTMLElement).closest('tr'); if (tr) e.dataTransfer.setDragImage(tr, 20, 20) }}
        onDragEnd={() => { setDrag(null); setOver(null) }}>⠿</span>
        <button type="button" disabled={busy} aria-label={`Nhân bản ${r.u.title}`} title="Nhân bản: tạo ngay một nội dung giống hệt bên dưới" onClick={() => duplicate(r)}>⧉</button>
        <button type="button" className="danger" aria-label={`Xoá ${r.u.title}`} onClick={() => removeContent(r)}>×</button></span> }] : []),
  ]
  const navItem = (s: TUnit | null) => { const rs = s ? rowsAll.filter(r => r.subj.id === s.id) : rowsAll, on = (s?.id ?? '') === (sel?.id ?? '')
    return <div key={s?.id ?? '*'} className={'slnavrow' + (on ? ' on' : '')}>
      <button type="button" className={'slnavi' + (on ? ' on' : '')} onClick={() => setCur(s?.id ?? '')}>
        <span className="slnm">{s ? s.title : 'Tất cả'}</span><span className="slcnt">{rs.length} nội dung · {num(rs.reduce((a, r) => a + (Number(r.u.hours) || 0), 0))} giờ</span></button>
      {editable && s && <button type="button" className="slnavx" title={`Xoá môn ${s.title}`} aria-label={`Xoá môn ${s.title}`} onClick={() => removeSubject(s)}>×</button>}</div> }
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addContent() } }

  if (draft) return <>
    <h4>Môn & nội dung</h4>
    <StructureDraft<TF> levels={TLEVELS} root="subject" initial={draft} cols={cols} titleOptions={catalogOpts} outCode={false}
      newFields={t => ({ hours: t === 'content' ? 1 : 0, mode: null, has_test: false, detail: {} })} onSave={saveDraft} onCancel={() => setDraft(null)} />
  </>
  return <>
    <h4>Môn & nội dung</h4>
    <div className="slwrap">
      <nav className="slnav" aria-label="Môn trong chương trình">
        {navItem(null)}
        {subjs.map(s => navItem(s))}
        {editable && (addS ? <div className="sladdbox">
            <input className="sladdsel" autoFocus list="tu-subj-catalog" value={newSubj} placeholder="Tên môn, rồi Enter" aria-label="Tên môn mới"
              onChange={e => setNewSubj(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubject() } if (e.key === 'Escape') setAddS(false) }} />
            <datalist id="tu-subj-catalog">{catalog.filter(n => !subjs.some(s => lc(s.title) === lc(n))).map(n => <option key={n} value={n} />)}</datalist>
            <span><button type="button" className="primary" disabled={!newSubj.trim()} onClick={addSubject}>Thêm</button> <button type="button" className="linkbtn" onClick={() => setAddS(false)}>Huỷ</button></span>
          </div>
          : <button type="button" className="sladdsubj" onClick={() => setAddS(true)}>+ Thêm môn</button>)}
      </nav>
      <div className="slmain">
        <DataTable id="training-units-v2" simple rows={shown} rowKey={r => r.u.id} className="slt tut"
          rowProps={editable ? r => ({ className: drag === r.u.id ? 'sldragging' : over === r.u.id && drag ? 'slover' : undefined,
            onDragOver: e => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== r.u.id) setOver(r.u.id) },
            onDrop: e => { e.preventDefault(); const id = drag; setDrag(null); setOver(null); if (id) moveTo(id, r) } }) : undefined}
          empty={<small className="sub">{inSel.length ? 'Không có nội dung nào khớp.' : !subjs.length ? `Chưa có môn.${editable ? ' Bấm “+ Thêm môn” hoặc “Nhập Excel”.' : ''}` : `${sel ? 'Môn ' + sel.title : 'Chương trình'} chưa có nội dung.${editable ? ' Gõ tên nội dung ở dòng dưới.' : ''}`}</small>}
          left={<input placeholder={sel ? `Tìm nội dung môn ${sel.title}…` : 'Tìm nội dung trong mọi môn…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm nội dung" />}
          right={<>
            {editable && <ImportExcel label="⇪ Nhập Excel" columns={IMPORT} template="Mau-chuong-trinh-tap-huan"
              sample={[['Môn', 'Phương pháp dạy học STEM', '', '', '', 'Nắm quy trình thiết kế bài học STEM'], ['Nội dung', 'Quy trình 4 bước thiết kế bài học STEM', '3', 'Trực tiếp', 'Có', ''],
                ['Nội dung', 'Thực hành soạn kế hoạch bài dạy', '4', 'Trực tuyến', '', '']]}
              onRecords={importRows} onMessage={(m, e) => onMessage(m, e)} />}
            {editable && units.length > 0 && <button type="button" onClick={() => startDraft(false)} title="Sửa nhiều mục cùng lúc rồi lưu một lần">Sửa hàng loạt</button>}
          </>}
          cols={tcols}
          foot={editable && target ? (keys: string[]) => {
            const subjSel = <select value={target.id} disabled={!!sel || subjs.length < 2} onChange={e => setNd({ ...nd, subj: e.target.value })} aria-label="Môn của nội dung mới">{subjs.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
            const cellOf = (k: string) => k === 'subj' ? subjSel
              : k === 'title' ? <div className="slnewrow">{!keys.includes('subj') && !sel && subjs.length > 1 ? subjSel : null}<input id="tu-new-title" className="slnt" value={nd.title} disabled={busy} placeholder="+ Tên nội dung mới" aria-label={`Tên nội dung mới môn ${target.title}`} onChange={e => setNd({ ...nd, title: e.target.value })} onKeyDown={enter} /></div>
              : k === 'reqs' ? <input className="slno" value={nd.reqs} disabled={busy} placeholder="Yêu cầu cần đạt (ngăn cách bằng ;)" aria-label="Yêu cầu cần đạt" onChange={e => setNd({ ...nd, reqs: e.target.value })} onKeyDown={enter} />
              : k === 'mode' ? <><select className="slnm2" value={nd.mode} onChange={e => setNd({ ...nd, mode: e.target.value as '' | 'online' | 'offline' })} aria-label="Hình thức nội dung mới">
<option value="">Theo CT</option><option value="online">Trực tuyến</option><option value="offline">Trực tiếp</option></select></>
              : k === 'hours' ? <input className="slnp" value={nd.hours} disabled={busy} placeholder="Số giờ" aria-label="Số giờ" inputMode="decimal" onChange={e => setNd({ ...nd, hours: e.target.value })} onKeyDown={enter} />
              : k === 'test' ? <label className="sltest"><input type="checkbox" checked={nd.test} onChange={e => setNd({ ...nd, test: e.target.checked })} /> Test</label>
              : k === 'act' ? <button type="button" className="primary" disabled={busy || !nd.title.trim()} onClick={addContent}>+ Thêm</button>
              : null
            return <tfoot><tr className="slnew">{keys.map(k => <td key={k}>{cellOf(k)}</td>)}{!keys.includes('act') && <td><button type="button" className="primary" disabled={busy || !nd.title.trim()} onClick={addContent}>+ Thêm</button></td>}</tr></tfoot>
          } : undefined} />
        {editable && <small className="sub">Bấm vào ô để sửa ngay, rời ô là lưu. Kéo ⠿ để đổi vị trí (thả vào dòng của môn khác là chuyển môn). Bấm ⧉ để nhân bản nội dung. Bấm “Soạn ›” để thêm bài giảng, tài liệu, định mức vật tư, hoạt động và bài test.</small>}
      </div>
    </div>
  </>
}
