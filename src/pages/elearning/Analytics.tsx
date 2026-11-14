import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { LEVEL, errText, letter, type Level } from './common'
import { DataTable, type Col } from '../../components/DataTable'
import { useGradeTree } from '../../components/GradeTree'
import { StatCards } from '../../components/StatCards'

// Phân tích kết quả luyện thi (migration 061): câu hỏi khó và nội dung cần ôn tập theo chủ đề / mức độ.
type Hard = { question_id: string; stem: string; subject: string; grade: number | null; topic: string; level: Level; shown: number; correct: number; rate: number; students: number
  wrong_option: { index: number; label: string | null; times: number } | null }
type Topic = { subject: string; grade: number | null; topic: string; level: Level; questions: number; answers: number; rate: number; students: number; weak_students: number }
type F = { exam: string; cls: string; subject: string; grade: string; days: string; min: string }
const DAYS: [string, string][] = [['30', '30 ngày qua'], ['90', '3 tháng qua'], ['180', '6 tháng qua'], ['365', '12 tháng qua'], ['', 'Tất cả thời gian']]
const tone = (r: number) => (r < 40 ? 'var(--bad)' : r < 60 ? '#d98a12' : 'var(--ok)')
const Rate = ({ r }: { r: number }) => <span className="ibar"><i style={{ width: r + '%', background: tone(r) }} /><b>{r}%</b></span>

