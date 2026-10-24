import { SelBar, SelTd, SelTh, useRowSel } from '../components/TableSel'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useEduLevels, type EduLevel } from '../lib/eduLevels'
import { ElView } from '../components/ElView'
import { NumMultiSelect } from '../components/MultiSelect'

// Danh mục cấp học & khối (migration 065): KDI thêm / sửa cấp học và khoảng khối áp dụng; chương trình giáo dục,
// môn học và các ô chọn khối ở mọi màn dùng danh mục này. Đơn vị khác chỉ xem.
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 065 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'
  : /23503|foreign key/i.test(m) ? 'Cấp học đang được chương trình dùng — hãy chuyển sang "Ngừng dùng".'
  : /23505|duplicate/i.test(m) ? 'Mã cấp học đã có.'
  : /edu_levels_code_check/i.test(m) ? 'Mã gồm 2–20 ký tự thường không dấu, số hoặc "_", bắt đầu bằng chữ (vd. lien_cap).'
  : /grade_to|edu_levels_check/i.test(m) ? 'Khối đến phải lớn hơn hoặc bằng khối từ (1–12).' : m)
const GRADES = Array.from({ length: 12 }, (_, i) => i + 1)

export function EduLevelsCatalog() {
  const { all, reload } = useEduLevels()
  const lsel = useRowSel(all, l => l.code)
  const [admin, setAdmin] = useState(false)
  const [used, setUsed] = useState<Record<string, number>>({})
  const [form, setForm] = useState<(EduLevel & { isNew?: boolean }) | null>(null)
  const [gradePick, setGradePick] = useState<number[] | null>(null)
  useEffect(() => { setGradePick(null) }, [form === null])
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => {
    supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data))
    supabase.from('edu_programs').select('level').then(({ data }) => {
      const n: Record<string, number> = {}
      for (const r of (data ?? []) as { level: string }[]) n[r.level] = (n[r.level] ?? 0) + 1
      setUsed(n)
    })
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const row = { name: form.name.trim(), grade_from: Number(form.grade_from), grade_to: Number(form.grade_to), sort: Number(form.sort) || 0, active: form.active !== false }
    if (!row.name) return setMsg(['Nhập tên cấp học.', true])
    if (row.grade_to < row.grade_from) return setMsg([errText('grade_to'), true])
    if (gradePick && !gradePick.length) return setMsg(['Chọn ít nhất một khối.', true])
    if (gradePick && gradePick.length !== row.grade_to - row.grade_from + 1) return setMsg(['Khối của một cấp học phải liền nhau (VD: 6, 7, 8, 9).', true])
    const { data, error } = form.isNew
      ? await supabase.from('edu_levels').insert({ ...row, code: form.code.trim().toLowerCase() }).select('code')
      : await supabase.from('edu_levels').update(row).eq('code', form.code).select('code')
    if (error) return setMsg([errText(error.message + ' ' + (error.code ?? '')), true])
    if (!data?.length) return setMsg([errText('row-level'), true])
    setForm(null); setMsg([form.isNew ? 'Đã thêm cấp học.' : 'Đã lưu cấp học.', false]); reload()
  }
  async function setActive(l: EduLevel, active: boolean) {
    const { error } = await supabase.from('edu_levels').update({ active }).eq('code', l.code)
    if (error) return setMsg([errText(error.message), true])
    reload()
  }
  async function remove(l: EduLevel) {
    if (!confirm(`Xoá cấp học "${l.name}"? Cấp đang có chương trình dùng thì không xoá được, hãy ngừng dùng.`)) return
    const { data, error } = await supabase.from('edu_levels').delete().eq('code', l.code).select('code')
    if (error) return setMsg([errText(error.message + ' ' + (error.code ?? '')), true])
    if (!data?.length) return setMsg([errText('row-level'), true])
    setMsg(null); reload()
  }
  // Chọn khối bằng danh sách tick; cấp học lưu khối nhỏ nhất – lớn nhất nên các khối phải liền nhau
  const gradeVal = gradePick ?? (form ? GRADES.filter(g => g >= form.grade_from && g <= form.grade_to) : [])
  const pickGrades = (gs: number[]) => { setGradePick(gs); if (form && gs.length) setForm({ ...form, grade_from: gs[0], grade_to: gs[gs.length - 1] }) }

  if (form) return (
    <ElView back="Cấp học & khối" onBack={() => setForm(null)} title={form.isNew ? 'Thêm cấp học' : 'Sửa cấp học'}>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
        <form className="panel formgrid" onSubmit={save} style={{ marginBottom: 12 }}>
          <label className="field"><span>Tên cấp học *</span><input required maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="VD: Liên cấp THCS–THPT" /></label>
          <label className="field"><span>Mã {form.isNew ? '*' : '(không đổi được)'}</span><input required disabled={!form.isNew} maxLength={20} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="VD: lien_cap" /></label>
          <div className="field" style={{ gridColumn: 'span 2' }}><span>Khối *</span>
            <NumMultiSelect value={gradeVal} onChange={pickGrades} options={GRADES.map(g => ({ value: g, label: `Khối ${g}` }))} placeholder="Chọn khối…" ariaLabel="Khối" /></div>
          <label className="field"><span>Thứ tự</span><input type="number" min={0} value={form.sort ?? 0} onChange={e => setForm({ ...form, sort: Number(e.target.value) })} /></label>
          <div className="formactions"><button className="primary" type="submit">{form.isNew ? 'Thêm' : 'Lưu'}</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
    </ElView>
  )
  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0 }}>Cấp học và các khối thuộc mỗi cấp. Khi soạn chương trình, môn học hay học liệu, ô "Cấp học" và "Khối" lấy từ danh mục này.
          {admin ? ' Thu hẹp khoảng khối chỉ được khi không có chương trình nào nằm ngoài khoảng mới.' : ' Chỉ quản trị nền tảng KDI sửa được danh mục này.'}</p>
        {admin && <button className="primary" onClick={() => { setMsg(null); setForm({ code: '', name: '', grade_from: 1, grade_to: 5, sort: all.reduce((m, x) => Math.max(m, x.sort ?? 0), 0) + 1, active: true, isNew: true }) }}>Thêm cấp học</button>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {admin && (() => { const l = lsel.cur; return (
        <SelBar picked={l?.name ?? null}>
          <button disabled={!l} onClick={() => { if (l) { setMsg(null); setForm({ ...l }) } }}>Sửa</button>
          <button disabled={!l} onClick={() => l && setActive(l, l.active === false)}>{l?.active === false ? 'Dùng lại' : 'Ngừng dùng'}</button>
          <button className="danger" disabled={!l} onClick={() => { if (l) { remove(l); lsel.clear() } }}>Xoá</button>
        </SelBar>) })()}
      <div className="wrap"><table>
        <thead><tr>{admin && <SelTh />}<th>Cấp học</th><th>Mã</th><th>Khối</th><th>Chương trình</th></tr></thead>
        <tbody>{all.map(l => (
          <tr key={l.code} className={lsel.is(l) ? 'picked' : undefined} style={l.active === false ? { opacity: 0.6 } : undefined}>
            {admin && <SelTd on={lsel.is(l)} onToggle={() => lsel.toggle(l)} label={l.name} />}
            <td><b>{l.name}</b>{l.active === false && <> <span className="pill">Ngừng dùng</span></>}</td>
            <td><small className="sub">{l.code}</small></td>
            <td>Khối {l.grade_from}{l.grade_to !== l.grade_from ? `–${l.grade_to}` : ''}</td>
            <td>{used[l.code] ?? 0}</td>
          </tr>))}</tbody>
      </table></div>
    </>
  )
}
