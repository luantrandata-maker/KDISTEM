import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import { supabase } from '../lib/supabase'
import { downloadXlsx, norm, type Column } from '../lib/sheet'
import ImportExcel from '../components/ImportExcel'
import { Tabs } from './teacher/common'
import { loadRooms, roomLabel, type RoomLite } from '../lib/rooms'

// Kho & kiểm kê (migration 044): vật tư tiêu hao (nhập / cấp phát / điều chỉnh), kiểm kê thiết bị bằng QR, tem QR thiết bị.
type Supply = { id: string; org_id: string; sku: string | null; name: string; unit: string; category: string | null; min_qty: number; qty: number; note: string | null; organizations?: { name: string } | null }
type Move = { id: string; supply_id: string; kind: 'in' | 'out' | 'adjust' | 'move'; qty: number; reason: string | null; created_at: string; room_id?: string | null; to_room_id?: string | null
  supplies: { name: string; unit: string } | null; teachers: { full_name: string } | null; classes: { name: string } | null }
type Stock = { supply_id: string; room_id: string | null; qty: number }
const KIND = { in: 'Nhập', out: 'Cấp phát', adjust: 'Điều chỉnh', move: 'Chuyển vị trí' } as const
const num = (v: number) => Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const when = (d: string) => new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 044 trên Supabase.' : /row-level/i.test(m) ? 'Bạn không có quyền với kho của đơn vị này.' : m)