export default function Analytics({ orgId, kind }: { orgId: string | null; kind: 'hard' | 'review' }) {
  const [f, setF] = useState<F>({ exam: '', cls: '', subject: '', grade: '', days: '180', min: '3' })
  const [exams, setExams] = useState<{ id: string; title: string }[]>([])
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [subjects, setSubjects] = useState<string[]>([])
  const [hard, setHard] = useState<Hard[] | null>(null)
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('practice_exams').select('id, title').neq('status', 'draft').order('created_at', { ascending: false }).then(({ data }) => setExams((data as any[]) ?? []))
    if (orgId) supabase.from('classes').select('id, name').eq('org_id', orgId).order('grade').order('name').then(({ data }) => setClasses((data as any[]) ?? []))
    supabase.from('question_bank').select('subject').limit(5000).then(({ data }) => setSubjects([...new Set(((data as any[]) ?? []).map(x => x.subject as string))].sort((a, b) => a.localeCompare(b, 'vi'))))
  }, [orgId])
  useEffect(() => {
    const p = { p_exam: f.exam || null, p_class: f.cls || null, p_subject: f.subject || null, p_grade: f.grade ? Number(f.grade) : null, p_days: f.days ? Number(f.days) : null }
    setErr('')
    if (kind === 'hard') { setHard(null); supabase.rpc('elearning_hard_questions', { ...p, p_min: Number(f.min) }).then(({ data, error }) => { if (error) setErr(errText(error.message, '061')); setHard((data as Hard[]) ?? []) }) }
    else { setTopics(null); supabase.rpc('elearning_topic_stats', p).then(({ data, error }) => { if (error) setErr(errText(error.message, '061')); setTopics((data as Topic[]) ?? []) }) }
  }, [kind, f])
  const wrong = (h: Hard) => (h.wrong_option ? `${letter(h.wrong_option.index)}. ${h.wrong_option.label ?? ''}` : '')
  function exportXlsx() {
    if (kind === 'hard' && hard) downloadXlsx('cau-hoi-kho', [{ key: 'a', label: 'Câu hỏi', width: 60 }, { key: 'b', label: 'Môn' }, { key: 'c', label: 'Khối' }, { key: 'd', label: 'Chủ đề', width: 26 },
      { key: 'e', label: 'Mức độ' }, { key: 'f', label: 'Lượt trả lời' }, { key: 'g', label: 'Số HS' }, { key: 'h', label: '% đúng' }, { key: 'i', label: 'Phương án sai chọn nhiều nhất', width: 30 }, { key: 'j', label: 'Số lần chọn' }],
      hard.map(h => [h.stem, h.subject, h.grade, h.topic, LEVEL[h.level] ?? h.level, h.shown, h.students, h.rate, wrong(h), h.wrong_option?.times]), 'Câu hỏi khó')
    if (kind === 'review' && topics) downloadXlsx('noi-dung-can-on', [{ key: 'a', label: 'Môn' }, { key: 'b', label: 'Khối' }, { key: 'c', label: 'Chủ đề', width: 30 }, { key: 'd', label: 'Mức độ' },
      { key: 'e', label: 'Số câu' }, { key: 'f', label: 'Lượt trả lời' }, { key: 'g', label: '% đúng' }, { key: 'h', label: 'Số HS' }, { key: 'i', label: 'HS dưới 50%' }],
      topics.map(t => [t.subject, t.grade, t.topic, LEVEL[t.level] ?? t.level, t.questions, t.answers, t.rate, t.students, t.weak_students]), 'Nội dung cần ôn')
  }
  const rows = kind === 'hard' ? hard : topics
  const gHard = useGradeTree('el-hard', hard ?? [], h => h.grade ? [h.grade] : [])
  const gTopic = useGradeTree('el-review', topics ?? [], t => t.grade ? [t.grade] : [])
  const left = <>
    <select value={f.exam} onChange={e => setF({ ...f, exam: e.target.value })} aria-label="Đề luyện"><option value="">Tất cả đề luyện</option>{exams.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
    {classes.length > 0 && <select value={f.cls} onChange={e => setF({ ...f, cls: e.target.value })} aria-label="Lớp"><option value="">Tất cả lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
    <select value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} aria-label="Môn"><option value="">Tất cả môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
    <select value={f.days} onChange={e => setF({ ...f, days: e.target.value })} aria-label="Thời gian">{DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    {kind === 'hard' && <select value={f.min} onChange={e => setF({ ...f, min: e.target.value })} aria-label="Số lượt tối thiểu">{['1', '3', '5', '10', '20'].map(v => <option key={v} value={v}>Từ {v} lượt trả lời</option>)}</select>}
  </>
  const right = <button type="button" onClick={exportXlsx} disabled={!rows?.length}>Xuất Excel</button>
  return (
    <>
      {/* Bộ lọc tải dữ liệu nằm trên thanh công cụ của bảng như các bảng khác */}
      {err && <p className="msg">{err}</p>}
      {!rows ? <><div className="bar"><div className="tools">{left}</div></div><p className="sub">Đang tải…</p></>
        : kind === 'hard' ? <HardTable rows={hard!} wrong={wrong} gt={gHard} left={left} right={right} /> : <TopicTable rows={topics!} gt={gTopic} left={left} right={right} />}
    </>
  )
}

type Tree<T> = ReturnType<typeof useGradeTree<T>>
const rateText = (r: number) => (r < 50 ? 'Dưới 50%' : r < 80 ? '50–79%' : 'Từ 80%')

function HardTable({ rows, wrong, gt, left, right }: { rows: Hard[]; wrong: (h: Hard) => string; gt: Tree<Hard>; left: ReactNode; right: ReactNode }) {
  return <DataTable id="el-hard" left={left} right={right} rows={gt.filter(rows)} rowKey={h => h.question_id} aside={rows.length ? gt.tree : undefined}
    empty="Chưa đủ dữ liệu — cần các lượt làm bài đã nộp trong khoảng thời gian đã chọn."
    cols={[
      { key: 'q', label: 'Câu hỏi', fixed: true, text: h => h.stem, values: h => [h.stem],
        cell: h => <span style={{ display: 'block', maxWidth: 420 }}>{h.stem}<br /><small>{[h.subject, h.grade ? 'Khối ' + h.grade : null].filter(Boolean).join(' · ')}</small></span> },
      { key: 'subj', label: 'Môn', off: true, text: h => h.subject, cell: h => h.subject },
      { key: 'topic', label: 'Chủ đề', text: h => h.topic, cell: h => h.topic },
      { key: 'lv', label: 'Mức độ', text: h => LEVEL[h.level] ?? h.level, cell: h => LEVEL[h.level] ?? h.level },
      { key: 'n', label: 'Lượt trả lời', thClass: 'num', cell: h => <span className="num">{h.shown}<br /><small>{h.students} HS</small></span> },
      { key: 'rate', label: '% đúng', thClass: 'c-rate', text: h => rateText(Number(h.rate)), cell: h => <Rate r={Number(h.rate)} /> },
      { key: 'wrong', label: 'Phương án sai chọn nhiều nhất', text: h => wrong(h),
        cell: h => h.wrong_option ? <>{wrong(h)}<br /><small>{h.wrong_option.times} lần chọn</small></> : <small>{h.correct < h.shown ? 'Bỏ trống hoặc chọn thiếu đáp án' : '—'}</small> },
    ] as Col<Hard>[]} />
}

function TopicTable({ rows, gt, left, right }: { rows: Topic[]; gt: Tree<Topic>; left: ReactNode; right: ReactNode }) {
  const weak = rows.filter(t => Number(t.rate) < 50)
  return <>
    {rows.length > 0 && <StatCards items={[
      { icon: 'grid', value: rows.length, label: 'Chủ đề × mức độ', sub: 'Có dữ liệu làm bài' },
      { icon: 'alert', tone: weak.length ? 'warn' : 'good', value: weak.length, label: 'Cần ôn', sub: 'Dưới 50% trả lời đúng' },
      { icon: 'chart', value: rows.reduce((n, t) => n + t.answers, 0), label: 'Lượt trả lời', sub: 'Được phân tích' },
    ]} />}
    <DataTable id="el-review" left={left} right={right} rows={gt.filter(rows)} rowKey={t => `${t.subject}|${t.grade}|${t.topic}|${t.level}`} aside={rows.length ? gt.tree : undefined}
      empty="Chưa có lượt làm bài đã nộp trong khoảng thời gian đã chọn."
      cols={[
        { key: 'topic', label: 'Chủ đề', fixed: true, text: t => t.topic, cell: t => <b>{t.topic}</b> },
        { key: 'subj', label: 'Môn', text: t => t.subject, cell: t => t.subject },
        { key: 'grade', label: 'Khối', text: t => t.grade ? String(t.grade) : '', cell: t => t.grade || '—' },
        { key: 'lv', label: 'Mức độ', text: t => LEVEL[t.level] ?? t.level, cell: t => LEVEL[t.level] ?? t.level },
        { key: 'q', label: 'Số câu', thClass: 'num', cell: t => <span className="num">{t.questions}</span> },
        { key: 'a', label: 'Lượt trả lời', thClass: 'num', cell: t => <span className="num">{t.answers}</span> },
        { key: 'rate', label: '% đúng', thClass: 'c-rate', text: t => rateText(Number(t.rate)), cell: t => <Rate r={Number(t.rate)} /> },
        { key: 'weak', label: 'HS dưới 50%', thClass: 'num', cell: t => <span className="num">{t.weak_students ? <b className="late">{t.weak_students}</b> : 0}<small>/{t.students}</small></span> },
      ] as Col<Topic>[]} />
  </>
}
