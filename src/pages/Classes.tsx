import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'
import { ProgChips } from '../components/Chips'
import { k12Sync } from '../lib/k12'
import { type Year, sameSchoolYear } from '../lib/year'
import ImportExcel from '../components/ImportExcel'
import { norm, importSummary, downloadXlsx, type Column } from '../lib/sheet'
import { loadRooms, type RoomLite } from '../lib/rooms'

const COLS: Column[] = [
  { key: 'name', label: 'Tên lớp', required: true, aliases: ['Lớp', 'Ten lop'] },
  { key: 'grade', label: 'Khối', aliases: ['Khoi'] },
  { key: 'gvcn', label: 'Giáo viên chủ nhiệm', aliases: ['GVCN', 'Chủ nhiệm'], width: 26 },
  { key: 'programs', label: 'Chương trình STEM', aliases: ['CT STEM', 'Chương trình'], width: 18 },
  { key: 'room', label: 'Phòng học', aliases: ['Phòng'], width: 16 },
]
// Khối lấy từ tên lớp khi không ghi: "6A1" → 6, "Lớp 10 Toán" → 10
const gradeOf = (name: string) => { const m = name.match(/(\d{1,2})/); const g = m ? Number(m[1]) : NaN; return g >= 1 && g <= 12 ? g : null }
const progList = (v: string) => [...new Set((v ?? '').split(/[,;\s]+/).map(x => x.trim().toUpperCase()).filter(x => /^CT[1-5]$/.test(x)))]

type Row = { id: string; year_id: string | null; name: string; grade: number; homeroom_teacher_id: string | null; room_id?: string | null; teachers: { full_name: string } | null; academic_years: { name: string } | null }
type Teacher = { id: string; full_name: string; email?: string | null }

