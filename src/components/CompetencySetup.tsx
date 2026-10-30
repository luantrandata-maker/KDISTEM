import { Suspense, lazy, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { Drawer } from './Drawer'

// Lối vào thiết lập khung năng lực ngay cạnh ô chọn năng lực (chỉ quản trị KDI sửa được khung dùng chung).
// Thêm / sửa xong, mọi ô chọn năng lực đang mở tự cập nhật danh sách.
const Framework = lazy(() => import('../pages/training/Competency').then(m => ({ default: m.CompetencyFramework })))
let adminCache: boolean | null = null
export function CompetencySetupLink({ audience }: { audience: 'teacher' | 'student' }) {
  const [admin, setAdmin] = useState(adminCache ?? false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (adminCache === null) supabase.rpc('is_platform_admin').then(({ data }) => { adminCache = !!data; setAdmin(adminCache) })
  }, [])
  if (!admin) return null
  return <>
    <button type="button" className="linkbtn" onClick={() => setOpen(true)}>Thiết lập khung năng lực {audience === 'teacher' ? 'giáo viên' : 'học sinh'}</button>
    {open && createPortal(<Drawer title={`Khung năng lực ${audience === 'teacher' ? 'giáo viên' : 'học sinh'}`} onClose={() => setOpen(false)} closeOnOutside={false}>
      <Suspense fallback={<p className="sub">Đang tải…</p>}><Framework audience={audience} compact /></Suspense>
    </Drawer>, document.querySelector('.main') ?? document.body)}
  </>
}
