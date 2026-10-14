import { useState } from 'react'

export type Field = {
  key: string; label: string
  type?: 'text' | 'number' | 'date' | 'time' | 'datetime-local' | 'select'
  options?: { value: string; label: string }[]
  required?: boolean; placeholder?: string
}
type Values = Record<string, string>

export default function FormPanel({ fields, initial, submitLabel = 'Lưu', onSubmit, onCancel }: {
  fields: Field[]; initial?: Values; submitLabel?: string
  onSubmit: (v: Values) => Promise<string | null | void>; onCancel: () => void
}) {
  const [v, setV] = useState<Values>(() => Object.fromEntries(fields.map(f => [f.key, initial?.[f.key] ?? (f.type === 'select' ? f.options?.[0]?.value ?? '' : '')])))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const msg = await onSubmit(v)
    setBusy(false)
    if (msg) setErr(msg)
  }

  return (
    <form className="panel formgrid" onSubmit={submit}>
      {fields.map(f => (
        <label key={f.key} className="field"><span>{f.label}{f.required && ' *'}</span>
          {f.type === 'select' ? (
            <select required={f.required} value={v[f.key]} onChange={e => setV({ ...v, [f.key]: e.target.value })}>
              {!f.required && <option value="">—</option>}
              {f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : (
            <input type={f.type ?? 'text'} required={f.required} placeholder={f.placeholder} value={v[f.key]} onChange={e => setV({ ...v, [f.key]: e.target.value })} />
          )}
        </label>
      ))}
      <div className="formactions"><button className="primary" type="submit" disabled={busy}>{submitLabel}</button> <button type="button" onClick={onCancel}>Huỷ</button></div>
      {err && <p className="msg">{err}</p>}
    </form>
  )
}
