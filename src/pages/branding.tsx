import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { norm } from '../lib/sheet'
import { contrast, logoToDataUrl, shade, DEFAULT_COLORS, DEFAULT_TITLE, type Branding } from '../lib/branding'
import kdiLogo from '../assets/kdi-logo.png'
import kdiLogoWhite from '../assets/kdi-logo-white.png'

// Giao diện & thương hiệu (migration 047): KDI đặt cho từng khách hàng; khách hàng tự sửa khi được KDI bật.
type Row = Branding & { org_id: string; domains: string[]; applies_to_children: boolean; self_edit: boolean; updated_at?: string; organizations?: { name: string; type: string } | null }
type Org = { id: string; name: string; type: string; code: string | null }
const TYPE: Record<string, string> = { ministry: 'Bộ', province: 'Tỉnh', department: 'Sở', district: 'Phòng', school: 'Trường', provider: 'Đơn vị cung cấp' }
const blank = (org_id: string): Row => ({ org_id, display_name: '', short_name: '', logo: null, logo_dark: null, primary_color: null, sidebar_color: null, accent_color: null,
  login_message: '', support_text: '', domains: [], applies_to_children: true, self_edit: false })
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 047 trên Supabase.' : /row-level|42501|KDI/i.test(m) ? m.replace(/^.*?:\s*/, '') || 'Bạn không có quyền.' : /domain|miền/i.test(m) ? m : m)

function Preview({ r }: { r: Row }) {
  const p = r.primary_color || DEFAULT_COLORS.primary, s = r.sidebar_color || DEFAULT_COLORS.sidebar, a = r.accent_color || DEFAULT_COLORS.accent
  return (
    <div className="brandprev" aria-label="Xem trước giao diện">
      <div className="bp-side" style={{ background: s }}>
        {r.logo_dark ? <img src={r.logo_dark} alt="" /> : r.logo ? <img src={r.logo} alt="" style={{ background: '#fff', borderRadius: 6, padding: '3px 6px' }} /> : <img src={kdiLogoWhite} alt="" />}
        <h5 style={{ color: a }}>Tổng quan</h5>
        <span style={{ background: shade(s, 0.12) }}>Dashboard</span><span>Giáo viên</span><span>Lớp học</span>
      </div>
      <div>
        <div className="bp-top"><img src={r.logo || kdiLogo} alt="" /><b>{r.display_name || DEFAULT_TITLE}</b></div>
        <div className="bp-body">
          <b style={{ fontSize: 14 }}>Dashboard Trường</b>
          <span className="sub">Màu chủ đạo dùng cho nút, liên kết, thanh tiến độ.</span>
          <span className="bp-btn" style={{ background: p }}>+ Thêm mới</span>
          <div style={{ height: 8, borderRadius: 4, background: '#eff4f9' }}><div style={{ width: '62%', height: '100%', borderRadius: 4, background: p }} /></div>
        </div>
      </div>
    </div>
  )
}

