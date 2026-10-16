import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { sendInviteEmail } from '../../lib/invite'
import {
  usePlatform, ORG_TYPE, TYPE_FULL, CHILD_TYPES, NEW_CHILD_TYPES, ROOT_TYPES, LEVELS, rolesFor, pathOf, nf, errText, type Org,
} from './data'

type MemberRow = { user_id: string; role_id: string; roles: { name: string } | null; profiles: { full_name: string | null; email: string | null } | null }
type Form =
  | { mode: 'edit'; name: string; code: string; level: string; ward: string; address: string }
  | { mode: 'child'; type: string; name: string; code: string; level: string; ward: string; parent: string | null }
  | { mode: 'move'; parent: string }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Cây tổ chức: xem toàn bộ Bộ → Tỉnh → Sở → Phòng → Trường; thêm/sửa/chuyển/kích hoạt/tạm dừng; gán người phụ trách
export function PlatformOrgs() {
  const { orgs, stats, roles, loading, err, reload } = usePlatform()
  const [sel, setSel] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  const [members, setMembers] = useState<MemberRow[]>([])
  const [add, setAdd] = useState({ email: '', role: '', send: true })
  const [busy, setBusy] = useState(false)

  const byId = useMemo(() => new Map(orgs.map(o => [o.id, o])), [orgs])
  const kids = useMemo(() => {
    const m = new Map<string | null, Org[]>()
    orgs.forEach(o => { const k = o.parent_id && byId.has(o.parent_id) ? o.parent_id : null; m.set(k, [...(m.get(k) ?? []), o]) })
    const rank = (o: Org) => ['ministry', 'provider', 'province', 'department', 'district', 'school'].indexOf(o.type)
    m.forEach(list => list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'vi')))
    return m
  }, [orgs, byId])
  // Tìm kiếm: giữ đơn vị khớp và toàn bộ cấp trên của nó
  const visible = useMemo(() => {
    if (!q.trim()) return null
    const s = q.trim().toLowerCase(), keep = new Set<string>()
    orgs.filter(o => o.name.toLowerCase().includes(s) || (o.code ?? '').toLowerCase().includes(s))
      .forEach(o => pathOf(o.id, byId).forEach(p => keep.add(p.id)))
    return keep
  }, [q, orgs, byId])

  const org = sel ? byId.get(sel) : undefined
  async function loadMembers(id: string) {
    const { data } = await supabase.from('memberships')
      .select('user_id, role_id, roles(name), profiles!memberships_user_id_fkey(full_name, email)').eq('org_id', id)
    setMembers((data as unknown as MemberRow[]) ?? [])
  }
  useEffect(() => { if (sel) { loadMembers(sel); setForm(null); setMsg(''); setInfo(''); setAdd({ email: '', role: '', send: true }) } }, [sel])
  useEffect(() => { if (!sel && orgs.length) setSel(kids.get(null)?.[0]?.id ?? null) }, [orgs.length])

  if (loading) return <p className="sub">Đang tải…</p>
  if (err) return <p className="msg">{err}</p>

  const done = async (error: { message: string } | null, ok: string) => {
    if (error) { setMsg(errText(error.message)); return false }
    setMsg(''); setInfo(ok); setForm(null); await reload(); return true
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    setBusy(true)
    if (form.mode === 'edit' && org) {
      await done((await supabase.from('organizations').update({
        name: form.name.trim(), code: form.code.trim() || null, level: org.type === 'school' ? form.level || null : null,
        ward: form.ward.trim() || null, address: form.address.trim() || null,
      }).eq('id', org.id)).error, 'Đã lưu thông tin đơn vị.')
    } else if (form.mode === 'child') {
      const { data, error } = await supabase.from('organizations').insert({
        type: form.type, parent_id: form.parent, name: form.name.trim(), code: form.code.trim() || null,
        level: form.type === 'school' ? form.level || null : null, ward: form.ward.trim() || null,
      }).select('id').single()
      if (await done(error, `Đã tạo ${TYPE_FULL[form.type].toLowerCase()} “${form.name.trim()}”.`) && data) {
        if (form.parent) setClosed(c => { const n = new Set(c); n.delete(form.parent!); return n })
        setSel((data as { id: string }).id)
      }
    } else if (form.mode === 'move' && org) {
      await done((await supabase.from('organizations').update({ parent_id: form.parent || null }).eq('id', org.id)).error, 'Đã chuyển đơn vị.')
    }
    setBusy(false)
  }
  async function setActive(o: Org, on: boolean) {
    await done((await supabase.from('organizations').update({ activated_at: on ? new Date().toISOString() : null }).eq('id', o.id)).error,
      on ? 'Đã kích hoạt trường.' : 'Đã bỏ kích hoạt.')
  }
  async function setStatus(o: Org, status: 'active' | 'suspended') {
    if (status === 'suspended' && !confirm(`Tạm dừng “${o.name}”? Mọi tài khoản của đơn vị này sẽ không vào làm việc được cho tới khi mở lại.`)) return
    await done((await supabase.from('organizations').update({ status }).eq('id', o.id)).error, status === 'active' ? 'Đã mở lại đơn vị.' : 'Đã tạm dừng đơn vị.')
  }
  async function remove(o: Org) {
    if (!confirm(`Xoá vĩnh viễn “${o.name}”?`)) return
    const { error } = await supabase.from('organizations').delete().eq('id', o.id)
    if (await done(error, 'Đã xoá đơn vị.')) setSel(o.parent_id)
  }
  async function addMember(e: React.FormEvent) {
    e.preventDefault(); if (!org) return
    const email = add.email.trim().toLowerCase()
    if (!EMAIL.test(email)) return setMsg('Email không hợp lệ.')
    if (!add.role) return setMsg('Chọn vai trò.')
    setBusy(true); setMsg(''); setInfo('')
    const { data: p } = await supabase.from('profiles').select('id').ilike('email', email).maybeSingle()
    if (p) {
      const { error } = await supabase.from('memberships').insert({ user_id: (p as { id: string }).id, org_id: org.id, role_id: add.role })
      if (error) setMsg(error.message.includes('duplicate') ? 'Người này đã có vai trò đó tại đơn vị.' : errText(error.message))
      else setInfo(`Đã gán vai trò cho ${email}.`)
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('invitations').insert({ org_id: org.id, email, role_id: add.role, invited_by: user?.id })
      if (error) setMsg(error.message.includes('invitations_pending_email') ? 'Email này đang có lời mời chờ.' : errText(error.message))
      else {
        let sent = ''
        if (add.send) { const r = await sendInviteEmail(email, null); sent = r.error ? ` Chưa gửi được email: ${r.error.message}` : ' Đã gửi email đăng nhập.' }
        setInfo(`Chưa có tài khoản ${email} — đã tạo lời mời.${sent}`)
      }
    }
    setAdd({ ...add, email: '' }); setBusy(false); loadMembers(org.id); reload()
  }
  async function removeMember(m: MemberRow) {
    if (!org || !confirm(`Gỡ vai trò ${m.roles?.name} của ${m.profiles?.full_name ?? m.profiles?.email}?`)) return
    const { error } = await supabase.from('memberships').delete().eq('user_id', m.user_id).eq('org_id', org.id).eq('role_id', m.role_id)
    if (error) setMsg(errText(error.message)); else { setInfo('Đã gỡ vai trò.'); loadMembers(org.id); reload() }
  }

  // Đơn vị cha hợp lệ khi chuyển (không phải chính nó hoặc con cháu của nó)
  const descendants = (id: string) => { const out = new Set<string>([id]); const walk = (x: string) => (kids.get(x) ?? []).forEach(k => { out.add(k.id); walk(k.id) }); walk(id); return out }
  const parentOptions = org ? orgs.filter(p => CHILD_TYPES[p.type]?.includes(org.type) && !descendants(org.id).has(p.id)) : []
  const canRoot = org ? ROOT_TYPES.includes(org.type) : false

  // Hàm vẽ nút cây (gọi trực tiếp, không làm component để tránh dựng lại khi state đổi)
  function renderNode(o: Org, depth: number): React.ReactNode {
    if (visible && !visible.has(o.id)) return null
    const ch = kids.get(o.id) ?? []
    const shut = closed.has(o.id) && !visible
    const s = stats.get(o.id)
    return (
      <li key={o.id}>
        <div className={'tnode' + (sel === o.id ? ' on' : '') + (o.status === 'suspended' ? ' off' : '')} style={{ paddingLeft: 6 + depth * 16 }}>
          {ch.length ? (
            <button type="button" className="caret" aria-label={shut ? 'Mở' : 'Thu gọn'} aria-expanded={!shut}
              onClick={() => setClosed(c => { const n = new Set(c); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n })}>{shut ? '▸' : '▾'}</button>
          ) : <span className="caret" />}
          <button type="button" className="tlabel" onClick={() => setSel(o.id)}>
            <span className={'ttype t-' + o.type}>{ORG_TYPE[o.type]}</span>
            <span className="tname">{o.name}</span>
            {o.status === 'suspended' && <span className="gpill bad" title="Tạm dừng" aria-label="Tạm dừng"><i aria-hidden="true">⏸</i></span>}
            {o.type === 'school' && !o.activated_at && o.status === 'active' && <span className="gpill warn" title="Chưa kích hoạt" aria-label="Chưa kích hoạt"><i aria-hidden="true">!</i></span>}
            <small>{o.type === 'school' ? `${nf(s?.members)} TK` : `${nf(s?.schools)} trường · ${nf(s?.members)} TK`}</small>
          </button>
        </div>
        {ch.length > 0 && !shut && <ul>{ch.map(k => renderNode(k, depth + 1))}</ul>}
      </li>
    )
  }

  const orgRoles = rolesFor(org, roles)
  const s = org ? stats.get(org.id) : undefined
  const grouped = new Map<string, MemberRow[]>()
  members.forEach(m => grouped.set(m.user_id, [...(grouped.get(m.user_id) ?? []), m]))

  return (
    <div className="split">
      <div className="panel tree">
        <div className="bar">
          <input className="search" placeholder="Tìm đơn vị theo tên hoặc mã…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm đơn vị" />
        </div>
        <div className="bar small">
          <button type="button" className="linkbtn" onClick={() => setClosed(new Set())}>Mở hết</button>
          <button type="button" className="linkbtn" onClick={() => setClosed(new Set(orgs.filter(o => o.type !== 'ministry' && (kids.get(o.id) ?? []).length).map(o => o.id)))}>Thu gọn</button>
          <button type="button" className="linkbtn" onClick={() => { setSel(null); setForm({ mode: 'child', type: 'province', name: '', code: '', level: '', ward: '', parent: null }) }}>+ Đơn vị gốc</button>
        </div>
        <p className="tree-legend"><span><span className="gpill warn"><i aria-hidden="true">!</i></span> Chưa kích hoạt</span><span><span className="gpill bad"><i aria-hidden="true">⏸</i></span> Tạm dừng</span><span>TK = tài khoản</span></p>
        <ul className="orgtree">{(kids.get(null) ?? []).map(o => renderNode(o, 0))}</ul>
      </div>

      <div className="detail">
        {msg && <p className="msg">{msg}</p>}
        {info && <p className="sub"><b>{info}</b></p>}

        {form?.mode === 'child' && (
          <form className="panel formgrid" onSubmit={save}>
            <h3 style={{ gridColumn: '1 / -1' }}>{form.parent ? `Thêm đơn vị trực thuộc ${byId.get(form.parent)?.name}` : 'Thêm đơn vị gốc'}</h3>
            <label className="field"><span>Loại *</span>
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                {(form.parent ? NEW_CHILD_TYPES[byId.get(form.parent)!.type] : ROOT_TYPES).map(t => <option key={t} value={t}>{TYPE_FULL[t]}</option>)}
              </select></label>
            <label className="field"><span>Tên *</span><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={form.type === 'school' ? 'Trường THCS …' : TYPE_FULL[form.type] + ' …'} /></label>
            <label className="field"><span>Mã đơn vị</span><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="VD: THCS-KB" /></label>
            {form.type === 'school' && <label className="field"><span>Cấp học</span>
              <select value={form.level} onChange={e => setForm({ ...form, level: e.target.value })}><option value="">—</option>{LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
            {form.type === 'school' && <label className="field"><span>Xã/phường</span><input value={form.ward} onChange={e => setForm({ ...form, ward: e.target.value })} /></label>}
            <div className="formactions"><button className="primary" disabled={busy}>Tạo đơn vị</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
          </form>
        )}

        {org && (
          <>
            <div className="panel">
              <nav className="crumbs" aria-label="Cấp trên">{pathOf(org.parent_id, byId).map(p => <button type="button" key={p.id} className="linkbtn" onClick={() => setSel(p.id)}>{p.name}</button>)}</nav>
              <div className="bar">
                <div>
                  <h2 style={{ margin: '2px 0' }}>{org.name}</h2>
                  <p className="sub" style={{ margin: 0 }}>{TYPE_FULL[org.type]}{org.code ? ` · ${org.code}` : ''}{org.is_platform ? ' · Chủ nền tảng' : ''}
                    {org.type === 'school' && <> · {org.activated_at ? `Kích hoạt ${new Date(org.activated_at).toLocaleDateString('vi-VN')}` : 'Chưa kích hoạt'}</>}
                    {org.status === 'suspended' && <b className="bad"> · Đang tạm dừng</b>}</p>
                </div>
                <div className="actions">
                  <button type="button" onClick={() => setForm({ mode: 'edit', name: org.name, code: org.code ?? '', level: org.level ?? '', ward: org.ward ?? '', address: org.address ?? '' })}>Sửa</button>
                  {NEW_CHILD_TYPES[org.type].length > 0 && <button type="button" onClick={() => setForm({ mode: 'child', type: NEW_CHILD_TYPES[org.type][0], name: '', code: '', level: '', ward: '', parent: org.id })}>+ Đơn vị trực thuộc</button>}
                  {!org.is_platform && (parentOptions.length > 0 || canRoot) && <button type="button" onClick={() => setForm({ mode: 'move', parent: org.parent_id ?? '' })}>Chuyển</button>}
                  {org.type === 'school' && <button type="button" onClick={() => setActive(org, !org.activated_at)}>{org.activated_at ? 'Bỏ kích hoạt' : 'Kích hoạt'}</button>}
                  {!org.is_platform && <button type="button" onClick={() => setStatus(org, org.status === 'active' ? 'suspended' : 'active')}>{org.status === 'active' ? 'Tạm dừng' : 'Mở lại'}</button>}
                  {!org.is_platform && !(kids.get(org.id) ?? []).length && members.length === 0 && <button type="button" className="danger" onClick={() => remove(org)}>Xoá</button>}
                </div>
              </div>

              {form?.mode === 'edit' && (
                <form className="formgrid" onSubmit={save} style={{ marginTop: 12 }}>
                  <label className="field"><span>Tên *</span><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
                  <label className="field"><span>Mã</span><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
                  {org.type === 'school' && <label className="field"><span>Cấp học</span>
                    <select value={form.level} onChange={e => setForm({ ...form, level: e.target.value })}><option value="">—</option>{LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
                  <label className="field"><span>Xã/phường</span><input value={form.ward} onChange={e => setForm({ ...form, ward: e.target.value })} /></label>
                  <label className="field"><span>Địa chỉ</span><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></label>
                  <div className="formactions"><button className="primary" disabled={busy}>Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
                </form>
              )}
              {form?.mode === 'move' && (
                <form className="formgrid" onSubmit={save} style={{ marginTop: 12 }}>
                  <label className="field" style={{ gridColumn: '1 / -1' }}><span>Chuyển “{org.name}” sang trực thuộc</span>
                    <select value={form.parent} onChange={e => setForm({ mode: 'move', parent: e.target.value })}>
                      {canRoot && <option value="">— Không trực thuộc (đơn vị gốc) —</option>}
                      {parentOptions.map(p => <option key={p.id} value={p.id}>{pathOf(p.id, byId).map(x => x.name).join(' › ')}</option>)}
                    </select></label>
                  <div className="formactions"><button className="primary" disabled={busy}>Chuyển</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
                </form>
              )}

              <div className="ktiles" style={{ marginTop: 14 }}>
                <div className="ktile"><span>Tài khoản tại đơn vị</span><b>{nf(s?.members)}</b></div>
                {org.type !== 'school' && <div className="ktile"><span>Trường trực thuộc</span><b>{nf(s?.schools)}</b><small>{nf(s?.schools_active)} đang hoạt động</small></div>}
                <div className="ktile"><span>Giáo viên</span><b>{nf(s?.teachers)}</b></div>
                <div className="ktile"><span>Học sinh</span><b>{nf(s?.students)}</b></div>
              </div>
            </div>

            <div className="panel">
              <h3>Người phụ trách & vai trò tại đơn vị</h3>
              {orgRoles.length === 0 ? <p className="sub">Loại đơn vị này chưa có vai trò để gán.</p> : (
                <form className="formgrid" onSubmit={addMember}>
                  <label className="field"><span>Email</span><input value={add.email} onChange={e => setAdd({ ...add, email: e.target.value })} placeholder="nguoidung@donvi.edu.vn" /></label>
                  <label className="field"><span>Vai trò</span>
                    <select value={add.role} onChange={e => setAdd({ ...add, role: e.target.value })}>
                      <option value="">Chọn vai trò…</option>
                      {orgRoles.map(r => <option key={r.id} value={r.id}>{r.name}{r.org_id ? ' (tuỳ chỉnh)' : ''}</option>)}
                    </select></label>
                  <label className="field"><span>Nếu chưa có tài khoản</span>
                    <span><input type="checkbox" checked={add.send} onChange={e => setAdd({ ...add, send: e.target.checked })} /> Gửi email mời</span></label>
                  <div className="formactions"><button className="primary" disabled={busy}>Gán / mời</button></div>
                </form>
              )}
              <div className="wrap">
                <table>
                  <thead><tr><th>Người dùng</th><th>Vai trò</th></tr></thead>
                  <tbody>
                    {[...grouped.values()].map(list => (
                      <tr key={list[0].user_id}>
                        <td><b>{list[0].profiles?.full_name ?? '—'}</b><br /><small>{list[0].profiles?.email}</small></td>
                        <td>{list.map(m => <span className="chip" key={m.role_id}>{m.roles?.name}<button className="x" onClick={() => removeMember(m)} aria-label={`Gỡ vai trò ${m.roles?.name}`}>×</button></span>)}</td>
                      </tr>
                    ))}
                    {members.length === 0 && <tr><td colSpan={2}>Chưa có ai tại đơn vị này.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
