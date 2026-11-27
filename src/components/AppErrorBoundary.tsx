import { Component, type ReactNode } from 'react'
import { isChunkError, reloadForUpdate } from '../lib/chunkReload'

/** Lỗi khi vẽ giao diện: không để trắng màn hình. Lỗi do vừa có bản mới thì tự tải lại; lỗi khác hiện khung báo lỗi kèm nút Tải lại trang. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { if (isChunkError(err)) reloadForUpdate() }
  render() {
    const { err } = this.state
    if (!err) return this.props.children
    const update = isChunkError(err)
    return <div role="alert" style={{ maxWidth: 520, margin: '12vh auto', padding: 24, border: '1px solid var(--line, #e2e8f0)', borderRadius: 12, background: 'var(--surface, #fff)', fontFamily: 'inherit' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{update ? 'Đã có phiên bản mới' : 'Có lỗi xảy ra'}</h2>
      <p style={{ margin: '0 0 16px', color: 'var(--muted, #64748b)' }}>{update ? 'Hệ thống vừa được cập nhật. Bấm Tải lại trang để dùng bản mới, dữ liệu không bị mất.' : 'Bấm Tải lại trang để tiếp tục. Nếu lỗi lặp lại, chụp dòng lỗi bên dưới gửi bộ phận hỗ trợ.'}</p>
      <button type="button" className="primary" style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 8, background: 'var(--primary, #1d5bd6)', color: '#fff', fontWeight: 600, cursor: 'pointer' }} onClick={() => location.reload()}>Tải lại trang</button>
      {!update && <pre style={{ marginTop: 16, padding: 10, background: '#f8fafc', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', color: '#b42318' }}>{err.message}</pre>}
    </div>
  }
}
