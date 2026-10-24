// Phân hệ 1 — Chứng chỉ tập huấn (087): danh sách, duyệt cấp, thu hồi, in (PDF qua hộp thoại in), QR tra cứu công khai;
// mẫu chứng chỉ (KDI soạn, chương trình tập huấn chọn mẫu); chứng chỉ của tôi (cổng giáo viên); trang tra cứu ?cc=<mã>.
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { CERT_ST } from './Results'

type Cert = { id: string; code: string | null; status: 'pending' | 'issued' | 'revoked'; issued_on: string | null; expires_on: string | null; revoked_reason: string | null
  verify_token: string; plan_id: string; plan_code: string | null; plan_name: string | null; teacher_id: string; teacher_name: string; org_name: string | null
  program_titles: string | null; hours: number | null; can_manage: boolean; created_at: string }
type Tpl = { id: string; name: string; title: string; body: string; issuer_name: string | null; signer_name: string | null; signer_title: string | null
  logo_url: string | null; valid_months: number | null; is_default: boolean }
type Payload = { code: string | null; status: string; issued_on: string | null; expires_on: string | null; revoked_reason: string | null; token?: string
  hours: number | null; programs: string | null; teacher: string; school: string | null; plan: string; plan_code: string | null; plan_org: string | null; template: Tpl | null }
type F = 'all' | 'pending' | 'issued' | 'revoked'

const day = (d: string | null) => d ? new Date(d + (d.length === 10 ? 'T00:00' : '')).toLocaleDateString('vi-VN') : '—'
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 087 trên Supabase.' : m
export const verifyUrl = (token: string) => `${location.origin}/?cc=${token}`
const FILL = '{ho_ten} · {chuong_trinh} · {ke_hoach} · {so_gio} · {ngay_cap} · {ma}'
function fill(t: string, p: Payload) {
  return t.replace(/\{ho_ten\}/g, p.teacher).replace(/\{chuong_trinh\}/g, p.programs ?? '').replace(/\{ke_hoach\}/g, p.plan)
    .replace(/\{so_gio\}/g, p.hours == null ? '' : String(p.hours).replace('.', ',')).replace(/\{ngay_cap\}/g, day(p.issued_on)).replace(/\{ma\}/g, p.code ?? '')
}

// Bản chứng chỉ (dùng để xem, in và ở trang tra cứu)
export function CertPaper({ p }: { p: Payload }) {
  const [qr, setQr] = useState('')
  useEffect(() => { if (p.token) QRCode.toDataURL(verifyUrl(p.token), { margin: 1, width: 160, errorCorrectionLevel: 'M' }).then(setQr) }, [p.token])
  const t = p.template ?? { title: 'CHỨNG CHỈ', body: 'Đã hoàn thành chương trình tập huấn {chuong_trinh} ({so_gio} giờ) thuộc {ke_hoach}.', issuer_name: p.plan_org, signer_name: null, signer_title: null, logo_url: null } as Tpl
  return <div className={`certpaper${p.status === 'revoked' ? ' revoked' : ''}`}>
    <div className="certhead">{t.logo_url ? <img src={t.logo_url} alt="" /> : <span />}<b>{t.issuer_name || p.plan_org}</b></div>
    <h2>{t.title || 'CHỨNG CHỈ'}</h2>
    <p className="sub">Chứng nhận</p>
    <p className="certname">{p.teacher}</p>
    {p.school && <p className="sub">{p.school}</p>}
    <p className="certbody">{fill(t.body, p)}</p>
    <div className="certfoot">
      <div>{qr && <img src={qr} alt="Mã QR tra cứu chứng chỉ" width={110} height={110} />}<small>Số: <b>{p.code ?? 'chưa cấp'}</b></small>
        <small>Ngày cấp: {day(p.issued_on)}{p.expires_on ? ` · hiệu lực đến ${day(p.expires_on)}` : ''}</small></div>
      <div className="certsign"><small>{t.signer_title || 'Đại diện đơn vị cấp'}</small><span /><b>{t.signer_name ?? ''}</b></div>
    </div>
    {p.status === 'revoked' && <div className="certstamp">ĐÃ THU HỒI</div>}
  </div>
}

