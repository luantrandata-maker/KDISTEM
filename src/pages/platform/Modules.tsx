// Quản trị chung quản lý 5 phân hệ (migration 033)
//  • Phân hệ & mức sử dụng (Tổng quan): mỗi phân hệ — gói, hợp đồng, số trường được bật / đang dùng thật, chức năng còn khung.
//  • Vai trò & quyền mặc định (Lõi): ma trận vai trò × chức năng, nhóm theo phân hệ; KDI sửa, có nhật ký.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { NAV } from '../../lib/nav'
import { downloadXlsx } from '../../lib/sheet'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'

type Usage = { key: string; name: string; description: string | null; sort: number; perm_modules: string[]; plans: number; contracts_active: number
  schools_total: number; schools_enabled: number; schools_active: number; events_28d: number; depts_enabled: number; depts_active: number | null }
type Detail = { org_id: string; name: string; code: string | null; parent_name: string | null; province_name: string | null; state: string
  plan_name: string | null; enabled: boolean; events: number }

const nf = (n: number) => n.toLocaleString('vi-VN')
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const errText = (m: string) => /schema cache|does not exist|function/i.test(m) ? 'Hãy chạy migration 033_modules_ph1_ph5.sql trên Supabase.' : m
const EVENT: Record<string, string> = {
  ph1: 'lượt GV có mặt tập huấn', ph2: 'bài giảng, hoạt động, bài tự học được soạn/giao', ph3: 'phiếu mượn + tiết dạy tại phòng STEM',
  ph4: 'tiết đã điểm danh', ph5: 'báo cáo Sở đã xuất',
}
// Nhóm menu của cổng nền tảng thuộc phân hệ nào (theo số đầu: "1." → ph1 …)
// Nhóm 5.3–5.6 là phần Sở/Trường tự quản (không thuộc gói PH5) nên không tính vào chức năng của PH5
const phOf = (g: { title: string; section?: string }) => {
  const m = (g.section ?? g.title).match(/^(\d)\./)
  if (!m) return null
  if (m[1] === '5' && /^5\.[3-9]/.test(g.title)) return null
  return 'ph' + m[1]
}

// ================= Phân hệ & mức sử dụng =================
export function ModuleUsage({ live, go }: { live: Set<string>; go?: (p: string) => void }) {
  const [rows, setRows] = useState<Usage[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('platform_module_usage').then(({ data, error }) => { if (error) setErr(errText(error.message)); setRows((data as Usage[]) ?? []) })
  }, [])
  const funcs = useMemo(() => {
    const m: Record<string, { live: number; total: number; planned: string[] }> = {}
    NAV.platform.forEach(g => {
      const k = phOf(g); if (!k) return
      const c = m[k] ?? { live: 0, total: 0, planned: [] }
      g.items.forEach(i => { c.total++; if (live.has(i)) c.live++; else c.planned.push(i) })
      m[k] = c
    })
    return m
  }, [live])

  if (rows === null) return <p className="sub">Đang tổng hợp…</p>
  const cur = rows.find(r => r.key === open)
  if (cur) return <ModuleDetail u={cur} funcs={funcs[cur.key]} onBack={() => setOpen(null)} />
  const total = rows[0]?.schools_total ?? 0
  return (
    <>
      <p className="sub">Mỗi phân hệ là một đơn vị bán. <b>Được bật</b>: trường có quyền dùng theo hợp đồng (hoặc chưa có hợp đồng nào — dùng không giới hạn).
        <b> Đang dùng thật</b>: có lượt dùng trong 28 ngày. Bấm một phân hệ để xem từng trường.</p>
      {err && <p className="msg">{err}</p>}
      <Tiles items={[
        { label: 'Phân hệ bán', value: rows.length },
        { label: 'Trường trên hệ thống', value: nf(total) },
        { label: 'Chức năng đã có màn', value: `${Object.values(funcs).reduce((a, b) => a + b.live, 0)}/${Object.values(funcs).reduce((a, b) => a + b.total, 0)}`, sub: 'trong 5 phân hệ' },
      ]} />
      <div className="modcards">
        {rows.map(r => {
          const f = funcs[r.key] ?? { live: 0, total: 0, planned: [] }
          const isSo = r.key === 'ph5'
          const en = isSo ? r.depts_enabled : r.schools_enabled, act = isSo ? (r.depts_active ?? 0) : r.schools_active
          return (
            <button type="button" className="panel modcard" key={r.key} onClick={() => setOpen(r.key)}>
              <b>{r.name}</b>
              <small>{r.description}</small>
              <div className="modnums">
                <span><b>{nf(en)}</b><small>{isSo ? 'Sở được bật' : 'trường được bật'}</small></span>
                <span><b>{nf(act)}</b><small>đang dùng thật</small></span>
                <span><b>{nf(r.events_28d)}</b><small>lượt / 28 ngày</small></span>
              </div>
              <div className="track" title={`${pct(act, en)}% đơn vị được bật đang dùng thật`}><div className={'fill ' + (pct(act, en) >= 60 ? 'g' : 'o')} style={{ width: pct(act, en) + '%' }} /></div>
              <small>{pct(act, en)}% đơn vị được bật đang dùng · {r.plans} gói · {r.contracts_active} hợp đồng hiệu lực</small>
              <small>Chức năng: <b>{f.live}/{f.total}</b> đã có màn{f.planned.length ? ` · còn khung: ${f.planned.slice(0, 3).join(', ')}${f.planned.length > 3 ? '…' : ''}` : ''}</small>
            </button>
          )
        })}
      </div>
      <p className="sub">Đo "đang dùng thật": {Object.entries(EVENT).map(([k, v]) => `${k.toUpperCase()} — ${v}`).join(' · ')}.
        {go && <> Khoá phân hệ theo gói ở <button type="button" className="linkbtn" onClick={() => go('Gói dịch vụ & hợp đồng')}>Gói dịch vụ & hợp đồng</button>.</>}</p>
    </>
  )
}

