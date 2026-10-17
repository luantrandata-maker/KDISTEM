import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'
import { norm, importSummary, type Column } from '../lib/sheet'

// Dữ liệu cá nhân học sinh (migration 039): đồng ý của cha mẹ, xuất dữ liệu, xoá dữ liệu.
export type Consent = {
  id: string; student_id: string; guardian_name: string; relation: string | null; phone: string | null
  method: string; consented_on: string; scope: string[]; note: string | null; withdrawn_on: string | null
}
type Stu = { id: string; full_name: string; student_code: string | null; classes: { name: string } | null }

export const METHOD: Record<string, string> = { paper: 'Giấy có chữ ký', online: 'Trực tuyến', other: 'Khác' }
const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('vi-VN')
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export async function loadConsents(): Promise<Record<string, Consent>> {
  const { data, error } = await supabase.from('student_consents')
    .select('id, student_id, guardian_name, relation, phone, method, consented_on, scope, note, withdrawn_on').is('withdrawn_on', null)
  if (error) return {}
  return Object.fromEntries(((data as Consent[]) ?? []).map(c => [c.student_id, c]))
}

export function ConsentBadge({ c }: { c?: Consent }) {
  return c ? <span className="plbadge ok" title={`${c.guardian_name}${c.relation ? ' (' + c.relation + ')' : ''} · ${METHOD[c.method] ?? c.method}`}>Đã đồng ý {day(c.consented_on)}</span>
    : <span className="plbadge mute">Chưa có</span>
}

// Nhập đồng ý từ Excel (theo mã HS)
export const CONSENT_COLS: Column[] = [
  { key: 'code', label: 'Mã học sinh', required: true, aliases: ['Mã HS', 'MSHS'] },
  { key: 'name', label: 'Họ tên học sinh', aliases: ['Họ tên'], width: 26 },
  { key: 'guardian', label: 'Người đồng ý', required: true, aliases: ['Phụ huynh', 'Cha mẹ', 'Người giám hộ'], width: 24 },
  { key: 'relation', label: 'Quan hệ', aliases: ['Quan he'] },
  { key: 'phone', label: 'Điện thoại', aliases: ['SĐT', 'So dien thoai'] },
  { key: 'date', label: 'Ngày đồng ý', aliases: ['Ngay'] },
  { key: 'method', label: 'Hình thức', aliases: ['Hinh thuc'] },
]
const parseDate = (s: string) => {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : null
}
export async function importConsents(recs: (Record<string, string> & { _line: number })[], students: Stu[], existing: Record<string, Consent>) {
  const byCode = new Map(students.filter(s => s.student_code).map(s => [norm(s.student_code!), s]))
  const org = await myOrgId(); const bad: string[] = []; const rows = []
  for (const r of recs) {
    const s = byCode.get(norm(r.code))
    if (!s) { bad.push(`dòng ${r._line}: không có HS mã ${r.code}`); continue }
    if (existing[s.id]) { bad.push(`dòng ${r._line}: ${s.full_name} đã có đồng ý`); continue }
    if (!r.guardian.trim()) { bad.push(`dòng ${r._line}: thiếu người đồng ý`); continue }
    const d = r.date ? parseDate(r.date) : new Date().toISOString().slice(0, 10)
    if (!d) { bad.push(`dòng ${r._line}: ngày "${r.date}" không đúng dạng dd/mm/yyyy`); continue }
    const mt = norm(r.method)
    rows.push({ org_id: org, student_id: s.id, guardian_name: r.guardian.trim(), relation: r.relation.trim() || null, phone: r.phone.trim() || null,
      consented_on: d, method: mt.includes('truc tuyen') || mt.includes('online') ? 'online' : mt && !mt.includes('giay') ? 'other' : 'paper' })
  }
  if (rows.length) { const { error } = await supabase.from('student_consents').insert(rows); if (error) return 'Không nhập được: ' + error.message }
  return importSummary(rows.length, 'phiếu đồng ý', bad)
}

