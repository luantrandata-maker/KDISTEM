import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// Độ rộng bảng chi tiết: tỉ lệ màn hình, mặc định một nửa; người dùng kéo mép trái để đổi, nhớ cho lần mở sau.
const KEY = 'drawer.width'
const MIN_PX = 360
function savedRatio() {
  try { const v = Number(localStorage.getItem(KEY)); if (v >= 0.2 && v <= 1) return v } catch { /* bỏ qua */ }
  return 0.5
}
// Phân hệ 1: nút phóng to toàn màn hình; mỗi lần mở luôn bắt đầu ở cỡ thu gọn, không nhớ lần phóng to trước
const Ico = ({ full }: { full: boolean }) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d={full ? 'M20 4l-6 6M14 4v6h6M4 20l6-6M10 20v-6H4' : 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7'} /></svg>

// Bảng chi tiết trượt ra bên phải. Đóng bằng nút ×, phím Esc hoặc bấm ra ngoài (trừ khi đang sửa: closeOnOutside=false).
export function Drawer({ title, onClose, onBack, children, closeOnOutside = true, head, actions }: {
  title: React.ReactNode; onClose: () => void; onBack?: () => void; children: React.ReactNode
  wide?: boolean; closeOnOutside?: boolean; head?: React.ReactNode; actions?: React.ReactNode
}) {
  const [ratio, setRatio] = useState(savedRatio)
  const drag = useRef(false)
  const wrap = useRef<HTMLDivElement>(null)
  const [canFull, setCanFull] = useState(false)
  const [full, setFull] = useState(false)
  useLayoutEffect(() => { setCanFull(!!wrap.current?.closest('.main[data-ph="1"]')) }, [])
  const isFull = canFull && full
  // Không phủ lên thanh menu bên trái: độ rộng tối đa (kéo hay phóng to) = màn hình trừ phần menu
  const sideW = () => { const r = document.querySelector('.app > .side')?.getBoundingClientRect(); return r && r.right < window.innerWidth / 2 ? Math.max(0, r.right) : 0 }
  const [side, setSide] = useState(0)
  useLayoutEffect(() => { const f = () => setSide(sideW()); f(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const toggleFull = () => setFull(v => !v)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && closeOnOutside) onClose() }
    window.addEventListener('keydown', k)
    document.body.classList.add('drawer-open')
    return () => { window.removeEventListener('keydown', k); document.body.classList.remove('drawer-open') }
  }, [onClose, closeOnOutside])

  const clamp = (px: number) => Math.min(window.innerWidth - sideW(), Math.max(Math.min(MIN_PX, window.innerWidth), px)) / window.innerWidth
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
    <div ref={wrap} className="drawerwrap" onMouseDown={e => { if (closeOnOutside && e.target === e.currentTarget) onClose() }}>
      <aside className="drawer" role="dialog" aria-modal="true" style={{ width: isFull ? `calc(100vw - ${side}px)` : `min(${(ratio * 100).toFixed(2)}vw, calc(100vw - ${side}px))` }}>
        {!isFull && <div className="drawerresize" role="separator" aria-orientation="vertical" aria-label="Kéo để đổi độ rộng" title="Kéo để đổi độ rộng"
          tabIndex={0} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={key}
          onDoubleClick={() => { setRatio(0.5); try { localStorage.setItem(KEY, '0.5') } catch { /* bỏ qua */ } }} />}
        <header className="drawerhead">
          {onBack && <button type="button" className="drawerbtn" onClick={onBack} aria-label="Quay lại" title="Quay lại">←</button>}
          <div className="drawertitle">{title}</div>
          {/* Chỗ để nội dung bên trong gắn nút lên đầu ngăn (vd. trang chủ đề: Chỉnh sửa / Lưu / Huỷ) */}
          <div className="drawerslot" />
          {actions && <div className="draweractions">{actions}</div>}
          {canFull && <button type="button" className="drawerbtn" onClick={toggleFull} aria-pressed={isFull}
            aria-label={isFull ? 'Thu nhỏ' : 'Mở toàn màn hình'} title={isFull ? 'Thu nhỏ' : 'Mở toàn màn hình'}><Ico full={isFull} /></button>}
          <button type="button" className="drawerbtn" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)">×</button>
        </header>
        {head}
        <div className="drawerbody">{children}</div>
      </aside>
    </div>
  )
}
