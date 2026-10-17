import { lazy, Suspense, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tiles, HBars } from '../department/charts'
import { usePlatform, ORG_TYPE, TYPE_ORDER, nf, fmtTime, type Org } from './data'
import { useDeptStats } from '../department/data'

// Bản đồ độ phủ STEM cả nước (dùng chung thành phần với Dashboard toàn Sở), tải lười
const CoverageMap = lazy(() => import('../department/CoverageMap'))

type Check = { level: 'bad' | 'warn' | 'info'; key: string; title: string; count: number; items: string[] }
type Overview = {
  org_counts: Record<string, number>; schools_active: number; users: number; users_active_7d: number; memberships: number
  by_role: { name: string; n: number }[]; invitations_pending: number; teachers: number; students: number
  checks: Check[]; recent: { at: string; summary: string; entity: string; actor: string }[]
}

const LEVEL_ICON = { bad: ['✕', 'Cần sửa'], warn: ['!', 'Nên xem'], info: ['i', 'Thông tin'] } as const

// Tổng quan hệ thống: số liệu toàn nền tảng + kiểm tra cấu trúc dữ liệu đa tổ chức
export function PlatformOverview({ go }: { go?: (p: string) => void }) {
  const { orgs, stats, loading, err } = usePlatform()
  const dept = useDeptStats()   // quản trị nền tảng: số liệu mọi trường trên toàn hệ thống
  const [ov, setOv] = useState<Overview | null>(null)
  const [ovErr, setOvErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('platform_overview').then(({ data, error }) => {
      if (error) setOvErr(/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 021_platform_admin.sql trên Supabase.' : error.message)
      else setOv(data as Overview)
    })
  }, [])
  if (loading) return <p className="sub">Đang tải…</p>
  if (err || ovErr) return <p className="msg">{err || ovErr}</p>
  if (!ov) return <p className="sub">Đang tải…</p>

  const c = ov.org_counts
  const schools = c.school ?? 0
  const provinces = orgs.filter(o => o.type === 'province')
  const byId = new Map(orgs.map(o => [o.id, o]))
  // Sở/Phòng/trường thuộc tỉnh nào
  const provinceOf = (o: Org): Org | undefined => {
    let cur: Org | undefined = o
    for (let i = 0; cur && i < 10; i++) { if (cur.type === 'province') return cur; cur = cur.parent_id ? byId.get(cur.parent_id) : undefined }
  }
  const unplaced = orgs.filter(o => o.type === 'department' && !provinceOf(o))
  const rows = [...provinces, ...unplaced].map(p => {
    const s = stats.get(p.id)
    const depts = orgs.filter(o => o.type === 'department' && provinceOf(o)?.id === (p.type === 'province' ? p.id : undefined)).length
    return { org: p, depts: p.type === 'province' ? depts : 1, ...s }
  })
  const problems = ov.checks.filter(x => x.level !== 'info' && x.count > 0).length

  return (
    <>
      <Tiles items={[
        { label: 'Đơn vị quản lý', value: nf((c.ministry ?? 0) + (c.province ?? 0) + (c.department ?? 0) + (c.district ?? 0)),
          sub: TYPE_ORDER.filter(t => !['school', 'provider'].includes(t)).map(t => `${ORG_TYPE[t]} ${c[t] ?? 0}`).join(' · ') },
        { label: 'Trường học', value: nf(schools), sub: `${nf(ov.schools_active)} đang hoạt động` },
        { label: 'Người dùng', value: nf(ov.users), sub: `${nf(ov.memberships)} vai trò đã gán` },
        { label: 'Giáo viên · Học sinh', value: `${nf(ov.teachers)} · ${nf(ov.students)}` },
        { label: 'Lời mời đang chờ', value: nf(ov.invitations_pending), tone: ov.invitations_pending ? 'warn' : '' },
        { label: 'Kiểm tra cấu trúc', value: problems ? `${problems} mục` : 'Ổn', sub: problems ? 'cần xem bên dưới' : 'không phát hiện lỗi', tone: problems ? 'bad' : 'good' },
      ]} />

      <div className="bar"><h3 style={{ margin: '4px 0 0' }}>Độ phủ STEM cả nước</h3></div>
      {dept.err ? <p className="msg">{dept.err}</p> : dept.loading ? <p className="sub">Đang tổng hợp số liệu các trường…</p>
        : <Suspense fallback={<p className="sub">Đang tải bản đồ…</p>}><CoverageMap schools={dept.schools} nation /></Suspense>}

      <div className="pgrid">
        <div className="panel">
          <div className="bar"><h3>Kiểm tra cấu trúc dữ liệu</h3><button className="linkbtn" onClick={() => go?.('Cây tổ chức')}>Mở cây tổ chức →</button></div>
          <ul className="checks">
            {ov.checks.map(x => {
              const ok = x.count === 0
              const [icon, label] = ok ? ['✓', 'Đạt'] : LEVEL_ICON[x.level]
              return (
                <li key={x.key} className={ok ? 'good' : x.level}>
                  <button type="button" onClick={() => setOpen(open === x.key ? null : x.key)} disabled={ok} aria-expanded={open === x.key}>
                    <span className="ck" aria-hidden="true">{icon}</span>
                    <span className="ct">{x.title}</span>
                    <span className="cn">{ok ? label : `${x.count} · ${label}`}</span>
                  </button>
                  {open === x.key && <p className="items">{x.items.slice(0, 30).join(', ')}{x.items.length > 30 ? ` … và ${x.items.length - 30} mục khác` : ''}</p>}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="panel">
          <h3>Vai trò đã gán</h3>
          <HBars unit="" max={Math.max(1, ...ov.by_role.map(r => r.n))} data={ov.by_role.map(r => ({ label: r.name, value: r.n }))} />
        </div>
      </div>

      <div className="panel">
        <h3>Theo tỉnh</h3>
        <div className="wrap">
          <table>
            <thead><tr><th>Tỉnh</th><th>Sở</th><th>Trường</th><th>Đang hoạt động</th><th>Giáo viên</th><th>Học sinh</th><th>Tài khoản ở cấp tỉnh</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.org.id}>
                  <td><b>{r.org.type === 'province' ? r.org.name : `${r.org.name} (chưa gắn tỉnh)`}</b></td>
                  <td>{r.depts}</td><td>{nf(r.schools)}</td>
                  <td>{nf(r.schools_active)} <small className="sub">/ {nf(r.schools)}</small></td>
                  <td>{nf(r.teachers)}</td><td>{nf(r.students)}</td><td>{nf(r.members)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7}>Chưa có tỉnh nào.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <div className="bar"><h3>Hoạt động gần đây</h3><button className="linkbtn" onClick={() => go?.('Nhật ký hệ thống')}>Xem nhật ký →</button></div>
        <ul className="feed">
          {ov.recent.map((a, i) => <li key={i}><time>{fmtTime(a.at)}</time><span>{a.summary}</span><small>{a.actor}</small></li>)}
          {ov.recent.length === 0 && <li><span className="sub">Chưa có thay đổi nào được ghi.</span></li>}
        </ul>
      </div>
    </>
  )
}
