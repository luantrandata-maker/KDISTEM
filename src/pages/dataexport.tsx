import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadWorkbook, norm, type Column } from '../lib/sheet'

// Sao lưu & xuất dữ liệu (migration 046): xuất toàn bộ dữ liệu của một đơn vị (và đơn vị trực thuộc) ra Excel nhiều trang
// hoặc JSON, ngay trên trình duyệt, theo đúng quyền đọc của người xuất. Mỗi lần xuất được ghi nhật ký (log_data_export).
type Group = { key: string; label: string; note?: string; tables: [string, string][] }
const GROUPS: Group[] = [
  { key: 'org', label: 'Đơn vị & cấu hình', tables: [['organizations', 'Đơn vị'], ['academic_years', 'Năm học'], ['period_configs', 'Tiết học'], ['school_holidays', 'Ngày nghỉ & lễ'], ['buildings', 'Tòa nhà'], ['stem_rooms', 'Phòng STEM']] },
  { key: 'people', label: 'Nhân sự & lớp học', tables: [['teachers', 'Giáo viên'], ['classes', 'Lớp học'], ['teaching_assignments', 'Phân công giảng dạy']] },
  { key: 'students', label: 'Học sinh', note: 'dữ liệu cá nhân — chỉ quản trị trường xuất được', tables: [['students', 'Học sinh'], ['student_consents', 'Đồng ý của cha mẹ']] },
  { key: 'teach', label: 'Giảng dạy & học tập', tables: [['timetable_entries', 'Thời khóa biểu'], ['teaching_sessions', 'Buổi dạy'], ['lesson_attendance', 'Điểm danh'], ['education_plans', 'Kế hoạch giáo dục'],
    ['stem_registrations', 'Đăng ký dạy STEM'], ['assignments', 'Bài tập'], ['submissions', 'Bài nộp']] },
  { key: 'equip', label: 'Thiết bị & kho', tables: [['equipment_types', 'Loại thiết bị'], ['equipment_units', 'Thiết bị'], ['equipment_events', 'Lịch sử thiết bị'], ['warranty_tickets', 'Bảo hành'],
    ['borrow_requests', 'Phiếu mượn'], ['supplies', 'Vật tư'], ['supply_moves', 'Sổ nhập xuất vật tư'], ['stocktakes', 'Đợt kiểm kê'], ['supply_requests', 'Đề xuất mua vật tư'], ['stock_transfers', 'Phiếu vận chuyển']] },
  { key: 'train', label: 'Tập huấn, đánh giá & khảo sát', tables: [['training_plans', 'Kế hoạch tập huấn'], ['training_sessions', 'Buổi tập huấn'], ['certificates', 'Chứng chỉ'],
    ['teacher_assessments', 'Đánh giá năng lực GV'], ['surveys', 'Khảo sát'], ['survey_responses', 'Câu trả lời khảo sát']] },
]
const LABEL = Object.fromEntries(GROUPS.flatMap(g => g.tables)) as Record<string, string>
type Org = { id: string; parent_id: string | null; name: string; type: string; code: string | null }
type Exp = { id: string; org_id: string; format: string; tables: string[]; row_count: number; note: string | null; created_at: string; organizations: { name: string } | null; profiles: { full_name: string | null; email: string | null } | null }
const when = (d: string) => new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
const bytes = (n: number) => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB')
const cell = (v: unknown) => (v == null ? null : typeof v === 'number' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v))

// Đọc hết một bảng theo trang 1000 dòng, lọc theo đơn vị (cột org_id; riêng bảng đơn vị lọc theo id)
async function fetchAll(table: string, ids: string[], strict: boolean): Promise<{ rows: Record<string, unknown>[]; skipped?: string }> {
  const col = table === 'organizations' ? 'id' : 'org_id'
  const out: Record<string, unknown>[] = []
  let useFilter = true, useOrder = true
  for (let from = 0; ; ) {
    let q = supabase.from(table).select('*')
    if (useFilter) q = q.in(col, ids)
    if (useOrder) q = q.order('id')
    const { data, error } = await q.range(from, from + 999)
    if (error) {
      if (/column .*id.* does not exist|42703/i.test(error.message + (error as any).code)) {
        if (useOrder && !/org_id/.test(error.message)) { useOrder = false; continue }
        if (useFilter && /org_id/.test(error.message)) { if (strict) return { rows: [], skipped: 'bảng không có cột đơn vị' }; useFilter = false; continue }
        if (useOrder) { useOrder = false; continue }
      }
      return { rows: [], skipped: /schema cache|does not exist/i.test(error.message) ? 'chưa có trên CSDL' : error.message }
    }
    out.push(...((data as Record<string, unknown>[]) ?? []))
    if (!data || data.length < 1000) break
    from += 1000
    if (out.length > 200000) return { rows: out, skipped: 'dừng ở 200.000 dòng' }
  }
  return { rows: out }
}