function CertView({ id, onBack, back }: { id: string; onBack: () => void; back: string }) {
  const [p, setP] = useState<Payload | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { supabase.rpc('training_cert_view', { p_id: id }).then(({ data, error }) => { if (error) setErr(errText(error.message)); else setP(data as Payload) }) }, [id])
  return <ElView back={back} onBack={onBack} title={p ? `Chứng chỉ ${p.code ?? '(chờ duyệt)'}` : 'Chứng chỉ'}
    sub={p ? <>{p.plan_code} · {p.plan} · <Chip tone={CERT_ST[p.status][1]}>{CERT_ST[p.status][0]}</Chip></> : undefined}
    actions={p && p.status === 'issued' && <><button type="button" className="primary" onClick={() => window.print()}>In / Lưu PDF</button>
      {p.token && <button type="button" onClick={() => navigator.clipboard?.writeText(verifyUrl(p.token!))}>Sao chép link tra cứu</button>}</>}>
    {err && <p className="msg" role="alert">{err}</p>}
    {p?.status === 'revoked' && <p className="warnline">Đã thu hồi: {p.revoked_reason}</p>}
    {p?.status === 'pending' && <p className="sub">Chứng chỉ đang chờ đơn vị tổ chức duyệt cấp. Số chứng chỉ có sau khi duyệt.</p>}
    {p && <div className="certwrap"><CertPaper p={p} /></div>}
  </ElView>
}

