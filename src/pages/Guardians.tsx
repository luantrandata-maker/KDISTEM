import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx, norm, type Column } from '../lib/sheet'
import ImportExcel from '../components/ImportExcel'

// Phụ huynh của học sinh (migration 048): danh sách theo lớp, thêm / nhập Excel, xuất Excel.
// Tài khoản phụ huynh: Tài khoản → Tài khoản mã → Phụ huynh (tên đăng nhập <mã trường>.ph<SĐT>).
type G = { id: string; student_id: string; full_name: string; relation: string; phone: string | null; email: string | null; profile_id: string | null; receive_alerts: boolean; note: string | null }
type S = { id: string; full_name: string; student_code: string | null; class_id: string | null; classes: { name: string } | null }
const REL: Record<string, string> = { mother: 'Mẹ', father: 'Bố', guardian: 'Người giám hộ', other: 'Khác' }
const relOf = (v: string) => { const x = norm(v.trim()); return /^(me|ma|mother)/.test(x) ? 'mother' : /^(bo|cha|ba|father)/.test(x) ? 'father' : /giam ho|guardian/.test(x) ? 'guardian' : x ? 'other' : 'guardian' }
const COLS: Column[] = [
  { key: 'code', label: 'Mã học sinh', required: true, aliases: ['Mã HS'] }, { key: 'student', label: 'Họ tên học sinh', width: 24 },
  { key: 'name', label: 'Họ tên phụ huynh', required: true, aliases: ['Phụ huynh', 'Họ tên PH'], width: 24 },
  { key: 'rel', label: 'Quan hệ', aliases: ['Quan hệ với HS'] }, { key: 'phone', label: 'Số điện thoại', aliases: ['SĐT', 'Điện thoại'], width: 16 },
  { key: 'email', label: 'Email', width: 24 },
]
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 048 trên Supabase.' : /guardians_student_phone|duplicate/i.test(m) ? 'Học sinh đã có phụ huynh với số điện thoại này.'
  : /guardians_check|9,12/i.test(m) ? 'Số điện thoại phải có 9–12 chữ số.' : /row-level/i.test(m) ? 'Bạn không có quyền sửa danh sách phụ huynh.' : m)

