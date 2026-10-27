// Ma trận đề kiểm tra (109): mỗi dòng = chủ đề × mức độ × số câu, rút ngẫu nhiên từ Ngân hàng câu hỏi.
// Bảng "Ngân hàng đang có" cho biết số câu sẵn có từng ô; bấm một ô để thêm dòng.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

export type MRow = { topic: string; level: string; count: number }
export const LEVELS: [string, string][] = [['nhan_biet', 'Nhận biết'], ['thong_hieu', 'Thông hiểu'], ['van_dung', 'Vận dụng'], ['van_dung_cao', 'Vận dụng cao']]
export const levelName = (k: string) => LEVELS.find(l => l[0] === k)?.[1] ?? 'Mọi mức độ'
type Stat = { topic: string; level: string; n: number }

/** Các môn có câu hỏi dùng được của đơn vị */
export function useBankSubjects(org: string | null | undefined) {
  const [list, setList] = useState<{ subject: string; n: number }[]>([])
  useEffect(() => {
    if (!org) return
    supabase.rpc('exam_bank_subjects', { p_org: org }).then(({ data }) => setList((data as { subject: string; n: number }[]) ?? []))
  }, [org])
  return list
}

export function useBankStats(org: string | null | undefined, subject: string, grade: number | null) {
  const [stats, setStats] = useState<Stat[] | null>(null)
  useEffect(() => {
    if (!org || !subject) { setStats([]); return }
    setStats(null)
    supabase.rpc('exam_bank_stats', { p_org: org, p_subject: subject, p_grade: grade }).then(({ data }) => setStats((data as Stat[]) ?? []))
  }, [org, subject, grade])
  return stats
}

export const matrixTotal = (rows: MRow[]) => rows.reduce((a, r) => a + (Number(r.count) || 0), 0)
export const matrixText = (rows: MRow[]) => rows.map(r => `${r.count} câu ${r.topic || 'mọi chủ đề'} · ${levelName(r.level).toLowerCase()}`).join('; ')

export function ExamMatrix({ org, subject, grade, rows, onChange, disabled }: {
  org: string | null | undefined; subject: string; grade: number | null; rows: MRow[]; onChange: (r: MRow[]) => void; disabled?: boolean
}) {
  const stats = useBankStats(org, subject, grade)
  const topics = useMemo(() => [...new Set((stats ?? []).map(s => s.topic))].sort((a, b) => a.localeCompare(b, 'vi')), [stats])
  const avail = (topic: string, level: string) => (stats ?? []).filter(s => (!topic || s.topic === topic) && (!level || s.level === level)).reduce((a, s) => a + s.n, 0)
  const cell = (topic: string, level: string) => (stats ?? []).find(s => s.topic === topic && s.level === level)?.n ?? 0
  const set = (i: number, p: Partial<MRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const add = (topic = '', level = '') => onChange([...rows, { topic, level, count: 1 }])

  return <div style={{ display: 'grid', gap: 10 }}>
    {!subject ? <p className="sub" style={{ margin: 0 }}>Chọn môn để xem câu hỏi trong ngân hàng.</p>
      : stats === null ? <p className="sub" style={{ margin: 0 }}>Đang đếm câu hỏi…</p>
      : !stats.length ? <p className="warnline" style={{ margin: 0 }}>Ngân hàng chưa có câu hỏi sẵn sàng của môn này{grade ? `, khối ${grade}` : ''}. Thêm câu hỏi ở mục E-learning › Ngân hàng câu hỏi.</p>
      : <div className="wrap"><table>
        <caption style={{ textAlign: 'left' }}><small className="sub">Ngân hàng đang có (bấm một ô để thêm vào ma trận)</small></caption>
        <thead><tr><th>Chủ đề</th>{LEVELS.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Cộng</th></tr></thead>
        <tbody>{topics.map(t => <tr key={t}><td>{t || <i className="sub">Chưa gắn chủ đề</i>}</td>
          {LEVELS.map(([k]) => <td key={k} className="num">{cell(t, k) ? <button type="button" className="linkbtn" disabled={disabled} onClick={() => add(t, k)}>{cell(t, k)}</button> : <small className="sub">0</small>}</td>)}
          <td className="num"><b>{avail(t, '')}</b></td></tr>)}</tbody>
      </table></div>}
    <div className="wrap"><table>
      <thead><tr><th>Chủ đề</th><th>Mức độ</th><th className="num">Số câu</th><th>Ngân hàng có</th>{!disabled && <th></th>}</tr></thead>
      <tbody>{rows.map((r, i) => { const a = avail(r.topic, r.level); return <tr key={i}>
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
        {!rows.length && <tr><td colSpan={disabled ? 4 : 5}><small className="sub">Chưa có dòng nào. Thêm dòng hoặc bấm số câu trong bảng ngân hàng.</small></td></tr>}</tbody>
      <tfoot><tr><td colSpan={2}><b>Tổng số câu</b></td><td className="num"><b>{matrixTotal(rows)}</b></td><td colSpan={disabled ? 1 : 2}>
        {!disabled && <button type="button" onClick={() => add()}>+ Thêm dòng</button>}</td></tr></tfoot>
    </table></div>
  </div>
}
