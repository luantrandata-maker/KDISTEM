import { useState, type ReactNode } from 'react'

/** Tiêu đề cây nhóm (vd. "Cấp › Khối") với nút ⓘ: bấm hoặc rê chuột để mở chú thích ngay bên dưới, trong khung cây (không bị cắt như popup) */
export function TreeHead({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [pin, setPin] = useState(false), [hov, setHov] = useState(false)
  const open = pin || hov
  return <div className="gthead">
    <div className="gtheadrow"><span>{title}</span>
      <button type="button" className="gthint" aria-expanded={open} aria-label="Cách đọc cây nhóm" title="Cách đọc cây nhóm"
        onClick={() => setPin(!pin)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>ⓘ</button></div>
    {open && <div className="gtnote" role="note">{children}</div>}
  </div>
}
