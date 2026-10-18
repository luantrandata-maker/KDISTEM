import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loginDomain } from '../lib/login'
import { downloadXlsx } from '../lib/sheet'

// Tài khoản đăng nhập bằng mã cho học sinh / giáo viên (migration 037 + hàm máy chủ school-accounts).
// Tạo hàng loạt từ hồ sơ đã nhập, in phiếu tài khoản theo lớp, đặt lại mật khẩu. Mật khẩu chỉ hiện một lần.
type Kind = 'student' | 'teacher' | 'parent'
type Person = { id: string; full_name: string; code: string | null; cls: string; profile_id: string | null; email: string | null; child?: string }
type Result = { person_id: string; full_name: string | null; class_name: string | null; login: string | null; password?: string; status: string; message?: string }

const STATUS: Record<string, string> = {
  created: 'Đã tạo', created_no_login: 'Đã tạo (chưa ghi tên đăng nhập)', has_account: 'Đã có tài khoản', missing_code: 'Thiếu mã học sinh',
  login_taken: 'Tên đăng nhập đã có người dùng', no_consent: 'Chưa có đồng ý của cha mẹ (bắt buộc)', not_found: 'Không thuộc trường', error: 'Lỗi', reset: 'Đã đặt lại mật khẩu',
  missing_phone: 'Thiếu số điện thoại', same_phone: 'Cùng SĐT với phụ huynh khác trong danh sách — dùng chung tài khoản đó',
}
const NO_CLASS = 'Chưa xếp lớp'
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

// Lỗi từ hàm máy chủ: đọc thông báo trong thân phản hồi
async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('school-accounts', { body })
  if (!error) return data
  let msg = error.message
  try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* giữ thông báo gốc */ }
  if (/Failed to send a request|not found/i.test(msg)) msg = 'Chưa kết nối được hàm tạo tài khoản trên máy chủ (cần đưa hàm school-accounts lên Supabase — xem README).'
  throw new Error(msg)
}

