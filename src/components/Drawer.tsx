import { useEffect } from 'react'

// Bảng chi tiết trượt ra bên phải. Đóng bằng nút ×, phím Esc hoặc bấm ra ngoài (trừ khi đang sửa: closeOnOutside=false).
export function Drawer({ title, onClose, onBack, children, wide, closeOnOutside = true, head }: {
  title: React.ReactNode; onClose: () => void; onBack?: () => void; children: React.ReactNode
  wide?: boolean; closeOnOutside?: boolean; head?: React.ReactNode
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && closeOnOutside) onClose() }
    window.addEventListener('keydown', k)
    document.body.classList.add('drawer-open')
    return () => { window.removeEventListener('keydown', k); document.body.classList.remove('drawer-open') }
  }, [onClose, closeOnOutside])
  return (
    <div className="drawerwrap" onMouseDown={e => { if (closeOnOutside && e.target === e.currentTarget) onClose() }}>
      <aside className={'drawer' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <header className="drawerhead">
          {onBack && <button type="button" className="x" onClick={onBack} aria-label="Quay lại">←</button>}
          <div className="drawertitle">{title}</div>
          <button type="button" className="x" onClick={onClose} aria-label="Đóng">×</button>
        </header>
        {head}
        <div className="drawerbody">{children}</div>
      </aside>
    </div>
  )
}
