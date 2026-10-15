import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'
import { fmtTime } from './data'

// Bảo mật tài khoản (migration 024): xác thực 2 lớp bắt buộc theo vai trò, khoá tài khoản, phiên đăng nhập

type Settings = { mfa_roles: string[]; enforce_mfa_db: boolean; idle_minutes: number; updated_at: string }
type Overview = {
  settings: Settings; users: number; note: string | null
  locked: { id: string; email: string | null; full_name: string | null; locked_at: string; reason: string | null; by: string | null }[]
  mfa_users: { id: string; email: string | null; full_name: string | null; roles: string[] | null; enrolled: boolean | null }[]
  sessions: Record<string, any>[] | null
}
type Role = { key: string; name: string }
type T = 'mfa' | 'sessions' | 'locked' | 'lock'

function errText(m: string) {
  if (/schema cache|does not exist|function/i.test(m)) return 'Hãy chạy migration 024_platform_commerce_security_support.sql trên Supabase.'
  if (/row-level security|Chỉ quản trị/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.'
  return m
}
const who = (u: { full_name: string | null; email: string | null }) => u.full_name || u.email || '—'
const agent = (ua: string | null | undefined) => {
  if (!ua) return '—'
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt khác'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return [b, os].filter(Boolean).join(' · ')
}

export function PlatformSecurity() {
  const [ov, setOv] = useState<Overview | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [t, setT] = useState<T>('mfa')
  const [err, setErr] = useState(''); const [info, setInfo] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ id: string; full_name: string | null; email: string | null; locked_at: string | null }[]>([])

  async function load() {
    const [o, r] = await Promise.all([supabase.rpc('platform_security_overview'), supabase.from('roles').select('key, name').is('org_id', null).order('name')])
    if (o.error) return setErr(errText(o.error.message))
    setOv(o.data as Overview); setRoles((r.data as Role[]) ?? [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const s = q.trim().replace(/[,()%*]/g, ' '); if (s.length < 2) { setFound([]); return }
    const h = setTimeout(() => supabase.from('profiles').select('id, full_name, email, locked_at').or(`full_name.ilike.%${s}%,email.ilike.%${s}%`).limit(20)
      .then(({ data }) => setFound((data as any) ?? [])), 250)
    return () => clearTimeout(h)
  }, [q])

  if (err && !ov) return <p className="msg">{err}</p>
  if (!ov) return <p className="sub">Đang tải…</p>
  const st = ov.settings
  const enrolled = ov.mfa_users.filter(u => u.enrolled).length
  const known = ov.mfa_users.some(u => u.enrolled !== null)
  const active24 = ov.sessions?.filter(s => Date.now() - new Date(s.updated_at ?? s.created_at).getTime() < 86400000).length

  async function saveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const enforce = fd.get('enforce') === 'on'
    if (enforce && !st.enforce_mfa_db && !confirm('Bật chặn ở cơ sở dữ liệu: quản trị nền tảng chưa xác thực 2 lớp sẽ mất quyền ngay. Bạn đã đăng ký ứng dụng xác thực chưa?')) return
    const { error } = await supabase.from('security_settings').update({
      mfa_roles: fd.getAll('mfa_roles').map(String), enforce_mfa_db: enforce, idle_minutes: Number(fd.get('idle') || 0), updated_at: new Date().toISOString(),
    }).eq('id', 1)
    if (error) return setErr(errText(error.message))
    setErr(''); setInfo('Đã lưu cài đặt. Người dùng áp dụng từ lần tải trang tiếp theo.'); load()
  }
  async function lock(id: string, name: string) {
    const reason = prompt(`Lý do khoá tài khoản ${name}?`)
    if (reason === null) return
    const { error } = await supabase.rpc('platform_lock_user', { p_user: id, p_reason: reason })
    if (error) return setErr(errText(error.message))
    setErr(''); setInfo(`Đã khoá ${name}. Người này mất quyền truy cập dữ liệu ngay lập tức.`); setQ(''); load()
  }
  async function unlock(id: string, name: string) {
    const { error } = await supabase.rpc('platform_unlock_user', { p_user: id })
    if (error) return setErr(errText(error.message))
    setErr(''); setInfo(`Đã mở khoá ${name}.`); load()
  }
  async function revoke(id: string) {
    if (!confirm('Thu hồi phiên đăng nhập này? Người dùng phải đăng nhập lại.')) return
    const { data, error } = await supabase.rpc('platform_revoke_session', { p_session: id })
    if (error || data) return setErr(errText(error?.message ?? String(data)))
    setErr(''); setInfo('Đã thu hồi phiên.'); load()
  }

  return (
    <>
      <Tiles items={[
        { label: 'Bắt buộc 2FA đã đăng ký', value: known ? `${enrolled}/${ov.mfa_users.length}` : '—', sub: known ? 'tài khoản thuộc vai trò bắt buộc' : 'chưa đọc được dữ liệu 2FA',
          tone: known ? (enrolled === ov.mfa_users.length ? 'good' : 'warn') : '' },
        { label: 'Phiên hoạt động 24 giờ', value: active24 ?? '—', sub: ov.sessions ? `${ov.sessions.length} phiên đang lưu` : 'chưa đọc được phiên' },
        { label: 'Tài khoản bị khoá', value: ov.locked.length, tone: ov.locked.length ? 'warn' : '' },
        { label: 'Chặn ở CSDL', value: st.enforce_mfa_db ? 'Bật' : 'Tắt', sub: 'quyền nền tảng chỉ ở phiên 2FA', tone: st.enforce_mfa_db ? 'good' : 'warn' },
      ]} />
      {ov.note && <p className="plnote" role="note">{ov.note}</p>}

      <form className="panel" onSubmit={saveSettings} key={st.updated_at}>
        <h3>Chính sách</h3>
        <fieldset className="modpick"><legend>Vai trò bắt buộc xác thực 2 lớp (ứng dụng xác thực TOTP)</legend>
          {roles.map(r => <label key={r.key} className="field inline"><input type="checkbox" name="mfa_roles" value={r.key} defaultChecked={st.mfa_roles.includes(r.key)} /> {r.name}</label>)}
        </fieldset>
        <div className="formgrid">
          <label className="field inline"><input type="checkbox" name="enforce" defaultChecked={st.enforce_mfa_db} /> Chặn ở cơ sở dữ liệu: quyền Quản trị nền tảng chỉ có hiệu lực khi phiên đã xác thực 2 lớp</label>
          <label className="field"><span>Tự đăng xuất khi không thao tác (phút, 0 = tắt)</span><input type="number" name="idle" min={0} max={1440} defaultValue={st.idle_minutes} /></label>
        </div>
        <p className="sub">Độ dài và độ phức tạp mật khẩu cấu hình trong Supabase Dashboard → Authentication → Providers → Email.</p>
        <div className="formactions"><button className="primary" type="submit">Lưu chính sách</button></div>
      </form>

      {err && <p className="msg">{err}</p>}
      {info && <p className="sub"><b>{info}</b></p>}
      <Tabs items={[['mfa', 'Tài khoản bắt buộc 2FA', ov.mfa_users.length], ['sessions', 'Phiên đăng nhập', ov.sessions?.length ?? 0], ['locked', 'Đang bị khoá', ov.locked.length], ['lock', 'Khoá tài khoản']]}
        value={t} onChange={setT} />

      {t === 'mfa' && (
        <div className="wrap"><table>
          <thead><tr><th>Người dùng</th><th>Vai trò bắt buộc</th><th>Ứng dụng xác thực</th></tr></thead>
          <tbody>
            {ov.mfa_users.map(u => <tr key={u.id}><td><b>{who(u)}</b><br /><small>{u.email}</small></td><td>{(u.roles ?? []).join(', ')}</td>
              <td>{u.enrolled === null ? <small>Không rõ</small> : <span className={'plbadge ' + (u.enrolled ? 'ok' : 'bad')}>{u.enrolled ? 'Đã đăng ký' : 'Chưa đăng ký'}</span>}</td></tr>)}
            {ov.mfa_users.length === 0 && <tr><td colSpan={3}>Chưa có ai thuộc vai trò bắt buộc.</td></tr>}
          </tbody>
        </table></div>
      )}
      {t === 'sessions' && (ov.sessions === null ? <p className="sub">Không đọc được bảng phiên của Supabase Auth.</p> : (
        <div className="wrap"><table>
          <thead><tr><th>Người dùng</th><th>Thiết bị</th><th>IP</th><th>Đăng nhập</th><th>Hoạt động gần nhất</th><th>Mức xác thực</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {ov.sessions.map(s => <tr key={s.id}><td><b>{s.full_name || s.email || '—'}</b><br /><small>{s.email}</small></td><td>{agent(s.user_agent)}</td><td>{s.ip ?? '—'}</td>
              <td>{s.created_at ? fmtTime(s.created_at) : '—'}</td><td>{s.updated_at ? fmtTime(s.updated_at) : '—'}</td>
              <td><span className={'plbadge ' + (s.aal === 'aal2' ? 'ok' : 'mute')}>{s.aal === 'aal2' ? '2 lớp' : 'Mật khẩu'}</span></td>
              <td><button type="button" onClick={() => revoke(s.id)}>Thu hồi</button></td></tr>)}
            {ov.sessions.length === 0 && <tr><td colSpan={7}>Không có phiên nào.</td></tr>}
          </tbody>
        </table></div>
      ))}
      {t === 'locked' && (
        <div className="wrap"><table>
          <thead><tr><th>Người dùng</th><th>Khoá lúc</th><th>Lý do</th><th>Người khoá</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {ov.locked.map(u => <tr key={u.id}><td><b>{who(u)}</b><br /><small>{u.email}</small></td><td>{fmtTime(u.locked_at)}</td><td>{u.reason ?? '—'}</td><td>{u.by ?? '—'}</td>
              <td><button type="button" onClick={() => unlock(u.id, who(u))}>Mở khoá</button></td></tr>)}
            {ov.locked.length === 0 && <tr><td colSpan={5}>Không có tài khoản nào bị khoá.</td></tr>}
          </tbody>
        </table></div>
      )}
      {t === 'lock' && (
        <div className="panel">
          <p className="sub">Tài khoản bị khoá mất quyền đọc và ghi mọi dữ liệu ngay lập tức, kể cả khi phiên đăng nhập vẫn còn. Không khoá được quản trị nền tảng: hãy gỡ vai trò trước.</p>
          <input className="search" type="search" placeholder="Nhập tên hoặc email (ít nhất 2 ký tự)…" aria-label="Tìm tài khoản để khoá" value={q} onChange={e => setQ(e.target.value)} />
          <ul className="plmaplist">
            {found.map(u => <li key={u.id}><span><b>{who(u)}</b> <small>{u.email}</small></span>
              {u.locked_at ? <button type="button" onClick={() => unlock(u.id, who(u))}>Mở khoá</button> : <button type="button" onClick={() => lock(u.id, who(u))}>Khoá</button>}</li>)}
            {q.trim().length >= 2 && found.length === 0 && <li><small>Không tìm thấy.</small></li>}
          </ul>
        </div>
      )}
    </>
  )
}
