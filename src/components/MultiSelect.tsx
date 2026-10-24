import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Một lựa chọn: [giá trị, nhãn] hoặc { value, label, group } (group = tiêu đề nhóm trong danh sách) */
export type MsOption = [string, string] | { value: string; label: string; group?: string }
const norm = (o: MsOption) => Array.isArray(o) ? { value: o[0], label: o[1], group: undefined as string | undefined } : o
const LIMIT = 300
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

/**
 * Ô chọn nhiều gọn: các mục đã chọn hiện thành thẻ trong ô; bấm vào ô mở danh sách có ô tick, gõ để tìm.
 * Thứ tự tick là thứ tự lưu; `primary` gắn nhãn cho mục đầu tiên (giá trị chính).
 * `allowCustom` cho thêm giá trị ngoài danh sách (gõ rồi Enter).
 */
export function MultiSelect({ value, onChange, options, disabled, placeholder = 'Chọn…', ariaLabel, primary, allowCustom, customLabel = 'Thêm', empty = 'Không có lựa chọn', style }: {
  value: string[]; onChange: (v: string[]) => void; options: MsOption[]; disabled?: boolean; placeholder?: string; ariaLabel?: string
  primary?: string; allowCustom?: boolean; customLabel?: string; empty?: string; style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [act, setAct] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const inp = useRef<HTMLInputElement>(null)

  const all = useMemo(() => {
    const list = options.map(norm)
    const known = new Set(list.map(o => o.value))
    return [...list, ...value.filter(v => !known.has(v)).map(v => ({ value: v, label: v, group: undefined }))]
  }, [options, value])
  const labelOf = (v: string) => all.find(o => o.value === v)?.label ?? v
  const shown = useMemo(() => { const k = fold(q.trim()); return k ? all.filter(o => fold(o.label).includes(k)) : all }, [all, q])
  const custom = allowCustom && q.trim() && !all.some(o => fold(o.label) === fold(q.trim())) ? q.trim() : ''
  const vis = Math.min(shown.length, LIMIT)
  const rows = custom ? vis + 1 : vis

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  const addCustom = () => { if (custom) { onChange([...value, custom]); setQ('') } }
  const shownOn = shown.filter(o => value.includes(o.value)).length
  const toggleAll = () => {
    const vs = shown.map(o => o.value)
    onChange(shownOn === shown.length ? value.filter(v => !vs.includes(v)) : [...value, ...vs.filter(v => !value.includes(v))])
  }

  const place = () => {
    const r = box.current?.getBoundingClientRect(); if (!r) return
    const below = window.innerHeight - r.bottom - 8, above = r.top - 8
    const up = below < 220 && above > below
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 240), up, max: Math.min(320, Math.max(160, up ? above : below)) })
  }
  useLayoutEffect(() => { if (open) place() }, [open, value.length])
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !pop.current?.contains(t)) { setOpen(false); setQ('') } }
    const re = () => place()
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); setQ('') } }
    document.addEventListener('keydown', esc, true)
    document.addEventListener('mousedown', out); window.addEventListener('resize', re); window.addEventListener('scroll', re, true)
    return () => { document.removeEventListener('keydown', esc, true); document.removeEventListener('mousedown', out); window.removeEventListener('resize', re); window.removeEventListener('scroll', re, true) }
  }, [open])
  useEffect(() => { setAct(0) }, [q])
  useEffect(() => { pop.current?.querySelector<HTMLElement>(`[data-i="${act}"]`)?.scrollIntoView({ block: 'nearest' }) }, [act])

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setAct(a => Math.min(rows - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAct(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault(); if (!open) return setOpen(true)
      if (act < vis) toggle(shown[act].value); else addCustom()
    } else if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false); setQ('') } }
    else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1))
  }

  let lastGroup: string | undefined
  return (
    <div ref={box} className={'msel' + (open ? ' open' : '') + (disabled ? ' dis' : '')} style={style}
      onMouseDown={e => { if (disabled || (e.target as HTMLElement).closest('button')) return; if (e.target !== inp.current) e.preventDefault(); setOpen(true); inp.current?.focus() }}>
      <div className="mselchips">
        {value.map((v, i) => (
          <span key={v} className="mselchip" title={labelOf(v)}>
            <span>{labelOf(v)}</span>{primary && i === 0 && value.length > 1 && <small className="checkmain">{primary}</small>}
            {!disabled && <button type="button" className="mselx" aria-label={`Bỏ ${labelOf(v)}`} onClick={() => onChange(value.filter(x => x !== v))}>×</button>}
          </span>))}
        {!disabled && <input ref={inp} className="mselq" value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onKeyDown={key} onFocus={() => setOpen(true)}
          placeholder={value.length ? 'Tìm…' : placeholder} aria-label={ariaLabel ? `${ariaLabel}: tìm và chọn` : 'Tìm và chọn'} aria-expanded={open} role="combobox" />}
        {disabled && !value.length && <span className="sub">—</span>}
      </div>
      {!disabled && <span className="mseltools">
        {value.length > 0 && <button type="button" className="mselx" aria-label="Bỏ chọn tất cả" title="Bỏ chọn tất cả" onClick={() => onChange([])}>×</button>}
        <button type="button" className="mselx mselplus" aria-label={open ? 'Đóng danh sách' : 'Mở danh sách'} onClick={() => { setOpen(o => !o); if (!open) inp.current?.focus() }}>{open ? '−' : '+'}</button>
      </span>}
      {open && pos && createPortal(
        <div ref={pop} className="mselpop" role="listbox" aria-multiselectable="true" aria-label={ariaLabel}
          style={{ left: pos.left, width: pos.width, maxHeight: pos.max, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
          onMouseDown={e => e.preventDefault()}>
          {shown.length > 0 && <label className="mselhead">
            <input type="checkbox" checked={shownOn > 0 && shownOn === shown.length} ref={el => { if (el) el.indeterminate = shownOn > 0 && shownOn < shown.length }} onChange={toggleAll} />
            <b>{value.length ? `Đã chọn ${value.length}` : q ? 'Chọn tất cả kết quả' : 'Chọn tất cả'}</b></label>}
          <div className="msellist">
            {shown.slice(0, LIMIT).map((o, i) => {
              const on = value.includes(o.value); const head = o.group && o.group !== lastGroup ? o.group : null; lastGroup = o.group
              return <div key={o.value}>
                {head && <div className="mselgroup">{head}</div>}
                <label data-i={i} className={(on ? 'mselon' : '') + (i === act ? ' mselact' : '')} onMouseEnter={() => setAct(i)}>
                  <input type="checkbox" checked={on} onChange={() => toggle(o.value)} /><span>{o.label}</span>
                  {primary && on && value[0] === o.value && value.length > 1 && <small className="checkmain">{primary}</small>}
                </label></div>
            })}
            {shown.length > LIMIT && <div className="mselempty">Còn {shown.length - LIMIT} mục, gõ để tìm thêm.</div>}
            {custom && <div data-i={vis} className={'mselnew' + (act === vis ? ' mselact' : '')} onMouseEnter={() => setAct(vis)} onClick={addCustom}>+ {customLabel} “{custom}”</div>}
            {!shown.length && !custom && <div className="mselempty">{q ? 'Không tìm thấy' : empty}</div>}
          </div>
        </div>, document.body)}
    </div>
  )
}

/** Chọn nhiều số (khối…) bằng MultiSelect; kết quả luôn sắp tăng dần. */
export function NumMultiSelect({ value, onChange, options, ...rest }: Omit<React.ComponentProps<typeof MultiSelect>, 'value' | 'onChange' | 'options' | 'allowCustom'> & {
  value: number[]; onChange: (v: number[]) => void; options: { value: number; label: string; group?: string }[]
}) {
  return <MultiSelect {...rest} value={value.map(String)} options={options.map(o => ({ ...o, value: String(o.value) }))}
    onChange={v => onChange(v.map(Number).sort((a, b) => a - b))} />
}