export function TrainingCertificatesPage({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Cert[] | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [f, setF] = useState<F>('pending')
  const [plan, setPlan] = useState('')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const load = () => supabase.rpc('training_cert_list', { p_mine: false }).then(({ data, error }) => {
    if (error) { setMsg([errText(error.message), true]); setRows([]) } else { setRows((data as Cert[]) ?? []); setSel(new Set()) }
  })
  useEffect(() => { load() }, [orgId])
  if (open) return <CertView id={open} back="Chứng chỉ tập huấn" onBack={() => setOpen(null)} />
  const all = rows ?? []
  const plans = [...new Map(all.map(c => [c.plan_id, `${c.plan_code ?? ''} · ${c.plan_name ?? ''}`])).entries()]
  const base = all.filter(c => !plan || c.plan_id === plan)
  const cnt = (k: F) => k === 'all' ? base.length : base.filter(c => c.status === k).length
  const shown = base.filter(c => (f === 'all' || c.status === f) && (c.teacher_name + ' ' + (c.code ?? '') + ' ' + (c.org_name ?? '')).toLowerCase().includes(q.toLowerCase()))
  const pick = shown.filter(c => c.can_manage && c.status !== 'issued')

  async function issue(ids: string[]) {
    const { data, error } = await supabase.rpc('training_cert_issue', { p_ids: ids })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã cấp ${data} chứng chỉ, giáo viên nhận được thông báo.`, false]); load()
  }
  async function revoke(c: Cert) {
    const r = prompt(`Lý do thu hồi chứng chỉ ${c.code} của ${c.teacher_name}:`)
    if (!r?.trim()) return
    const { error } = await supabase.rpc('training_cert_revoke', { p_id: c.id, p_reason: r })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã thu hồi chứng chỉ ${c.code}.`, false]); load()
  }
  const steps: [string, string, F][] = [
    ['Giáo viên Đạt', 'Kết luận Đạt ở mục Đánh giá kết quả thì chứng chỉ tự vào danh sách chờ duyệt.', 'pending'],
    ['Duyệt cấp', 'Chọn chứng chỉ và bấm Duyệt cấp: hệ thống sinh số CCTH-năm-số, ngày cấp, hạn hiệu lực theo mẫu.', 'pending'],
    ['In & tra cứu', 'In hoặc lưu PDF; QR trên chứng chỉ mở trang tra cứu công khai. Thu hồi khi cần (ghi lý do).', 'issued']]
  return <>
    <div className="panel distintro">
      <ol className="distguide">{steps.map(([h, d, k], i) => <li key={h}><button type="button" onClick={() => setF(k)}><i>{i + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
    </div>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">🎓</i><span><b>{rows ? base.length : '…'}</b><small>Chứng chỉ</small></span></div>
      <div className="panel"><i aria-hidden="true" className={cnt('pending') ? 'warn' : ''}>…</i><span><b>{cnt('pending')}</b><small>Chờ duyệt cấp</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{cnt('issued')}</b><small>Đã cấp</small></span></div>
      <div className="panel"><i aria-hidden="true">✗</i><span><b>{cnt('revoked')}</b><small>Đã thu hồi</small></span></div>
    </div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <div className="distfilter">
        <select value={plan} onChange={e => setPlan(e.target.value)} aria-label="Kế hoạch"><option value="">Tất cả kế hoạch</option>{plans.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <input placeholder="Tìm giáo viên, số chứng chỉ…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chứng chỉ" />
        {sel.size > 0 && <button type="button" className="primary" onClick={() => issue([...sel])}>Duyệt cấp ({sel.size})</button>}
      </div>
      <div className="distfilter">{([['pending', 'Chờ duyệt'], ['issued', 'Đã cấp'], ['revoked', 'Đã thu hồi'], ['all', 'Tất cả']] as [F, string][])
        .map(([k, l]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} onClick={() => { setF(k); setSel(new Set()) }}>{l} ({cnt(k)})</button>)}</div>
      {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th style={{ width: 36 }}>{pick.length > 0 && <input type="checkbox" aria-label="Chọn tất cả" checked={pick.every(c => sel.has(c.id))}
          onChange={e => setSel(e.target.checked ? new Set(pick.map(c => c.id)) : new Set())} />}</th>
          <th>Giáo viên</th><th>Kế hoạch / chương trình</th><th>Số chứng chỉ</th><th>Ngày cấp</th><th>Trạng thái</th><th></th></tr></thead>
        <tbody>{shown.map(c => <tr key={c.id}>
          <td>{c.can_manage && c.status !== 'issued' && <input type="checkbox" aria-label={`Chọn ${c.teacher_name}`} checked={sel.has(c.id)}
            onChange={e => { const n = new Set(sel); e.target.checked ? n.add(c.id) : n.delete(c.id); setSel(n) }} />}</td>
          <td><b>{c.teacher_name}</b><br /><small className="sub">{c.org_name ?? '—'}</small></td>
          <td style={{ whiteSpace: 'normal' }}>{c.plan_code} · {c.plan_name}<br /><small className="sub">{c.program_titles ?? ''}{c.hours ? ` · ${String(c.hours).replace('.', ',')} giờ` : ''}</small></td>
          <td>{c.code ?? <small className="sub">Chưa có</small>}</td>
          <td>{day(c.issued_on)}{c.expires_on && <><br /><small className="sub">Hết hạn {day(c.expires_on)}</small></>}</td>
          <td><Chip tone={CERT_ST[c.status][1]}>{CERT_ST[c.status][0]}</Chip>{c.revoked_reason && <><br /><small className="sub">{c.revoked_reason}</small></>}</td>
          <td><div className="tools"><button type="button" onClick={() => setOpen(c.id)}>Xem{c.status === 'issued' ? ' / In' : ''}</button>
            {c.can_manage && c.status === 'pending' && <button type="button" className="primary" onClick={() => issue([c.id])}>Duyệt cấp</button>}
            {c.can_manage && c.status === 'issued' && <button type="button" onClick={() => revoke(c)}>Thu hồi</button>}
            {c.can_manage && c.status === 'revoked' && <button type="button" onClick={() => issue([c.id])}>Cấp lại</button>}</div></td>
        </tr>)}
          {!shown.length && <tr><td colSpan={7}><small className="sub">{all.length ? 'Không có chứng chỉ nào khớp.' : 'Chưa có chứng chỉ. Kết luận Đạt ở mục Đánh giá kết quả tập huấn để có chứng chỉ chờ duyệt.'}</small></td></tr>}</tbody>
      </table></div>}
    </section>
  </>
}

// ===== Mẫu chứng chỉ =====
const BLANK: Omit<Tpl, 'id'> = { name: '', title: 'CHỨNG CHỈ', body: 'Đã hoàn thành chương trình tập huấn {chuong_trinh} ({so_gio} giờ) thuộc {ke_hoach}.',
  issuer_name: 'KDI Education', signer_name: '', signer_title: 'Giám đốc', logo_url: '', valid_months: null, is_default: false }
const SAMPLE: Payload = { code: 'CCTH-2027-00001', status: 'issued', issued_on: new Date().toISOString().slice(0, 10), expires_on: null, revoked_reason: null,
  hours: 24, programs: 'STEM cơ bản cho GV THCS', teacher: 'Nguyễn Văn A', school: 'THCS Phố Hiến', plan: 'Tập huấn STEM hè 2027', plan_code: 'KHTH-001', plan_org: 'KDI Education', template: null }

export function CertTemplatesPage() {
  const [rows, setRows] = useState<Tpl[] | null>(null)
  const [progs, setProgs] = useState<{ id: string; code: string; title: string; cert_template_id: string | null }[]>([])
  const [admin, setAdmin] = useState(false)
  const [edit, setEdit] = useState<Tpl | Omit<Tpl, 'id'> | null>(null)
  const [msg, setMsg] = useState('')
  const load = () => {
    supabase.from('certificate_templates').select('*').order('is_default', { ascending: false }).order('name').then(({ data, error }) => { if (error) setMsg(errText(error.message)); else setRows((data as Tpl[]) ?? []) })
    supabase.from('training_programs').select('id, code, title, cert_template_id').neq('status', 'archived').order('code').then(({ data }) => setProgs((data as typeof progs) ?? []))
  }
  useEffect(() => { load(); supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)) }, [])
  if (edit) return <TplForm t={edit} progs={progs} onBack={() => setEdit(null)} onDone={m => { setEdit(null); setMsg(m); load() }} />
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Mẫu chứng chỉ</h3>{admin && <button type="button" className="primary" onClick={() => setEdit({ ...BLANK })}>Thêm mẫu</button>}</div>
    <small className="sub">Chương trình tập huấn chọn mẫu ở đây; chương trình chưa chọn thì dùng mẫu mặc định. {!admin && 'Chỉ KDI soạn mẫu.'}</small>
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Mẫu</th><th>Đơn vị cấp · người ký</th><th>Hiệu lực</th><th>Áp dụng cho chương trình</th><th></th></tr></thead>
      <tbody>{rows.map(t => { const ps = progs.filter(p => p.cert_template_id === t.id)
        return <tr key={t.id}>
          <td><b>{t.name}</b>{t.is_default && <> <Chip tone="good">Mặc định</Chip></>}<br /><small className="sub">{t.title}</small></td>
          <td>{t.issuer_name || '—'}<br /><small className="sub">{[t.signer_title, t.signer_name].filter(Boolean).join(' · ') || '—'}</small></td>
          <td>{t.valid_months ? `${t.valid_months} tháng` : 'Không thời hạn'}</td>
          <td style={{ whiteSpace: 'normal' }}>{ps.length ? ps.map(p => p.code).join(', ') : <small className="sub">{t.is_default ? 'Các chương trình chưa chọn mẫu' : 'Chưa có'}</small>}</td>
          <td><button type="button" onClick={() => setEdit(t)}>{admin ? 'Sửa' : 'Xem'}</button></td>
        </tr> })}
        {!rows.length && <tr><td colSpan={5}><small className="sub">Chưa có mẫu.</small></td></tr>}</tbody>
    </table></div>}
  </section>
}

