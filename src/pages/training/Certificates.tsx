// Phân hệ 1 — Chứng chỉ đào tạo (087): danh sách, duyệt cấp, thu hồi, in (PDF qua hộp thoại in), QR tra cứu công khai;
// mẫu chứng chỉ (KDI soạn, chương trình đào tạo chọn mẫu); chứng chỉ của tôi (cổng nhà giáo); trang tra cứu ?cc=<mã>.
import { useOrgFilter } from '../../components/OrgFilters'
import { MultiSelect } from '../../components/MultiSelect'
import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { CERT_ST } from './Results'
import { DataTable, MoreFilters, type Col } from '../../components/DataTable'

type Cert = { id: string; code: string | null; status: 'pending' | 'issued' | 'revoked'; issued_on: string | null; expires_on: string | null; revoked_reason: string | null
  verify_token: string; plan_id: string; plan_code: string | null; plan_name: string | null; teacher_id: string; teacher_name: string; org_name: string | null
  program_titles: string | null; hours: number | null; can_manage: boolean; created_at: string }
type Tpl = { id: string; name: string; title: string; body: string; issuer_name: string | null; signer_name: string | null; signer_title: string | null
  logo_url: string | null; valid_months: number | null; is_default: boolean }
export type Payload = { code: string | null; status: string; issued_on: string | null; expires_on: string | null; revoked_reason: string | null; token?: string
  hours: number | null; programs: string | null; teacher: string; school: string | null; plan: string; plan_code: string | null; plan_org: string | null; template: Tpl | null
  score?: number | null; grade?: string | null }

const day = (d: string | null) => d ? new Date(d + (d.length === 10 ? 'T00:00' : '')).toLocaleDateString('vi-VN') : '—'
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 087 trên Supabase.' : m
export const verifyUrl = (token: string) => `${location.origin}/?cc=${token}`
const FILL = '{ho_ten} · {chuong_trinh} · {ke_hoach} · {so_gio} · {ngay_cap} · {ma} · {xep_loai} · {diem}'
function fill(t: string, p: Payload) {
  return t.replace(/\{ho_ten\}/g, p.teacher).replace(/\{chuong_trinh\}/g, p.programs ?? '').replace(/\{ke_hoach\}/g, p.plan)
    .replace(/\{so_gio\}/g, p.hours == null ? '' : String(p.hours).replace('.', ',')).replace(/\{ngay_cap\}/g, day(p.issued_on)).replace(/\{ma\}/g, p.code ?? '')
    .replace(/\{xep_loai\}/g, p.grade ?? '').replace(/\{diem\}/g, p.score == null ? '' : String(Number(p.score)).replace('.', ','))
}

