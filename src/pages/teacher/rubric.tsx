import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCompetencies } from '../competency'

// Chấm theo tiêu chí (migration 041). Mức 1–4, Mức 4 cao nhất. Điểm = Σ(điểm tiêu chí × mức/4) / Σ điểm × thang điểm.
export type Criterion = { name: string; desc?: string; points: number; levels: string[]; competency?: string }
export type Rubric = { title: string; criteria: Criterion[] }
type Saved = { id: string; org_id: string | null; title: string; description: string | null; criteria: Criterion[] }

export const LEVEL_NAME = ['Mức 1 · Chưa đạt', 'Mức 2 · Đạt một phần', 'Mức 3 · Đạt', 'Mức 4 · Tốt']
export const LEVEL_SHORT = ['M1', 'M2', 'M3', 'M4']
export function rubricScore(r: Rubric, levels: (number | null)[], max: number) {
  if (levels.length !== r.criteria.length || levels.some(l => !l)) return null
  const tot = r.criteria.reduce((s, c) => s + c.points, 0)
  const got = r.criteria.reduce((s, c, i) => s + c.points * (levels[i] as number) / 4, 0)
  return Math.round(got / tot * max * 4) / 4
}
const blank = (): Criterion => ({ name: '', points: 1, levels: ['', '', '', ''] })
export const rubricProblem = (r: Rubric) => !r.criteria.length ? 'Cần ít nhất một tiêu chí.'
  : r.criteria.some(c => !c.name.trim()) ? 'Mỗi tiêu chí cần có tên.' : r.criteria.some(c => !(c.points > 0)) ? 'Điểm tiêu chí phải lớn hơn 0.' : ''

// Chọn mẫu / soạn tiêu chí trong form giao bài
export function RubricField({ value, onChange, orgId }: { value: Rubric | null; onChange: (r: Rubric | null) => void; orgId: string | null }) {
  const [lib, setLib] = useState<Saved[]>([])
  const comps = useCompetencies('student')
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState('')
  async function load() {
    const { data } = await supabase.from('rubrics').select('id, org_id, title, description, criteria').order('org_id', { nullsFirst: true }).order('title')
    setLib((data as Saved[]) ?? [])
  }
  useEffect(() => { load() }, [])
  function pick(id: string) {
    setMsg('')
    if (!id) return onChange(null)
    if (id === 'new') { onChange({ title: 'Tiêu chí riêng', criteria: [blank(), blank()] }); return setEditing(true) }
    const r = lib.find(x => x.id === id); if (r) onChange({ title: r.title, criteria: r.criteria.map(c => ({ ...c, levels: [...c.levels] })) })
  }
  async function saveAsTemplate() {
    if (!value || !orgId) return
    const p = rubricProblem(value); if (p) return setMsg(p)
    const title = prompt('Tên mẫu tiêu chí (cả trường dùng được):', value.title)
    if (!title) return
    const { error } = await supabase.from('rubrics').insert({ org_id: orgId, title: title.trim(), criteria: value.criteria })
    setMsg(error ? 'Không lưu được: ' + error.message : 'Đã lưu thành mẫu của trường.'); load()
  }
  const total = value?.criteria.reduce((s, c) => s + (Number(c.points) || 0), 0) ?? 0
  return (
    <div className="field rubricfield" style={{ gridColumn: '1 / -1' }}>
      <span>Chấm theo tiêu chí (rubric)</span>
      <div className="tools">
        <select value="" onChange={e => pick(e.target.value)} aria-label="Chọn mẫu tiêu chí">
          <option value="">{value ? `Đang dùng: ${value.title} — đổi…` : 'Không dùng (chấm điểm trực tiếp)'}</option>
          {value && <option value="">— Bỏ tiêu chí —</option>}
          <optgroup label="Mẫu của KDI">{lib.filter(r => !r.org_id).map(r => <option key={r.id} value={r.id}>{r.title} ({r.criteria.length} tiêu chí)</option>)}</optgroup>
          {lib.some(r => r.org_id) && <optgroup label="Mẫu của trường">{lib.filter(r => r.org_id).map(r => <option key={r.id} value={r.id}>{r.title} ({r.criteria.length} tiêu chí)</option>)}</optgroup>}
          <option value="new">+ Soạn tiêu chí mới…</option>
        </select>
        {value && <button type="button" onClick={() => setEditing(!editing)}>{editing ? 'Thu gọn' : 'Xem / sửa tiêu chí'}</button>}
        {value && <button type="button" onClick={saveAsTemplate}>Lưu thành mẫu của trường</button>}
        {value && <button type="button" onClick={() => onChange(null)}>Bỏ tiêu chí</button>}
      </div>
      {msg && <small className="sub">{msg}</small>}
      {value && !editing && <small className="sub">{value.criteria.length} tiêu chí · tổng {total} điểm tiêu chí (quy đổi về thang điểm của bài) · {value.criteria.filter(c => c.competency).length} tiêu chí gắn năng lực. Học sinh thấy tiêu chí khi làm bài.</small>}
      {value && editing && (
        <div className="rubricedit">
          <input value={value.title} onChange={e => onChange({ ...value, title: e.target.value })} aria-label="Tên bộ tiêu chí" placeholder="Tên bộ tiêu chí" />
          <table>
            <thead><tr><th style={{ width: '20%' }}>Tiêu chí</th><th style={{ width: 70 }}>Điểm</th>{LEVEL_NAME.map(l => <th key={l}>{l}</th>)}<th /></tr></thead>
            <tbody>{value.criteria.map((c, i) => {
              const set = (p: Partial<Criterion>) => onChange({ ...value, criteria: value.criteria.map((x, j) => j === i ? { ...x, ...p } : x) })
              return (
                <tr key={i}>
                  <td><textarea rows={2} value={c.name} onChange={e => set({ name: e.target.value })} aria-label={`Tên tiêu chí ${i + 1}`} />
                    <select value={c.competency ?? ''} onChange={e => set({ competency: e.target.value || undefined })} aria-label={`Năng lực của tiêu chí ${i + 1}`}>
                      <option value="">Năng lực: (không gắn)</option>{comps.map(k => <option key={k.key} value={k.key}>{k.name}</option>)}</select></td>
                  <td><input type="number" min={0.5} step={0.5} value={c.points} onChange={e => set({ points: Number(e.target.value) })} aria-label="Điểm tiêu chí" /></td>
                  {c.levels.map((l, k) => <td key={k}><textarea rows={2} value={l} placeholder="Mô tả mức" aria-label={`${LEVEL_NAME[k]} của tiêu chí ${i + 1}`}
                    onChange={e => set({ levels: c.levels.map((x, m) => m === k ? e.target.value : x) })} /></td>)}
                  <td><button type="button" className="x" disabled={value.criteria.length <= 1} aria-label="Xoá tiêu chí"
                    onClick={() => onChange({ ...value, criteria: value.criteria.filter((_, j) => j !== i) })}>×</button></td>
                </tr>)
            })}</tbody>
          </table>
          <button type="button" disabled={value.criteria.length >= 12} onClick={() => onChange({ ...value, criteria: [...value.criteria, blank()] })}>+ Thêm tiêu chí</button>
        </div>
      )}
    </div>
  )
}

