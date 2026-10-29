// Trang mở khi giáo viên quét QR điểm danh (/?dd=<mã>): đã đăng nhập thì điểm danh ngay, không cần giảng viên gọi tên.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export function CheckInLanding({ code, onDone }: { code: string; onDone: () => void }) {
  const [st, setSt] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    supabase.rpc('training_check_in_code', { p_code: code }).then(({ data, error }) => setSt(error
      ? { ok: false, text: /schema cache|does not exist/i.test(error.message) ? 'Hệ thống chưa sẵn sàng, báo quản trị.' : error.message }
      : { ok: true, text: String(data ?? '') }))
  }, [code])
  const at = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  return <main className="cklanding">
    <section className="panel">
      {!st ? <p className="sub">Đang điểm danh…</p> : st.ok ? <>
        <div className="ckok" aria-hidden="true">✓</div>
        <h2>Đã điểm danh</h2>
        <p><b>{st.text}</b><br /><span className="sub">lúc {at}</span></p>
      </> : <>
        <div className="ckbad" aria-hidden="true">!</div>
        <h2>Chưa điểm danh được</h2>
        <p>{st.text}</p>
        <small className="sub">Mã {code}. Kiểm tra bạn đã đăng nhập đúng tài khoản giáo viên có tên trong danh sách buổi học, và đang trong khung giờ điểm danh của buổi (người tổ chức đặt ở Thông tin buổi).</small>
      </>}
      <button type="button" className="primary" onClick={onDone}>Vào hệ thống</button>
    </section>
  </main>
}