function ModuleDetail({ u, funcs, onBack }: { u: Usage; funcs?: { live: number; total: number; planned: string[] }; onBack: () => void }) {
  const [rows, setRows] = useState<Detail[] | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState<'all' | 'idle' | 'active' | 'off'>('all')
  const [q, setQ] = useState('')
  useEffect(() => {
    supabase.rpc('platform_module_usage_detail', { p_key: u.key }).then(({ data, error }) => { if (error) setErr(errText(error.message)); setRows((data as Detail[]) ?? []) })
  }, [u.key])
  const all = rows ?? []
  const shown = all.filter(r => (f === 'all' || (f === 'active' && r.enabled && r.events > 0) || (f === 'idle' && r.enabled && r.events === 0) || (f === 'off' && !r.enabled))
    && (!q || r.name.toLowerCase().includes(q.toLowerCase())))
  const unit = u.key === 'ph5' ? 'Sở' : 'Trường'
  return (
    <>
      <div className="bar"><span className="tools"><button onClick={onBack}>← Các phân hệ</button><b style={{ fontSize: 18 }}>{u.name}</b></span>
        <button onClick={() => downloadXlsx(`Muc-su-dung-${u.key}`, [{ key: 'a', label: unit, width: 34 }, { key: 'b', label: 'Mã' }, { key: 'c', label: 'Đơn vị quản lý', width: 26 },
          { key: 'd', label: 'Tỉnh', width: 18 }, { key: 'e', label: 'Được bật' }, { key: 'f', label: 'Gói' }, { key: 'g', label: 'Lượt dùng 28 ngày' }],
          shown.map(r => [r.name, r.code, r.parent_name, r.province_name, r.enabled ? 'Có' : 'Không', r.plan_name ?? (r.state === 'open' ? 'Chưa có HĐ' : ''), r.events]), u.key.toUpperCase())}>Xuất Excel</button></div>
      <p className="sub">{u.description}. Đo bằng: {EVENT[u.key]}.</p>
      {err && <p className="msg">{err}</p>}
      <Tiles items={[
        { label: `${unit} được bật`, value: all.filter(r => r.enabled).length, sub: `trên ${all.length}` },
        { label: 'Đang dùng thật', value: all.filter(r => r.enabled && r.events > 0).length, tone: 'good' },
        { label: 'Được bật nhưng chưa dùng', value: all.filter(r => r.enabled && r.events === 0).length, tone: 'warn', sub: 'cần hỗ trợ / đào tạo' },
        { label: 'Chưa mua', value: all.filter(r => !r.enabled).length, sub: 'cơ hội bán thêm' },
      ]} />
      {funcs && funcs.planned.length > 0 && <div className="panel"><b>Chức năng còn khung ({funcs.planned.length}/{funcs.total}):</b> {funcs.planned.join(' · ')}</div>}
      <div className="bar">
        <Tabs value={f} onChange={setF} items={[['all', 'Tất cả', all.length], ['active', 'Đang dùng', all.filter(r => r.enabled && r.events > 0).length],
          ['idle', 'Bật nhưng chưa dùng', all.filter(r => r.enabled && r.events === 0).length], ['off', 'Chưa mua', all.filter(r => !r.enabled).length]]} />
        <input className="search" style={{ margin: 0, maxWidth: 280 }} placeholder={`Tìm ${unit.toLowerCase()}…`} value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
      </div>
      <div className="wrap"><table>
        <thead><tr><th>{unit}</th><th>Tỉnh · đơn vị quản lý</th><th>Quyền dùng</th><th>Lượt dùng 28 ngày</th></tr></thead>
        <tbody>{shown.map(r => (
          <tr key={r.org_id}><td><b>{r.name}</b><br /><small>{r.code}</small></td><td><small>{r.province_name}<br />{r.parent_name}</small></td>
            <td>{r.enabled ? <span className="plbadge ok">{r.state === 'open' ? 'Chưa có HĐ (mở)' : r.plan_name ?? 'Được bật'}</span>
              : <span className="plbadge">{r.state === 'expired' ? 'HĐ hết hạn' : 'Không có trong gói'}</span>}</td>
            <td>{r.enabled && r.events === 0 ? <span className="plbadge warn">0 · chưa dùng</span> : nf(r.events)}</td></tr>
        ))}{rows && shown.length === 0 && <tr><td colSpan={4}>Không có đơn vị phù hợp.</td></tr>}</tbody>
      </table></div>
      {rows === null && <p className="sub">Đang tải…</p>}
    </>
  )
}