// Bảng chấm: bấm ô mức cho từng tiêu chí
export function RubricGrader({ rubric, levels, onChange, max }: { rubric: Rubric; levels: (number | null)[]; onChange: (l: (number | null)[]) => void; max: number }) {
  const score = rubricScore(rubric, levels, max)
  return (
    <div className="rubricgrid" role="group" aria-label={`Chấm theo ${rubric.title}`}>
      <table>
        <thead><tr><th>Tiêu chí</th>{LEVEL_NAME.map(l => <th key={l}>{l}</th>)}</tr></thead>
        <tbody>{rubric.criteria.map((c, i) => (
          <tr key={i}>
            <td><b>{c.name}</b><br /><small>{c.points} điểm</small></td>
            {c.levels.map((d, k) => (
              <td key={k}><button type="button" className={'rlevel' + (levels[i] === k + 1 ? ' on' : '')} aria-pressed={levels[i] === k + 1}
                onClick={() => onChange(rubric.criteria.map((_, j) => j === i ? k + 1 : levels[j] ?? null))}>
                <b>{LEVEL_SHORT[k]}</b> {d}</button></td>
            ))}
          </tr>
        ))}</tbody>
      </table>
      <p className="sub" style={{ margin: '6px 0 0' }}>Điểm theo tiêu chí: <b>{score == null ? `chọn mức cho đủ ${rubric.criteria.length} tiêu chí` : `${score}/${max}`}</b></p>
    </div>
  )
}

// Học sinh xem tiêu chí (và mức đạt khi đã chấm)
export function RubricView({ rubric, levels }: { rubric: Rubric; levels?: (number | null)[] | null }) {
  return (
    <div className="rubricgrid">
      <b>Tiêu chí chấm: {rubric.title}</b>
      <table>
        <thead><tr><th>Tiêu chí</th>{LEVEL_NAME.map(l => <th key={l}>{l}</th>)}</tr></thead>
        <tbody>{rubric.criteria.map((c, i) => (
          <tr key={i}><td><b>{c.name}</b><br /><small>{c.points} điểm</small></td>
            {c.levels.map((d, k) => <td key={k} className={levels?.[i] === k + 1 ? 'rgot' : ''}>{levels?.[i] === k + 1 && <b>✓ </b>}{d}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  )
}

// Tổng hợp lớp theo tiêu chí (rubric_class_summary)
type Row = { idx: number; name: string; points: number; graded: number; avg_level: number | null; l1: number; l2: number; l3: number; l4: number }
export function RubricSummary({ assignmentId }: { assignmentId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => { supabase.rpc('rubric_class_summary', { p_assignment: assignmentId }).then(({ data }) => setRows((data as Row[]) ?? [])) }, [assignmentId])
  if (!rows?.length) return null
  return (
    <div className="panel rubricgrid">
      <b>Kết quả lớp theo tiêu chí</b>
      <table>
        <thead><tr><th>Tiêu chí</th><th>Đã chấm</th><th>Mức TB</th><th>M1</th><th>M2</th><th>M3</th><th>M4</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.idx}><td>{r.name}</td><td>{r.graded}</td>
          <td><b>{r.avg_level ?? '—'}</b>{r.avg_level != null && r.avg_level < 2.5 && <small className="due bad"> · cần củng cố</small>}</td>
          <td>{r.l1}</td><td>{r.l2}</td><td>{r.l3}</td><td>{r.l4}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