// Bản chứng chỉ (dùng để xem, in và ở trang tra cứu)
export function CertPaper({ p }: { p: Payload }) {
  const [qr, setQr] = useState('')
  useEffect(() => { if (p.token) QRCode.toDataURL(verifyUrl(p.token), { margin: 1, width: 160, errorCorrectionLevel: 'M' }).then(setQr) }, [p.token])
  const t = p.template ?? { title: 'CHỨNG CHỈ', body: 'Đã hoàn thành chương trình đào tạo {chuong_trinh} ({so_gio} giờ) thuộc {ke_hoach}.', issuer_name: p.plan_org, signer_name: null, signer_title: null, logo_url: null } as Tpl
  return <div className={`certpaper${p.status === 'revoked' ? ' revoked' : ''}`}>
    <div className="certhead">{t.logo_url ? <img src={t.logo_url} alt="" /> : <span />}<b>{t.issuer_name || p.plan_org}</b></div>
    <h2>{t.title || 'CHỨNG CHỈ'}</h2>
    <p className="sub">Chứng nhận</p>
    <p className="certname">{p.teacher}</p>
    {p.school && <p className="sub">{p.school}</p>}
    <p className="certbody">{fill(t.body, p)}</p>
    {p.grade && !/\{xep_loai\}/.test(t.body) && <p className="certbody"><b>Xếp loại: {p.grade}</b>{p.score != null ? ` · tổng điểm ${String(Number(p.score)).replace('.', ',')}/10` : ''}</p>}
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
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const ofl = useOrgFilter()
  // Trường của từng GV (danh sách chứng chỉ chỉ có tên trường) để lọc Tỉnh / Sở, trường
  const [tOrg, setTOrg] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    const ids = [...new Set((rows ?? []).map(c => c.teacher_id))]
    if (ids.length) supabase.from('teachers').select('id, org_id').in('id', ids).then(({ data }) => setTOrg(new Map(((data ?? []) as { id: string; org_id: string }[]).map(t => [t.id, t.org_id]))))
  }, [rows])
  const load = () => supabase.rpc('training_cert_list', { p_mine: false }).then(({ data, error }) => {
    if (error) { setMsg([errText(error.message), true]); setRows([]) } else { setRows((data as Cert[]) ?? []); setSel(new Set()) }
  })
  useEffect(() => { load() }, [orgId])
  if (open) return <CertView id={open} back="Chứng chỉ đào tạo" onBack={() => setOpen(null)} />
  const all = rows ?? []
  // Theo đơn vị và ô tìm (kế hoạch, trạng thái: lọc theo cột của bảng)
  const shown = all.filter(c => ofl.fit(tOrg.get(c.teacher_id)) && (c.teacher_name + ' ' + (c.code ?? '')).toLowerCase().includes(q.toLowerCase()))
  const pick = shown.filter(c => c.can_manage && c.status !== 'issued')

  async function issue(ids: string[]) {
    const { data, error } = await supabase.rpc('training_cert_issue', { p_ids: ids })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã cấp ${data} chứng chỉ, nhà giáo nhận được thông báo.`, false]); load()
  }
  async function revoke(c: Cert) {
    const r = prompt(`Lý do thu hồi chứng chỉ ${c.code} của ${c.teacher_name}:`)
    if (!r?.trim()) return
    const { error } = await supabase.rpc('training_cert_revoke', { p_id: c.id, p_reason: r })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã thu hồi chứng chỉ ${c.code}.`, false]); load()
  }
  const certCols: Col<Cert>[] = [
    { key: 'teacher', label: 'Nhà giáo', fixed: true, values: c => [c.teacher_name], text: c => `${c.teacher_name} ${c.org_name ?? ''}`, cell: c => <><b>{c.teacher_name}</b><br /><small className="sub">{c.org_name ?? '—'}</small></> },
    { key: 'plan', label: 'Kế hoạch / chương trình', values: c => [c.plan_name ?? ''], text: c => `${c.plan_code} ${c.plan_name} ${c.program_titles ?? ''}`,
      cell: c => <>{c.plan_code} · {c.plan_name}<br /><small className="sub">{c.program_titles ?? ''}{c.hours ? ` · ${String(c.hours).replace('.', ',')} giờ` : ''}</small></> },
    { key: 'code', label: 'Số chứng chỉ', text: c => c.code ?? '', cell: c => c.code ?? <small className="sub">Chưa có</small> },
    { key: 'date', label: 'Ngày cấp', text: c => day(c.issued_on), cell: c => <>{day(c.issued_on)}{c.expires_on && <><br /><small className="sub">Hết hạn {day(c.expires_on)}</small></>}</> },
    { key: 'st', label: 'Trạng thái', text: c => CERT_ST[c.status][0], cell: c => <><Chip tone={CERT_ST[c.status][1]}>{CERT_ST[c.status][0]}</Chip>{c.revoked_reason && <><br /><small className="sub">{c.revoked_reason}</small></>}</> },
    { key: 'act', label: 'Thao tác', fixed: true, cell: c => <div className="tools"><button type="button" data-rowopen onClick={() => setOpen(c.id)}>Xem{c.status === 'issued' ? ' / In' : ''}</button>
      {c.can_manage && c.status === 'pending' && <button type="button" className="primary" onClick={() => issue([c.id])}>Duyệt cấp</button>}
      {c.can_manage && c.status === 'issued' && <button type="button" onClick={() => revoke(c)}>Thu hồi</button>}
      {c.can_manage && c.status === 'revoked' && <button type="button" onClick={() => issue([c.id])}>Cấp lại</button>}</div> },
  ]
  return <>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {!rows ? <p className="sub">Đang tải…</p> : <DataTable id="training-certs" rows={shown} rowKey={c => c.id} cols={certCols}
      empty={<small className="sub">{all.length ? 'Không có chứng chỉ nào khớp.' : 'Chưa có chứng chỉ. Kết luận Đạt ở mục Đánh giá kết quả đào tạo để có chứng chỉ chờ duyệt.'}</small>}
      head={{ th: pick.length > 0 && <input type="checkbox" aria-label="Chọn tất cả" checked={pick.every(c => sel.has(c.id))} onChange={e => setSel(e.target.checked ? new Set(pick.map(c => c.id)) : new Set())} />,
        td: c => c.can_manage && c.status !== 'issued' && <input type="checkbox" aria-label={`Chọn ${c.teacher_name}`} checked={sel.has(c.id)}
          onChange={e => { const n = new Set(sel); e.target.checked ? n.add(c.id) : n.delete(c.id); setSel(n) }} /> }}
      left={<>
        <input placeholder="Tìm nhà giáo, số chứng chỉ…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chứng chỉ" />
        <MoreFilters active={ofl.active}>{ofl.node(all.map(c => tOrg.get(c.teacher_id)))}</MoreFilters></>}
      right={sel.size > 0 && <button type="button" className="primary ttadd" onClick={() => issue([...sel])}>Duyệt cấp ({sel.size})</button>} />}
  </>
}

