import type { Entitlement } from '../lib/auth'

// Trang hiện khi mở một mục thuộc phân hệ chưa có trong gói (cổng Trường, Sở).
// Không mở màn thật (CSDL cũng chặn theo gói), chỉ giới thiệu và chỉ đường liên hệ KDI.
export function LockedModule({ name, phase, entitlement, go }: {
  name: string; phase: string | null; entitlement: Entitlement | null; go: (page: string) => void
}) {
  const plan = entitlement?.plan
  const expired = entitlement?.state === 'expired'
  return (
    <section className="card lockedmod" aria-labelledby="locked-title">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <h2 id="locked-title">Chưa có trong gói</h2>
      <p>
        <b>{name}</b>{phase ? <> thuộc phân hệ <b>{phase}</b></> : null}
        {expired ? ', hợp đồng của đơn vị đã hết hạn.' : plan ? <>, chưa có trong gói <b>{plan}</b> của đơn vị.</> : ', chưa có trong gói dịch vụ của đơn vị.'}
      </p>
      <p className="sub">Liên hệ KDI Education để được tư vấn mở phân hệ này. Dữ liệu đơn vị đang có không bị ảnh hưởng.</p>
      <div className="plactions">
        <button type="button" className="primary" onClick={() => go('Hỗ trợ từ KDI')}>Liên hệ KDI</button>
      </div>
    </section>
  )
}
