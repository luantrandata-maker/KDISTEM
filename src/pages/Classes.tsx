import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'
import { ProgChips } from '../components/Chips'
import { k12Sync } from '../lib/k12'
import { type Year, sameSchoolYear } from '../lib/year'

type Row = { id: string; year_id: string | null; name: string; grade: number; homeroom_teacher_id: string | null; teachers: { full_name: string } | null; academic_years: { name: string } | null }
type Teacher = { id: string; full_name: string }

export default function Classes({ orgId, year, years = [] }: { orgId: string; year?: Year | null; years?: Year[] }) {
  const [rows, setRows] = useState<Row[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [progs, setProgs] = useState<Record<string, string[]>>({})
  const [stemT, setStemT] = useState<Record<string, string[]>>({})
  const [form, setForm] = useState<Row | 'new' | null>(null)
  const [q, setQ] = useState('')

  async function load() {
    const [c, t, s, cp, tt] = await Promise.all([
      supabase.from('classes').select('id, year_id, name, grade, homeroom_teacher_id, teachers!classes_homeroom_teacher_id_fkey(full_name), academic_years(name)').order('name'),
      supabase.from('teachers').select('id, full_name').order('full_name'),
      supabase.from('students').select('class_id'),
      supabase.from('class_programs').select('class_id, program'),
      supabase.from('timetable_entries').select('class_id, teachers(full_name)').eq('kind', 'stem'),
    ])
    setRows(((c.data as unknown as Row[]) ?? []).filter(r => sameSchoolYear(years, r.year_id, year ?? null))); setTeachers((t.data as Teacher[]) ?? [])
    const m: Record<string, number> = {}; (s.data ?? []).forEach((x: any) => { m[x.class_id] = (m[x.class_id] ?? 0) + 1 }); setCounts(m)
    const p: Record<string, string[]> = {}; (cp.data ?? []).forEach((x: any) => { (p[x.class_id] ??= []).push(x.program) }); setProgs(p)
    const st: Record<string, string[]> = {}; (tt.data ?? []).forEach((x: any) => { const n = x.teachers?.full_name; if (n && !(st[x.class_id] ??= []).includes(n)) st[x.class_id].push(n) }); setStemT(st)
  }
  useEffect(() => { load() }, [])

  async function save(v: Record<string, string>) {
    const body = { name: v.name, grade: Number(v.grade), homeroom_teacher_id: v.homeroom_teacher_id || null }
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

  const shown = rows.filter(c => (c.name + (c.teachers?.full_name ?? '') + (stemT[c.id] ?? []).join(' ')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="bar">
        <input className="search" style={{ margin: 0 }} placeholder="Tìm lớp, GVCN, GV STEM…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="tools"><button onClick={k12Sync}>Đồng bộ K12</button><button className="primary" onClick={() => setForm('new')}>Thêm lớp</button></div>
      </div>
      <p className="sub">{shown.length} lớp · phân công giáo viên STEM · chương trình triển khai</p>
      {form && <FormPanel fields={[
        { key: 'name', label: 'Tên lớp', required: true, placeholder: 'VD: Lớp 6B' }, { key: 'grade', label: 'Khối', type: 'number', required: true },
        { key: 'homeroom_teacher_id', label: 'Giáo viên chủ nhiệm', type: 'select', options: teachers.map(t => ({ value: t.id, label: t.full_name })) },
        { key: 'programs', label: 'Chương trình STEM (VD: CT1,CT3)' },
      ]} initial={form === 'new' ? undefined : { name: form.name, grade: String(form.grade), homeroom_teacher_id: form.homeroom_teacher_id ?? '', programs: (progs[form.id] ?? []).join(',') }} onSubmit={save} onCancel={() => setForm(null)} />}
      <table>
        <thead><tr><th>Lớp</th><th>Khối</th><th>Sĩ số</th><th>GVCN</th><th>GV STEM</th><th>CT STEM</th><th></th></tr></thead>
        <tbody>
          {shown.map(c => (
            <tr key={c.id}><td><b>{c.name}</b><br /><small>{c.academic_years?.name}</small></td><td>{c.grade}</td><td>{counts[c.id] ?? 0} HS</td>
              <td>{c.teachers?.full_name ?? '—'}</td><td>{(stemT[c.id] ?? []).join(', ') || '—'}</td><td><ProgChips programs={(progs[c.id] ?? []).join(',')} /></td>
              <td><button onClick={() => setForm(c)}>Sửa</button> <button onClick={() => remove(c)}>Xoá</button></td></tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={7}>Chưa có lớp nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
