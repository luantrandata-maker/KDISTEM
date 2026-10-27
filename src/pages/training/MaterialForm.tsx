// Form thêm học liệu tập huấn, theo khuôn form Học liệu của Phân hệ 2: bảng trượt bên phải, phần "Gắn với" (chương trình → nội dung),
// thông tin chính, nguồn tệp / đường dẫn; vật tư nhập theo bảng, chọn từ danh mục vật tư; hoạt động chọn từ Kho hoạt động hoặc nhập mới.
// Lưu vào training_program_units (nội dung) hoặc detail của nội dung (tài liệu, vật tư, hoạt động). Chỉ chương trình nháp / bị trả lại.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { MAX_FILE_MB, fmtSize, uploadLearningFile } from '../../lib/files'
import { Drawer } from '../../components/Drawer'
import { STATUS } from './Programs'
import { LISTS, type Detail } from './Content'
import { ACT } from '../teacher/activity'
import type { Part } from './Materials'

type Prog = { id: string; code: string; title: string; status: keyof typeof STATUS }
type Unit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; detail: Detail | null }
type MKind = 'supply' | 'tool' | 'equipment'
type Cat = { id: string; name: string; unit: string; kind: MKind; reusable: boolean; code: string | null }
type Act = { id: string; kind: string; title: string }
type MatRow = { key: string; catalog_id: string | null; name: string; unit: string; kind: MKind; qty: string; reusable: boolean }

const MKIND: Record<MKind, string> = { supply: 'Vật tư tiêu hao', tool: 'Dụng cụ', equipment: 'Thiết bị' }
const opts = (k: 'docs' | 'mats' | 'acts', col: string) => LISTS[k].cols.find(c => c.key === col)?.options ?? []
const rid = () => Math.random().toString(36).slice(2, 10)
const NOUN: Record<Part, string> = { content: 'nội dung tập huấn', docs: 'tài liệu', mats: 'định mức vật tư', acts: 'hoạt động' }

