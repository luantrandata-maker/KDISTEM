import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Row = { id: string; name: string; grade: number; teaching_assignments: { subject: string; teachers: { full_name: string } | null }[] }

export default function Classes() {
  const [rows, setRows] = useState<Row[]>([])
  useEffect(() => {
    supabase.from('classes')
      .select('id, name, grade, teaching_assignments(subject, teachers(full_name))')
      .order('name')
      .then(({ data }) => setRows((data as unknown as Row[]) ?? []))
  }, [])
  return (
    <table>
      <thead><tr><th>Lớp</th><th>Khối</th><th>Giáo viên bộ môn</th></tr></thead>
      <tbody>
        {rows.map(c => (
          <tr key={c.id}>
            <td><b>{c.name}</b></td><td>Khối {c.grade}</td>
            <td>{c.teaching_assignments.map(a => `${a.teachers?.full_name ?? '?'} (${a.subject})`).join(', ') || '—'}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={3}>Chưa có lớp nào.</td></tr>}
      </tbody>
    </table>
  )
}
