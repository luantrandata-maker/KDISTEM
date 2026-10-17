import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'
import ImportExcel from '../components/ImportExcel'
import { type Year, sameSchoolYear } from '../lib/year'
import StudentPrivacy, { type Consent, ConsentBadge, loadConsents, CONSENT_COLS, importConsents, printConsentForms } from './StudentPrivacy'
import { norm, importSummary, downloadXlsx, type Column } from '../lib/sheet'

const COLS: Column[] = [
  { key: 'code', label: 'Mã học sinh', aliases: ['Mã HS', 'Ma hoc sinh', 'MSHS'] },
  { key: 'name', label: 'Họ tên', aliases: ['Họ và tên', 'Tên học sinh'], required: true, width: 28 },
  { key: 'cls', label: 'Lớp', aliases: ['Tên lớp'], required: true },
]

type St = { id: string; full_name: string; student_code: string | null; class_id: string | null; status: string; classes: { name: string; grade: number } | null }
const STATUS: Record<string, string> = { studying: 'Đang học', transferred: 'Chuyển trường', graduated: 'Đã tốt nghiệp' }
const ERASED = 'erased'   // 039: đã xoá dữ liệu cá nhân
const PAGE = 20
type Cls = { id: string; name: string; year_id: string | null }

export default function Students({ year, years = [] }: { year?: Year | null; years?: Year[] }) {
  const [rows, setRows] = useState<St[]>([])
  const [classes, setClasses] = useState<Cls[]>([])
  const [cls, setCls] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<{ full_name: string; student_code: string; class_id: string } | null>(null)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(1)
  const [consents, setConsents] = useState<Record<string, Consent>>({})
  const [sel, setSel] = useState<string | null>(null)
  const [school, setSchool] = useState('')

  async function load() {
    const [s, c] = await Promise.all([
      supabase.from('students').select('id, full_name, student_code, class_id, status, classes(name, grade)').order('student_code'),
      supabase.from('classes').select('id, name, year_id').order('name'),
    ])
    setRows((s.data as unknown as St[]) ?? []); setClasses((c.data as Cls[]) ?? [])
    setConsents(await loadConsents())
  }
  useEffect(() => { myOrgId().then(id => supabase.from('organizations').select('name').eq('id', id).single()).then(({ data }) => setSchool((data as { name: string } | null)?.name ?? '')) }, [])
  useEffect(() => { load() }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    const { error } = await supabase.from('students').insert({ org_id: await myOrgId(), ...form, student_code: form.student_code || null })
    if (error) return setErr(error.message)
    setForm(null); setErr(''); load()
  }
  async function importRecords(recs: (Record<string, string> & { _line: number })[]) {
    // Lớp của năm học đang chọn được ưu tiên khi trùng tên với lớp năm cũ
    const short = (n: string) => norm(n.replace(/^lớp\s*/i, ''))
    const ordered = [...classes.filter(c => !sameSchoolYear(years, c.year_id, year ?? null)), ...classes.filter(c => sameSchoolYear(years, c.year_id, year ?? null))]
    const byName = new Map(ordered.map(c => [short(c.name), c.id]))
    const byCode = new Map(rows.filter(r => r.student_code).map(r => [r.student_code!, r]))
    const org = await myOrgId(); const bad: string[] = []; const newCls: string[] = []; let moved = 0
    // Lớp chưa có: tạo trong năm học đang chọn (khối lấy từ tên lớp, vd 6A1 → 6)
    for (const r of recs) {
      const k = short(r.cls ?? '')
      if (!k || byName.has(k)) continue
      const m = r.cls.match(/(\d{1,2})/); const grade = m ? Number(m[1]) : NaN
      if (!(grade >= 1 && grade <= 12)) continue
      const { data, error } = await supabase.from('classes').insert({ org_id: org, year_id: year?.id ?? null, name: r.cls.trim(), grade }).select('id').single()
      if (!error && data) { byName.set(k, data.id); newCls.push(r.cls.trim()) }
    }
    const seen = new Set<string>()
    const list: { org_id: string; student_code: string | null; full_name: string; class_id: string }[] = []
    for (const r of recs) {
      const cid = byName.get(short(r.cls ?? ''))
      if (!r.name) { bad.push(`dòng ${r._line}: thiếu họ tên`); continue }
      if (!cid) { bad.push(`dòng ${r._line}: không có lớp "${r.cls}" (không rõ khối để tạo)`); continue }
      if (r.code && seen.has(r.code)) { bad.push(`dòng ${r._line}: mã ${r.code} lặp lại trong file`); continue }
      if (r.code) seen.add(r.code)
      const old = r.code ? byCode.get(r.code) : undefined
      if (old) {   // HS đã có (cùng mã): cập nhật họ tên, lớp — dùng khi lên lớp đầu năm
        if (old.class_id !== cid || old.full_name !== r.name) {
          const { error } = await supabase.from('students').update({ full_name: r.name, class_id: cid }).eq('id', old.id)
          if (error) bad.push(`dòng ${r._line}: ${error.message}`); else moved++
        }
        continue
      }
      list.push({ org_id: org, student_code: r.code || null, full_name: r.name, class_id: cid })
    }
    if (list.length) { const { error } = await supabase.from('students').insert(list); if (error) return 'Không nhập được: ' + error.message }
    load()
    return importSummary(list.length, 'học sinh mới', bad) + (moved ? ` Cập nhật lớp/họ tên ${moved} học sinh đã có.` : '')
      + (newCls.length ? ` Đã tạo ${newCls.length} lớp mới: ${newCls.slice(0, 6).join(', ')}${newCls.length > 6 ? '…' : ''}.` : '')
  }
  async function exportXlsx() {
    await downloadXlsx('danh-sach-hoc-sinh', [...COLS, { key: 'st', label: 'Trạng thái' }],
      all.map(r => [r.student_code, r.full_name, r.classes?.name, STATUS[r.status] ?? r.status]))
  }
  async function remove(s: St) {
    if (!confirm(`Xoá học sinh ${s.full_name}?`)) return
    await supabase.from('students').delete().eq('id', s.id); load()
  }

  async function setStatus(st: St, status: string) { await supabase.from('students').update({ status }).eq('id', st.id); load() }
  const all = rows.filter(r => (!cls || r.class_id === cls) && (r.full_name + (r.student_code ?? '')).toLowerCase().includes(q.toLowerCase()))
  const active = all.filter(r => r.status === 'studying')
  const pages = Math.max(1, Math.ceil(all.length / PAGE)); const cur = Math.min(page, pages)
  const shown = all.slice((cur - 1) * PAGE, cur * PAGE)

  return (
    <>
      <div className="bar">
        <div>
          <input className="search" placeholder="Tìm theo tên hoặc mã học sinh…" value={q} onChange={e => { setQ(e.target.value); setPage(1) }} />{' '}
          <select value={cls} onChange={e => { setCls(e.target.value); setPage(1) }} aria-label="Lọc theo lớp">
            <option value="">Tất cả lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="tools">
          <ImportExcel columns={COLS} template="mau-nhap-hoc-sinh" sample={[['HS9A001', 'Nguyễn Minh Anh', classes[0]?.name ?? 'Lớp 9A']]}
            onRecords={importRecords} onMessage={m => setErr(m)} />
          <button onClick={exportXlsx} disabled={!all.length}>Xuất Excel</button>
          <ImportExcel label="Nhập đồng ý PH" templateLabel="Mẫu đồng ý PH" columns={CONSENT_COLS} template="mau-dong-y-phu-huynh"
            sample={all.filter(r => r.status === 'studying' && !consents[r.id]).map(r => [r.student_code ?? '', r.full_name, '', 'Mẹ', '', '', 'Giấy có chữ ký'])}
            onRecords={async recs => { const m = await importConsents(recs, rows, consents); load(); return m }} onMessage={m => setErr(m)} />
          <button onClick={() => { if (!printConsentForms(school, all.filter(r => r.status === 'studying'))) setErr('Trình duyệt chặn cửa sổ in — cho phép cửa sổ bật lên.') }}
            disabled={!all.length} title="In giấy đồng ý cho các học sinh đang lọc (theo lớp)">In giấy đồng ý</button>
          <button className="primary" onClick={() => setForm({ full_name: '', student_code: '', class_id: classes[0]?.id ?? '' })}>Thêm học sinh</button>
        </div>
      </div>
      {err && !form && <p className="sub"><b>{err}</b></p>}
      <p className="sub covhint">Đồng ý của cha mẹ: {active.filter(r => consents[r.id]).length}/{active.length} học sinh đang học{cls ? ' của lớp đang lọc' : ''} đã có.
        Lọc theo lớp rồi bấm <i>In giấy đồng ý</i> để phát cho phụ huynh ký; thu lại thì nhập bằng <i>Nhập đồng ý PH</i> (file mẫu có sẵn học sinh chưa có đồng ý).</p>
      {sel && rows.find(r => r.id === sel) && <StudentPrivacy s={rows.find(r => r.id === sel)!} consent={consents[sel]} canErase
        onClose={() => setSel(null)} onChanged={load} />}
      
      {form && (
        <form className="panel formgrid" onSubmit={add}>
          <input required placeholder="Họ và tên" value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
          <input placeholder="Mã học sinh" value={form.student_code} onChange={e => setForm({ ...form, student_code: e.target.value })} />
          <select value={form.class_id} onChange={e => setForm({ ...form, class_id: e.target.value })}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <div><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
          {err && <p className="msg">{err}</p>}
        </form>
      )}
      <table>
        <thead><tr><th>Học sinh</th><th>Lớp</th><th>Khối</th><th>Trạng thái</th><th>Đồng ý PH</th><th></th></tr></thead>
        <tbody>
          {shown.map(s => (
            <tr key={s.id}><td><b>{s.full_name}</b><br /><small>{s.student_code}</small></td><td>{s.classes?.name ?? '—'}</td><td>{s.classes?.grade ?? '—'}</td>
              <td>{s.status === ERASED ? <small>Đã xoá dữ liệu</small>
                : <select value={s.status} onChange={e => setStatus(s, e.target.value)}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</td>
              <td>{s.status !== ERASED && <ConsentBadge c={consents[s.id]} />}</td>
              <td className="nowrap">{s.status !== ERASED && <button onClick={() => setSel(s.id)}>Đồng ý & dữ liệu</button>} <button onClick={() => remove(s)}>Xoá</button></td></tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={6}>Không có học sinh phù hợp.</td></tr>}
        </tbody>
      </table>
      <div className="bar" style={{ marginTop: 10 }}><small>Hiển thị {shown.length}/{PAGE} (trang {cur}/{pages}) · Tổng {all.length} học sinh</small>
        <div className="tools"><button disabled={cur <= 1} onClick={() => setPage(cur - 1)}>‹ Trước</button><button disabled={cur >= pages} onClick={() => setPage(cur + 1)}>Sau ›</button></div></div>
    </>
  )
}
