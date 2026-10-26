// Trường tùy chỉnh (Thiết lập chung › Trường tùy chỉnh): ô nhập trong form và hiển thị ở chi tiết.
// Tách riêng khỏi pages/settings/Custom.tsx để các trang (Học liệu, Chương trình) không nhập vòng với trang thiết lập.
import { Fragment } from 'react'
import type { CustomField } from '../lib/settings'

/** Ô nhập các trường tùy chỉnh trong form (cuối form Thêm / Sửa). */
export function CustomInputs({ fields, value, onChange, disabled }: { fields: CustomField[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled?: boolean }) {
  if (!fields.length) return null
  return <>{fields.map(f => {
    const v = value?.[f.key] ?? ''
    const set = (x: unknown) => onChange({ ...value, [f.key]: x === '' ? undefined : x })
    return <label key={f.key} className="field" style={f.type === 'textarea' ? { gridColumn: '1 / -1' } : undefined}><span>{f.label}{f.required ? ' *' : ''}</span>
      {f.type === 'select' ? <select disabled={disabled} required={f.required} value={String(v)} onChange={e => set(e.target.value)}><option value="">—</option>{(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select>
        : f.type === 'textarea' ? <textarea disabled={disabled} required={f.required} rows={3} maxLength={2000} value={String(v)} onChange={e => set(e.target.value)} />
        : <input disabled={disabled} required={f.required} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} maxLength={500} value={String(v)}
            onChange={e => set(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />}</label>
  })}</>
}
const fmtV = (f: CustomField, v: unknown) => v == null || v === '' ? '—' : f.type === 'date' ? String(v).split('-').reverse().join('/') : String(v)
/** Các trường tùy chỉnh ở trang chi tiết. */
export function CustomView({ fields, value }: { fields: CustomField[]; value: Record<string, unknown> | null | undefined }) {
  const fs = fields.filter(f => f.detail !== false)
  if (!fs.length) return null
  return <dl className="setcustomview">{fs.map(f => <Fragment key={f.key}><dt>{f.label}</dt><dd>{fmtV(f, value?.[f.key])}</dd></Fragment>)}</dl>
}
export const customCell = fmtV