export default function CodeAccounts({ orgId }: { orgId: string | null }) {
  const [kind, setKind] = useState<Kind>('student')
  const [people, setPeople] = useState<Person[]>([])
  const [logins, setLogins] = useState<Record<string, string | null>>({})
  const [school, setSchool] = useState<{ name: string; code: string | null } | null>(null)
  const [domain, setDomain] = useState('')
  const [cls, setCls] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<Result[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    if (!orgId) return
    const [o, list] = await Promise.all([
      supabase.from('organizations').select('name, code').eq('id', orgId).single(),
      kind === 'student'
        ? supabase.from('students').select('id, full_name, student_code, profile_id, classes(name)').eq('org_id', orgId).order('student_code')
        : kind === 'parent' ? supabase.from('guardians').select('id, full_name, phone_norm, email, profile_id, students(full_name, classes(name))').eq('org_id', orgId).order('full_name')
        : supabase.from('teachers').select('id, full_name, email, profile_id').eq('org_id', orgId).order('full_name'),
    ])
    setSchool(o.data as { name: string; code: string | null } | null)
    const ps: Person[] = ((list.data ?? []) as any[]).map(x => ({
      id: x.id, full_name: x.full_name, code: kind === 'parent' ? x.phone_norm ?? null : x.student_code ?? null,
      cls: (kind === 'parent' ? x.students?.classes?.name : x.classes?.name) ?? (kind === 'teacher' ? '' : NO_CLASS),
      profile_id: x.profile_id, email: x.email ?? null, child: x.students?.full_name,
    }))
    setPeople(ps)
    const ids = ps.map(p => p.profile_id).filter(Boolean) as string[]
    const map: Record<string, string | null> = {}
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from('profiles').select('id, login, email').in('id', ids.slice(i, i + 300))
      for (const p of (data ?? []) as { id: string; login: string | null; email: string | null }[]) map[p.id] = p.login ?? p.email ?? ''
    }
    setLogins(map); setPicked(new Set())
  }
  useEffect(() => { load() }, [orgId, kind])
  useEffect(() => { loginDomain().then(setDomain).catch(() => setDomain('')) }, [])

  const classes = useMemo(() => [...new Set(people.map(p => p.cls))].sort((a, b) => a === NO_CLASS ? 1 : b === NO_CLASS ? -1 : a.localeCompare(b, 'vi', { numeric: true })), [people])
  const shown = people.filter(p => !cls || p.cls === cls)
  const noAcc = shown.filter(p => !p.profile_id && (kind === 'teacher' || !!p.code))
  const isCode = (p: Person) => !!p.profile_id && !!logins[p.profile_id] && !logins[p.profile_id]!.includes('@')
  const nCode = shown.filter(isCode).length
  const schoolCode = (school?.code ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const preview = (p: Person) => kind === 'student'
    ? (p.code ? `${schoolCode}.${p.code.toLowerCase().replace(/[^a-z0-9]+/g, '')}` : '')
    : kind === 'parent' ? (p.code ? `${schoolCode}.ph${p.code}` : '') : `${schoolCode}.gv…`
  const allPicked = noAcc.length > 0 && noAcc.every(p => picked.has(p.id))
  const toggle = (id: string) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function create() {
    const ids = noAcc.filter(p => picked.has(p.id)).map(p => p.id)
    if (!ids.length) return
    if (!confirm(`Tạo tài khoản đăng nhập bằng mã cho ${ids.length} ${kind === 'student' ? 'học sinh' : kind === 'parent' ? 'phụ huynh' : 'giáo viên'}? Mật khẩu chỉ hiện một lần ngay sau khi tạo — hãy in phiếu hoặc tải Excel.`)) return
    setBusy(true); setErr(''); setResults(null)
    try {
      const out: Result[] = []
      for (let i = 0; i < ids.length; i += 100) out.push(...((await call({ action: 'create', kind, ids: ids.slice(i, i + 100) })).results as Result[]))
      setResults(out)
    } catch (e) { setErr((e as Error).message) }
    setBusy(false); load()
  }
  async function reset(p: Person) {
    if (!confirm(`Đặt lại mật khẩu cho ${p.full_name}? Mật khẩu cũ sẽ không dùng được nữa.`)) return
    setBusy(true); setErr('')
    try {
      const r = await call({ action: 'reset', kind, id: p.id }) as { login: string | null; password: string }
      setResults([{ person_id: p.id, full_name: p.full_name, class_name: p.cls || null, login: r.login ?? logins[p.profile_id!] ?? null, password: r.password, status: 'reset' }])
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }

  const withPw = (results ?? []).filter(r => r.password)
  function printSlips() {
    const w = window.open('', '_blank')
    if (!w) return setErr('Trình duyệt chặn cửa sổ in — cho phép cửa sổ bật lên rồi bấm lại.')
    const site = window.location.origin
    const slip = (r: Result) => `<div class="s"><div class="h">${esc(school?.name ?? '')}<small>Hệ thống Quản trị STEM</small></div>
      <div class="n">${esc(r.full_name ?? '')}${r.class_name ? ` · Lớp ${esc(r.class_name)}` : ''}</div>
      <table><tr><td>Địa chỉ</td><td><b>${esc(site)}</b></td></tr><tr><td>Tên đăng nhập</td><td><b class="m">${esc(r.login ?? '')}</b></td></tr>
      <tr><td>Mật khẩu</td><td><b class="m">${esc(r.password ?? '')}</b></td></tr></table>
      <p>Lần đầu đăng nhập, hệ thống yêu cầu đặt mật khẩu mới. Giữ kín phiếu này.</p></div>`
    w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu tài khoản</title><style>
      body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:12mm;color:#111}
      .g{display:grid;grid-template-columns:1fr 1fr;gap:0}
      .s{border:1px dashed #888;padding:10px 12px;break-inside:avoid;font-size:12.5px}
      .h{font-weight:700;font-size:13px;display:flex;justify-content:space-between;gap:8px}.h small{font-weight:400;color:#555}
      .n{margin:6px 0;font-size:14px;font-weight:600}table{border-collapse:collapse}td{padding:2px 8px 2px 0;vertical-align:top}
      .m{font-family:ui-monospace,Consolas,monospace;font-size:14px;letter-spacing:.5px}p{margin:6px 0 0;color:#555;font-size:11px}
      @page{size:A4;margin:10mm}</style></head><body><div class="g">${withPw.map(slip).join('')}</div>
      <script>window.onload=()=>{window.print()}<\/script></body></html>`)
    w.document.close()
  }
  function excel() {
    downloadXlsx(`tai-khoan-${kind === 'student' ? 'hoc-sinh' : kind === 'parent' ? 'phu-huynh' : 'giao-vien'}${cls ? '-' + cls : ''}`, [
      { key: 'name', label: 'Họ tên', width: 28 }, { key: 'cls', label: 'Lớp', width: 10 }, { key: 'login', label: 'Tên đăng nhập', width: 22 },
      { key: 'pw', label: 'Mật khẩu', width: 14 }, { key: 'st', label: 'Kết quả', width: 26 },
    ], (results ?? []).map(r => [r.full_name, r.class_name, r.login, r.password ?? '', (STATUS[r.status] ?? r.status) + (r.message ? ': ' + r.message : '')]), 'Tài khoản')
  }

  return (
    <div className="codeacc">
      <p className="sub" style={{ margin: 0 }}>
        Tạo tài khoản cho học sinh, giáo viên <b>không cần email</b>: đăng nhập bằng <b>tên đăng nhập</b> và mật khẩu do hệ thống cấp, in phiếu phát cho từng người.
        Tên đăng nhập học sinh = <code>{schoolCode || 'mãtrường'}.mãhọcsinh</code>, giáo viên = <code>{schoolCode || 'mãtrường'}.gv1, .gv2…</code>,
        phụ huynh = <code>{schoolCode || 'mãtrường'}.ph</code> + số điện thoại (một tài khoản cho các con cùng trường).
        Lần đầu đăng nhập phải đổi mật khẩu. Quên mật khẩu: quản trị trường bấm <i>Đặt lại mật khẩu</i>.
      </p>
      {!schoolCode && school && <p className="msg">Trường chưa có mã đơn vị nên chưa tạo được tài khoản mã. Liên hệ KDI để đặt mã trường.</p>}
      <div className="bar">
        <div className="segmented" style={{ margin: 0 }}>
          <button className={kind === 'student' ? 'on' : ''} onClick={() => { setKind('student'); setCls(''); setResults(null) }}>Học sinh</button>
          <button className={kind === 'teacher' ? 'on' : ''} onClick={() => { setKind('teacher'); setCls(''); setResults(null) }}>Giáo viên</button>
          <button className={kind === 'parent' ? 'on' : ''} onClick={() => { setKind('parent'); setCls(''); setResults(null) }}>Phụ huynh</button>
        </div>
        {kind !== 'teacher' && <select value={cls} onChange={e => { setCls(e.target.value); setPicked(new Set()) }} aria-label="Lọc theo lớp">
          <option value="">Tất cả lớp ({people.length})</option>
          {classes.map(c => <option key={c} value={c}>{c} ({people.filter(p => p.cls === c).length})</option>)}
        </select>}
        <small className="sub">{shown.filter(p => !p.profile_id).length} chưa có tài khoản · {nCode} tài khoản mã · {shown.length - noAcc.length - nCode} tài khoản email</small>
        <span style={{ flex: 1 }} />
        <button className="primary" disabled={busy || !schoolCode || !noAcc.some(p => picked.has(p.id))} onClick={create}>
          {busy ? 'Đang xử lý…' : `Tạo tài khoản (${noAcc.filter(p => picked.has(p.id)).length})`}</button>
      </div>
      {err && <p className="msg">{err}</p>}

      {results && (
        <div className="panel">
          <div className="bar"><b>Kết quả — mật khẩu chỉ hiện lần này</b><span style={{ flex: 1 }} />
            {withPw.length > 0 && <button className="primary" onClick={printSlips}>In phiếu tài khoản ({withPw.length})</button>}
            <button onClick={excel}>Tải Excel</button><button onClick={() => setResults(null)}>Đóng</button></div>
          <div className="wrap"><table>
            <thead><tr><th>Họ tên</th><th>Lớp</th><th>Tên đăng nhập</th><th>Mật khẩu</th><th>Kết quả</th></tr></thead>
            <tbody>{results.map(r => (
              <tr key={r.person_id + r.status}><td>{r.full_name}</td><td>{r.class_name ?? ''}</td><td><code>{r.login ?? '—'}</code></td>
                <td>{r.password ? <code>{r.password}</code> : '—'}</td>
                <td className={['created', 'reset'].includes(r.status) ? '' : 'due bad'}>{STATUS[r.status] ?? r.status}{r.message ? `: ${r.message}` : ''}</td></tr>))}</tbody>
          </table></div>
        </div>
      )}

      <div className="wrap"><table>
        <thead><tr>
          <th style={{ width: 32 }}><input type="checkbox" aria-label="Chọn tất cả người chưa có tài khoản" checked={allPicked} disabled={!noAcc.length}
            onChange={() => setPicked(allPicked ? new Set() : new Set(noAcc.map(p => p.id)))} /></th>
          <th>Họ tên</th>{kind === 'student' ? <><th>Lớp</th><th>Mã HS</th></> : kind === 'parent' ? <><th>Lớp · con</th><th>SĐT</th></> : <th>Email (hồ sơ)</th>}<th>Tài khoản</th><th></th>
        </tr></thead>
        <tbody>
          {shown.map(p => {
            const acc = p.profile_id ? logins[p.profile_id] : null
            return (
              <tr key={p.id}>
                <td>{noAcc.includes(p) && <input type="checkbox" aria-label={`Chọn ${p.full_name}`} checked={picked.has(p.id)} onChange={() => toggle(p.id)} />}</td>
                <td><b>{p.full_name}</b></td>
                {kind === 'student' ? <><td>{p.cls}</td><td>{p.code ?? <small className="due bad">thiếu mã</small>}</td></>
                  : kind === 'parent' ? <><td>{p.cls} · {p.child}</td><td>{p.code ?? <small className="due bad">thiếu SĐT</small>}</td></> : <td><small>{p.email ?? '—'}</small></td>}
                <td>{p.profile_id ? <code>{acc || 'đã có'}</code> : <small className="sub">{preview(p) ? <>Chưa có · sẽ là <code>{preview(p)}</code></> : (kind === 'parent' ? 'Cần nhập SĐT ở mục Phụ huynh trước' : 'Cần nhập mã HS ở mục Học sinh trước')}</small>}</td>
                <td>{isCode(p) && <button disabled={busy} onClick={() => reset(p)}>Đặt lại mật khẩu</button>}</td>
              </tr>
            )
          })}
          {shown.length === 0 && <tr><td colSpan={6}>{kind === 'student' ? 'Chưa có học sinh. Nhập danh sách ở mục Học sinh.' : kind === 'parent' ? 'Chưa có phụ huynh. Nhập danh sách ở mục Phụ huynh.' : 'Chưa có giáo viên. Nhập danh sách ở mục Giáo viên.'}</td></tr>}
        </tbody>
      </table></div>
      {domain && <p className="sub covhint">Tài khoản mã dùng email nội bộ <code>…@{domain}</code> (không có hộp thư, không nhận thư).</p>}
    </div>
  )
}
