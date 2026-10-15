import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export type TProps = { teacherId: string | null; orgId: string | null; go?: (page: string) => void }
export type MyClass = { id: string; name: string; grade: number; subjects: string[] }

export const NoTeacher = () => <p className="sub">Tài khoản này chưa được liên kết với hồ sơ giáo viên. Quản trị trường liên kết trong mục Tài khoản.</p>

export const KIND_LABEL: Record<string, string> = {
  worksheet: 'Phiếu HT', product: 'Sản phẩm', quiz: 'Kiểm tra', report: 'Báo cáo', homework: 'Bài về nhà', self_review: 'Tự đánh giá',
}
export const PROGRAM_COLOR: Record<string, string> = { CT1: '#64748b', CT2: '#2e95f2', CT3: '#7c3aed', CT4: '#dc2626', CT5: '#16a34a' }

// Lớp giáo viên được phân công dạy (gộp các môn)
export function useMyClasses(teacherId: string | null) {
  const [classes, setClasses] = useState<MyClass[]>([])
  useEffect(() => {
    if (!teacherId) return
    supabase.from('teaching_assignments').select('subject, classes(id, name, grade)').eq('teacher_id', teacherId).then(({ data }) => {
      const m = new Map<string, MyClass>()
      ;((data as any[]) ?? []).forEach(r => {
        if (!r.classes) return
        const c = m.get(r.classes.id) ?? { ...r.classes, subjects: [] }
        c.subjects.push(r.subject); m.set(c.id, c)
      })
      setClasses([...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi')))
    })
  }, [teacherId])
  return classes
}

const DAY = 86400000
const p2 = (n: number) => String(n).padStart(2, '0')
export const fmtDM = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`
export const fmtHM = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`
export const fmtDMY = (d: Date) => `${fmtDM(d)}/${d.getFullYear()}`
// "14/10 15:18"
export const fmtDateTime = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return `${fmtDM(d)} ${fmtHM(d)}` }

// "Quá hạn 3 ngày" / "Hạn hôm nay 23:59" / "Hạn 20/10"
export function dueLabel(due: string | null): { text: string; tone: '' | 'warn' | 'bad' } {
  if (!due) return { text: 'Không hạn', tone: '' }
  const d = new Date(due), now = Date.now(), diff = d.getTime() - now
  const hm = fmtHM(d)
  if (diff < 0) return { text: `Quá hạn ${Math.max(1, Math.floor(-diff / DAY))} ngày · ${fmtDMY(d)}`, tone: 'bad' }
  const sameDay = new Date().toDateString() === d.toDateString()
  if (sameDay) return { text: `Hạn hôm nay ${hm}`, tone: 'warn' }
  const tomorrow = new Date(Date.now() + DAY).toDateString() === d.toDateString()
  if (tomorrow) return { text: `Hạn ngày mai ${hm}`, tone: 'warn' }
  if (diff <= 3 * DAY) return { text: `Hạn ${fmtDM(d)} ${hm}`, tone: 'warn' }
  return { text: `Hạn ${fmtDMY(d)}`, tone: '' }
}

// Chuyển ngữ cảnh giữa các màn (vd: Bài tập → Chấm bài của một đề)
export const handoff = {
  set(key: string, value: string) { try { sessionStorage.setItem('handoff.' + key, value) } catch { /* bỏ qua */ } },
  take(key: string) { try { const v = sessionStorage.getItem('handoff.' + key); sessionStorage.removeItem('handoff.' + key); return v } catch { return null } },
}

export function Tabs<T extends string>({ items, value, onChange }: { items: [T, string, number?][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {items.map(([k, l, n]) => (
        <button type="button" key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {l}{n !== undefined && <span className="count">{n}</span>}
        </button>
      ))}
    </div>
  )
}