// ===== Mẫu chứng chỉ =====
const BLANK: Omit<Tpl, 'id'> = { name: '', title: 'CHỨNG CHỈ', body: 'Đã hoàn thành chương trình đào tạo {chuong_trinh} ({so_gio} giờ) thuộc {ke_hoach}.',
  issuer_name: 'KDI Education', signer_name: '', signer_title: 'Giám đốc', logo_url: '', valid_months: null, is_default: false }
const SAMPLE: Payload = { code: 'CCTH-2027-00001', status: 'issued', issued_on: new Date().toISOString().slice(0, 10), expires_on: null, revoked_reason: null,
  hours: 24, programs: 'STEM cơ bản cho GV THCS', teacher: 'Nguyễn Văn A', school: 'THCS Phố Hiến', plan: 'Đào tạo STEM hè 2027', plan_code: 'KHTH-001', plan_org: 'KDI Education', template: null, grade: 'Giỏi', score: 8.4 }

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
    <small className="sub">Chương trình đào tạo chọn mẫu ở đây; chương trình chưa chọn thì dùng mẫu mặc định. {!admin && 'Chỉ KDI soạn mẫu.'}</small>
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Mẫu</th><th>Đơn vị cấp · người ký</th><th>Hiệu lực</th><th>Áp dụng cho chương trình</th><th></th></tr></thead>
      <tbody>{rows.map(t => { const ps = progs.filter(p => p.cert_template_id === t.id)
        return <tr key={t.id}>
          <td><b>{t.name}</b>{t.is_default && <> <Chip tone="good">Mặc định</Chip></>}<br /><small className="sub">{t.title}</small></td>
          <td>{t.issuer_name || '—'}<br /><small className="sub">{[t.signer_title, t.signer_name].filter(Boolean).join(' · ') || '—'}</small></td>
          <td>{t.valid_months ? `${t.valid_months} tháng` : 'Không thời hạn'}</td>
          <td style={{ whiteSpace: 'normal' }}>{ps.length ? ps.map(p => p.code).join(', ') : <small className="sub">{t.is_default ? 'Các chương trình chưa chọn mẫu' : 'Chưa có'}</small>}</td>
          <td><button type="button" data-rowopen onClick={() => setEdit(t)}>{admin ? 'Sửa' : 'Xem'}</button></td>
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
          <div style={{ marginTop: 6 }}><MultiSelect value={[...use]} onChange={v => setUse(new Set(v))} options={progs.map(p => [p.id, `${p.code} · ${p.title}`])}
            placeholder="Chọn chương trình đào tạo…" ariaLabel="Áp dụng cho chương trình" empty="Chưa có chương trình đào tạo." /></div></div>
      </section>
      <section className="panel"><b>Xem trước</b><div className="certwrap small"><CertPaper p={preview} /></div></section>
    </div>
  </ElView>
}

// ===== Cổng nhà giáo: Chứng chỉ của tôi =====
export function TeacherCertificates({ teacherId }: { teacherId: string | null }) {
  const [rows, setRows] = useState<Cert[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { if (teacherId) supabase.rpc('training_cert_list', { p_mine: true }).then(({ data, error }) => { if (error) setErr(errText(error.message)); else setRows((data as Cert[]) ?? []) }) }, [teacherId])
  if (!teacherId) return <p className="sub">Tài khoản này chưa được liên kết với hồ sơ nhà giáo.</p>
  if (open) return <CertView id={open} back="Chứng chỉ của tôi" onBack={() => setOpen(null)} />
  if (!rows) return err ? <p className="sub" role="alert">{err}</p> : <p className="sub">Đang tải…</p>
  return <div className="tlcourses">
    {rows.map(c => <div key={c.id} className="panel tlcourse">
      <div><small className="sub">{c.code}</small><h3>{c.plan_name}</h3><small className="sub">{c.program_titles}{c.hours ? ` · ${String(c.hours).replace('.', ',')} giờ` : ''}</small></div>
      <div><small>Ngày cấp {day(c.issued_on)}</small>{c.expires_on && <><br /><small className="sub">Hiệu lực đến {day(c.expires_on)}</small></>}</div>
      <button type="button" className="primary" onClick={() => setOpen(c.id)}>Xem / In</button>
    </div>)}
    {!rows.length && <p className="sub">Bạn chưa có chứng chỉ đào tạo nào. Hoàn thành khoá đào tạo và được kết luận Đạt để nhận chứng chỉ.</p>}
  </div>
}

/** Chứng chỉ của một nhà giáo (bảng gọn, có Xem / In) — dùng trong Hồ sơ năng lực */
export function TeacherCertList({ teacherId }: { teacherId: string }) {
  const [rows, setRows] = useState<Cert[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    ;(async () => {
      // Người quản lý / trường: danh sách theo quyền xem; nhà giáo tự xem: danh sách của tôi
      const a = await supabase.rpc('training_cert_list', { p_mine: false })
      let xs = ((a.data as Cert[]) ?? []).filter(c => c.teacher_id === teacherId && c.status !== 'pending')
      if (!xs.length) {
        const b = await supabase.rpc('training_cert_list', { p_mine: true })
        xs = ((b.data as Cert[]) ?? []).filter(c => c.teacher_id === teacherId)
      }
      setRows(xs)
    })()
  }, [teacherId])
  if (open) return <CertView id={open} back="Hồ sơ năng lực" onBack={() => setOpen(null)} />
  if (!rows) return <p className="sub" style={{ margin: 0 }}>Đang tải…</p>
  if (!rows.length) return <p className="sub" style={{ margin: 0 }}>Chưa có chứng chỉ đào tạo nào. Hoàn thành khoá đào tạo và được kết luận Đạt để nhận chứng chỉ.</p>
  return <div className="wrap"><table className="libtable">
    <thead><tr><th>Số chứng chỉ</th><th>Kế hoạch / chương trình đào tạo</th><th>Ngày cấp</th><th>Hiệu lực đến</th><th>Trạng thái</th><th></th></tr></thead>
    <tbody>{rows.map(c => <tr key={c.id}>
      <td>{c.code ?? '—'}</td>
      <td style={{ whiteSpace: 'normal' }}>{c.plan_name ?? '—'}<br /><small className="sub">{c.program_titles}{c.hours ? ` · ${String(c.hours).replace('.', ',')} giờ` : ''}</small></td>
      <td>{day(c.issued_on)}</td><td>{c.expires_on ? day(c.expires_on) : 'Không thời hạn'}</td>
      <td><Chip tone={CERT_ST[c.status][1]}>{CERT_ST[c.status][0]}</Chip></td>
      <td><button type="button" onClick={() => setOpen(c.id)}>Xem / In</button></td>
    </tr>)}</tbody>
  </table></div>
}

// ===== Trang tra cứu công khai (không cần đăng nhập): /?cc=<mã> =====
export function CertVerify({ token }: { token: string }) {
  const [p, setP] = useState<Payload | null | undefined>(undefined)
  useEffect(() => { supabase.rpc('training_cert_verify', { p_token: token }).then(({ data, error }) => setP(error ? null : (data as Payload | null))) }, [token])
  return <div className="certverify">
    <h1>Tra cứu chứng chỉ đào tạo</h1>
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
