import type { ReactNode } from 'react'

/** Trang riêng (thêm, sửa, xem chi tiết) thay cho mở ngay bên dưới danh sách */
export function ElView({ back, onBack, title, sub, actions, children }: { back: string; onBack: () => void; title: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <div className="elview">
    <button type="button" className="ghostbtn" onClick={onBack}>← {back}</button>
    <div className="elviewhead"><div><h2>{title}</h2>{sub && <p className="sub">{sub}</p>}</div>{actions && <div className="tools">{actions}</div>}</div>
    {children}
  </div>
}
