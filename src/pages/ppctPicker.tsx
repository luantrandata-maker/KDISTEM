import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Chọn tiết theo phân phối chương trình khi điểm danh (057). Tách riêng để màn điểm danh không phải tải cả màn PPCT.
const norm = (s: string) => s.normalize('NFC').trim().toLowerCase()
type Kind = 'lesson' | 'stem' | 'practice' | 'review' | 'test'
const KIND: Record<Kind, string> = { lesson: 'Bài học', stem: 'Chủ đề STEM', practice: 'Thực hành', review: 'Ôn tập', test: 'Kiểm tra' }

type PickLesson = { id: string; seq: number; title: string; kind: Kind }
export function usePpctForSession(session: { id: string; org_id: string; class_id: string; subject: string; grade?: number | null }) {
  const [state, setState] = useState<{ book: { id: string; title: string } | null; lessons: PickLesson[]; current: string | null; next: PickLesson | null; done: Set<string> } | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      const [ses, cls] = await Promise.all([
        supabase.from('teaching_sessions').select('curriculum_lesson_id').eq('id', session.id).maybeSingle(),
        session.grade != null ? Promise.resolve({ data: { grade: session.grade } }) : supabase.from('classes').select('grade').eq('id', session.class_id).maybeSingle(),
      ])
      if ((ses as any).error) { if (live) setState({ book: null, lessons: [], current: null, next: null, done: new Set() }); return }   // CSDL chưa có 057
      const grade = (cls.data as any)?.grade
      const { data: books } = await supabase.from('curriculum_books').select('id, title, subject, year_name, updated_at')
        .eq('org_id', session.org_id).eq('grade', grade).eq('status', 'published')
      const book = ((books as any[]) ?? []).filter(b => norm(b.subject) === norm(session.subject))
        .sort((a, b) => (a.year_name ? 0 : 1) - (b.year_name ? 0 : 1) || String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null
      if (!book) { if (live) setState({ book: null, lessons: [], current: ses.data?.curriculum_lesson_id ?? null, next: null, done: new Set() }); return }
      const [ls, used] = await Promise.all([
        supabase.from('curriculum_lessons').select('id, seq, title, kind').eq('book_id', book.id).order('seq'),
        supabase.from('teaching_sessions').select('id, curriculum_lesson_id').eq('class_id', session.class_id).eq('status', 'taught').not('curriculum_lesson_id', 'is', null),
      ])
      const lessons = (ls.data as PickLesson[]) ?? []
      const others = ((used.data as any[]) ?? []).filter(u => u.id !== session.id).map(u => u.curriculum_lesson_id as string)
      const done = new Set(others)
      const maxSeq = Math.max(0, ...lessons.filter(l => done.has(l.id)).map(l => l.seq))
      if (live) setState({ book, lessons, current: ses.data?.curriculum_lesson_id ?? null, next: lessons.find(l => l.seq > maxSeq) ?? null, done })
    })()
    return () => { live = false }
  }, [session.id])
  return state
}

export function PpctPicker({ ppct, value, onChange }: { ppct: ReturnType<typeof usePpctForSession>; value: string; onChange: (v: string) => void }) {
  if (!ppct?.book || !ppct.lessons.length) return null
  return (
    <label className="field" style={{ marginTop: 10 }}><span>Tiết theo phân phối chương trình</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {!ppct.current && <option value="">Tự động: {ppct.next ? `Tiết ${ppct.next.seq} — ${ppct.next.title}` : 'đã dạy hết PPCT'}</option>}
        {ppct.lessons.map(l => <option key={l.id} value={l.id}>Tiết {l.seq} — {l.title}{ppct.done.has(l.id) ? ' (đã dạy)' : ''}{l.kind !== 'lesson' ? ` · ${KIND[l.kind]}` : ''}</option>)}
      </select>
      <small className="sub">{ppct.book.title}</small>
    </label>
  )
}
