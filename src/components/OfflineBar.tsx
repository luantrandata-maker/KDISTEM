import { useEffect, useState } from 'react'
import { offlineState, subscribeOffline } from '../lib/offline'
import { flushOffline } from '../lib/supabase'

// Dải báo trạng thái ngoại tuyến (cuối màn hình): mất mạng, đang xem dữ liệu đã lưu, thao tác chờ gửi
export default function OfflineBar({ go }: { go?: () => void }) {
  const [s, setS] = useState(offlineState())
  const [toast, setToast] = useState('')
  useEffect(() => subscribeOffline(setS), [])
  useEffect(() => {
    const f = () => { setToast('Đã lưu điểm danh trên máy — sẽ tự gửi khi có mạng.'); setTimeout(() => setToast(''), 5000) }
    window.addEventListener('offline-queued', f); return () => window.removeEventListener('offline-queued', f)
  }, [])
  const show = !s.online || s.fromCache || s.queued > 0 || s.failed > 0 || toast
  if (!show) return null
  return (
    <div className={'offlinebar' + (!s.online ? ' off' : '')} role="status">
      {toast ? <span>{toast}</span> : !s.online ? <span><b>Đang ngoại tuyến.</b> {s.fromCache ? 'Đang xem dữ liệu đã lưu lần trước.' : 'Một số màn cần mạng sẽ không tải được.'}</span>
        : s.fromCache ? <span>Vừa có mạng lại — tải lại trang để xem dữ liệu mới nhất.</span> : null}
      {s.queued > 0 && <span><b>{s.queued}</b> điểm danh chờ gửi{s.online && <> · <button className="xbtn" onClick={() => flushOffline()}>Gửi ngay</button></>}</span>}
      {s.failed > 0 && <span className="bad"><b>{s.failed}</b> thao tác gửi lỗi{go && <> · <button className="xbtn" onClick={go}>Xem</button></>}</span>}
    </div>
  )
}
