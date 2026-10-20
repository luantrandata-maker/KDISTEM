import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { LEVEL, errText, letter, type Level } from './common'

// Phân tích kết quả luyện thi (migration 061): câu hỏi khó và nội dung cần ôn tập theo chủ đề / mức độ.
type Hard = { question_id: string; stem: string; subject: string; grade: number | null; topic: string; level: Level; shown: number; correct: number; rate: number; students: number
  wrong_option: { index: number; label: string | null; times: number } | null }
type Topic = { subject: string; grade: number | null; topic: string; level: Level; questions: number; answers: number; rate: number; students: number; weak_students: number }
type F = { exam: string; cls: string; subject: string; grade: string; days: string; min: string }
const DAYS: [string, string][] = [['30', '30 ngày qua'], ['90', '3 tháng qua'], ['180', '6 tháng qua'], ['365', '12 tháng qua'], ['', 'Mọi thời gian']]
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
  return (
    <>
      <p className="sub">{kind === 'hard'
        ? 'Câu hỏi có tỉ lệ trả lời đúng thấp nhất trong các lượt đã nộp — xem lại đáp án, cách hỏi, hoặc dạy lại phần kiến thức đó. Phương án sai được chọn nhiều cho biết học sinh hay nhầm ở đâu.'
        : 'Tỉ lệ đúng theo chủ đề và mức độ, kèm số học sinh làm đúng dưới 50% — gợi ý nội dung cần ôn tập cho cả lớp hoặc cho nhóm học sinh yếu.'}</p>
      <div className="bar" style={{ margin: '12px 0' }}>
        <span className="tools">
          <select value={f.exam} onChange={e => setF({ ...f, exam: e.target.value })} aria-label="Đề luyện"><option value="">Mọi đề luyện</option>{exams.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
          {classes.length > 0 && <select value={f.cls} onChange={e => setF({ ...f, cls: e.target.value })} aria-label="Lớp"><option value="">Mọi lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          <select value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} aria-label="Môn"><option value="">Mọi môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
          <select value={f.grade} onChange={e => setF({ ...f, grade: e.target.value })} aria-label="Khối"><option value="">Mọi khối</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>Khối {i + 1}</option>)}</select>
          <select value={f.days} onChange={e => setF({ ...f, days: e.target.value })} aria-label="Thời gian">{DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {kind === 'hard' && <select value={f.min} onChange={e => setF({ ...f, min: e.target.value })} aria-label="Số lượt tối thiểu">{['1', '3', '5', '10', '20'].map(v => <option key={v} value={v}>Từ {v} lượt trả lời</option>)}</select>}
        </span>
        <button onClick={exportXlsx} disabled={!rows?.length}>Xuất Excel</button>
      </div>
      {err && <p className="msg">{err}</p>}
      {!rows ? <p className="sub">Đang tải…</p> : kind === 'hard' ? <HardTable rows={hard!} wrong={wrong} /> : <TopicTable rows={topics!} />}
    </>
  )
}

function HardTable({ rows, wrong }: { rows: Hard[]; wrong: (h: Hard) => string }) {
  return <div className="wrap"><table className="systable">
    <thead><tr><th>Câu hỏi</th><th>Chủ đề</th><th>Mức độ</th><th className="num">Lượt trả lời</th><th style={{ minWidth: 140 }}>% đúng</th><th>Phương án sai chọn nhiều nhất</th></tr></thead>
    <tbody>{rows.map(h => <tr key={h.question_id}>
      <td style={{ maxWidth: 420 }}>{h.stem}<br /><small>{[h.subject, h.grade ? 'Khối ' + h.grade : null].filter(Boolean).join(' · ')}</small></td>
      <td>{h.topic}</td><td>{LEVEL[h.level] ?? h.level}</td>
      <td className="num">{h.shown}<br /><small>{h.students} HS</small></td>
      <td><Rate r={Number(h.rate)} /></td>
      <td>{h.wrong_option ? <>{wrong(h)}<br /><small>{h.wrong_option.times} lần chọn</small></> : <small>{h.correct < h.shown ? 'Bỏ trống hoặc chọn thiếu đáp án' : '—'}</small>}</td>
    </tr>)}
      {!rows.length && <tr><td colSpan={6}>Chưa đủ dữ liệu — cần các lượt làm bài đã nộp trong khoảng thời gian đã chọn.</td></tr>}
    </tbody>
  </table></div>
}

function TopicTable({ rows }: { rows: Topic[] }) {
  const weak = rows.filter(t => Number(t.rate) < 50)
  return <>
    {rows.length > 0 && <div className="cards syscards">
      <div className="card"><strong>{rows.length}</strong><span>Chủ đề × mức độ có dữ liệu</span></div>
      <div className="card"><strong>{weak.length}</strong><span>Dưới 50% đúng — cần ôn</span></div>
      <div className="card"><strong>{rows.reduce((n, t) => n + t.answers, 0)}</strong><span>Lượt trả lời được phân tích</span></div>
    </div>}
    <div className="wrap"><table className="systable">
      <thead><tr><th>Chủ đề</th><th>Môn · Khối</th><th>Mức độ</th><th className="num">Số câu</th><th className="num">Lượt trả lời</th><th style={{ minWidth: 140 }}>% đúng</th><th className="num">HS dưới 50%</th></tr></thead>
      <tbody>{rows.map(t => <tr key={`${t.subject}|${t.grade}|${t.topic}|${t.level}`}>
        <td><b>{t.topic}</b></td><td>{t.subject}{t.grade ? ` · Khối ${t.grade}` : ''}</td><td>{LEVEL[t.level] ?? t.level}</td>
        <td className="num">{t.questions}</td><td className="num">{t.answers}</td><td><Rate r={Number(t.rate)} /></td>
        <td className="num">{t.weak_students ? <b className="late">{t.weak_students}</b> : 0}<small>/{t.students}</small></td>
      </tr>)}
        {!rows.length && <tr><td colSpan={7}>Chưa có lượt làm bài đã nộp trong khoảng thời gian đã chọn.</td></tr>}
      </tbody>
    </table></div>
  </>
}