// In giấy đồng ý theo lớp: mỗi HS một trang A5 (2 trang/A4), phụ huynh ký rồi trường nhập lại
export function printConsentForms(school: string, list: Stu[]) {
  const w = window.open('', '_blank'); if (!w) return false
  const page = (s: Stu) => `<section><h2>GIẤY ĐỒNG Ý XỬ LÝ DỮ LIỆU CÁ NHÂN CỦA HỌC SINH</h2>
    <p class="c">${esc(school)} · Hệ thống Quản trị STEM</p>
    <p>Học sinh: <b>${esc(s.full_name)}</b> · Lớp: <b>${esc(s.classes?.name ?? '')}</b> · Mã HS: <b>${esc(s.student_code ?? '')}</b></p>
    <p>Tôi là: ............................................................ Quan hệ với học sinh: ..................... Điện thoại: ...........................</p>
    <p>Tôi đồng ý để nhà trường và đơn vị cung cấp hệ thống (KDI Education) xử lý các dữ liệu: họ tên, lớp, mã học sinh, điểm danh,
    bài làm và kết quả học tập của con tôi, <b>chỉ cho mục đích tổ chức dạy học và đánh giá giáo dục STEM</b> trong thời gian con học tại trường.
    Tôi được biết tôi có quyền xem, yêu cầu sửa, xoá dữ liệu hoặc rút lại đồng ý bất cứ lúc nào bằng cách liên hệ nhà trường.</p>
    <p>☐ Đồng ý sử dụng thêm hình ảnh, sản phẩm có hình học sinh trong hoạt động STEM của trường.</p>
    <table><tr><td>Ngày ...... tháng ...... năm 20......</td><td class="r">Người đồng ý<br/>(ký, ghi rõ họ tên)<br/><br/><br/></td></tr></table>
    <p class="n">Nội dung mẫu — nhà trường điều chỉnh theo quy định của trường và hướng dẫn pháp lý trước khi sử dụng.</p></section>`
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Giấy đồng ý</title><style>
    body{font-family:'Times New Roman',serif;margin:0;color:#111;font-size:13.5px}section{height:138mm;box-sizing:border-box;padding:10mm 14mm;border-bottom:1px dashed #999;break-inside:avoid}
    h2{font-size:15px;text-align:center;margin:0 0 4px}.c{text-align:center;margin:0 0 8px;color:#444}p{margin:5px 0;line-height:1.45}
    table{width:100%;margin-top:6px}.r{text-align:center}.n{font-size:10.5px;color:#777;font-style:italic}@page{size:A4;margin:5mm}</style></head>
    <body>${list.map(page).join('')}<script>window.onload=()=>window.print()<\/script></body></html>`)
  w.document.close(); return true
}

type Form = { guardian_name: string; relation: string; phone: string; method: string; consented_on: string; photo: boolean; note: string }

// Bảng thao tác cho một học sinh: ghi nhận / rút đồng ý, xuất dữ liệu, xoá dữ liệu
export default function StudentPrivacy({ s, consent, canErase, onClose, onChanged }: {
  s: Stu; consent?: Consent; canErase: boolean; onClose: () => void; onChanged: () => void
}) {
  const [f, setF] = useState<Form>({ guardian_name: '', relation: 'Mẹ', phone: '', method: 'paper', consented_on: new Date().toISOString().slice(0, 10), photo: false, note: '' })
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.from('student_consents').insert({
      org_id: await myOrgId(), student_id: s.id, guardian_name: f.guardian_name.trim(), relation: f.relation || null, phone: f.phone.trim() || null,
      method: f.method, consented_on: f.consented_on, scope: f.photo ? ['learning', 'photo'] : ['learning'], note: f.note.trim() || null })
    setBusy(false)
    if (error) return setMsg([error.message, true])
    setMsg(['Đã ghi nhận đồng ý.', false]); onChanged()
  }
  async function withdraw() {
    if (!consent || !confirm(`Ghi nhận phụ huynh RÚT LẠI đồng ý cho ${s.full_name}?`)) return
    const { error } = await supabase.from('student_consents').update({ withdrawn_on: new Date().toISOString().slice(0, 10) }).eq('id', consent.id)
    if (error) return setMsg([error.message, true])
    setMsg(['Đã ghi nhận rút lại đồng ý. Cân nhắc xoá dữ liệu nếu phụ huynh yêu cầu.', false]); onChanged()
  }
  async function exportData() {
    const { data, error } = await supabase.rpc('student_data_export', { p_student: s.id })
    if (error) return setMsg([error.message, true])
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `du-lieu-hoc-sinh-${(s.student_code ?? s.id).replace(/[^\w.-]+/g, '_')}.json`; a.click(); URL.revokeObjectURL(a.href)
    setMsg(['Đã tải dữ liệu của học sinh (có ghi nhật ký).', false])
  }
  async function erase() {
    if (!reason.trim()) return setMsg(['Ghi lý do xoá (vd: phụ huynh yêu cầu ngày …).', true])
    const typed = prompt(`Xoá dữ liệu cá nhân của ${s.full_name} — KHÔNG khôi phục được.\nHọ tên, mã HS, bài làm, đồng ý của phụ huynh sẽ bị xoá; tài khoản đăng nhập bị khoá. Điểm danh và điểm số giữ lại ở dạng không định danh để thống kê của trường không lệch.\n\nGõ mã học sinh (${s.student_code ?? 'XOA'}) để xác nhận:`)
    if (typed === null) return
    if (typed.trim() !== (s.student_code ?? 'XOA')) return setMsg(['Mã xác nhận không khớp — chưa xoá.', true])
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('school-accounts', { body: { action: 'erase', kind: 'student', id: s.id, reason: reason.trim() } })
    setBusy(false)
    if (error) {
      let m = error.message
      try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) m = j.error } catch { /* giữ thông báo gốc */ }
      return setMsg([m, true])
    }
    const d = data as { warning?: string }
    alert('Đã xoá dữ liệu cá nhân của học sinh.' + (d?.warning ? '\n' + d.warning : ''))
    onChanged(); onClose()
  }

  return (
    <div className="panel privacy">
      <div className="bar"><h3>{s.full_name} <small className="sub">{s.student_code} · {s.classes?.name}</small></h3><button onClick={onClose}>Đóng</button></div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      <h4>Đồng ý của cha mẹ / người giám hộ</h4>
      {consent ? (
        <div className="bar">
          <p style={{ margin: 0 }}><b>{consent.guardian_name}</b>{consent.relation && ` (${consent.relation})`}{consent.phone && ` · ${consent.phone}`} · {METHOD[consent.method] ?? consent.method} · ngày {day(consent.consented_on)}
            {consent.scope.includes('photo') && ' · có đồng ý dùng hình ảnh'}</p>
          <button onClick={withdraw}>Ghi nhận rút lại đồng ý</button>
        </div>
      ) : (
        <form className="formgrid" onSubmit={save}>
          <label className="field"><span>Người đồng ý *</span><input required value={f.guardian_name} onChange={e => setF({ ...f, guardian_name: e.target.value })} /></label>
          <label className="field"><span>Quan hệ</span><select value={f.relation} onChange={e => setF({ ...f, relation: e.target.value })}>{['Mẹ', 'Cha', 'Người giám hộ', 'Khác'].map(x => <option key={x}>{x}</option>)}</select></label>
          <label className="field"><span>Điện thoại</span><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
          <label className="field"><span>Hình thức</span><select value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Ngày đồng ý</span><input type="date" required value={f.consented_on} onChange={e => setF({ ...f, consented_on: e.target.value })} /></label>
          <label className="field inline"><input type="checkbox" checked={f.photo} onChange={e => setF({ ...f, photo: e.target.checked })} /> Đồng ý dùng hình ảnh, sản phẩm có hình học sinh</label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú (vd: nơi lưu giấy gốc)</span><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit" disabled={busy}>Ghi nhận đồng ý</button></div>
        </form>
      )}
      <h4>Quyền của học sinh và phụ huynh đối với dữ liệu</h4>
      <div className="bar">
        <p className="sub" style={{ margin: 0, flex: 1 }}>Phụ huynh có quyền xem và nhận bản sao dữ liệu của con: bấm <i>Xuất dữ liệu</i> để tải toàn bộ (thông tin, điểm danh, bài làm, tự học).</p>
        <button onClick={exportData}>Xuất dữ liệu (JSON)</button>
      </div>
      {canErase && (
        <div className="bar">
          <input style={{ flex: 1, minWidth: 220 }} placeholder="Lý do xoá (bắt buộc), vd: phụ huynh yêu cầu ngày 20/10/2026" value={reason} onChange={e => setReason(e.target.value)} />
          <button className="danger" disabled={busy} onClick={erase}>{busy ? 'Đang xoá…' : 'Xoá dữ liệu cá nhân'}</button>
        </div>
      )}
    </div>
  )
}