function Editor({ row, platform, onSaved, onCancel }: { row: Row; platform: boolean; onSaved: () => void; onCancel?: () => void }) {
  const [r, setR] = useState<Row>(row)
  const [domains, setDomains] = useState(row.domains.join('\n'))
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => { setR(row); setDomains(row.domains.join('\n')) }, [row.org_id])
  const set = (p: Partial<Row>) => setR({ ...r, ...p })
  const warn: string[] = []
  const p = r.primary_color || DEFAULT_COLORS.primary, s = r.sidebar_color || DEFAULT_COLORS.sidebar, a = r.accent_color || DEFAULT_COLORS.accent
  if (contrast(p, '#ffffff') < 4.5) warn.push(`Chữ trắng trên màu chủ đạo khó đọc (tương phản ${contrast(p, '#ffffff').toFixed(1)}:1, cần ≥ 4,5) — chọn màu đậm hơn.`)
  if (contrast(s, '#ffffff') < 4.5) warn.push(`Chữ trắng trên thanh menu khó đọc (${contrast(s, '#ffffff').toFixed(1)}:1) — chọn màu đậm hơn.`)
  if (contrast(a, s) < 3) warn.push(`Màu nhấn khó nhìn trên thanh menu (${contrast(a, s).toFixed(1)}:1, cần ≥ 3).`)
  async function upload(e: React.ChangeEvent<HTMLInputElement>, key: 'logo' | 'logo_dark') {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
    try { set({ [key]: await logoToDataUrl(f) } as Partial<Row>) } catch (x) { setMsg([(x as Error).message, true]) }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    const row = { display_name: r.display_name?.trim() || null, short_name: r.short_name?.trim() || null, logo: r.logo, logo_dark: r.logo_dark,
      primary_color: r.primary_color, sidebar_color: r.sidebar_color, accent_color: r.accent_color, login_message: r.login_message?.trim() || null, support_text: r.support_text?.trim() || null,
      ...(platform ? { domains: domains.split(/[\s,;]+/).map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean), applies_to_children: r.applies_to_children, self_edit: r.self_edit } : {}) }
    const { error } = platform ? await supabase.from('org_branding').upsert({ org_id: r.org_id, ...row }) : await supabase.from('org_branding').update(row).eq('org_id', r.org_id)
    if (error) return setMsg([errText(error.message), true])
    setMsg(['Đã lưu. Người dùng thấy giao diện mới khi tải lại trang.', false]); window.dispatchEvent(new Event('branding-changed')); onSaved()
  }
  const color = (k: 'primary_color' | 'sidebar_color' | 'accent_color', label: string, def: string) => (
    <label className="field"><span>{label}</span><span className="tools" style={{ alignItems: 'center' }}>
      <input type="color" value={r[k] || def} onChange={e => set({ [k]: e.target.value } as Partial<Row>)} style={{ width: 44, height: 34, padding: 2 }} aria-label={label} />
      <input value={r[k] ?? ''} placeholder={def} onChange={e => set({ [k]: /^#[0-9a-fA-F]{6}$/.test(e.target.value) ? e.target.value : e.target.value === '' ? null : r[k] } as Partial<Row>)} style={{ width: 90 }} aria-label={label + ' (mã màu)'} />
      {r[k] && <button type="button" onClick={() => set({ [k]: null } as Partial<Row>)}>Mặc định</button>}</span></label>
  )
  return (
    <form className="panel" onSubmit={save}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }} className="brandgrid">
        <div className="formgrid" style={{ alignContent: 'start' }}>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên hệ thống (thanh trên cùng, trang đăng nhập)</span><input value={r.display_name ?? ''} onChange={e => set({ display_name: e.target.value })} placeholder={DEFAULT_TITLE} maxLength={80} /></label>
          <label className="field"><span>Logo (nền sáng)</span><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => upload(e, 'logo')} />
            {r.logo && <button type="button" onClick={() => set({ logo: null })}>Bỏ logo</button>}</label>
          <label className="field"><span>Logo cho thanh menu (nền tối, tuỳ chọn)</span><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => upload(e, 'logo_dark')} />
            {r.logo_dark && <button type="button" onClick={() => set({ logo_dark: null })}>Bỏ</button>}</label>
          {color('primary_color', 'Màu chủ đạo (nút, liên kết)', DEFAULT_COLORS.primary)}
          {color('sidebar_color', 'Màu thanh menu', DEFAULT_COLORS.sidebar)}
          {color('accent_color', 'Màu nhấn (tiêu đề nhóm menu)', DEFAULT_COLORS.accent)}
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Lời chào trên trang đăng nhập</span><textarea rows={2} maxLength={500} value={r.login_message ?? ''} onChange={e => set({ login_message: e.target.value })}
            placeholder="VD: Hệ thống quản lý giáo dục STEM của Sở GD&ĐT … Tài khoản do nhà trường cấp." /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Thông tin hỗ trợ (chân trang đăng nhập)</span><input maxLength={300} value={r.support_text ?? ''} onChange={e => set({ support_text: e.target.value })} placeholder="VD: Hỗ trợ: 0221 xxx xxx · stem@hungyen.edu.vn" /></label>
          {platform && <>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên miền riêng (mỗi dòng một tên; trang đăng nhập hiện thương hiệu này)</span>
              <textarea rows={2} value={domains} onChange={e => setDomains(e.target.value)} placeholder="stem.hungyen.edu.vn" /></label>
            <label style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={r.applies_to_children} onChange={e => set({ applies_to_children: e.target.checked })} /> Áp dụng cho mọi đơn vị trực thuộc (trường trong tỉnh dùng chung giao diện)</label>
            <label style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={r.self_edit} onChange={e => set({ self_edit: e.target.checked })} /> Cho đơn vị tự sửa (trừ tên miền và quyền này)</label>
          </>}
        </div>
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <Preview r={r} />
          {warn.map(w => <p key={w} className="msg" style={{ margin: 0 }}>⚠ {w}</p>)}
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <div className="formactions"><button className="primary" type="submit">Lưu</button>{onCancel && <> <button type="button" onClick={onCancel}>Đóng</button></>}</div>
    </form>
  )
}

