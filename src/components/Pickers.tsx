import { useState } from 'react'
import { useSubjects } from '../pages/subjects'
import { gradeRange, useEduLevels } from '../lib/eduLevels'

// Ô chọn dùng chung thay cho ô nhập tay: môn học (danh mục môn, 064), cấp học và khối (danh mục cấp học, 065).
// Giá trị cũ không có trong danh mục vẫn hiện thành một lựa chọn để không mất dữ liệu.
const OTHER = '__other__'

// Khối lưu dạng chữ (học liệu, bài giảng): "8,9", "6-9", "Khối 7" → [8, 9] / [6, 7, 8, 9] / [7]
export const gradeList = (g: string) => [...new Set((g.match(/\d+\s*[-–]\s*\d+|\d+/g) ?? []).flatMap(t => {
  const [a, b = a] = t.split(/[-–]/).map(x => Number(x.trim()))
  return Array.from({ length: Math.max(0, Math.min(b, 12) - a + 1) }, (_, i) => a + i)
}))].filter(n => n >= 1 && n <= 12).sort((a, b) => a - b)

/** Tên các môn đang dùng (có thể lọc theo cấp học), thêm gợi ý riêng (vd. môn của loại chương trình). */
export function useSubjectNames(level?: string | null, extra: string[] = []) {
  const { subjects } = useSubjects()
  const names = subjects.filter(s => s.active && (!level || !s.levels.length || s.levels.includes(level))).map(s => s.name)
  return [...new Set([...names, ...extra])]
}

/** Chọn một môn theo tên. Có lựa chọn "Môn khác…" để nhập tay khi danh mục chưa có. */
export function SubjectPicker({ value, onChange, level, extra, exclude = [], disabled, required, emptyLabel = '— Chọn môn —', style, ariaLabel = 'Môn', addOnly }: {
  value: string | null | undefined; onChange: (v: string) => void; level?: string | null; extra?: string[]; exclude?: string[]
  disabled?: boolean; required?: boolean; emptyLabel?: string; style?: React.CSSProperties; ariaLabel?: string; addOnly?: boolean
}) {
  const names = useSubjectNames(level, extra).filter(n => !exclude.includes(n))
  const v = value ?? ''
  const [free, setFree] = useState(false)
  const [draft, setDraft] = useState('')
  // addOnly: ô "thêm môn" của SubjectMulti — chỉ gửi tên khi nhập xong (Enter / rời ô)
  const commit = () => { if (draft.trim()) onChange(draft.trim()); setDraft(''); setFree(false) }
  if (free) return (
    <span style={{ display: 'flex', gap: 4, ...style }}>
      {addOnly
        ? <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
            placeholder="Nhập tên môn rồi Enter" aria-label={ariaLabel} style={{ flex: 1, minWidth: 0 }} />
        : <input autoFocus required={required} disabled={disabled} value={v} onChange={e => onChange(e.target.value)} placeholder="Nhập tên môn" aria-label={ariaLabel} style={{ flex: 1, minWidth: 0 }} />}
      <button type="button" className="x" title="Chọn từ danh mục" onClick={() => setFree(false)}>≡</button>
    </span>
  )
  const opts = v && !names.includes(v) ? [v, ...names] : names
  return (
    <select required={required} disabled={disabled} value={v} aria-label={ariaLabel} style={style}
      onChange={e => (e.target.value === OTHER ? (setFree(true), !addOnly && onChange('')) : onChange(e.target.value))}>
      <option value="">{emptyLabel}</option>
      {opts.map(n => <option key={n} value={n}>{n}</option>)}
      <option value={OTHER}>Môn khác (nhập tay)…</option>
    </select>
  )
}

/** Chọn nhiều môn: các môn đã chọn hiện thành thẻ, thêm bằng ô chọn. */
export function SubjectMulti({ value, onChange, level, extra, disabled, exclude = [] }: {
  value: string[]; onChange: (v: string[]) => void; level?: string | null; extra?: string[]; disabled?: boolean; exclude?: string[]
}) {
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
      {value.map(n => <span key={n} className="chip">{n}{!disabled && <button type="button" className="x" aria-label={`Bỏ ${n}`} onClick={() => onChange(value.filter(x => x !== n))}>×</button>}</span>)}
      {!disabled && <SubjectPicker addOnly value="" emptyLabel="+ Thêm môn" level={level} extra={extra} exclude={[...value, ...exclude]}
        onChange={n => { if (n.trim() && !value.includes(n.trim())) onChange([...value, n.trim()]) }} ariaLabel="Thêm môn" />}
      {disabled && !value.length && <small className="sub">—</small>}
    </span>
  )
}

/** Chọn cấp học từ danh mục (cấp đã ngừng dùng chỉ hiện khi đang được chọn). */
export function LevelPicker({ value, onChange, disabled, emptyLabel, ariaLabel = 'Cấp học' }: {
  value: string | null | undefined; onChange: (v: string) => void; disabled?: boolean; emptyLabel?: string; ariaLabel?: string
}) {
  const { levels, all } = useEduLevels()
  const opts = value && !levels.some(l => l.code === value) ? [...levels, all.find(l => l.code === value) ?? { code: value, name: value }] : levels
  return (
    <select disabled={disabled} value={value ?? ''} onChange={e => onChange(e.target.value)} aria-label={ariaLabel}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {opts.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
    </select>
  )
}

/** Chọn một khối; `from`/`to` hoặc `level` giới hạn danh sách. */
export function GradePicker({ value, onChange, from, to, level, disabled, emptyLabel, ariaLabel = 'Khối', style }: {
  value: number | null | undefined; onChange: (v: number | null) => void; from?: number; to?: number; level?: string | null
  disabled?: boolean; emptyLabel?: string; ariaLabel?: string; style?: React.CSSProperties
}) {
  const { byCode, grades } = useEduLevels()
  const lv = level ? byCode[level] : undefined
  let list = from && to ? gradeRange(from, to) : lv ? gradeRange(lv.grade_from, lv.grade_to) : grades.length ? grades : gradeRange(1, 12)
  if (value && !list.includes(value)) list = [...list, value].sort((a, b) => a - b)
  return (
    <select disabled={disabled} value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} aria-label={ariaLabel} style={style}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {list.map(g => <option key={g} value={g}>Khối {g}</option>)}
    </select>
  )
}

/** Chọn nhiều khối, xếp theo cấp học. */
export function GradeChecks({ value, onChange, disabled }: { value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  const { levels } = useEduLevels()
  const toggle = (g: number) => onChange(value.includes(g) ? value.filter(x => x !== g) : [...value, g].sort((a, b) => a - b))
  const shown = new Set<number>()
  const rows = levels.map(l => ({ l, gs: gradeRange(l.grade_from, l.grade_to).filter(g => !shown.has(g) && (shown.add(g), true)) })).filter(r => r.gs.length)
  const odd = value.filter(g => !shown.has(g))
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map(({ l, gs }) => (
        <span key={l.code} style={{ display: 'flex', flexWrap: 'wrap', gap: '0 10px', alignItems: 'center' }}>
          <small className="sub" style={{ minWidth: 64 }}>{l.name}</small>
          {gs.map(g => <label key={g} style={{ whiteSpace: 'nowrap' }}><input type="checkbox" disabled={disabled} checked={value.includes(g)} onChange={() => toggle(g)} /> {g}</label>)}
        </span>
      ))}
      {odd.length > 0 && <small className="sub">Khác: {odd.join(', ')}</small>}
    </span>
  )
}