function TplForm({ t, progs, onBack, onDone }: { t: Tpl | Omit<Tpl, 'id'>; progs: { id: string; code: string; title: string; cert_template_id: string | null }[]; onBack: () => void; onDone: (m: string) => void }) {
  const id = 'id' in t ? t.id : null
  const [f, setF] = useState({ ...t, signer_name: t.signer_name ?? '', logo_url: t.logo_url ?? '', issuer_name: t.issuer_name ?? '', signer_title: t.signer_title ?? '' })
  const [use, setUse] = useState<Set<string>>(() => new Set(progs.filter(p => id && p.cert_template_id === id).map(p => p.id)))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = useMemo(() => ({ ...SAMPLE, template: { ...f, id: id ?? '' } as Tpl }), [f, id])
  async function save() {
    if (!f.name.trim() || !f.body.trim()) return setErr('Nhập tên mẫu và nội dung.')
    if (f.logo_url.trim() && !/^https?:\/\//i.test(f.logo_url.trim())) return setErr('Link logo phải bắt đầu bằng http:// hoặc https://')
    setBusy(true); setErr('')
    const row = { name: f.name.trim(), title: f.title.trim() || 'CHỨNG CHỈ', body: f.body.trim(), issuer_name: f.issuer_name.trim() || null, signer_name: f.signer_name.trim() || null,
      signer_title: f.signer_title.trim() || null, logo_url: f.logo_url.trim() || null, valid_months: f.valid_months || null, is_default: f.is_default, updated_at: new Date().toISOString() }
    if (f.is_default) await supabase.from('certificate_templates').update({ is_default: false }).eq('is_default', true).neq('id', id ?? '00000000-0000-0000-0000-000000000000')
    const r = id ? await supabase.from('certificate_templates').update(row).eq('id', id).select('id').single() : await supabase.from('certificate_templates').insert(row).select('id').single()
    if (r.error) { setBusy(false); return setErr(errText(r.error.message)) }
    const tid = (r.data as { id: string }).id
    const on = progs.filter(p => use.has(p.id) && p.cert_template_id !== tid).map(p => p.id)
    const off = progs.filter(p => !use.has(p.id) && p.cert_template_id === tid).map(p => p.id)
    if (on.length) await supabase.from('training_programs').update({ cert_template_id: tid }).in('id', on)
    if (off.length) await supabase.from('training_programs').update({ cert_template_id: null }).in('id', off)
    setBusy(false); onDone('Đã lưu mẫu chứng chỉ.')
  }
  async function del() {
    if (!id || !confirm(`Xoá mẫu "${t.name}"? Chương trình đang dùng mẫu này sẽ dùng mẫu mặc định.`)) return
    const { error } = await supabase.from('certificate_templates').delete().eq('id', id)
    if (error) return setErr(errText(error.message))
    onDone('Đã xoá mẫu.')
  }
  const set = (k: string, v: unknown) => setF({ ...f, [k]: v })
  return <ElView back="Mẫu chứng chỉ" onBack={onBack} title={id ? f.name || 'Mẫu chứng chỉ' : 'Thêm mẫu chứng chỉ'}
    actions={<>{id && !t.is_default && <button type="button" className="danger" onClick={del}>Xoá</button>}<button type="button" className="primary" disabled={busy} onClick={save}>Lưu</button></>}>
    {err && <p className="msg" role="alert">{err}</p>}
    <div className="tsgrid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
      <section className="panel formgrid">
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên mẫu *</span><input value={f.name} maxLength={200} onChange={e => set('name', e.target.value)} /></label>
        <label className="field"><span>Tiêu đề trên chứng chỉ</span><input value={f.title} maxLength={120} onChange={e => set('title', e.target.value)} /></label>
        <label className="field"><span>Thời hạn (tháng)</span><input type="number" min={1} max={240} value={f.valid_months ?? ''} placeholder="Không thời hạn" onChange={e => set('valid_months', e.target.value === '' ? null : Number(e.target.value))} /></label>
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Nội dung *</span><textarea rows={3} maxLength={2000} value={f.body} onChange={e => set('body', e.target.value)} />
          <small className="sub">Chỗ điền: {FILL}</small></label>
        <label className="field"><span>Đơn vị cấp</span><input value={f.issuer_name} onChange={e => set('issuer_name', e.target.value)} /></label>
        <label className="field"><span>Link logo</span><input type="url" value={f.logo_url} onChange={e => set('logo_url', e.target.value)} placeholder="https://…" /></label>
        <label className="field"><span>Chức danh người ký</span><input value={f.signer_title} onChange={e => set('signer_title', e.target.value)} /></label>
        <label className="field"><span>Người ký</span><input value={f.signer_name} onChange={e => set('signer_name', e.target.value)} /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', gridColumn: '1/-1' }}><input type="checkbox" checked={f.is_default} onChange={e => set('is_default', e.target.checked)} />Mẫu mặc định (cho chương trình chưa chọn mẫu)</label>
        <div style={{ gridColumn: '1/-1' }}><b>Áp dụng cho chương trình</b>
          <div className="reggrid" style={{ marginTop: 6 }}>{progs.map(p => <label className="roomrow" key={p.id}><span>{p.code} · {p.title}</span>
            <input type="checkbox" checked={use.has(p.id)} onChange={e => { const n = new Set(use); e.target.checked ? n.add(p.id) : n.delete(p.id); setUse(n) }} aria-label={`Áp dụng cho ${p.title}`} /></label>)}
            {!progs.length && <small className="sub">Chưa có chương trình tập huấn.</small>}</div></div>
      </section>
      <section className="panel"><b>Xem trước</b><div className="certwrap small"><CertPaper p={preview} /></div></section>
    </div>
  </ElView>
}

// ===== Cổng giáo viên: Chứng chỉ của tôi =====
export function TeacherCertificates({ teacherId }: { teacherId: string | null }) {
  const [rows, setRows] = useState<Cert[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { if (teacherId) supabase.rpc('training_cert_list', { p_mine: true }).then(({ data, error }) => { if (error) setErr(errText(error.message)); else setRows((data as Cert[]) ?? []) }) }, [teacherId])
  if (!teacherId) return <p className="sub">Tài khoản này chưa được liên kết với hồ sơ giáo viên.</p>
  if (open) return <CertView id={open} back="Chứng chỉ của tôi" onBack={() => setOpen(null)} />
  if (!rows) return err ? <p className="sub" role="alert">{err}</p> : <p className="sub">Đang tải…</p>
  return <div className="tlcourses">
    {rows.map(c => <div key={c.id} className="panel tlcourse">
      <div><small className="sub">{c.code}</small><h3>{c.plan_name}</h3><small className="sub">{c.program_titles}{c.hours ? ` · ${String(c.hours).replace('.', ',')} giờ` : ''}</small></div>
      <div><small>Ngày cấp {day(c.issued_on)}</small>{c.expires_on && <><br /><small className="sub">Hiệu lực đến {day(c.expires_on)}</small></>}</div>
      <button type="button" className="primary" onClick={() => setOpen(c.id)}>Xem / In</button>
    </div>)}
    {!rows.length && <p className="sub">Bạn chưa có chứng chỉ tập huấn nào. Hoàn thành khoá tập huấn và được kết luận Đạt để nhận chứng chỉ.</p>}
  </div>
}

// ===== Trang tra cứu công khai (không cần đăng nhập): /?cc=<mã> =====
export function CertVerify({ token }: { token: string }) {
  const [p, setP] = useState<Payload | null | undefined>(undefined)
  useEffect(() => { supabase.rpc('training_cert_verify', { p_token: token }).then(({ data, error }) => setP(error ? null : (data as Payload | null))) }, [token])
  return <div className="certverify">
    <h1>Tra cứu chứng chỉ tập huấn</h1>
    {p === undefined ? <p className="sub">Đang tra cứu…</p>
      : !p ? <div className="panel"><b>Không tìm thấy chứng chỉ.</b><p className="sub">Mã tra cứu không đúng hoặc chứng chỉ chưa được cấp.</p></div>
      : <>
        <div className={`panel certverdict ${p.status === 'issued' && !(p.expires_on && p.expires_on < new Date().toISOString().slice(0, 10)) ? 'good' : 'bad'}`}>
          <b>{p.status === 'revoked' ? 'Chứng chỉ đã bị thu hồi' : p.expires_on && p.expires_on < new Date().toISOString().slice(0, 10) ? 'Chứng chỉ đã hết hiệu lực' : 'Chứng chỉ hợp lệ'}</b>
          <span>{p.code} · {p.teacher} · {p.plan}</span>
          {p.revoked_reason && <small>Lý do: {p.revoked_reason}</small>}
        </div>
        <div className="certwrap"><CertPaper p={p} /></div>
      </>}
    <p className="sub" style={{ textAlign: 'center' }}><a href="/">Về trang đăng nhập</a></p>
  </div>
}
