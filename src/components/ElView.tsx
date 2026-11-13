import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DetailHead } from './DetailHead'

/** Trang riêng (thêm, sửa, xem chi tiết) thay cho mở ngay bên dưới danh sách.
 *  Ở cấp trang: nút "← <back>" và tiêu đề lớn lên hàng tiêu đề trang (như chi tiết Chương trình giáo dục), Esc để quay lại.
 *  Nằm trong khung / ngăn kéo / hộp thoại / một ElView khác: giữ dạng gọn tại chỗ. */
export function ElView({ back, onBack, title, sub, actions, children }: { back: string; onBack: () => void; title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState<boolean | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    setTop(!!el?.closest('main') && !el.parentElement?.closest('.panel, .drawerwrap, dialog, [role=dialog], .elview'))
  }, [])
  return <div className="elview" ref={ref}>
    {top ? <>
      <DetailHead back={back} onBack={onBack} title={title} />
      {(sub || actions) && <div className="elviewhead elviewbar"><div>{sub && <p className="sub">{sub}</p>}</div>{actions && <div className="tools">{actions}</div>}</div>}
    </> : top === false && <>
      <button type="button" className="ghostbtn" onClick={onBack}>← {back}</button>
      <div className="elviewhead"><div><h2>{title}</h2>{sub && <p className="sub">{sub}</p>}</div>{actions && <div className="tools">{actions}</div>}</div>
    </>}
    {children}
  </div>
}
