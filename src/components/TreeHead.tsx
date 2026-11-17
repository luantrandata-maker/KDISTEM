import { createContext, useContext, useState, type ReactNode } from 'react'

/** Hàm ẩn khung cây (do khung bảng SideSplit cấp): có thì nút « nằm ngay trên dòng tiêu đề cây */
export const TreeHide = createContext<(() => void) | null>(null)

/** Dòng tiêu đề cây nhóm (vd. "Cấp › Khối") + nút ⓘ, luôn ghim ở đầu cây khi cuộn: bấm hoặc rê chuột để mở chú thích ngay bên dưới, trong khung cây (không bị cắt như popup) */
export function TreeHead({ title, children }: { title: ReactNode; children: ReactNode }) {
  const [pin, setPin] = useState(false), [hov, setHov] = useState(false)
  const open = pin || hov
  const hide = useContext(TreeHide)
  return <div className="gthead">
    <div className="gtheadrow"><span>{title}</span>
      <button type="button" className="gthint" aria-expanded={open} aria-label="Cách đọc cây nhóm"
        onClick={() => setPin(!pin)} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>ⓘ</button>
      {hide && <button type="button" className="ttsidebtn gthide" onClick={hide} title="Ẩn cây nhóm" aria-label="Ẩn cây nhóm">«</button>}</div>
    {open && <div className="gtnote" role="note">{children}</div>}
  </div>
}