export function BrandingPage({ orgId, platform = false }: { orgId: string | null; platform?: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [orgs, setOrgs] = useState<Org[]>([])
  const [eff, setEff] = useState<(Branding & { org_id: string }) | null>(null)
  const [sel, setSel] = useState<Row | null>(null)
  const [q, setQ] = useState('')
  const [pickOrg, setPickOrg] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [b, o, e] = await Promise.all([
      supabase.from('org_branding').select('*, organizations(name, type)').order('updated_at', { ascending: false }),
      platform ? supabase.from('organizations').select('id, name, type, code').neq('type', 'school').order('name') : Promise.resolve({ data: [] }),
      supabase.rpc('my_branding'),
    ])
    if (b.error) setMsg([errText(b.error.message), true])
    setRows((b.data as Row[]) ?? []); setOrgs(((o as any).data as Org[]) ?? []); setEff((e.data as any) ?? null)
  }
  useEffect(() => { load() }, [])
  async function remove(r: Row) {
    if (!confirm(`Xoá thương hiệu của ${r.organizations?.name}? Đơn vị sẽ dùng giao diện của cấp trên hoặc giao diện KDI.`)) return
    const { error } = await supabase.from('org_branding').delete().eq('org_id', r.org_id)
    if (error) return setMsg([errText(error.message), true]); setSel(null); load()
  }

  if (!platform) {
    const own = rows.find(r => r.org_id === orgId)
    return (
      <>
        <p className="sub">Giao diện riêng (tên hệ thống, logo, màu) của đơn vị do KDI thiết lập theo hợp đồng{eff?.inherited ? ` — đang dùng giao diện của ${eff.source}.` : '.'}</p>
        {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
        {own && own.self_edit ? <Editor row={own} platform={false} onSaved={load} />
          : <div className="panel"><Preview r={{ ...blank(orgId ?? ''), ...(eff ?? {}) } as Row} />
              <p className="sub" style={{ marginBottom: 0 }}>{own ? 'KDI chưa bật quyền tự sửa cho đơn vị.' : eff ? 'Đơn vị đang dùng giao diện của cấp trên.' : 'Đơn vị đang dùng giao diện mặc định của KDI.'} Liên hệ KDI (mục Hỗ trợ từ KDI) để thay đổi.</p></div>}
      </>
    )
  }
  const free = orgs.filter(o => !rows.some(r => r.org_id === o.id) && (!q || norm(o.name + ' ' + (o.code ?? '')).includes(norm(q)))).slice(0, 60)
  return (
    <>
      <p className="sub">Đặt tên hệ thống, logo, màu và tên miền riêng cho Sở / Phòng / khách hàng. Thương hiệu của Sở áp cho mọi trường trực thuộc (trường không có thương hiệu riêng). Cổng KDI luôn giữ giao diện gốc.</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      <div className="panel formgrid">
        <label className="field"><span>Tìm đơn vị</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="Tên hoặc mã Sở / Phòng…" /></label>
        <label className="field"><span>Thêm thương hiệu cho</span><select value={pickOrg} onChange={e => setPickOrg(e.target.value)}><option value="">— chọn đơn vị —</option>
          {free.map(o => <option key={o.id} value={o.id}>{TYPE[o.type] ?? o.type} · {o.name}</option>)}</select></label>
        <div className="formactions"><button className="primary" disabled={!pickOrg} onClick={() => { const o = orgs.find(x => x.id === pickOrg)!; setSel({ ...blank(o.id), display_name: `Hệ thống STEM ${o.name.replace(/^Sở GD&ĐT\s*/i, '')}`, organizations: { name: o.name, type: o.type } }); setPickOrg('') }}>Tạo</button></div>
      </div>
      {sel && <><h3>{sel.organizations?.name}</h3><Editor key={sel.org_id} row={sel} platform onSaved={() => { load() }} onCancel={() => setSel(null)} /></>}
      <div className="wrap"><table>
        <thead><tr><th>Đơn vị</th><th>Tên hệ thống</th><th>Logo</th><th>Màu</th><th>Tên miền</th><th>Phạm vi</th><th /></tr></thead>
        <tbody>{rows.map(r => <tr key={r.org_id}>
          <td><b>{r.organizations?.name}</b><br /><small>{TYPE[r.organizations?.type ?? ''] ?? ''}</small></td><td>{r.display_name ?? '—'}</td>
          <td>{r.logo ? <img src={r.logo} alt="" style={{ maxHeight: 28, maxWidth: 100, objectFit: 'contain' }} /> : '—'}</td>
          <td><span style={{ display: 'inline-flex', gap: 3 }}>{[r.primary_color, r.sidebar_color, r.accent_color].map((c, i) => <i key={i} title={c ?? 'mặc định'} style={{ width: 16, height: 16, borderRadius: 4, background: c ?? '#e0e5eb', display: 'inline-block', border: '1px solid #0001' }} />)}</span></td>
          <td><small>{r.domains.join(', ') || '—'}</small></td>
          <td><small>{r.applies_to_children ? 'Gồm đơn vị trực thuộc' : 'Chỉ đơn vị này'}{r.self_edit ? ' · tự sửa' : ''}</small></td>
          <td className="nowrap"><button onClick={() => setSel(r)}>Sửa</button> <button onClick={() => remove(r)}>Xoá</button></td></tr>)}
          {!rows.length && <tr><td colSpan={7}>Chưa có khách hàng nào dùng giao diện riêng.</td></tr>}</tbody>
      </table></div>
    </>
  )
}
