// Ma trận đề kiểm tra (109): mỗi dòng = chủ đề × mức độ × số câu, rút ngẫu nhiên từ Ngân hàng câu hỏi.
// Bảng "Ngân hàng đang có" cho biết số câu sẵn có từng ô; bấm một ô để thêm dòng.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export type MRow = { topic: string; level: string; count: number; subject?: string }
export const LEVELS: [string, string][] = [['nhan_biet', 'Nhận biết'], ['thong_hieu', 'Thông hiểu'], ['van_dung', 'Vận dụng'], ['van_dung_cao', 'Vận dụng cao']]
export const levelName = (k: string) => LEVELS.find(l => l[0] === k)?.[1] ?? 'Mọi mức độ'
type Stat = { subject: string; topic: string; level: string; n: number }

/** Các môn có câu hỏi dùng được của đơn vị */
export function useBankSubjects(org: string | null | undefined) {
  const [list, setList] = useState<{ subject: string; n: number }[]>([])
  useEffect(() => {
    if (!org) return
    supabase.rpc('exam_bank_subjects', { p_org: org }).then(({ data }) => setList((data as { subject: string; n: number }[]) ?? []))
  }, [org])
  return list
}

/** Số câu sẵn có theo môn × chủ đề × mức độ, lọc theo các môn và các khối của đề (123) */
export function useBankStats(org: string | null | undefined, subjects: string[], grades: number[]) {
  const [stats, setStats] = useState<Stat[] | null>(null)
  const key = subjects.join('|') + '#' + grades.join(',')
  useEffect(() => {
    if (!org || !subjects.length) { setStats([]); return }
    setStats(null)
    supabase.rpc('exam_bank_stats_multi', { p_org: org, p_subjects: subjects, p_grades: grades }).then(async ({ data, error }) => {
      if (!error) return setStats((data as Stat[]) ?? [])
      // CSDL chưa chạy 123: đếm theo môn đầu, khối đầu như trước
      const r = await supabase.rpc('exam_bank_stats', { p_org: org, p_subject: subjects[0], p_grade: grades[0] ?? null })
      setStats(((r.data as Omit<Stat, 'subject'>[]) ?? []).map(x => ({ ...x, subject: subjects[0] })))
    })
  }, [org, key])
  return stats
}

/** Môn / khối của đề: danh sách mới (123) hoặc một môn / một khối cũ */
export const listSubjects = (x: { subject?: string | null; subjects?: string[] | null } | null | undefined) => x?.subjects?.length ? x.subjects : x?.subject?.trim() ? [x.subject.trim()] : []
export const listGrades = (x: { grade?: number | null; grades?: number[] | null } | null | undefined) => x?.grades?.length ? x.grades : x?.grade ? [x.grade] : []
/** Dòng ma trận gửi lên: bỏ môn trống */
export const cleanMatrix = (rows: MRow[]) => rows.map(r => ({ ...(r.subject ? { subject: r.subject } : {}), topic: r.topic, level: r.level, count: r.count }))

export const matrixTotal = (rows: MRow[]) => rows.reduce((a, r) => a + (Number(r.count) || 0), 0)
export const matrixText = (rows: MRow[]) => rows.map(r => `${r.count} câu ${r.subject ? r.subject + ' · ' : ''}${r.topic || 'mọi chủ đề'} · ${levelName(r.level).toLowerCase()}`).join('; ')

