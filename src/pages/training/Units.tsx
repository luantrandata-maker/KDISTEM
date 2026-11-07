// Chương trình đào tạo: bảng Môn → Nội dung đào tạo và yêu cầu cần đạt, cùng cách làm với Chương trình giáo dục:
// thẻ số liệu, "Chỉnh sửa cấu trúc" mở bảng nháp (thêm / sửa / xoá / đổi thứ tự) rồi "Lưu tất cả" một lần, nhập / tải Excel.
import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { StructureDraft, newKey, saveDraftTree, type DCol, type DRow } from '../../components/StructureDraft'
import { supabase } from '../../lib/supabase'
import { downloadXlsx, importSummary, norm, type Column } from '../../lib/sheet'
import ImportExcel from '../../components/ImportExcel'
import { detailCount, type Detail } from './Content'

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
  const [closed, setClosed] = useState<string[]>([])
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
    { label: 'Hình thức', width: 150, cell: (r, set) => r.type === 'content' ? <select value={r.f.mode ?? ''} onChange={e => set({ mode: (e.target.value || null) as TF['mode'] })} aria-label="Hình thức">
      <option value="">Theo chương trình</option><option value="online">Trực tuyến</option><option value="offline">Trực tiếp</option></select> : null },
    { label: 'Số giờ', width: 90, cell: (r, set) => r.type === 'content' ? <input type="number" min={0} max={500} step={0.5} value={r.f.hours} onChange={e => set({ hours: Math.max(0, Number(e.target.value) || 0) })} aria-label="Số giờ" style={{ width: 76 }} /> : null },
    { label: 'Bài test', width: 70, cell: (r, set) => r.type === 'content' ? <input type="checkbox" checked={r.f.has_test} onChange={e => set({ has_test: e.target.checked })} aria-label="Có bài test" /> : null },
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
  function exportRows() {
    downloadXlsx(`Chuong-trinh-tap-huan ${programTitle}`, IMPORT, ordered.map(({ u }) => [KIND[u.kind], u.title, u.kind === 'content' ? Number(u.hours) : hoursOf(u),
      u.kind === 'content' ? (u.mode ? MODE[u.mode] : '') : '', u.kind === 'content' ? (u.has_test ? 'Có' : '') : '', u.note ?? '']), 'Cấu trúc')
  }

  return <>
    <div className="pviewhead">
      <h4><Icon n="steps" size={18} /> Cấu trúc & yêu cầu cần đạt
        <small className="sub" style={{ fontWeight: 400 }}>{subjs.length} môn · {contents.length} nội dung đào tạo · {num(hours)} giờ · {contents.filter(u => u.has_test).length} có bài test · {contents.filter(u => detailCount(u.detail)).length} đã soạn chi tiết</small></h4>
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
    <small className="sub">Cấu trúc: môn → nội dung đào tạo. Số giờ tính theo nội dung.{subjs.some(s => !kids(s.id).length) ? ' Có môn chưa có nội dung.' : ''} Bấm {editable ? '"Soạn nội dung"' : '"Xem nội dung"'} để {editable ? 'thêm' : 'xem'} bài giảng, tài liệu, định mức vật tư, hoạt động và bài test.</small>
    {draft ? <StructureDraft<TF> levels={TLEVELS} root="subject" initial={draft} cols={cols} titleOptions={catalogOpts} outCode={false}
      newFields={t => ({ hours: t === 'content' ? 1 : 0, mode: null, has_test: false, detail: {} })} onSave={saveDraft} onCancel={() => setDraft(null)} />
    : !units.length ? <p className="sub" style={{ margin: 0 }}>Chưa có môn nào.{editable && ' Bấm "Thêm môn" hoặc "Nhập Excel".'}</p> : subjs.map(sj => {
      const open = !closed.includes(sj.id)
      const cs = kids(sj.id)
      const ok = cs.filter(c => kit.get(c.id) === 'published').length
      return <div key={sj.id} className="ugroup">
        <button type="button" className="ughead" aria-expanded={open} onClick={() => setClosed(open ? [...closed, sj.id] : closed.filter(x => x !== sj.id))}>
          <span className={'ugchev' + (open ? ' on' : '')} aria-hidden="true">›</span><small>MÔN</small> <b>{sj.title}</b>
          <small className="sub">{cs.length} nội dung · {num(hoursOf(sj))} giờ</small>
          <span className="ugbadge">Học liệu đủ {ok}/{cs.length}</span>
        </button>
        {open && <div className="wrap"><table className="utable">
          <thead><tr><th style={{ width: 40 }}>#</th><th style={{ width: '26%' }}>Tên</th><th>Mục tiêu · yêu cầu cần đạt</th><th style={{ width: 110 }}>Hình thức</th><th style={{ width: 70 }}>Số giờ</th><th style={{ width: 70 }}>Bài test</th><th style={{ width: 150 }}>Học liệu</th><th></th></tr></thead>
          <tbody>
            {(sj.note || reqsOf(sj.detail).length > 0) && <tr className="utopic"><td></td><td><small className="utk">MỤC TIÊU MÔN</small></td>
              <td colSpan={6}>{sj.note && <div className="uobj" title={sj.note}>{sj.note}</div>}{reqsOf(sj.detail).map((x, i) => <div key={i} className="uout">✓ {x}</div>)}</td></tr>}
            {cs.map((u, i) => { const k = kit.get(u.id), rq = reqsOf(u.detail)
              return <tr key={u.id}>
                <td className="sub">{i + 1}</td>
                <td><button type="button" className="namelink" onClick={() => onOpen(u.id)}>{u.title}</button><br /><small className="sub">{detailCount(u.detail) || 'Chưa soạn chi tiết'}</small></td>
                <td>{u.note && <div className="uobj" title={u.note}>{u.note}</div>}{rq.map((x, j) => <div key={j} className="uout">✓ {x}</div>)}{!u.note && !rq.length && <span className="sub">—</span>}</td>
                <td>{u.mode ? MODE[u.mode] : <small className="sub">{MODE[programMode]}</small>}</td>
                <td>{num(Number(u.hours))}</td>
                <td>{u.has_test ? 'Có' : '—'}</td>
                <td>{k === 'published' ? <span className="gpill good">Đã phát hành</span> : k ? <span className="gpill warn">Đang soạn</span> : <span className="pill">Chưa có</span>}</td>
                <td className="tools" style={{ whiteSpace: 'nowrap' }}><button type="button" onClick={() => onOpen(u.id)}>{editable ? 'Soạn nội dung' : 'Xem nội dung'}</button></td>
              </tr> })}
            {!cs.length && <tr><td colSpan={8}><small className="sub">Môn này chưa có nội dung.</small></td></tr>}
          </tbody>
        </table></div>}
      </div>
    })}
  </>
}
