// Cỡ chữ hiển thị (Nhỏ / Vừa / Lớn): đổi biến --fz trên <html>, mọi cỡ chữ trong index.css nhân với biến này. Lưu trên trình duyệt.
import { useEffect, useRef, useState } from 'react'

const KEY = 'ui.fontsize'
export const FONT_SIZES = [['s', 'Nhỏ', 0.9], ['m', 'Vừa', 1], ['l', 'Lớn', 1.15]] as const
type Size = typeof FONT_SIZES[number][0]
const read = (): Size => { try { const v = localStorage.getItem(KEY); return v === 's' || v === 'l' ? v : 'm' } catch { return 'm' } }
const apply = (s: Size) => document.documentElement.style.setProperty('--fz', String(FONT_SIZES.find(x => x[0] === s)![2]))
/** Gọi một lần lúc khởi động để trang hiện đúng cỡ chữ đã chọn */
export function installFontSize() { apply(read()) }

export default function FontSize() {
  const [size, setSize] = useState<Size>(read)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  const pick = (s: Size) => { setSize(s); apply(s); try { localStorage.setItem(KEY, s) } catch { /* chỉ đổi trong phiên */ } }
  return <div className="bell fzpick" ref={ref}>
    <button type="button" className="bellbtn fzbtn" aria-label="Cỡ chữ hiển thị" title="Cỡ chữ hiển thị" aria-expanded={open} onClick={() => setOpen(!open)}>Aa</button>
    {open && <div className="bellpanel fzpanel" role="dialog" aria-label="Cỡ chữ hiển thị">
      <b>Cỡ chữ hiển thị</b>
      <div className="fzopts" role="radiogroup" aria-label="Cỡ chữ">
        {FONT_SIZES.map(([k, l, z]) => <button key={k} type="button" role="radio" aria-checked={size === k} className={'fzopt' + (size === k ? ' on' : '')} onClick={() => pick(k)}>
          <span style={{ fontSize: `${Math.round(16 * z)}px` }}>Aa</span><small>{l}</small></button>)}
      </div>
      <small className="sub">Áp dụng cho mọi màn, lưu trên trình duyệt này.</small>
    </div>}
  </div>
}
