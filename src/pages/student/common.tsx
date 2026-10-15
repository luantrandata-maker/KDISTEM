import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Year } from '../../lib/year'

export type SProps = { studentId: string | null; orgId: string | null; go?: (page: string) => void; year?: Year | null; userName?: string }
export type Me = { id: string; full_name: string; student_code: string | null; class_id: string | null; class_name: string; groups: { id: string; name: string }[] }
export type Topic = {
  id: string; title: string; subject: string | null; program: string | null; status: 'planned' | 'active' | 'done'; starts_on: string | null; summary: string | null
  teachers: { full_name: string } | null
}
export type Lesson = { id: string; topic_id: string; seq: number; title: string; minutes: number; scheduled_on: string | null; bring_items: string | null; stem_rooms: { name: string } | null }

export const NoStudent = () => <p className="sub">Tài khoản này chưa được liên kết với hồ sơ học sinh. Hãy nhờ thầy cô hoặc quản trị trường liên kết trong mục Tài khoản.</p>

// Hồ sơ học sinh đang xem (của chính mình, hoặc học sinh quản trị chọn để xem thử)
export function useMe(studentId: string | null) {
  const [me, setMe] = useState<Me | null>(null)
  useEffect(() => {
    if (!studentId) return setMe(null)
    Promise.all([
      supabase.from('students').select('id, full_name, student_code, class_id, classes(name)').eq('id', studentId).maybeSingle(),
      supabase.from('student_group_members').select('student_groups(id, name)').eq('student_id', studentId),
    ]).then(([s, g]) => {
      const st = s.data as any
      if (!st) return setMe(null)
      setMe({ id: st.id, full_name: st.full_name, student_code: st.student_code, class_id: st.class_id, class_name: st.classes?.name ?? '',
        groups: ((g.data as any[]) ?? []).map(x => x.student_groups).filter(Boolean) })
    })
  }, [studentId])
  return me
}

// Chủ đề + buổi học + tiến độ của học sinh
export function useTopics(me: Me | null) {
  const [topics, setTopics] = useState<Topic[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [done, setDone] = useState<Set<string>>(new Set())
  async function reload() {
    if (!me?.class_id) return
    const t = await supabase.from('class_topics').select('id, title, subject, program, status, starts_on, summary, teachers(full_name)').eq('class_id', me.class_id).order('starts_on')
    const ts = (t.data as unknown as Topic[]) ?? []
    const ids = ts.map(x => x.id)
    const [l, p] = await Promise.all([
      ids.length ? supabase.from('topic_lessons').select('id, topic_id, seq, title, minutes, scheduled_on, bring_items, stem_rooms(name)').in('topic_id', ids).order('seq') : Promise.resolve({ data: [] }),
      supabase.from('lesson_progress').select('lesson_id, status').eq('student_id', me.id),
    ])
    setTopics(ts); setLessons((l.data as unknown as Lesson[]) ?? [])
    setDone(new Set(((p.data as { lesson_id: string; status: string }[]) ?? []).filter(x => x.status === 'done').map(x => x.lesson_id)))
  }
  useEffect(() => { reload() }, [me?.id])
  const progress = (topicId: string) => {
    const ls = lessons.filter(l => l.topic_id === topicId)
    return ls.length ? Math.round(100 * ls.filter(l => done.has(l.id)).length / ls.length) : 0
  }
  const nextLesson = (topicId: string) => lessons.filter(l => l.topic_id === topicId && !done.has(l.id)).sort((a, b) => a.seq - b.seq)[0]
  return { topics, lessons, done, progress, nextLesson, reload }
}

export const SUBJECT_TINT: Record<string, string> = {
  'Công nghệ': '#e6f6ee', 'Tin học': '#fde9f1', 'Khoa học tự nhiên': '#efe8fd', 'Hoá học': '#fff3df', 'Vật lý': '#e6f1fd', 'Toán': '#e6f1fd', STEM: '#fff3df',
}
export const tint = (s: string | null) => SUBJECT_TINT[s ?? ''] ?? '#eef3f8'
export const vnDate = (d: string | null) => d ? d.split('-').reverse().slice(0, 2).join('/') : ''