export default function Guardians({ orgId, go }: { orgId: string | null; go?: (p: string) => void }) {
  const [gs, setGs] = useState<G[]>([])
  const [ss, setSs] = useState<S[]>([])
  const [cls, setCls] = useState('')
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'' | 'none' | 'noacc'>('')
  const [form, setForm] = useState<Partial<G> | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    if (!orgId) return
    const [g, s] = await Promise.all([
      supabase.from('guardians').select('*').eq('org_id', orgId),
      supabase.from('students').select('id, full_name, student_code, class_id, classes(name)').eq('org_id', orgId).neq('status', 'erased').order('student_code'),
    ])
    if (g.error) setMsg([errText(g.error.message), true])
    setGs((g.data as G[]) ?? []); setSs((s.data as unknown as S[]) ?? [])
  }
  useEffect(() => { load() }, [orgId])
  const byStudent = useMemo(() => { const m = new Map<string, G[]>(); gs.forEach(g => m.set(g.student_id, [...(m.get(g.student_id) ?? []), g])); return m }, [gs])
  const classes = [...new Set(ss.map(s => s.classes?.name ?? 'Chưa xếp lớp'))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }))
  const shown = ss.filter(s => (!cls || (s.classes?.name ?? 'Chưa xếp lớp') === cls)
    && (!q || norm(s.full_name + ' ' + (s.student_code ?? '') + ' ' + (byStudent.get(s.id) ?? []).map(g => g.full_name + ' ' + (g.phone ?? '')).join(' ')).includes(norm(q)))
    && (only !== 'none' || !byStudent.get(s.id)?.length) && (only !== 'noacc' || (byStudent.get(s.id) ?? []).some(g => !g.profile_id)))
  const covered = ss.filter(s => byStudent.get(s.id)?.length).length
  const withAcc = new Set(gs.filter(g => g.profile_id).map(g => g.student_id)).size

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form?.student_id || !form.full_name?.trim()) return
    const row = { student_id: form.student_id, org_id: orgId, full_name: form.full_name.trim(), relation: form.relation ?? 'guardian', phone: form.phone?.trim() || null,
      email: form.email?.trim() || null, receive_alerts: form.receive_alerts ?? true, note: form.note?.trim() || null }
    const { error } = form.id ? await supabase.from('guardians').update(row).eq('id', form.id) : await supabase.from('guardians').insert(row)
    if (error) return setMsg([errText(error.message), true]); setForm(null); setMsg(['Đã lưu.', false]); load()
  }
  async function remove(g: G) {
    if (!confirm(`Xoá phụ huynh ${g.full_name}?${g.profile_id ? ' Tài khoản phụ huynh sẽ không còn thấy học sinh này.' : ''}`)) return
    const { error } = await supabase.from('guardians').delete().eq('id', g.id)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  async function importRows(recs: (Record<string, string> & { _line: number })[]) {
    const code = new Map(ss.map(s => [norm(s.student_code ?? ''), s.id])); const bad: string[] = []; let n = 0
    for (const r of recs) {
      const sid = code.get(norm(r.code.trim()))
      if (!sid) { bad.push(`dòng ${r._line}: không có mã HS ${r.code}`); continue }
      const { error } = await supabase.from('guardians').insert({ student_id: sid, org_id: orgId, full_name: r.name.trim(), relation: relOf(r.rel), phone: r.phone.trim() || null, email: r.email.trim() || null })
      if (error) { bad.push(`dòng ${r._line}: ${errText(error.message)}`); continue }
      n++
    }
    load(); return `Đã thêm ${n} phụ huynh.` + (bad.length ? ` Bỏ qua ${bad.length} dòng: ${bad.slice(0, 4).join('; ')}` : '')
  }
  function excel() {
    downloadXlsx('phu-huynh' + (cls ? '-' + cls : ''), [{ key: 'cls', label: 'Lớp' }, ...COLS, { key: 'acc', label: 'Có tài khoản' }],
      shown.flatMap(s => (byStudent.get(s.id) ?? [null]).map(g => [s.classes?.name, s.student_code, s.full_name, g?.full_name, g ? REL[g.relation] : '', g?.phone, g?.email, g ? (g.profile_id ? 'Có' : 'Chưa') : ''])), 'Phụ huynh')
  }
  return (
    <>
      <div className="cards">
        <div className="card"><strong>{covered}/{ss.length}</strong><span>Học sinh đã có thông tin phụ huynh</span></div>
        <div className="card"><strong>{withAcc}</strong><span>Học sinh có phụ huynh dùng tài khoản</span></div>
        <div className="card"><strong>{gs.filter(g => !g.phone).length}</strong><span>Phụ huynh thiếu số điện thoại</span></div>
      </div>
      <div className="bar" style={{ marginTop: 12 }}>
        <span className="tools">
          <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Lớp"><option value="">Tất cả lớp</option>{classes.map(c => <option key={c}>{c}</option>)}</select>
          <select value={only} onChange={e => setOnly(e.target.value as typeof only)} aria-label="Lọc"><option value="">Mọi học sinh</option><option value="none">Chưa có phụ huynh</option><option value="noacc">Phụ huynh chưa có tài khoản</option></select>
          <input className="search" style={{ margin: 0 }} placeholder="Tìm HS, phụ huynh, SĐT…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        </span>
        <span className="tools">
          <ImportExcel columns={COLS} template="mau-phu-huynh" sample={[['HS0012', 'Nguyễn Minh An', 'Trần Thị Hoa', 'Mẹ', '0912345678', '']]} onRecords={importRows} onMessage={(m, e) => setMsg([m, !!e])} />
          <button onClick={excel}>Xuất Excel</button>
          {go && <button onClick={() => go('Tài khoản')} title="Tài khoản → Tài khoản mã → Phụ huynh">Tạo tài khoản phụ huynh</button>}
        </span>
      </div>
      <p className="sub">Phụ huynh đăng nhập bằng <b>tên đăng nhập theo số điện thoại</b> (tạo ở Tài khoản → Tài khoản mã → Phụ huynh). Một số điện thoại dùng chung cho các con học cùng trường. Phụ huynh chỉ xem được dữ liệu của con mình.</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={save}>
          <h3 style={{ gridColumn: '1 / -1', margin: 0 }}>{form.id ? 'Sửa' : 'Thêm'} phụ huynh · {ss.find(s => s.id === form.student_id)?.full_name}</h3>
          <label className="field"><span>Họ tên *</span><input required value={form.full_name ?? ''} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>
          <label className="field"><span>Quan hệ</span><select value={form.relation ?? 'guardian'} onChange={e => setForm({ ...form, relation: e.target.value })}>{Object.entries(REL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Số điện thoại</span><input inputMode="tel" value={form.phone ?? ''} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="09xx xxx xxx" /></label>
          <label className="field"><span>Email</span><input type="email" value={form.email ?? ''} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={form.receive_alerts ?? true} onChange={e => setForm({ ...form, receive_alerts: e.target.checked })} /> Nhận thông báo khi con vắng / đi muộn</label>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Lớp</th><th>Học sinh</th><th>Phụ huynh</th><th>Số điện thoại</th><th>Tài khoản</th><th /></tr></thead>
        <tbody>{shown.slice(0, 500).flatMap(s => {
          const list = byStudent.get(s.id) ?? []
          return (list.length ? list : [null]).map((g, i) => (
            <tr key={s.id + (g?.id ?? '')}>
              {i === 0 && <><td rowSpan={Math.max(1, list.length)}>{s.classes?.name ?? '—'}</td><td rowSpan={Math.max(1, list.length)}><b>{s.full_name}</b><br /><small>{s.student_code}</small><br />
                <button onClick={() => setForm({ student_id: s.id, relation: list.some(x => x.relation === 'mother') ? 'father' : 'mother', receive_alerts: true })}>+ Phụ huynh</button></td></>}
              {g ? <><td>{g.full_name} <small className="sub">· {REL[g.relation]}</small>{!g.receive_alerts && <><br /><small className="sub">tắt thông báo vắng</small></>}</td><td>{g.phone ?? <small className="due bad">thiếu</small>}</td>
                <td>{g.profile_id ? <span className="plbadge ok">Đã có</span> : <span className="plbadge mute">Chưa</span>}</td>
                <td className="nowrap"><button onClick={() => setForm(g)}>Sửa</button> <button onClick={() => remove(g)}>Xoá</button></td></>
                : <td colSpan={4}><small className="sub">Chưa có thông tin phụ huynh</small></td>}
            </tr>))
        })}
          {!shown.length && <tr><td colSpan={6}>Không có học sinh phù hợp.</td></tr>}</tbody>
      </table></div>
      {shown.length > 500 && <p className="sub">Đang hiện 500 học sinh đầu — chọn lớp để xem tiếp.</p>}
    </>
  )
}