// ================= Vai trò & quyền mặc định =================
type Role = { id: string; key: string; name: string; portal: string | null }
type Perm = { role_id: string; module: string; can_view: boolean; can_detail: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }
type SM = { key: string; name: string; perm_modules: string[]; sort: number }
const LABEL: Record<string, string> = {
  teachers: 'Giáo viên', classes: 'Lớp học', students: 'Học sinh', assignments: 'Phân công giảng dạy', accounts: 'Tài khoản', roles: 'Vai trò & phân quyền',
  buildings: 'Tòa nhà & tầng', periods: 'Năm học, tiết học, ngày nghỉ', approvals: 'Phê duyệt',
  training: 'Tập huấn giáo viên', library: 'Kho học liệu dùng chung', packages: 'Gói STEM', curriculum: 'Phân phối chương trình',
  stem_rooms: 'Phòng STEM', equipment: 'Thiết bị', warranty: 'Bảo hành thiết bị',
  timetable: 'Thời khoá biểu, buổi dạy & điểm danh', edu_plan: 'Kế hoạch giáo dục', stem_registrations: 'Đăng ký dạy STEM', stem_assign: 'Phân công GV dạy STEM',
}
const CORE = ['teachers', 'classes', 'students', 'assignments', 'accounts', 'roles', 'buildings', 'periods', 'approvals']
const ACTIONS = [['can_view', 'Xem'], ['can_detail', 'Chi tiết'], ['can_create', 'Tạo'], ['can_edit', 'Sửa'], ['can_delete', 'Xoá']] as const
const SCHOOL_ROLES = ['principal', 'it_admin', 'office_staff', 'teacher']
const FULL = ['principal', 'it_admin']
const empty = (role_id: string, module: string): Perm => ({ role_id, module, can_view: false, can_detail: false, can_create: false, can_edit: false, can_delete: false })