export function ExamMatrix({ org, subjects, grades, rows, onChange, disabled }: {
  org: string | null | undefined; subjects: string[]; grades: number[]; rows: MRow[]; onChange: (r: MRow[]) => void; disabled?: boolean
}) {
  const stats = useBankStats(org, subjects, grades)
  const multi = subjects.length > 1
  const inSub = (sub: string) => (st: Stat) => (sub ? st.subject === sub : true)
  const topicsOf = (sub: string) => [...new Set((stats ?? []).filter(inSub(sub)).map(s => s.topic))].sort((a, b) => a.localeCompare(b, 'vi'))
  // Bảng ngân hàng: mỗi dòng là một môn × chủ đề
  const pairs = useMemo(() => [...new Map((stats ?? []).map(s => [s.subject + '\u0001' + s.topic, [s.subject, s.topic] as const])).values()]
    .sort((a, b) => a[0].localeCompare(b[0], 'vi') || a[1].localeCompare(b[1], 'vi')), [stats])
  const avail = (sub: string, topic: string, level: string) => (stats ?? []).filter(s => inSub(sub)(s) && (!topic || s.topic === topic) && (!level || s.level === level)).reduce((a, s) => a + s.n, 0)
  const cell = (sub: string, topic: string, level: string) => (stats ?? []).find(s => s.subject === sub && s.topic === topic && s.level === level)?.n ?? 0
  const set = (i: number, p: Partial<MRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const add = (subject = '', topic = '', level = '') => onChange([...rows, { ...(multi && subject ? { subject } : {}), topic, level, count: 1 }])
  const cols = (multi ? 1 : 0) + (disabled ? 4 : 5)

  return <div style={{ display: 'grid', gap: 10 }}>
    {!subjects.length ? <p className="sub" style={{ margin: 0 }}>Chọn môn để xem câu hỏi trong ngân hàng.</p>
      : stats === null ? <p className="sub" style={{ margin: 0 }}>Đang đếm câu hỏi…</p>
      : !stats.length ? <p className="warnline" style={{ margin: 0 }}>Ngân hàng chưa có câu hỏi sẵn sàng của {multi ? 'các môn' : 'môn'} này{grades.length ? `, khối ${grades.join(', ')}` : ''}. Thêm câu hỏi ở mục E-learning › Ngân hàng câu hỏi.</p>
      : <div className="wrap"><table>
        <caption style={{ textAlign: 'left' }}><small className="sub">Ngân hàng đang có (bấm một ô để thêm vào ma trận)</small></caption>
        <thead><tr>{multi && <th>Môn</th>}<th>Chủ đề</th>{LEVELS.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Cộng</th></tr></thead>
        <tbody>{pairs.map(([sub, t]) => <tr key={sub + t}>{multi && <td>{sub}</td>}<td>{t || <i className="sub">Chưa gắn chủ đề</i>}</td>
          {LEVELS.map(([k]) => <td key={k} className="num">{cell(sub, t, k) ? <button type="button" className="linkbtn" disabled={disabled} onClick={() => add(sub, t, k)}>{cell(sub, t, k)}</button> : <small className="sub">0</small>}</td>)}
          <td className="num"><b>{avail(sub, t, '')}</b></td></tr>)}</tbody>
      </table></div>}
    <div className="wrap"><table>
      <thead><tr>{multi && <th>Môn</th>}<th>Chủ đề</th><th>Mức độ</th><th className="num">Số câu</th><th>Ngân hàng có</th>{!disabled && <th></th>}</tr></thead>
      <tbody>{rows.map((r, i) => { const sub = r.subject ?? '', a = avail(sub, r.topic, r.level), topics = topicsOf(sub); return <tr key={i}>
        {multi && <td>{disabled ? sub || 'Mọi môn của đề' : <select value={sub} onChange={e => set(i, { subject: e.target.value || undefined, topic: '' })} aria-label="Môn">
          <option value="">Mọi môn của đề</option>{subjects.map(x => <option key={x}>{x}</option>)}
          {sub && !subjects.includes(sub) && <option>{sub}</option>}</select>}</td>}
        <td>{disabled ? r.topic || 'Mọi chủ đề' : <select value={r.topic} onChange={e => set(i, { topic: e.target.value })} aria-label="Chủ đề">
          <option value="">Mọi chủ đề</option>{topics.filter(Boolean).map(t => <option key={t}>{t}</option>)}
          {r.topic && !topics.includes(r.topic) && <option>{r.topic}</option>}</select>}</td>
        <td>{disabled ? levelName(r.level) : <select value={r.level} onChange={e => set(i, { level: e.target.value })} aria-label="Mức độ">
          <option value="">Mọi mức độ</option>{LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}</td>
        <td className="num">{disabled ? r.count : <input type="number" min={1} max={200} value={r.count} style={{ width: 80 }} aria-label="Số câu"
          onChange={e => set(i, { count: Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))) })} />}</td>
        <td>{stats === null ? '…' : r.count > a ? <small className="warnline">chỉ có {a} câu</small> : <small className="sub">{a} câu</small>}</td>
        {!disabled && <td><button type="button" className="x" aria-label="Bỏ dòng" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button></td>}
      </tr> })}
        {!rows.length && <tr><td colSpan={cols}><small className="sub">Chưa có dòng nào. Thêm dòng hoặc bấm số câu trong bảng ngân hàng.</small></td></tr>}</tbody>
      <tfoot><tr><td colSpan={multi ? 3 : 2}><b>Tổng số câu</b></td><td className="num"><b>{matrixTotal(rows)}</b></td><td colSpan={disabled ? 1 : 2}>
        {!disabled && <button type="button" onClick={() => add()}>+ Thêm dòng</button>}</td></tr></tfoot>
    </table></div>
  </div>
}
