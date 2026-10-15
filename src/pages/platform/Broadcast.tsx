import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { usePlatform, pathOf, fmtTime, TYPE_FULL } from './data'

// Thông báo hàng loạt (migration 025): gửi vào chuông thông báo trong ứng dụng theo đơn vị, loại đơn vị, vai trò

type B = { id: string; title: string; body: string | null; page: string | null; target: { org_ids: string[] | null; org_types: string[] | null; role_keys: string[] | null }
  recipients: number; reads: number; created_at: string; created_by_name: string | null }
const TYPES = ['department', 'district', 'school', 'province', 'ministry']
function errText(m: string) {
  if (/schema cache|does not exist|function/i.test(m)) return 'Hãy chạy migration 025_platform_wave2_rollout_catalog_broadcast.sql trên Supabase.'
  return m
}

export function PlatformBroadcast() {
  const p = usePlatform()
  const [hist, setHist] = useState<B[]>([])
  const [orgIds, setOrgIds] = useState<string[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [roleKeys, setRoleKeys] = useState<string[]>([])
  const [title, setTitle] = useState(''); const [body, setBody] = useState('')
  const [orgQ, setOrgQ] = useState('')
  const [preview, setPreview] = useState<{ users: number; orgs: number } | null>(null)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => supabase.rpc('platform_broadcasts').then(({ data, error }) => error ? setMsg(errText(error.message)) : setHist((data as B[]) ?? []))
  useEffect(() => { load() }, [])
  const args = { p_org_ids: orgIds.length ? orgIds : null, p_org_types: types.length ? types : null, p_role_keys: roleKeys.length ? roleKeys : null }
  useEffect(() => {
    const h = setTimeout(() => supabase.rpc('platform_broadcast_preview', args).then(({ data }) => setPreview((data as any) ?? null)), 300)
    return () => clearTimeout(h)
  }, [orgIds.join(), types.join(), roleKeys.join()])

  const byId = useMemo(() => new Map(p.orgs.map(o => [o.id, o])), [p.orgs])
  const label = (id: string) => pathOf(id, byId).map(o => o.name).join(' › ')
  const roles = p.roles.filter(r => !r.org_id)
  const roleName = (k: string) => roles.find(r => r.key === k)?.name ?? k
  // Chọn đơn vị: ưu tiên cơ quan quản lý; gõ để tìm cả trường
  const s = orgQ.trim().toLowerCase()
  const orgOpts = p.orgs.filter(o => !o.is_platform && (s ? label(o.id).toLowerCase().includes(s) : o.type !== 'school'))
    .sort((a, b) => label(a.id).localeCompare(label(b.id), 'vi')).slice(0, 60)
  const tog = (xs: string[], x: string, set: (v: string[]) => void) => set(xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x])
  const summary = (t: B['target']) => [
    t.org_ids?.length ? t.org_ids.map(id => byId.get(id)?.name ?? '?').join(', ') : 'Toàn hệ thống',
    t.org_types?.length ? t.org_types.map(x => TYPE_FULL[x] ?? x).join(', ') : null,
    t.role_keys?.length ? t.role_keys.map(roleName).join(', ') : 'mọi vai trò',
  ].filter(Boolean).join(' · ')

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!preview?.users) return setMsg('Không có người nhận phù hợp.')
    if (!confirm(`Gửi “${title}” tới ${preview.users} người?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('platform_broadcast', { p_title: title, p_body: body || null, p_page: null, ...args })
    setBusy(false)
    if (error) return setMsg(errText(error.message))
    setMsg(''); setInfo(`Đã gửi tới ${(data as any).recipients} người.`); setTitle(''); setBody(''); load()
  }

  if (p.loading) return <p className="sub">Đang tải…</p>
  return (
    <>
      <form className="panel" onSubmit={send}>
        <h3>Soạn thông báo</h3>
        <div className="formgrid">
          <label className="field spanall"><span>Tiêu đề *</span><input required maxLength={150} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ví dụ: Bảo trì hệ thống 22:00–23:00 thứ Bảy" /></label>
          <label className="field spanall"><span>Nội dung</span><textarea rows={3} value={body} onChange={e => setBody(e.target.value)} /></label>
        </div>
        <div className="bcgrid">
          <fieldset className="modpick"><legend>Đơn vị (kèm cấp dưới) — bỏ trống = toàn hệ thống</legend>
            <input className="search spanall" type="search" placeholder="Tìm Sở, Phòng, trường…" aria-label="Tìm đơn vị nhận" value={orgQ} onChange={e => setOrgQ(e.target.value)} />
            {orgIds.map(id => <label key={id} className="field inline"><input type="checkbox" checked onChange={() => tog(orgIds, id, setOrgIds)} /> <b>{label(id)}</b></label>)}
            {orgOpts.filter(o => !orgIds.includes(o.id)).map(o => <label key={o.id} className="field inline"><input type="checkbox" checked={false} onChange={() => tog(orgIds, o.id, setOrgIds)} /> {label(o.id)}</label>)}
          </fieldset>
          <div>
            <fieldset className="modpick"><legend>Loại đơn vị — bỏ trống = mọi loại</legend>
              {TYPES.map(t => <label key={t} className="field inline"><input type="checkbox" checked={types.includes(t)} onChange={() => tog(types, t, setTypes)} /> {TYPE_FULL[t]}</label>)}
            </fieldset>
            <fieldset className="modpick"><legend>Vai trò — bỏ trống = mọi vai trò</legend>
              {roles.map(r => <label key={r.key} className="field inline"><input type="checkbox" checked={roleKeys.includes(r.key)} onChange={() => tog(roleKeys, r.key, setRoleKeys)} /> {r.name}</label>)}
            </fieldset>
          </div>
        </div>
        <div className="bar">
          <p className="sub" style={{ margin: 0 }} aria-live="polite">{preview ? <>Sẽ gửi tới <b>{preview.users}</b> người tại <b>{preview.orgs}</b> đơn vị. Tài khoản bị khoá và đơn vị tạm dừng không nhận.</> : 'Đang tính số người nhận…'}</p>
          <button className="primary" type="submit" disabled={busy || !title.trim() || !preview?.users}>Gửi thông báo</button>
        </div>
        {msg && <p className="msg">{msg}</p>}
        {info && <p className="sub"><b>{info}</b></p>}
      </form>

      <h3>Đã gửi</h3>
      <div className="wrap">
        <table>
          <thead><tr><th>Thông báo</th><th>Gửi tới</th><th>Đã đọc</th><th>Thời gian</th></tr></thead>
          <tbody>
            {hist.map(b => (
              <tr key={b.id}>
                <td><b>{b.title}</b>{b.body && <><br /><small>{b.body.slice(0, 140)}</small></>}</td>
                <td>{summary(b.target)}<br /><small>{b.recipients} người</small></td>
                <td><span className="plbar"><span className="track"><span className="fill b" style={{ width: (b.recipients ? b.reads / b.recipients * 100 : 0) + '%' }} /></span><small>{b.reads}/{b.recipients}</small></span></td>
                <td>{fmtTime(b.created_at)}<br /><small>{b.created_by_name}</small></td>
              </tr>
            ))}
            {hist.length === 0 && <tr><td colSpan={4}>Chưa gửi thông báo nào.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