export function TrainingItemForm({ orgId, part, progs, units: allUnits, initialProg, onClose, onDone }: {
  orgId: string | null; part: Part; progs: Prog[]; units: Unit[]; initialProg: string; onClose: () => void; onDone: (m: string, more: boolean) => void
}) {
  const [pid, setPid] = useState(progs.some(p => p.id === initialProg) ? initialProg : progs[0]?.id ?? '')
  // Tải lại cấu trúc của chương trình đang chọn để danh sách nội dung luôn đủ và mới nhất
  const [fresh, setFresh] = useState<Record<string, Unit[]>>({})
  useEffect(() => {
    if (!pid) return
    supabase.from('training_program_units').select('id, program_id, parent_id, kind, seq, title, detail').eq('program_id', pid)
      .then(({ data }) => { if (data) setFresh(x => ({ ...x, [pid]: data as Unit[] })) })
  }, [pid])
  const units = fresh[pid] ?? allUnits
  const subjects = units.filter(u => u.program_id === pid && u.kind === 'subject').sort((a, b) => a.seq - b.seq)
  const conts = subjects.flatMap(s => units.filter(c => c.kind === 'content' && c.parent_id === s.id).sort((a, b) => a.seq - b.seq))
  const [sid, setSid] = useState('')
  const [cid, setCid] = useState('')
  const subj = subjects.find(s => s.id === sid) ?? subjects[0]
  const cont = conts.find(c => c.id === cid) ?? conts[0]
  const [f, setF] = useState<Record<string, string>>({ hours: '1', mode: '', src: 'url', per: 'group' })
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }))
  const [test, setTest] = useState(false)
  const [file, setFile] = useState<{ path: string; name: string; size: number } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [rows, setRows] = useState<MatRow[]>([])
  const [cat, setCat] = useState<Cat[]>([])
  const [acts, setActs] = useState<Act[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (part === 'mats') supabase.from('material_catalog').select('id, name, unit, kind, reusable, code').eq('active', true).order('kind').order('name')
      .then(({ data }) => setCat((data as Cat[]) ?? []))
    if (part === 'acts') supabase.from('activities').select('id, kind, title').order('title').limit(500).then(({ data }) => setActs((data as Act[]) ?? []))
  }, [part])

  async function pickFile(x: File) {
    if (!orgId) return setMsg('Chưa xác định được đơn vị để lưu tệp. Dùng đường dẫn thay cho tệp.')
    setUploading(true); setMsg('')
    try { const r = await uploadLearningFile(orgId, 'training', x); setFile({ path: r.path, name: r.name, size: r.size }); if (!f.title?.trim()) set('title', x.name.replace(/\.[^.]+$/, '')) }
    catch (e) { setMsg((e as Error).message) }
    setUploading(false)
  }
  const addCat = (id: string) => { const c = cat.find(x => x.id === id); if (c) setRows(r => [...r, { key: rid(), catalog_id: c.id, name: c.name, unit: c.unit, kind: c.kind, qty: '1', reusable: c.reusable }]) }
  const setRow = (k: string, p: Partial<MatRow>) => setRows(r => r.map(x => (x.key === k ? { ...x, ...p } : x)))
  const pickAct = (id: string) => { const a = acts.find(x => x.id === id); setF(x => ({ ...x, activity_id: id, title: a ? a.title : x.title })) }

  function reset() { setF(x => ({ hours: '1', mode: '', src: x.src, per: x.per })); setTest(false); setFile(null); setRows([]) }

  async function save(more: boolean) {
    setMsg('')
    let error: { message: string } | null = null, done = ''
    if (part === 'content') {
      if (!subj) return setMsg('Chương trình chưa có học phần. Thêm học phần ở mục Chương trình tập huấn trước.')
      if (!f.title?.trim()) return setMsg('Nhập tên nội dung.')
      const h = Number((f.hours ?? '').replace(',', '.'))
      const seq = Math.max(0, ...units.filter(c => c.kind === 'content' && c.parent_id === subj.id).map(c => c.seq)) + 1
      const goal = f.goal?.trim()
      setBusy(true)
      ;({ error } = await supabase.from('training_program_units').insert({ program_id: pid, parent_id: subj.id, kind: 'content', seq, title: f.title.trim(),
        hours: Number.isFinite(h) && h > 0 ? h : 1, mode: f.mode || null, has_test: test, note: f.note?.trim() || null, detail: goal ? { body: { goal } } : {} }))
      done = `Đã thêm nội dung "${f.title.trim()}".`
    } else {
      if (!cont) return setMsg('Chương trình chưa có nội dung tập huấn. Thêm nội dung trước.')
      let add: Record<string, string>[] = []
      if (part === 'docs') {
        if (!f.title?.trim()) return setMsg('Nhập tên tài liệu.')
        if (f.src === 'url' && !/^https?:\/\//i.test(f.url?.trim() ?? '')) return setMsg('Nhập đường dẫn bắt đầu bằng http:// hoặc https://')
        if (f.src === 'file' && !file) return setMsg('Chọn tệp để tải lên.')
        add = [{ title: f.title.trim(), kind: f.kind ?? '', summary: f.summary?.trim() ?? '', note: f.note?.trim() ?? '',
          ...(f.src === 'url' ? { url: f.url.trim() } : { file: file!.path, file_name: file!.name }) }]
      } else if (part === 'mats') {
        const ok = rows.filter(r => r.name.trim())
        if (!ok.length) return setMsg('Thêm ít nhất một vật tư.')
        const bad = ok.find(r => !(Number(r.qty.replace(',', '.')) > 0))
        if (bad) return setMsg(`Số lượng của "${bad.name}" phải lớn hơn 0.`)
        add = ok.map(r => ({ name: r.name.trim(), unit: r.unit.trim() || 'cái', qty: r.qty.replace(',', '.'), per: f.per ?? '', mkind: r.kind, reusable: r.reusable ? '1' : '',
          ...(r.catalog_id ? { catalog_id: r.catalog_id } : {}), note: f.note?.trim() ?? '' }))
      } else {
        if (!f.title?.trim()) return setMsg('Nhập tên hoạt động hoặc chọn từ Kho hoạt động.')
        add = [{ title: f.title.trim(), kind: f.kind ?? '', minutes: f.minutes ?? '', note: f.note?.trim() ?? '', ...(f.activity_id ? { activity_id: f.activity_id } : {}) }]
      }
      add = add.map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== '')))
      setBusy(true)
      const fresh = await supabase.from('training_program_units').select('detail').eq('id', cont.id).maybeSingle()
      const cur = ((fresh.data as { detail: Detail | null } | null)?.detail ?? cont.detail ?? {}) as Detail
      ;({ error } = await supabase.from('training_program_units').update({ detail: { ...cur, [part]: [...(cur[part] ?? []), ...add] } }).eq('id', cont.id))
      done = `Đã thêm ${add.length > 1 ? `${add.length} ${NOUN[part]}` : NOUN[part]} vào "${cont.title}".`
    }
    setBusy(false)
    if (error) return setMsg(error.message)
    if (more) reset()
    onDone(done, more)
  }

  const used = new Set(rows.map(r => r.catalog_id).filter(Boolean))
  return <Drawer wide closeOnOutside={false} onClose={onClose} title={`Thêm ${NOUN[part]}`}
    actions={progs.length > 0 ? <>
      <button type="button" className="primary" disabled={busy || uploading} onClick={() => save(false)}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button type="button" disabled={busy || uploading} onClick={() => save(true)}>Lưu & thêm tiếp</button>
      <button type="button" onClick={onClose}>Huỷ</button></> : <button type="button" onClick={onClose}>Đóng</button>}>
    <form className="panel libform" onSubmit={e => { e.preventDefault(); save(false) }}>
      {msg && <p className="msg">{msg}</p>}
      {!progs.length ? <p className="warnline" style={{ margin: 0 }}>Chưa có chương trình nào đang nháp hoặc bị trả lại. Chỉ thêm được vào chương trình chưa phát hành:
        tạo chương trình mới hoặc phiên bản mới ở mục Chương trình tập huấn.</p> : <>
      <h4 className="libparthead">Gắn với</h4>
      <div className="formgrid libgrid4">
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Chương trình tập huấn *</span>
          <select value={pid} onChange={e => { setPid(e.target.value); setSid(''); setCid('') }} aria-label="Chương trình tập huấn">
            {progs.map(p => <option key={p.id} value={p.id}>{p.code} · {p.title} · {STATUS[p.status]?.[0]?.toLowerCase()}</option>)}</select></label>
        {part === 'content'
          ? <label className="field" style={{ gridColumn: 'span 2' }}><span>Học phần *</span><select value={subj?.id ?? ''} onChange={e => setSid(e.target.value)} aria-label="Học phần">
              {!subjects.length && <option value="">— chương trình chưa có học phần —</option>}{subjects.map(s => <option key={s.id} value={s.id}>{s.seq}. {s.title}</option>)}</select></label>
          : <label className="field" style={{ gridColumn: 'span 2' }}><span>Nội dung tập huấn *</span><select value={cont?.id ?? ''} onChange={e => setCid(e.target.value)} aria-label="Nội dung tập huấn">
              {!conts.length && <option value="">— chương trình chưa có nội dung —</option>}
              {subjects.filter(s => conts.some(c => c.parent_id === s.id)).map(s => <optgroup key={s.id} label={`${s.seq}. ${s.title}`}>{conts.filter(c => c.parent_id === s.id).map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</optgroup>)}</select>
              {!conts.length && <small className="warnline">{subjects.length ? `Môn ${subjects.map(s => `"${s.title}"`).join(', ')} chưa có nội dung tập huấn.` : 'Chương trình chưa có môn.'} Thêm nội dung ở mục Chương trình tập huấn › Cấu trúc hoặc mục Nội dung tập huấn.</small>}</label>}
      </div>

      {part === 'content' && <>
        <h4 className="libparthead">Thông tin nội dung</h4>
        <div className="formgrid libgrid4">
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên nội dung *</span><input required maxLength={300} value={f.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="VD: Lắp ráp robot xe 2 bánh" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mục tiêu</span><textarea rows={2} value={f.goal ?? ''} onChange={e => set('goal', e.target.value)} placeholder="Sau nội dung này, giáo viên…" /></label>
          <label className="field"><span>Số giờ</span><input inputMode="decimal" value={f.hours ?? ''} onChange={e => set('hours', e.target.value)} /></label>
          <label className="field"><span>Hình thức</span><select value={f.mode ?? ''} onChange={e => set('mode', e.target.value)}>
            <option value="">Theo kế hoạch</option><option value="online">Trực tuyến</option><option value="offline">Trực tiếp</option></select></label>
          <div className="field"><span>Bài test</span><label><input type="checkbox" checked={test} onChange={e => setTest(e.target.checked)} /> Có bài test</label></div>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú</span><input value={f.note ?? ''} onChange={e => set('note', e.target.value)} /></label>
        </div>
        <p className="sub" style={{ margin: 0 }}>Bài giảng, tài liệu, vật tư và hoạt động của nội dung thêm ở các tab tương ứng hoặc mở nội dung để soạn đủ 5 phần.</p>
      </>}

      {part === 'docs' && <>
        <h4 className="libparthead">Thông tin tài liệu</h4>
        <div className="formgrid libgrid4">
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên *</span><input required value={f.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="VD: Công văn hướng dẫn giáo dục STEM" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mô tả ngắn</span><textarea rows={2} value={f.summary ?? ''} onChange={e => set('summary', e.target.value)} /></label>
          <label className="field"><span>Loại tài liệu</span><select value={f.kind ?? ''} onChange={e => set('kind', e.target.value)}><option value="">—</option>
            {opts('docs', 'kind').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <div className="field"><span>Nguồn</span><div className="tools">
            <label><input type="radio" checked={f.src === 'file'} onChange={() => set('src', 'file')} /> Tải tệp lên</label>
            <label><input type="radio" checked={f.src === 'url'} onChange={() => set('src', 'url')} /> Đường dẫn</label></div></div>
          {f.src === 'url'
            ? <label className="field" style={{ gridColumn: 'span 2' }}><span>Đường dẫn *</span><input value={f.url ?? ''} onChange={e => set('url', e.target.value)} placeholder="https://… (Google Drive, YouTube, Canva…)" /></label>
            : <div className="field" style={{ gridColumn: 'span 2' }}><span>Tệp * (tối đa {MAX_FILE_MB} MB)</span><div className="tools">
                {file && <span className="chip">{file.name} · {fmtSize(file.size)}<button type="button" className="x" aria-label="Bỏ tệp" onClick={() => setFile(null)}>×</button></span>}
                <label className={'filebtn' + (uploading ? ' busy' : '')}>{uploading ? 'Đang tải lên…' : file ? 'Thay tệp' : 'Chọn tệp'}
                  <input type="file" hidden disabled={uploading} onChange={e => { const x = e.target.files?.[0]; if (x) pickFile(x); e.target.value = '' }} /></label></div></div>}
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú</span><input value={f.note ?? ''} onChange={e => set('note', e.target.value)} placeholder="VD: đọc trước buổi 1" /></label>
        </div>
      </>}

      {part === 'mats' && <>
        <h4 className="libparthead">Vật tư của nội dung</h4>
        <div className="tools">
          <label>Tính cho <select value={f.per ?? 'group'} onChange={e => set('per', e.target.value)} aria-label="Định mức cho">
            {opts('mats', 'per').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <div className="wrap"><table>
          <thead><tr><th>Vật tư / công cụ</th><th>Loại</th><th>Số lượng</th><th>Đơn vị</th><th>Dùng lại</th><th></th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.key}>
            <td>{r.catalog_id ? <b>{r.name}</b> : <input value={r.name} onChange={e => setRow(r.key, { name: e.target.value })} placeholder="Tên vật tư" aria-label="Tên vật tư" style={{ minWidth: 180 }} />}</td>
            <td>{r.catalog_id ? MKIND[r.kind] : <select value={r.kind} onChange={e => setRow(r.key, { kind: e.target.value as MKind, reusable: e.target.value !== 'supply' })} aria-label="Loại">
              {(Object.keys(MKIND) as MKind[]).map(k => <option key={k} value={k}>{MKIND[k]}</option>)}</select>}</td>
            <td><input value={r.qty} inputMode="decimal" onChange={e => setRow(r.key, { qty: e.target.value })} aria-label={`Số lượng ${r.name}`} style={{ width: 80 }} /></td>
            <td>{r.catalog_id ? r.unit : <input value={r.unit} onChange={e => setRow(r.key, { unit: e.target.value })} aria-label="Đơn vị" style={{ width: 80 }} />}</td>
            <td><input type="checkbox" checked={r.reusable} onChange={e => setRow(r.key, { reusable: e.target.checked })} aria-label="Dùng lại được" /></td>
            <td><button type="button" className="x" aria-label={`Bỏ ${r.name}`} onClick={() => setRows(x => x.filter(y => y.key !== r.key))}>×</button></td>
          </tr>)}
            {!rows.length && <tr><td colSpan={6}><small className="sub">Chưa có vật tư. Chọn từ danh mục hoặc thêm vật tư khác bên dưới.</small></td></tr>}</tbody>
        </table></div>
        <div className="tools">
          <select value="" onChange={e => e.target.value && addCat(e.target.value)} aria-label="Thêm vật tư từ danh mục">
            <option value="">+ Thêm từ danh mục vật tư…</option>
            {(Object.keys(MKIND) as MKind[]).map(k => <optgroup key={k} label={MKIND[k]}>{cat.filter(c => c.kind === k && !used.has(c.id)).map(c =>
              <option key={c.id} value={c.id}>{c.name} ({c.unit}){c.code ? ` · ${c.code}` : ''}</option>)}</optgroup>)}</select>
          <button type="button" onClick={() => setRows(r => [...r, { key: rid(), catalog_id: null, name: '', unit: 'cái', kind: 'supply', qty: '1', reusable: false }])}>+ Vật tư khác</button>
        </div>
        <div className="formgrid libgrid4"><label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú</span><input value={f.note ?? ''} onChange={e => set('note', e.target.value)} placeholder="VD: chuẩn bị trước buổi thực hành" /></label></div>
      </>}

      {part === 'acts' && <>
        <h4 className="libparthead">Thông tin hoạt động</h4>
        <div className="formgrid libgrid4">
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Chọn từ Kho hoạt động (không bắt buộc)</span>
            <select value={f.activity_id ?? ''} onChange={e => pickAct(e.target.value)} aria-label="Chọn từ Kho hoạt động">
              <option value="">— Nhập hoạt động mới —</option>
              {acts.map(a => <option key={a.id} value={a.id}>{a.title} · {ACT[a.kind as keyof typeof ACT]?.label ?? a.kind}</option>)}</select></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên hoạt động *</span><input required value={f.title ?? ''} onChange={e => set('title', e.target.value)} placeholder="VD: Thiết kế cầu giấy chịu lực" /></label>
          <label className="field"><span>Loại</span><select value={f.kind ?? ''} onChange={e => set('kind', e.target.value)}><option value="">—</option>
            {opts('acts', 'kind').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="field"><span>Thời lượng (phút)</span><input type="number" min={0} value={f.minutes ?? ''} onChange={e => set('minutes', e.target.value)} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mô tả ngắn</span><textarea rows={3} value={f.note ?? ''} onChange={e => set('note', e.target.value)} placeholder="Cách tổ chức, sản phẩm cần đạt…" /></label>
        </div>
      </>}
      </>}
    </form>
  </Drawer>
}
