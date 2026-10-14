import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Counts = { teachers: number; classes: number; rooms: number; units: number; broken: number }

async function count(table: string, filter?: [string, string]) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true })
  if (filter) q = q.eq(filter[0], filter[1])
  const { count: c } = await q
  return c ?? 0
}

export default function Dashboard() {
  const [c, setC] = useState<Counts | null>(null)
  useEffect(() => {
    Promise.all([
      count('teachers'), count('classes'), count('stem_rooms'),
      count('equipment_units'), count('equipment_units', ['status', 'broken']),
    ]).then(([teachers, classes, rooms, units, broken]) => setC({ teachers, classes, rooms, units, broken }))
  }, [])

  if (!c) return <p>Đang tải số liệu…</p>
  const cards: [string, number][] = [
    ['Giáo viên', c.teachers], ['Lớp học', c.classes], ['Phòng STEM', c.rooms],
    ['Thiết bị', c.units], ['Thiết bị hỏng', c.broken],
  ]
  return (
    <div className="cards">
      {cards.map(([label, n]) => (
        <div className="card" key={label}><strong>{n}</strong><span>{label}</span></div>
      ))}
    </div>
  )
}