export default function Classes({ orgId, year, years = [] }: { orgId: string; year?: Year | null; years?: Year[] }) {
  const [rows, setRows] = useState<Row[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [rooms, setRooms] = useState<RoomLite[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [progs, setProgs] = useState<Record<string, string[]>>({})
  const [stemT, setStemT] = useState<Record<string, string[]>>({})
  const [form, setForm] = useState<Row | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)

  async function load() {
    const [c, t, s, cp, tt, rm] = await Promise.all([
      supabase.from('classes').select('*, teachers!classes_homeroom_teacher_id_fkey(full_name), academic_years(name)').order('name'),
      supabase.from('teachers').select('id, full_name, email').order('full_name'),
      supabase.from('students').select('class_id'),
      supabase.from('class_programs').select('class_id, program'),
      supabase.from('timetable_entries').select('class_id, teachers(full_name)').eq('kind', 'stem'),
      loadRooms('classroom'),
    ])
    setRooms(rm)
    setRows(((c.data as unknown as Row[]) ?? []).filter(r => sameSchoolYear(years, r.year_id, year ?? null))); setTeachers((t.data as Teacher[]) ?? [])
    const m: Record<string, number> = {}; (s.data ?? []).forEach((x: any) => { m[x.class_id] = (m[x.class_id] ?? 0) + 1 }); setCounts(m)
    const p: Record<string, string[]> = {}; (cp.data ?? []).forEach((x: any) => { (p[x.class_id] ??= []).push(x.program) }); setProgs(p)
    const st: Record<string, string[]> = {}; (tt.data ?? []).forEach((x: any) => { const n = x.teachers?.full_name; if (n && !(st[x.class_id] ??= []).includes(n)) st[x.class_id].push(n) }); setStemT(st)
  }
  useEffect(() => { load() }, [])

  async function save(v: Record<string, string>) {
    const body: Record<string, unknown> = { name: v.name, grade: Number(v.grade), homeroom_teacher_id: v.homeroom_teacher_id || null }
    if (rooms.length) body.room_id = v.room_id || null
    let id = form && form !== 'new' ? form.id : ''
    if (id) { const { error } = await supabase.from('classes').update(body).eq('id', id); if (error) return error.message }
    else { const { data, error } = await supabase.from('classes').insert({ ...body, org_id: orgId, year_id: year?.id ?? null }).select('id').single(); if (error) return error.message; id = data.id }
    const list = (v.programs ?? '').split(',').map(s => s.trim().toUpperCase()).filter(p => /^CT[1-5]$/.test(p))
    await supabase.from('class_programs').delete().eq('class_id', id)
    if (list.length) await supabase.from('class_programs').insert([...new Set(list)].map(program => ({ org_id: orgId, class_id: id, program })))
    setForm(null); load()
  }
  async function remove(c: Row) {
    if (!confirm(`Xoá ${c.name}? Phân công và thời khóa biểu của lớp cũng bị xoá.`)) return
    const { error } = await supabase.from('classes').delete().eq('id', c.id)
    if (error) alert(error.message); else load()
  }

  // Nhập lớp từ Excel: lớp mới tạo trong năm học đang chọn; lớp đã có (cùng tên) cập nhật GVCN / chương trình nếu có ghi
  async function importRecords(recs: (Record<string, string> & { _line: number })[]) {
    const byName = new Map(rows.map(r => [norm(r.name), r]))
    const tByName = new Map<string, string | null>()
    teachers.forEach(t => { const k = norm(t.full_name); tByName.set(k, tByName.has(k) ? null : t.id) })   // trùng tên → không tự gán
    const tByEmail = new Map(teachers.filter(t => t.email).map(t => [t.email!.toLowerCase(), t.id]))
    const bad: string[] = []; const warn: string[] = []; let created = 0, updated = 0; const seen = new Set<string>()
    for (const r of recs) {
      const name = r.name.trim(); const k = norm(name)
      if (!name) { bad.push(`dòng ${r._line}: thiếu tên lớp`); continue }
      if (seen.has(k)) { bad.push(`dòng ${r._line}: lớp ${name} lặp lại`); continue }
      seen.add(k)
      const grade = r.grade ? Number(r.grade) : gradeOf(name)
      if (!grade || grade < 1 || grade > 12) { bad.push(`dòng ${r._line}: không rõ khối của ${name}`); continue }
      let hid: string | null | undefined
      if (r.gvcn.trim()) {
        hid = r.gvcn.includes('@') ? tByEmail.get(r.gvcn.trim().toLowerCase()) : tByName.get(norm(r.gvcn))
        if (!hid) { warn.push(`${name}: không tìm thấy (hoặc trùng tên) GVCN "${r.gvcn}"`); hid = undefined }
      }
      const progs = progList(r.programs)
      const roomId = r.room?.trim() ? rooms.find(x => norm(x.name) === norm(r.room) || norm(x.code ?? '') === norm(r.room))?.id : undefined
      if (r.room?.trim() && !roomId) warn.push(`${name}: không có phòng học "${r.room}"`)
      const old = byName.get(k)
      let id = old?.id
      if (old) {
        const body: Record<string, unknown> = {}
        if (hid) body.homeroom_teacher_id = hid
        if (r.grade) body.grade = grade
        if (roomId) body.room_id = roomId
        if (Object.keys(body).length) { const { error } = await supabase.from('classes').update(body).eq('id', old.id); if (error) { bad.push(`dòng ${r._line}: ${error.message}`); continue } }
        if (Object.keys(body).length || progs.length) updated++
      } else {
        const { data, error } = await supabase.from('classes').insert({ org_id: orgId, year_id: year?.id ?? null, name, grade, homeroom_teacher_id: hid ?? null, ...(roomId ? { room_id: roomId } : {}) }).select('id').single()
        if (error) { bad.push(`dòng ${r._line}: ${error.message}`); continue }
        id = data.id; created++
      }
      if (id && progs.length) {
        await supabase.from('class_programs').delete().eq('class_id', id)
        await supabase.from('class_programs').insert(progs.map(program => ({ org_id: orgId, class_id: id, program })))
      }
    }
    load()
    return importSummary(created, 'lớp mới', bad) + (updated ? ` Cập nhật ${updated} lớp đã có.` : '')
      + (warn.length ? ` Chưa gán: ${warn.slice(0, 4).join('; ')}${warn.length > 4 ? '…' : ''}.` : '')
  }
  async function exportXlsx() {
    await downloadXlsx('danh-sach-lop', [...COLS, { key: 'n', label: 'Sĩ số' }],
      shown.map(c => [c.name, c.grade, c.teachers?.full_name ?? '', (progs[c.id] ?? []).join(', '), roomOf(c), counts[c.id] ?? 0]))
  }

  const roomOf = (c: Row) => rooms.find(r => r.id === c.room_id)?.name ?? ''
  const shown = rows.filter(c => (c.name + (c.teachers?.full_name ?? '') + (stemT[c.id] ?? []).join(' ')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="bar">
        <input className="search" style={{ margin: 0 }} placeholder="Tìm lớp, GVCN, GV STEM…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="tools"><button onClick={k12Sync}>Đồng bộ K12</button>
          <ImportExcel columns={COLS} template="mau-nhap-lop" sample={[['6A1', '6', teachers[0]?.full_name ?? 'Nguyễn Thị Lan', 'CT1, CT3', 'Phòng 101'], ['6A2', '', '', '', '']]}
            onRecords={importRecords} onMessage={(m, e) => setMsg([m, !!e])} />
          <button onClick={exportXlsx} disabled={!rows.length}>Xuất Excel</button>
          <button className="primary" onClick={() => setForm('new')}>Thêm lớp</button></div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {year && <p className="sub covhint">Lớp nhập mới thuộc năm học {year.name}. Lớp đã có (trùng tên) chỉ cập nhật GVCN, khối, chương trình nếu file có ghi.</p>}
      <p className="sub">{shown.length} lớp · phân công giáo viên STEM · chương trình triển khai</p>
      {form && <FormPanel fields={[
        { key: 'name', label: 'Tên lớp', required: true, placeholder: 'VD: Lớp 6B' }, { key: 'grade', label: 'Khối', type: 'number', required: true },
        { key: 'homeroom_teacher_id', label: 'Giáo viên chủ nhiệm', type: 'select', options: teachers.map(t => ({ value: t.id, label: t.full_name })) },
        { key: 'programs', label: 'Chương trình STEM (VD: CT1,CT3)' },
        ...(rooms.length ? [{ key: 'room_id', label: 'Phòng học', type: 'select' as const, options: rooms.map(r => ({ value: r.id, label: r.name + (r.code ? ` (${r.code})` : '') })) }] : []),
      ]} initial={form === 'new' ? undefined : { name: form.name, grade: String(form.grade), homeroom_teacher_id: form.homeroom_teacher_id ?? '', programs: (progs[form.id] ?? []).join(','), room_id: form.room_id ?? '' }} onSubmit={save} onCancel={() => setForm(null)} />}
      <table>
        <thead><tr><th>Lớp</th><th>Khối</th><th>Sĩ số</th><th>Phòng học</th><th>GVCN</th><th>GV STEM</th><th>CT STEM</th><th></th></tr></thead>
        <tbody>
          {shown.map(c => (
            <tr key={c.id}><td><b>{c.name}</b><br /><small>{c.academic_years?.name}</small></td><td>{c.grade}</td><td>{counts[c.id] ?? 0} HS</td><td>{roomOf(c) || <small>—</small>}</td>
              <td>{c.teachers?.full_name ?? '—'}</td><td>{(stemT[c.id] ?? []).join(', ') || '—'}</td><td><ProgChips programs={(progs[c.id] ?? []).join(',')} /></td>
              <td><button onClick={() => setForm(c)}>Sửa</button> <button onClick={() => remove(c)}>Xoá</button></td></tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={8}>Chưa có lớp nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
