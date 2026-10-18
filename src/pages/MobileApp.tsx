import { useEffect, useState } from 'react'
import { supabase, flushOffline } from '../lib/supabase'
import { canInstall, onInstallChange, promptInstall, isStandalone, listQueue, dropQueued, cacheStats, clearOfflineData, subscribeOffline, offlineState, type Queued } from '../lib/offline'

// Ứng dụng di động & ngoại tuyến: cài KSCHOOL STEM như ứng dụng (PWA) trên điện thoại / máy tính,
// trạng thái dữ liệu ngoại tuyến và hàng đợi điểm danh trên máy này.
const OFFLINE_OK = [
  ['Mở lại ứng dụng khi mất mạng', 'Giao diện được lưu trên máy sau lần mở đầu tiên.'],
  ['Xem lại màn đã mở', 'Lịch dạy, danh sách lớp, bài tập, năng lực… hiện bản lưu lần xem gần nhất (tối đa 14 ngày).'],
  ['Điểm danh khi mất mạng', 'Giáo viên mở tiết (đã xem khi có mạng), điểm danh và lưu — dữ liệu xếp hàng trên máy, tự gửi khi có mạng lại.'],
]
const NEED_NET = 'Đăng nhập lần đầu, tạo / sửa dữ liệu khác (bài tập, thiết bị, phê duyệt…), Trợ lý AI, xuất báo cáo.'

export default function MobileAppPage() {
  const [installable, setInstallable] = useState(canInstall())
  const [standalone] = useState(isStandalone())
  const [sw, setSw] = useState<'none' | 'pending' | 'active'>('pending')
  const [queue, setQueue] = useState<Queued[]>([])
  const [stats, setStats] = useState<{ entries: number; bytes: number; oldest: number } | null>(null)
  const [st, setSt] = useState(offlineState())
  const [uid, setUid] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)

  async function load() {
    const { data } = await supabase.auth.getSession(); const u = data.session?.user.id ?? null
    setUid(u); setQueue((await listQueue()).filter(q => q.uid === u)); setStats(await cacheStats(u))
  }
  useEffect(() => {
    load()
    const off1 = onInstallChange(() => setInstallable(canInstall()))
    const off2 = subscribeOffline(s => { setSt(s); load() })
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(r => setSw(r?.active ? 'active' : r ? 'pending' : 'none')).catch(() => setSw('none'))
    else setSw('none')
    return () => { off1(); off2() }
  }, [])

  const kb = (n: number) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')
  return (
    <>
      <div className="cards syscards">
        <div className="card"><strong>{standalone ? 'Đã cài' : 'Trình duyệt'}</strong><span>Đang mở bằng</span></div>
        <div className="card"><strong>{st.online ? 'Có mạng' : 'Ngoại tuyến'}</strong><span>Kết nối hiện tại</span></div>
        <div className="card"><strong>{sw === 'active' ? 'Sẵn sàng' : sw === 'pending' ? 'Đang chuẩn bị' : 'Chưa bật'}</strong><span>Mở khi mất mạng</span></div>
        <div className="card"><strong>{stats ? stats.entries : '…'}</strong><span>Màn dữ liệu đã lưu{stats?.entries ? ` · ${kb(stats.bytes)}` : ''}</span></div>
        <div className="card"><strong>{queue.length}</strong><span>Thao tác chờ gửi</span></div>
      </div>

      <div className="appgrid">
        <section className="panel">
          <h3>Cài ứng dụng trên thiết bị này</h3>
          {standalone ? <p className="sub">Bạn đang dùng KSCHOOL STEM dạng ứng dụng đã cài.</p>
            : installable ? <><p className="sub">Cài để mở nhanh từ màn hình chính, toàn màn hình, dùng được khi mất mạng.</p>
              <button className="primary" onClick={async () => setMsg((await promptInstall()) ? 'Đã cài ứng dụng.' : 'Đã huỷ cài đặt.')}>Cài ứng dụng KSCHOOL STEM</button></>
            : ios ? <ol className="steps"><li>Mở trang này bằng <b>Safari</b>.</li><li>Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên).</li><li>Chọn <b>Thêm vào MH chính</b> → <b>Thêm</b>.</li></ol>
            : <ol className="steps"><li><b>Android (Chrome):</b> menu ⋮ → <b>Cài đặt ứng dụng</b> / <b>Thêm vào màn hình chính</b>.</li>
              <li><b>Máy tính (Chrome, Edge):</b> biểu tượng cài đặt ở cuối thanh địa chỉ → <b>Cài đặt</b>.</li>
              <li>Nếu không thấy tuỳ chọn: tải lại trang một lần sau khi đăng nhập.</li></ol>}
          {msg && <p className="sub" role="status"><b>{msg}</b></p>}
        </section>
        <section className="panel">
          <h3>Dùng được khi mất mạng</h3>
          <ul className="oklist">{OFFLINE_OK.map(([t, d]) => <li key={t}><b>{t}</b><span>{d}</span></li>)}</ul>
          <p className="sub"><b>Cần mạng:</b> {NEED_NET}</p>
        </section>
      </div>

      <section className="panel">
        <div className="bar"><h3>Thao tác chờ gửi trên máy này</h3>
          <span className="tools"><button onClick={async () => { await flushOffline(); load() }} disabled={!st.online || !queue.length}>Gửi ngay</button></span></div>
        <div className="wrap"><table className="systable"><thead><tr><th>Thao tác</th><th>Lưu lúc</th><th>Trạng thái</th><th /></tr></thead><tbody>
          {queue.map(q => <tr key={q.id}><td>{q.label}</td><td>{new Date(q.at).toLocaleString('vi-VN')}</td>
            <td>{q.error ? <span className="pill inactive" title={q.error}>Lỗi: {q.error}</span> : <span className="pill maintenance">Chờ có mạng</span>}</td>
            <td><button className="xbtn" onClick={async () => { if (confirm('Bỏ thao tác này? Dữ liệu chưa gửi sẽ mất.')) { await dropQueued(q.id!); load() } }}>Bỏ</button></td></tr>)}
          {!queue.length && <tr><td colSpan={4}>Không có thao tác nào chờ gửi.</td></tr>}
        </tbody></table></div>
        <p className="sub">Điểm danh gửi muộn vẫn theo quy định của trường: giáo viên chỉ sửa được tiết trong 7 ngày. Thao tác lỗi giữ lại để bạn xem lý do.</p>
      </section>

      <section className="panel">
        <h3>Dữ liệu lưu trên máy</h3>
        <p className="sub">Bản lưu chỉ dành cho tài khoản đang đăng nhập, tự xoá khi đăng xuất hoặc sau 14 ngày. Trên máy dùng chung, hãy đăng xuất sau khi dùng.</p>
        <button disabled={!uid} onClick={async () => { if (confirm('Xoá toàn bộ dữ liệu ngoại tuyến trên máy này (kể cả thao tác chờ gửi)?')) { await clearOfflineData(); load(); setMsg('Đã xoá dữ liệu ngoại tuyến.') } }}>Xoá dữ liệu ngoại tuyến trên máy này</button>
      </section>
    </>
  )
}