export function DataExportPage({ orgId, platform = false }: { orgId: string | null; platform?: boolean }) {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [target, setTarget] = useState<string>(platform ? '' : orgId ?? '')
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<Set<string>>(new Set(GROUPS.filter(g => g.key !== 'students').map(g => g.key)))
  const [children, setChildren] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [hist, setHist] = useState<Exp[]>([])
  const [ov, setOv] = useState<{ db_bytes: number; tables: { name: string; rows: number; bytes: number }[]; exports_30d: number; orgs_exported_90d: number; last_export: string | null } | null>(null)
  async function load() {
    const [o, h, b] = await Promise.all([
      supabase.from('organizations').select('id, parent_id, name, type, code').order('name'),
      supabase.from('data_exports').select('*, organizations(name), profiles(full_name, email)').order('created_at', { ascending: false }).limit(100),
      platform ? supabase.rpc('backup_overview') : Promise.resolve({ data: null }),
    ])
    setOrgs((o.data as Org[]) ?? []); setHist((h.data as unknown as Exp[]) ?? []); setOv((b as any).data ?? null)
  }
  useEffect(() => { load() }, [])
  const tree = useMemo(() => {
    if (!target) return [] as string[]
    if (!children) return [target]
    const kids = new Map<string, string[]>(); orgs.forEach(o => o.parent_id && kids.set(o.parent_id, [...(kids.get(o.parent_id) ?? []), o.id]))
    const out: string[] = [], st = [target]
    while (st.length) { const x = st.pop()!; out.push(x); st.push(...(kids.get(x) ?? [])) }
    return out
  }, [target, children, orgs])
  const tOrg = orgs.find(o => o.id === target)
  const shownOrgs = orgs.filter(o => !q || norm(o.name + ' ' + (o.code ?? '')).includes(norm(q))).slice(0, 50)

  async function run(format: 'xlsx' | 'json') {
    if (!target || !tOrg) return setMsg(['Chọn đơn vị cần xuất.', true])
    const tables = GROUPS.filter(g => pick.has(g.key)).flatMap(g => g.tables)
    if (!tables.length) return setMsg(['Chọn ít nhất một nhóm dữ liệu.', true])
    setMsg(null)
    const got: { table: string; label: string; rows: Record<string, unknown>[]; skipped?: string }[] = []
    for (const [t, l] of tables) {
      setBusy(`Đang đọc ${l}… (${got.length + 1}/${tables.length})`)
      const r = await fetchAll(t, tree, platform)
      got.push({ table: t, label: l, ...r })
    }
    setBusy('Đang tạo file…')
    const total = got.reduce((a, g) => a + g.rows.length, 0)
    const stamp = new Date().toISOString().slice(0, 10)
    const fname = `du-lieu-${(tOrg.code || tOrg.name).replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${stamp}`
    try {
      if (format === 'xlsx') {
        const info = [['Đơn vị', tOrg.name], ['Gồm đơn vị trực thuộc', children ? `Có (${tree.length} đơn vị)` : 'Không'], ['Thời điểm xuất', new Date().toLocaleString('vi-VN')], ['Tổng số dòng', total],
          ...got.map(g => [g.label, g.skipped ? `Bỏ qua: ${g.skipped}` : g.rows.length])]
        await downloadWorkbook(fname, [
          { name: 'Thông tin', columns: [{ key: 'k', label: 'Mục', width: 32 }, { key: 'v', label: 'Giá trị', width: 40 }], rows: info },
          ...got.filter(g => g.rows.length).map(g => {
            const keys = Array.from(new Set(g.rows.flatMap(r => Object.keys(r))))
            return { name: g.label, columns: keys.map(k => ({ key: k, label: k, width: Math.min(40, Math.max(12, k.length + 4)) }) as Column), rows: g.rows.map(r => keys.map(k => cell(r[k]))) }
          }),
        ])
      } else {
        const blob = new Blob([JSON.stringify({ org: { id: tOrg.id, name: tOrg.name }, include_children: children, org_ids: tree, exported_at: new Date().toISOString(),
          tables: Object.fromEntries(got.map(g => [g.table, g.rows])), skipped: Object.fromEntries(got.filter(g => g.skipped).map(g => [g.table, g.skipped])) }, null, 1)], { type: 'application/json' })
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      }
      const { error } = await supabase.rpc('log_data_export', { p_org: target, p_format: format, p_tables: got.filter(g => g.rows.length).map(g => g.table), p_rows: total,
        p_note: children && tree.length > 1 ? `Gồm ${tree.length} đơn vị` : null })
      const skipped = got.filter(g => g.skipped)
      setMsg([`Đã xuất ${total.toLocaleString('vi-VN')} dòng từ ${got.filter(g => g.rows.length).length} bảng.` + (skipped.length ? ` Bỏ qua: ${skipped.map(g => g.label).join(', ')}.` : '') + (error ? ' (Chưa ghi được nhật ký: ' + error.message + ')' : ''), false])
      load()
    } catch (e) { setMsg(['Không tạo được file: ' + (e instanceof Error ? e.message : String(e)), true]) }
    setBusy(null)
  }
  const toggle = (k: string) => { const s = new Set(pick); s.has(k) ? s.delete(k) : s.add(k); setPick(s) }
  return (
    <>
      {platform && ov && (
        <div className="cards">
          <div className="card"><strong>{bytes(ov.db_bytes)}</strong><span>Dung lượng CSDL</span></div>
          <div className="card"><strong>{ov.exports_30d}</strong><span>Lần xuất 30 ngày qua</span></div>
          <div className="card"><strong>{ov.orgs_exported_90d}</strong><span>Đơn vị đã xuất 90 ngày qua</span></div>
          <div className="card"><strong>{ov.last_export ? when(ov.last_export) : '—'}</strong><span>Lần xuất gần nhất</span></div>
        </div>
      )}
      {platform && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Sao lưu hệ thống</h3>
          <p className="sub" style={{ margin: 0 }}>Supabase tự sao lưu toàn bộ CSDL hằng ngày (giữ 7 ngày ở gói Pro). Nên bật <b>Point-in-Time Recovery</b> (khôi phục đến từng phút) trước khi chạy chính thức:
            Supabase → Database → Backups. Bảng dưới là các bảng lớn nhất (số dòng ước tính). Xuất theo từng đơn vị ở phần bên dưới để giao dữ liệu cho khách hàng hoặc lưu trữ riêng.</p>
          {ov && <div className="wrap" style={{ marginTop: 8 }}><table><thead><tr><th>Bảng</th><th>Số dòng (ước tính)</th><th>Dung lượng</th></tr></thead>
            <tbody>{ov.tables.map(t => <tr key={t.name}><td>{LABEL[t.name] ? <>{LABEL[t.name]} <small className="sub">{t.name}</small></> : t.name}</td><td>{t.rows.toLocaleString('vi-VN')}</td><td>{bytes(t.bytes)}</td></tr>)}</tbody></table></div>}
        </div>
      )}
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Xuất dữ liệu {tOrg && !platform ? `— ${tOrg.name}` : ''}</h3>
        {platform && (
          <div className="formgrid">
            <label className="field"><span>Tìm đơn vị</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Tên hoặc mã trường / Sở…" /></label>
            <label className="field"><span>Đơn vị cần xuất</span><select value={target} onChange={e => setTarget(e.target.value)}><option value="">— chọn —</option>
              {(tOrg && !shownOrgs.includes(tOrg) ? [tOrg, ...shownOrgs] : shownOrgs).map(o => <option key={o.id} value={o.id}>{o.name}{o.code ? ` (${o.code})` : ''}</option>)}</select></label>
          </div>
        )}
        <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0' }}>
          {GROUPS.map(g => <label key={g.key} className={'chipbtn' + (pick.has(g.key) ? ' on' : '')} title={g.tables.map(t => t[1]).join(', ')}>
            <input type="checkbox" checked={pick.has(g.key)} onChange={() => toggle(g.key)} style={{ marginRight: 6 }} />{g.label}{g.note && <small className="sub"> · {g.note}</small>}</label>)}
        </div>
        {orgs.some(o => o.parent_id === target) && <label style={{ display: 'block', marginBottom: 10 }}><input type="checkbox" checked={children} onChange={e => setChildren(e.target.checked)} /> Gồm cả đơn vị trực thuộc {children && tree.length > 1 && <small className="sub">({tree.length} đơn vị)</small>}</label>}
        <div className="tools"><button className="primary" disabled={!!busy || !target} onClick={() => run('xlsx')}>Tải Excel (mỗi bảng một trang)</button>
          <button disabled={!!busy || !target} onClick={() => run('json')}>Tải JSON (sao lưu đầy đủ)</button>{busy && <span className="sub">{busy}</span>}</div>
        <p className="sub">Dữ liệu được đọc theo đúng quyền của tài khoản đang dùng; bảng không có quyền xem sẽ trống. File chứa dữ liệu cá nhân — lưu ở nơi an toàn, không gửi qua kênh công khai.</p>
        {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      </div>
      <h3>Nhật ký xuất dữ liệu</h3>
      <div className="wrap"><table>
        <thead><tr><th>Thời điểm</th><th>Đơn vị</th><th>Người xuất</th><th>Định dạng</th><th>Số bảng</th><th>Số dòng</th><th>Ghi chú</th></tr></thead>
        <tbody>{hist.map(h => <tr key={h.id}><td className="nowrap">{when(h.created_at)}</td><td>{h.organizations?.name}</td><td>{h.profiles?.full_name ?? h.profiles?.email ?? '—'}</td>
          <td>{h.format.toUpperCase()}</td><td title={h.tables.map(t => LABEL[t] ?? t).join(', ')}>{h.tables.length}</td><td>{h.row_count.toLocaleString('vi-VN')}</td><td><small>{h.note}</small></td></tr>)}
          {!hist.length && <tr><td colSpan={7}>Chưa có lần xuất nào.</td></tr>}</tbody>
      </table></div>
    </>
  )
}