// ================= Tem QR thiết bị =================
export async function printUnitLabels(school: string, units: { id: string; serial: string | null; name: string; room: string | null }[]) {
  const w = window.open('', '_blank'); if (!w) return false
  const imgs = await Promise.all(units.map(u => QRCode.toDataURL('KDI:U:' + u.id, { margin: 1, width: 180, errorCorrectionLevel: 'M' })))
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Tem QR thiết bị</title><style>
    body{font-family:system-ui,Arial,sans-serif;margin:8mm}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
    .t{border:1px dashed #999;padding:3mm;display:grid;grid-template-columns:22mm 1fr;gap:2mm;align-items:center;break-inside:avoid;font-size:9.5pt}
    img{width:22mm;height:22mm}b{display:block;font-size:10pt}small{color:#555}@page{size:A4;margin:6mm}</style></head><body><div class="g">
    ${units.map((u, i) => `<div class="t"><img src="${imgs[i]}" alt=""><div><b>${esc(u.name)}</b>${esc(u.serial ?? '')}<br><small>${esc(u.room ?? 'Kho')} · ${esc(school)}</small></div></div>`).join('')}
    </div><script>window.onload=()=>window.print()<\/script></body></html>`)
  w.document.close(); return true
}

// ================= Quét QR bằng camera =================
function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stream: MediaStream | null = null, timer = 0, last = '', lastAt = 0
    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true })
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(s => {
      stream = s; if (video.current) { video.current.srcObject = s; video.current.play() }
      timer = window.setInterval(() => {
        const v = video.current; if (!v || !ctx || v.readyState < 2) return
        canvas.width = v.videoWidth; canvas.height = v.videoHeight; ctx.drawImage(v, 0, 0)
        const r = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' })
        if (r?.data && (r.data !== last || Date.now() - lastAt > 2500)) { last = r.data; lastAt = Date.now(); onCode(r.data) }
      }, 300)
    }).catch(() => setErr('Không mở được camera — cho phép quyền camera, hoặc nhập số serial bên cạnh.'))
    if (!navigator.mediaDevices) setErr('Trình duyệt không hỗ trợ camera — nhập số serial bên cạnh.')
    return () => { clearInterval(timer); stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return err ? <p className="msg">{err}</p> : <video ref={video} className="qrvideo" muted playsInline aria-label="Camera quét mã QR" />
}

// ================= Vật tư tiêu hao =================
const IMPORT: Column[] = [
  { key: 'sku', label: 'Mã vật tư', aliases: ['Mã', 'SKU'] }, { key: 'name', label: 'Tên vật tư', required: true, aliases: ['Tên'], width: 28 },
  { key: 'unit', label: 'Đơn vị tính', aliases: ['ĐVT', 'Đơn vị'] }, { key: 'category', label: 'Nhóm' },
  { key: 'min', label: 'Tồn tối thiểu', aliases: ['Mức tối thiểu'] }, { key: 'qty', label: 'Số lượng đầu kỳ', aliases: ['Tồn', 'Số lượng'] },
  { key: 'room', label: 'Để tại phòng / kho', aliases: ['Phòng', 'Kho', 'Vị trí'], width: 20 },
]
type MoveForm = { supply_id: string; kind: 'in' | 'out' | 'adjust' | 'move'; qty: string; reason: string; teacher_id: string; class_id: string; room_id: string; to_room_id: string }

export function SuppliesPage({ orgId, initialTab = 'stock' }: { orgId: string | null; initialTab?: 'stock' | 'moves' }) {
  const [rows, setRows] = useState<Supply[]>([])
  const [moves, setMoves] = useState<Move[]>([])
  const [teachers, setTeachers] = useState<{ id: string; full_name: string }[]>([])
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [rooms, setRooms] = useState<RoomLite[]>([])
  const [stocks, setStocks] = useState<Stock[]>([])
  const [hasLoc, setHasLoc] = useState(true)
  const [tab, setTab] = useState<'stock' | 'moves'>(initialTab)
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Partial<Supply> | null>(null)
  const [mv, setMv] = useState<MoveForm | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [s, m, t, c, r, k] = await Promise.all([
      supabase.from('supplies').select('*, organizations(name)').order('name'),
      supabase.from('supply_moves').select('*, supplies(name, unit), teachers(full_name), classes(name)').order('created_at', { ascending: false }).limit(300),
      supabase.from('teachers').select('id, full_name').eq('status', 'active').order('full_name'),
      supabase.from('classes').select('id, name').order('name'),
      loadRooms(), supabase.from('supply_stocks').select('supply_id, room_id, qty'),
    ])
    setRooms(r); setHasLoc(!k.error); setStocks(k.error ? [] : (k.data as Stock[]) ?? [])
    if (s.error) setMsg([errText(s.error.message), true])
    setRows((s.data as Supply[]) ?? []); setMoves((m.data as unknown as Move[]) ?? []); setTeachers((t.data as any[]) ?? []); setClasses((c.data as any[]) ?? [])
  }
  useEffect(() => { load() }, [])
  const multi = new Set(rows.map(r => r.org_id)).size > 1
  const low = rows.filter(r => Number(r.qty) <= Number(r.min_qty))
  const shown = rows.filter(r => !q || norm(r.name + ' ' + (r.sku ?? '') + ' ' + (r.category ?? '')).includes(norm(q)))
  async function saveSupply(e: React.FormEvent) {
    e.preventDefault(); if (!form?.name?.trim()) return
    const row = { org_id: orgId, sku: form.sku?.trim() || null, name: form.name.trim(), unit: form.unit?.trim() || 'cái', category: form.category?.trim() || null, min_qty: Number(form.min_qty) || 0, note: form.note || null }
    const { error } = form.id ? await supabase.from('supplies').update(row).eq('id', form.id) : await supabase.from('supplies').insert(row)
    if (error) return setMsg([errText(error.message), true]); setForm(null); setMsg(['Đã lưu vật tư.', false]); load()
  }
  async function saveMove(e: React.FormEvent) {
    e.preventDefault(); if (!mv) return
    const qty = Number(mv.qty.replace(',', '.'))
    if (!qty || (mv.kind !== 'adjust' && qty < 0)) return setMsg(['Số lượng không hợp lệ.', true])
    if (mv.kind === 'move' && mv.room_id === mv.to_room_id) return setMsg(['Chọn nơi chuyển đến khác nơi đi.', true])
    const loc = !hasLoc ? {} : { room_id: mv.room_id || null, ...(mv.kind === 'move' ? { to_room_id: mv.to_room_id || null } : {}) }
    const { error } = await supabase.from('supply_moves').insert({ org_id: orgId, supply_id: mv.supply_id, kind: mv.kind, qty, reason: mv.reason.trim() || null,
      teacher_id: mv.kind === 'out' && mv.teacher_id ? mv.teacher_id : null, class_id: mv.kind === 'out' && mv.class_id ? mv.class_id : null, ...loc })
    if (error) return setMsg([errText(error.message), true])
    setMv(null); setMsg([`Đã ghi phiếu ${KIND[mv.kind].toLowerCase()}.`, false]); load()
  }
  async function importRows(recs: (Record<string, string> & { _line: number })[]) {
    const bad: string[] = []; let n = 0
    for (const r of recs) {
      if (!r.name.trim()) continue
      const { data, error } = await supabase.from('supplies').insert({ org_id: orgId, sku: r.sku.trim() || null, name: r.name.trim(), unit: r.unit.trim() || 'cái', category: r.category.trim() || null, min_qty: Number(r.min.replace(',', '.')) || 0 }).select('id').single()
      if (error) { bad.push(`dòng ${r._line}: ${/duplicate|unique/i.test(error.message) ? 'trùng mã' : error.message}`); continue }
      const q0 = Number(r.qty.replace(',', '.'))
      const rm = r.room.trim() ? rooms.find(x => norm(x.name) === norm(r.room) || norm(x.code ?? '') === norm(r.room)) : undefined
      if (r.room.trim() && !rm) bad.push(`dòng ${r._line}: không có phòng/kho "${r.room}" — tồn đầu kỳ để ở "chưa xếp phòng"`)
      if (q0 > 0) await supabase.from('supply_moves').insert({ org_id: orgId, supply_id: data.id, kind: 'in', qty: q0, reason: 'Tồn đầu kỳ (nhập Excel)', ...(rm ? { room_id: rm.id } : {}) })
      n++
    }
    load(); return `Đã thêm ${n} vật tư.` + (bad.length ? ` Bỏ qua ${bad.length} dòng: ${bad.slice(0, 4).join('; ')}` : '')
  }
  function excel() {
    if (tab === 'stock') downloadXlsx('ton-kho-vat-tu', [...(multi ? [{ key: 'o', label: 'Đơn vị', width: 26 }] : []), ...IMPORT.slice(0, 5), { key: 'q', label: 'Tồn hiện tại' }, { key: 'l', label: 'Đang ở (phòng / kho)', width: 36 }],
      shown.map(r => [...(multi ? [r.organizations?.name ?? ''] : []), r.sku, r.name, r.unit, r.category, Number(r.min_qty), Number(r.qty),
        locs(r.id).map(x => `${roomName(x.room_id)}: ${num(x.qty)}`).join('; ')]), 'Tồn kho')
    else downloadXlsx('so-nhap-xuat-vat-tu', [{ key: 't', label: 'Thời gian', width: 18 }, { key: 'k', label: 'Loại' }, { key: 'n', label: 'Vật tư', width: 26 }, { key: 'q', label: 'Số lượng' },
      { key: 'r', label: 'Người nhận / lớp', width: 24 }, { key: 'd', label: 'Lý do', width: 30 }],
      moves.map(m => [when(m.created_at), KIND[m.kind], m.supplies?.name, Number(m.qty), [m.kind === 'move' ? `${roomName(m.room_id)} → ${roomName(m.to_room_id)}` : m.room_id ? roomName(m.room_id) : '', m.teachers?.full_name, m.classes?.name].filter(Boolean).join(' · '), m.reason]), 'Nhập xuất')
  }
  const open = (kind: MoveForm['kind'], s: Supply) => {
    const at = stocks.filter(x => x.supply_id === s.id).sort((a, b) => b.qty - a.qty)[0]?.room_id ?? ''
    setMv({ supply_id: s.id, kind, qty: '', reason: '', teacher_id: '', class_id: '', room_id: kind === 'in' ? '' : at ?? '', to_room_id: '' })
  }
  const roomName = (id: string | null | undefined) => id ? rooms.find(r => r.id === id)?.name ?? 'Phòng khác' : 'Chưa xếp phòng'
  const locs = (id: string) => stocks.filter(x => x.supply_id === id && Number(x.qty) > 0)
  const have = (id: string, room: string) => Number(stocks.find(x => x.supply_id === id && (x.room_id ?? '') === room)?.qty ?? 0)
  const cur = mv && rows.find(r => r.id === mv.supply_id)
  return (
    <>
      <div className="bar">
        <Tabs<'stock' | 'moves'> value={tab} onChange={setTab} items={[['stock', 'Tồn kho', rows.length], ['moves', 'Sổ nhập – cấp phát', moves.length]]} />
        <span className="tools">
          <input className="search" style={{ margin: 0 }} placeholder="Tìm vật tư…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm vật tư" />
          {orgId && <ImportExcel columns={IMPORT} template="mau-vat-tu" sample={[['PIN-AA', 'Pin AA', 'viên', 'Điện', '20', '100']]} onRecords={importRows} onMessage={(m, e) => setMsg([m, !!e])} />}
          <button onClick={excel}>Xuất Excel</button>
          {orgId && <button className="primary" onClick={() => setForm({ unit: 'cái', min_qty: 0 })}>+ Vật tư</button>}
        </span>
      </div>
      {low.length > 0 && <p className="msg" role="status">{low.length} vật tư dưới mức tối thiểu: {low.slice(0, 6).map(r => `${r.name} (${num(r.qty)} ${r.unit})`).join(', ')}{low.length > 6 ? '…' : ''}</p>}
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={saveSupply}>
          <label className="field"><span>Tên vật tư *</span><input required value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Mã</span><input value={form.sku ?? ''} onChange={e => setForm({ ...form, sku: e.target.value })} /></label>
          <label className="field"><span>Đơn vị tính</span><input value={form.unit ?? ''} onChange={e => setForm({ ...form, unit: e.target.value })} /></label>
          <label className="field"><span>Nhóm</span><input value={form.category ?? ''} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Điện, Cơ khí, Hoá chất…" /></label>
          <label className="field"><span>Tồn tối thiểu (cảnh báo)</span><input type="number" min={0} value={form.min_qty ?? 0} onChange={e => setForm({ ...form, min_qty: Number(e.target.value) })} /></label>
          <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}>Số lượng tồn thay đổi qua phiếu Nhập / Cấp phát / Điều chỉnh (có sổ theo dõi), không sửa trực tiếp.</p>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {mv && cur && (
        <form className="panel formgrid" onSubmit={saveMove}>
          <h3 style={{ gridColumn: '1 / -1', margin: 0 }}>{KIND[mv.kind]}: {cur.name} <small className="sub">(tồn {num(cur.qty)} {cur.unit}{hasLoc && locs(cur.id).length > 0 ? ` — ${locs(cur.id).map(x => `${roomName(x.room_id)} ${num(x.qty)}`).join(', ')}` : ''})</small></h3>
          {hasLoc && <label className="field"><span>{mv.kind === 'in' ? 'Nhập vào phòng / kho' : mv.kind === 'move' ? 'Chuyển từ' : mv.kind === 'out' ? 'Lấy từ phòng / kho' : 'Tại phòng / kho'}</span>
            <select value={mv.room_id} onChange={e => setMv({ ...mv, room_id: e.target.value })}>
              {mv.kind === 'in' ? <option value="">Chưa xếp phòng</option> : <option value="">{mv.kind === 'move' ? 'Chưa xếp phòng' : 'Tự động (chưa xếp phòng trước, rồi phòng còn nhiều)'}</option>}
              {(mv.kind === 'in' || mv.kind === 'adjust' ? rooms : rooms.filter(r => have(cur.id, r.id) > 0)).map(r => <option key={r.id} value={r.id}>{roomLabel(r)}{mv.kind !== 'in' ? ` (${num(have(cur.id, r.id))})` : ''}</option>)}
            </select></label>}
          {hasLoc && mv.kind === 'move' && <label className="field"><span>Chuyển đến *</span>
            <select value={mv.to_room_id} onChange={e => setMv({ ...mv, to_room_id: e.target.value })}>
              <option value="">Chưa xếp phòng</option>{rooms.filter(r => r.id !== mv.room_id).map(r => <option key={r.id} value={r.id}>{roomLabel(r)}</option>)}</select></label>}
          <label className="field"><span>{mv.kind === 'adjust' ? 'Chênh lệch (+ thêm / − bớt)' : 'Số lượng'} ({cur.unit}) *</span><input required inputMode="decimal" value={mv.qty} onChange={e => setMv({ ...mv, qty: e.target.value })} /></label>
          {mv.kind === 'out' && <>
            <label className="field"><span>Giao cho giáo viên</span><select value={mv.teacher_id} onChange={e => setMv({ ...mv, teacher_id: e.target.value })}><option value="">—</option>{teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></label>
            <label className="field"><span>Cho lớp</span><select value={mv.class_id} onChange={e => setMv({ ...mv, class_id: e.target.value })}><option value="">—</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          </>}
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>{mv.kind === 'in' ? 'Nguồn / chứng từ' : 'Lý do / mục đích'}</span><input value={mv.reason} onChange={e => setMv({ ...mv, reason: e.target.value })}
            placeholder={mv.kind === 'in' ? 'VD: Mua theo HĐ số …; KDI cấp kèm gói STEM' : mv.kind === 'out' ? 'VD: Chủ đề Mạch điện, tiết 3 tuần 8' : mv.kind === 'move' ? 'VD: Đưa lên phòng STEM cho chủ đề tuần 9' : 'VD: hư hỏng, hết hạn'} /></label>
          <div className="formactions"><button className="primary" type="submit">Ghi phiếu</button> <button type="button" onClick={() => setMv(null)}>Huỷ</button></div>
        </form>
      )}
      {tab === 'stock' ? (
        <div className="wrap"><table>
          <thead><tr>{multi && <th>Đơn vị</th>}<th>Vật tư</th><th>Nhóm</th><th>Tồn</th>{hasLoc && <th>Đang ở</th>}<th>Tối thiểu</th><th /></tr></thead>
          <tbody>{shown.map(r => (
            <tr key={r.id}>{multi && <td>{r.organizations?.name}</td>}<td><b>{r.name}</b>{r.sku && <small> · {r.sku}</small>}</td><td>{r.category ?? '—'}</td>
              <td><b>{num(r.qty)}</b> {r.unit} {Number(r.qty) <= Number(r.min_qty) && <span className="plbadge bad">Sắp hết</span>}</td>
              {hasLoc && <td>{locs(r.id).map(x => <span key={x.room_id ?? 'none'} className="chip">{roomName(x.room_id)} · {num(x.qty)}</span>)}{!locs(r.id).length && <small>—</small>}</td>}<td>{num(r.min_qty)}</td>
              <td className="nowrap">{(!orgId || r.org_id === orgId) && orgId && <><button onClick={() => open('in', r)}>Nhập</button> <button className="primary" onClick={() => open('out', r)} disabled={Number(r.qty) <= 0}>Cấp phát</button>
                {' '}{hasLoc && rooms.length > 0 && <><button onClick={() => open('move', r)} disabled={Number(r.qty) <= 0}>Chuyển vị trí</button>{' '}</>}<button onClick={() => open('adjust', r)}>Điều chỉnh</button> <button onClick={() => setForm(r)}>Sửa</button></>}</td></tr>))}
            {!shown.length && <tr><td colSpan={7}>Chưa có vật tư. Bấm "+ Vật tư" hoặc nhập Excel.</td></tr>}</tbody>
        </table></div>
      ) : (
        <div className="wrap"><table>
          <thead><tr><th>Thời gian</th><th>Loại</th><th>Vật tư</th><th>Số lượng</th>{hasLoc && <th>Phòng / kho</th>}<th>Người nhận / lớp</th><th>Lý do</th></tr></thead>
          <tbody>{moves.map(m => (
            <tr key={m.id}><td className="nowrap">{when(m.created_at)}</td><td><span className={'plbadge ' + (m.kind === 'in' ? 'ok' : m.kind === 'out' || m.kind === 'move' ? 'mute' : 'bad')}>{KIND[m.kind]}</span></td>
              <td>{m.supplies?.name}</td><td>{m.kind === 'out' ? '−' : m.kind === 'move' ? '' : m.qty > 0 ? '+' : ''}{num(m.qty)} {m.supplies?.unit}</td>
              {hasLoc && <td><small>{m.kind === 'move' ? `${roomName(m.room_id)} → ${roomName(m.to_room_id)}` : m.room_id ? roomName(m.room_id) : '—'}</small></td>}
              <td>{[m.teachers?.full_name, m.classes?.name].filter(Boolean).join(' · ') || '—'}</td><td><small>{m.reason}</small></td></tr>))}
            {!moves.length && <tr><td colSpan={7}>Chưa có phiếu nào.</td></tr>}</tbody>
        </table></div>
      )}
    </>
  )
}

// ================= Kiểm kê =================
type ST = { id: string; org_id: string; name: string; room_id: string | null; status: 'open' | 'submitted' | 'approved' | 'cancelled'; created_at: string; submitted_at: string | null; approved_at: string | null;
  stem_rooms: { name: string } | null; organizations?: { name: string } | null }
type Item = { unit_id: string; expected_room_id: string | null; expected_status: string | null; result: 'ok' | 'broken' | 'missing' | null; found_room_id: string | null; note: string | null; checked_at: string | null
  equipment_units: { serial: string | null; equipment_types: { name: string } | null } | null }
type SLine = { supply_id: string; expected_qty: number; counted_qty: number | null; supplies: { name: string; unit: string } | null }
const ST_STATUS = { open: 'Đang kiểm', submitted: 'Chờ duyệt', approved: 'Đã duyệt', cancelled: 'Đã huỷ' } as const
const RESULT = { ok: 'Có, tốt', broken: 'Có, hỏng', missing: 'Không thấy' } as const

export function StocktakePage({ orgId }: { orgId: string | null }) {
  const [list, setList] = useState<ST[]>([])
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [lines, setLines] = useState<SLine[]>([])
  const [newForm, setNewForm] = useState<{ name: string; room: string } | null>(null)
  const [code, setCode] = useState('')
  const [scan, setScan] = useState(false)
  const [filter, setFilter] = useState<'all' | 'todo' | 'done' | 'issue'>('all')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [admin, setAdmin] = useState(false)
  async function load() {
    const [s, r, a] = await Promise.all([supabase.from('stocktakes').select('*, stem_rooms(name), organizations(name)').order('created_at', { ascending: false }),
      supabase.from('stem_rooms').select('id, name').order('name'), supabase.rpc('is_admin')])
    if (s.error) setMsg([errText(s.error.message), true])
    setList((s.data as ST[]) ?? []); setRooms((r.data as any[]) ?? []); setAdmin(!!a.data)
  }
  async function loadItems(id: string) {
    const [i, l] = await Promise.all([
      supabase.from('stocktake_items').select('unit_id, expected_room_id, expected_status, result, found_room_id, note, checked_at, equipment_units(serial, equipment_types(name))').eq('stocktake_id', id),
      supabase.from('stocktake_supplies').select('supply_id, expected_qty, counted_qty, supplies(name, unit)').eq('stocktake_id', id),
    ])
    setItems(((i.data as unknown as Item[]) ?? []).sort((a, b) => (a.equipment_units?.equipment_types?.name ?? '').localeCompare(b.equipment_units?.equipment_types?.name ?? '', 'vi') || (a.equipment_units?.serial ?? '').localeCompare(b.equipment_units?.serial ?? '', 'vi', { numeric: true })))
    setLines((l.data as unknown as SLine[]) ?? [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (sel) loadItems(sel); setScan(false) }, [sel])
  const st = list.find(x => x.id === sel)
  const room = (id: string | null) => rooms.find(r => r.id === id)?.name ?? (id ? '?' : 'Kho')
  async function start(e: React.FormEvent) {
    e.preventDefault(); if (!newForm) return
    const { data, error } = await supabase.rpc('stocktake_start', { p_name: newForm.name, p_room: newForm.room || null, p_supplies: true })
    if (error) return setMsg([errText(error.message), true])
    setNewForm(null); await load(); setSel(data as string)
  }
  async function doScan(raw: string) {
    if (!sel || !raw.trim()) return
    const { data, error } = await supabase.rpc('stocktake_scan', { p_stocktake: sel, p_code: raw.trim(), p_room: st?.room_id ?? null, p_result: 'ok' })
    if (error) { setMsg([error.message, true]); return }
    const r = (data as { name: string; serial: string | null; expected_room: string | null }[])?.[0]
    setMsg([`✓ ${r?.name ?? ''} ${r?.serial ?? ''}${r && st?.room_id && r.expected_room !== st.stem_rooms?.name ? ` (sổ ghi ở ${r.expected_room ?? 'kho'})` : ''}`, false])
    try { navigator.vibrate?.(60) } catch { /* bỏ qua */ }
    setCode(''); loadItems(sel)
  }
  async function setItem(i: Item, p: Partial<Item>) {
    const { error } = await supabase.from('stocktake_items').update(p).eq('stocktake_id', sel!).eq('unit_id', i.unit_id)
    if (error) return setMsg([errText(error.message), true]); loadItems(sel!)
  }
  async function setCount(l: SLine, v: string) {
    const { error } = await supabase.from('stocktake_supplies').update({ counted_qty: v === '' ? null : Number(v.replace(',', '.')) }).eq('stocktake_id', sel!).eq('supply_id', l.supply_id)
    if (error) setMsg([errText(error.message), true])
  }
  async function setStatus(s: ST['status']) {
    if (s === 'submitted' && items.some(i => !i.result) && !confirm(`${items.filter(i => !i.result).length} thiết bị chưa kiểm sẽ được tính là "Không thấy". Nộp kết quả?`)) return
    if (s === 'cancelled' && !confirm('Huỷ đợt kiểm kê này?')) return
    const { error } = await supabase.from('stocktakes').update({ status: s }).eq('id', sel!)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  async function approve() {
    if (!confirm('Duyệt kết quả: thiết bị không thấy → Thất lạc, hỏng → Hỏng, sai phòng → cập nhật phòng, vật tư lệch → phiếu điều chỉnh. Tiếp tục?')) return
    const { data, error } = await supabase.rpc('stocktake_approve', { p_stocktake: sel })
    if (error) return setMsg([errText(error.message), true])
    const d = data as { lost: number; broken: number; moved: number; adjusted: number }
    setMsg([`Đã duyệt: ${d.lost} thất lạc, ${d.broken} hỏng, ${d.moved} cập nhật phòng, ${d.adjusted} vật tư điều chỉnh.`, false]); load()
  }
  function excel() {
    downloadXlsx(`kiem-ke-${st?.name ?? ''}`, [{ key: 'n', label: 'Thiết bị', width: 26 }, { key: 's', label: 'Serial' }, { key: 'r', label: 'Phòng theo sổ', width: 18 }, { key: 'f', label: 'Phòng thực tế', width: 18 }, { key: 'k', label: 'Kết quả' }, { key: 'g', label: 'Ghi chú', width: 30 }],
      items.map(i => [i.equipment_units?.equipment_types?.name, i.equipment_units?.serial, room(i.expected_room_id), i.result ? room(i.found_room_id) : '', i.result ? RESULT[i.result] : 'Chưa kiểm', i.note]), 'Kiểm kê')
  }
  const done = items.filter(i => i.result).length
  const issues = items.filter(i => i.result && i.result !== 'ok' || (i.result && i.found_room_id !== i.expected_room_id)).length
  const shown = items.filter(i => filter === 'all' || (filter === 'todo' ? !i.result : filter === 'done' ? !!i.result : (i.result && i.result !== 'ok') || (i.result && i.found_room_id !== i.expected_room_id)))
  const editable = st?.status === 'open' && (!orgId || st.org_id === orgId)
  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0 }}>Kiểm kê thiết bị (quét tem QR hoặc nhập serial) và đếm vật tư. Dán tem QR ở mục Quản lý Thiết bị → <i>In tem QR</i>.</p>
        <span style={{ flex: 1 }} />{orgId && <button className="primary" onClick={() => setNewForm({ name: `Kiểm kê ${new Date().toLocaleDateString('vi-VN')}`, room: '' })}>+ Mở đợt kiểm kê</button>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {newForm && (
        <form className="panel formgrid" onSubmit={start}>
          <label className="field"><span>Tên đợt *</span><input required value={newForm.name} onChange={e => setNewForm({ ...newForm, name: e.target.value })} /></label>
          <label className="field"><span>Phạm vi</span><select value={newForm.room} onChange={e => setNewForm({ ...newForm, room: e.target.value })}>
            <option value="">Toàn trường (thiết bị + vật tư)</option>{rooms.map(r => <option key={r.id} value={r.id}>Phòng {r.name}</option>)}</select></label>
          <div className="formactions"><button className="primary" type="submit">Mở đợt</button> <button type="button" onClick={() => setNewForm(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Đợt kiểm kê</th><th>Phạm vi</th><th>Mở lúc</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{list.map(s => <tr key={s.id} className={s.id === sel ? 'on' : ''}><td><b>{s.name}</b>{s.organizations && list.some(x => x.org_id !== s.org_id) && <><br /><small>{s.organizations.name}</small></>}</td>
          <td>{s.stem_rooms?.name ? 'Phòng ' + s.stem_rooms.name : 'Toàn trường'}</td><td className="nowrap">{when(s.created_at)}</td>
          <td><span className={'plbadge ' + (s.status === 'approved' ? 'ok' : s.status === 'submitted' ? 'bad' : 'mute')}>{ST_STATUS[s.status]}</span></td>
          <td><button onClick={() => setSel(sel === s.id ? null : s.id)}>{sel === s.id ? 'Đóng' : 'Mở'}</button></td></tr>)}
          {!list.length && <tr><td colSpan={5}>Chưa có đợt kiểm kê.</td></tr>}</tbody>
      </table></div>
      {st && (
        <div className="panel stocktake">
          <div className="bar"><h3 style={{ margin: 0 }}>{st.name}</h3><small className="sub">{done}/{items.length} thiết bị đã kiểm · {issues} cần chú ý</small><span style={{ flex: 1 }} />
            <button onClick={excel}>Xuất Excel</button>
            {editable && <><button onClick={() => setStatus('cancelled')}>Huỷ đợt</button> <button className="primary" onClick={() => setStatus('submitted')}>Nộp kết quả</button></>}
            {st.status === 'submitted' && (!orgId || st.org_id === orgId) && <><button onClick={() => setStatus('open')}>Mở lại để sửa</button> {admin && <button className="primary" onClick={approve}>Duyệt kết quả</button>}</>}</div>
          <div className="covtrack" style={{ height: 10 }}><i style={{ width: (items.length ? Math.round(100 * done / items.length) : 0) + '%' }} /></div>
          {editable && (
            <div className="scanbox">
              <form className="tools" onSubmit={e => { e.preventDefault(); doScan(code) }}>
                <input autoFocus className="search" style={{ margin: 0 }} placeholder="Quét bằng máy đọc mã hoặc nhập serial…" value={code} onChange={e => setCode(e.target.value)} aria-label="Mã thiết bị" />
                <button type="submit">Ghi nhận</button>
                <button type="button" onClick={() => setScan(!scan)}>{scan ? 'Tắt camera' : '📷 Quét bằng camera'}</button>
              </form>
              {scan && <QrScanner onCode={doScan} />}
            </div>
          )}
          <Tabs<'all' | 'todo' | 'done' | 'issue'> value={filter} onChange={setFilter}
            items={[['all', 'Tất cả', items.length], ['todo', 'Chưa kiểm', items.length - done], ['done', 'Đã kiểm', done], ['issue', 'Cần chú ý', issues]]} />
          <div className="wrap"><table>
            <thead><tr><th>Thiết bị</th><th>Phòng theo sổ</th><th>Kết quả</th><th>Phòng thực tế</th><th>Ghi chú</th></tr></thead>
            <tbody>{shown.map(i => (
              <tr key={i.unit_id}><td><b>{i.equipment_units?.equipment_types?.name}</b><br /><small>{i.equipment_units?.serial}</small></td><td>{room(i.expected_room_id)}</td>
                <td>{editable ? <select value={i.result ?? ''} onChange={e => setItem(i, { result: (e.target.value || null) as Item['result'], found_room_id: i.found_room_id ?? i.expected_room_id })} aria-label="Kết quả">
                    <option value="">Chưa kiểm</option>{Object.entries(RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  : <span className={'plbadge ' + (i.result === 'ok' ? 'ok' : i.result ? 'bad' : 'mute')}>{i.result ? RESULT[i.result] : 'Chưa kiểm'}</span>}</td>
                <td>{editable && i.result && i.result !== 'missing' ? <select value={i.found_room_id ?? ''} onChange={e => setItem(i, { found_room_id: e.target.value || null })} aria-label="Phòng thực tế">
                    <option value="">Kho</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                  : i.result && i.result !== 'missing' ? room(i.found_room_id) : '—'}{i.result && i.result !== 'missing' && i.found_room_id !== i.expected_room_id && <small className="due bad"> · khác sổ</small>}</td>
                <td>{editable ? <input defaultValue={i.note ?? ''} onBlur={e => e.target.value !== (i.note ?? '') && setItem(i, { note: e.target.value || null })} aria-label="Ghi chú" /> : <small>{i.note}</small>}</td></tr>))}
              {!shown.length && <tr><td colSpan={5}>Không có thiết bị.</td></tr>}</tbody>
          </table></div>
          {lines.length > 0 && <>
            <h4>Vật tư tiêu hao</h4>
            <div className="wrap"><table>
              <thead><tr><th>Vật tư</th><th>Tồn theo sổ</th><th>Đếm thực tế</th><th>Chênh lệch</th></tr></thead>
              <tbody>{lines.map(l => { const d = l.counted_qty == null ? null : Number(l.counted_qty) - Number(l.expected_qty); return (
                <tr key={l.supply_id}><td>{l.supplies?.name}</td><td>{num(l.expected_qty)} {l.supplies?.unit}</td>
                  <td>{editable ? <input inputMode="decimal" defaultValue={l.counted_qty ?? ''} onBlur={e => setCount(l, e.target.value).then(() => loadItems(sel!))} style={{ width: 100 }} aria-label={`Số đếm ${l.supplies?.name}`} /> : l.counted_qty == null ? '—' : num(l.counted_qty)}</td>
                  <td className={d ? 'due bad' : ''}>{d == null ? '—' : (d > 0 ? '+' : '') + num(d)}</td></tr>) })}</tbody>
            </table></div>
          </>}
        </div>
      )}
    </>
  )
}