export function DefaultPermissions() {
  const [roles, setRoles] = useState<Role[]>([])
  const [perms, setPerms] = useState<Perm[]>([])
  const [mods, setMods] = useState<SM[]>([])
  const [over, setOver] = useState<Record<string, number>>({})
  const [sel, setSel] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const [r, p, m, o] = await Promise.all([
      supabase.from('roles').select('id, key, name, portal').is('org_id', null).in('key', SCHOOL_ROLES),
      supabase.from('role_permissions').select('*'),
      supabase.from('service_modules').select('key, name, perm_modules, sort').order('sort'),
      supabase.rpc('platform_permission_overrides'),
    ])
    const rs = ((r.data as Role[]) ?? []).sort((a, b) => SCHOOL_ROLES.indexOf(a.key) - SCHOOL_ROLES.indexOf(b.key))
    setRoles(rs); setPerms((p.data as Perm[]) ?? []); setMods((m.data as SM[]) ?? [])
    setOver(Object.fromEntries(((o.data as { role_id: string; module: string; orgs: number }[]) ?? []).map(x => [x.role_id + '|' + x.module, x.orgs])))
    if (o.error) setErr(errText(o.error.message))
    setSel(cur => cur || rs.find(x => !FULL.includes(x.key))?.id || rs[0]?.id || '')
  }
  useEffect(() => { load() }, [])

  const role = roles.find(r => r.id === sel)
  const full = !!role && FULL.includes(role.key)
  const get = (m: string) => perms.find(p => p.role_id === sel && p.module === m) ?? empty(sel, m)
  const groups: [string, string[]][] = [['Lõi (luôn dùng được)', CORE], ...mods.map(m => [m.name, m.perm_modules.filter(x => LABEL[x])] as [string, string[]])]

  async function toggle(module: string, k: (typeof ACTIONS)[number][0]) {
    const cur = get(module)
    const next = { ...cur, [k]: !cur[k] }
    if (k === 'can_view' && !next.can_view) Object.assign(next, { can_detail: false, can_create: false, can_edit: false, can_delete: false })
    else if (k !== 'can_view' && next[k]) next.can_view = true
    setPerms([...perms.filter(p => !(p.role_id === sel && p.module === module)), next])
    const { error } = await supabase.from('role_permissions').upsert(next)
    if (error) { setErr('Không lưu được: ' + errText(error.message)); load() } else { setErr(''); setMsg(`Đã lưu: ${role?.name} · ${LABEL[module]}`) }
  }
  function exportXlsx() {
    downloadXlsx('Quyen-mac-dinh', [{ key: 'r', label: 'Vai trò' }, { key: 'g', label: 'Phân hệ', width: 34 }, { key: 'm', label: 'Chức năng', width: 30 },
      ...ACTIONS.map(([k, l]) => ({ key: k, label: l })), { key: 'o', label: 'Số trường chỉnh riêng' }],
      roles.flatMap(r => groups.flatMap(([g, ms]) => ms.map(m => {
        const p = perms.find(x => x.role_id === r.id && x.module === m) ?? empty(r.id, m)
        return [r.name, g, LABEL[m], ...ACTIONS.map(([k]) => FULL.includes(r.key) || p[k] ? '✓' : ''), over[r.id + '|' + m] ?? 0]
      }))), 'Quyền mặc định')
  }

  return (
    <>
      <p className="sub">Quyền mặc định áp dụng cho <b>mọi trường chưa chỉnh riêng</b>. Trường tự chỉnh ở <i>Vai trò và phân quyền</i> — phần chỉnh riêng của trường được giữ nguyên khi
        KDI đổi mặc định (cột "Trường chỉnh riêng" cho biết bao nhiêu trường không chịu ảnh hưởng). Chức năng thuộc phân hệ nào chỉ dùng được khi trường có phân hệ đó trong gói.</p>
      <div className="bar">
        <Tabs value={sel} onChange={setSel} items={roles.map(r => [r.id, r.name] as [string, string])} />
        <button onClick={exportXlsx}>Xuất Excel</button>
      </div>
      {msg && !err && <p className="sub"><b>{msg}</b></p>}
      {err && <p className="msg">{err}</p>}
      {full && <div className="panel warnbox"><b>{role?.name}</b> có toàn quyền trong trường (theo thiết kế), ma trận dưới đây chỉ để tham khảo.</div>}
      {groups.map(([g, ms]) => ms.length > 0 && (
        <div className="panel" key={g}>
          <h3 style={{ marginTop: 0 }}>{g}</h3>
          <div className="wrap"><table className="permtable">
            <thead><tr><th>Chức năng</th>{ACTIONS.map(([k, l]) => <th key={k} style={{ textAlign: 'center' }}>{l}</th>)}<th>Trường chỉnh riêng</th></tr></thead>
            <tbody>{ms.map(m => {
              const p = get(m)
              return (
                <tr key={m}><td>{LABEL[m]}</td>
                  {ACTIONS.map(([k, l]) => (
                    <td key={k} style={{ textAlign: 'center' }}>
                      <input type="checkbox" checked={full || p[k]} disabled={full} onChange={() => toggle(m, k)} aria-label={`${role?.name} · ${LABEL[m]} · ${l}`} />
                    </td>
                  ))}
                  <td>{over[sel + '|' + m] ? <small>{over[sel + '|' + m]} trường</small> : <small>—</small>}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
        </div>
      ))}
    </>
  )
}
