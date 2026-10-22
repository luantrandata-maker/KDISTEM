import { useEffect, useRef, useState } from 'react'

// Độ rộng bảng chi tiết: tỉ lệ màn hình, mặc định một nửa; người dùng kéo mép trái để đổi, nhớ cho lần mở sau.
const KEY = 'drawer.width'
const MIN_PX = 360
function savedRatio() {
  try { const v = Number(localStorage.getItem(KEY)); if (v >= 0.2 && v <= 1) return v } catch { /* bỏ qua */ }
  return 0.5
}

// Bảng chi tiết trượt ra bên phải. Đóng bằng nút ×, phím Esc hoặc bấm ra ngoài (trừ khi đang sửa: closeOnOutside=false).
export function Drawer({ title, onClose, onBack, children, closeOnOutside = true, head, actions }: {
  title: React.ReactNode; onClose: () => void; onBack?: () => void; children: React.ReactNode
  wide?: boolean; closeOnOutside?: boolean; head?: React.ReactNode; actions?: React.ReactNode
}) {
  const [ratio, setRatio] = useState(savedRatio)
  const drag = useRef(false)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && closeOnOutside) onClose() }
    window.addEventListener('keydown', k)
    document.body.classList.add('drawer-open')
    return () => { window.removeEventListener('keydown', k); document.body.classList.remove('drawer-open') }
  }, [onClose, closeOnOutside])

  const clamp = (px: number) => Math.min(window.innerWidth, Math.max(Math.min(MIN_PX, window.innerWidth), px)) / window.innerWidth
  function start(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault(); drag.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add('drawer-resizing')
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current) setRatio(clamp(window.innerWidth - e.clientX))
  }
  function end(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    drag.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    document.body.classList.remove('drawer-resizing')
    try { localStorage.setItem(KEY, String(ratio)) } catch { /* bỏ qua */ }
  }
  function key(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowLeft' ? 0.05 : e.key === 'ArrowRight' ? -0.05 : 0
    if (!step) return
    e.preventDefault()
    const r = clamp((ratio + step) * window.innerWidth)
    setRatio(r); try { localStorage.setItem(KEY, String(r)) } catch { /* bỏ qua */ }
  }

  return (
    <div className="drawerwrap" onMouseDown={e => { if (closeOnOutside && e.target === e.currentTarget) onClose() }}>
      <aside className="drawer" role="dialog" aria-modal="true" style={{ width: `${(ratio * 100).toFixed(2)}vw` }}>
        <div className="drawerresize" role="separator" aria-orientation="vertical" aria-label="Kéo để đổi độ rộng" title="Kéo để đổi độ rộng"
          tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={key}
          onDoubleClick={() => { setRatio(0.5); try { localStorage.setItem(KEY, '0.5') } catch { /* bỏ qua */ } }} />
        <header className="drawerhead">
          {onBack && <button type="button" className="drawerbtn" onClick={onBack} aria-label="Quay lại" title="Quay lại">←</button>}
          <div className="drawertitle">{title}</div>
          {actions && <div className="draweractions">{actions}</div>}
          <button type="button" className="drawerbtn" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)">×</button>
        </header>
        {head}
        <div className="drawerbody">{children}</div>
      </aside>
    </div>
  )
}
