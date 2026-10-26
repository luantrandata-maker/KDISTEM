// Soạn giáo án (migration 060): kiểu dữ liệu, nhãn, mẫu giáo án, bản xem trước in được, quản lý mẫu
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { OrgPick, useAllMode } from '../../components/OrgScope'
import type { Plan, Slide } from '../teacher/Lessons'
import { MAT_TYPE } from '../library/common'
import { ACT, type ActKind } from '../teacher/activity'
import { SelBar, SelTd, SelTh, useRowSel } from '../../components/TableSel'

export type LStatus = 'draft' | 'editing' | 'pending' | 'approved' | 'rejected' | 'published' | 'archived'
export type Section = { key: string; title: string; hint?: string; required?: boolean }
export type Phase = { key: string; title: string; hint?: string }
export type Template = {
  id: string; org_id: string; name: string; description: string | null; sections: Section[]; phases: Phase[]
  scope: 'own' | 'children'; active: boolean; owner_name?: string | null
}
export type Step = {
  id: string; phase?: string; title: string; goal?: string; teacher?: string; student?: string; product?: string
  minutes?: number; activity_id?: string | null; library_ids?: string[]; rubric_id?: string | null; note?: string
}
export type Adjust = { item_id: string; qty: number; note?: string }
export type LPlan = Omit<Plan, 'status'> & {
  status: LStatus; template_id: string | null; doc: Record<string, string>; steps: Step[]; program_id: string | null; unit_id: string | null
  library_ids: string[]; rubric_ids: string[]; norm_id: string | null; norm_adjust: Adjust[]; periods: number | null
  version_no: number; published_at: string | null; review_note: string | null; source_id?: string | null; created_at?: string
  lesson?: any; cover_url?: string | null
  draft_of?: string | null  // bản nháp để sửa một bài đã xuất bản (076)
}
export type Version = { id: string; plan_id: string; version_no: number; snapshot: Partial<LPlan>; note: string | null; published_at: string; published_by: string | null }
export type Review = { id: string; plan_id: string; kind: 'trial' | 'comment'; class_id: string | null; taught_on: string | null; rating: number | null; note: string; created_by: string | null; created_at: string; classes?: { name: string } | null; profiles?: { full_name: string | null } | null }
export type ActLite = { id: string; kind: ActKind; title: string; is_template: boolean; teacher_id: string | null }
export type LibLite = { id: string; title: string; kind: string; content: { type?: string; url?: string; path?: string }; owner_name?: string | null }
export type RubLite = { id: string; title: string; org_id: string | null }
export type NormLite = { id: string; title: string; version_no: number; basis: 'product' | 'group' | 'student'; group_size: number; sessions: number; owner_name?: string | null }
export type NormItem = { id: string; name: string; unit: string; qty: number; kind: string; reusable: boolean; note: string | null; seq: number }

export const LSTATUS: Record<LStatus, [string, string]> = {
  draft: ['Nháp', ''], editing: ['Đang soạn', 'warn'], pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'good'],
  rejected: ['Bị trả lại', 'bad'], published: ['Đã xuất bản', 'good'], archived: ['Lưu trữ', ''],
}
export function LStatusPill({ s }: { s: LStatus }) {
  const [label, tone] = LSTATUS[s] ?? [s, '']
  return <span className={'gpill ' + tone}>{label}</span>
}
// Nội dung chỉ sửa được khi giáo án đang là bản soạn (CSDL cũng chặn)
export const editable = (s: LStatus) => s === 'draft' || s === 'editing' || s === 'rejected'
export const BASIS: Record<NormLite['basis'], string> = { product: '1 sản phẩm', group: '1 nhóm', student: '1 học sinh' }
export const uid = () => Math.random().toString(36).slice(2, 9)
export const fmtD = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')
export const errText = (m: string) => (/schema cache|does not exist|column .* of relation/i.test(m)
  ? 'Hãy chạy migration 060_lesson_design.sql trên Supabase.' : m)
export const PLAN_COLS = '*, teachers(full_name)'

// Mẫu giáo án đơn vị dùng được (của mình + mẫu dùng chung của KDI / cấp trên)
export function useTemplates(reloadKey = 0) {
  const [list, setList] = useState<Template[]>([])
  useEffect(() => {
    supabase.from('lesson_templates').select('*').order('name').then(({ data }) => setList(((data as Template[]) ?? []).filter(t => t.active)))
  }, [reloadKey])
  return list
}

// Tài nguyên để gắn vào giáo án: hoạt động tương tác, học liệu, rubric, định mức
export function useAttachables(orgId: string | null) {
  const [acts, setActs] = useState<ActLite[]>([])
  const [libs, setLibs] = useState<LibLite[]>([])
  const [rubs, setRubs] = useState<RubLite[]>([])
  const [norms, setNorms] = useState<NormLite[]>([])
  useEffect(() => {
    supabase.from('activities').select('id, kind, title, is_template, teacher_id').order('title').then(({ data }) => setActs((data as ActLite[]) ?? []))
    supabase.from('library_items').select('id, title, kind, content, owner_name').eq('status', 'published').in('kind', ['material', 'lesson']).order('title')
      .then(({ data }) => setLibs((data as LibLite[]) ?? []))
    supabase.from('rubrics').select('id, title, org_id').order('title').then(({ data }) => setRubs((data as RubLite[]) ?? []))
    supabase.from('material_norms').select('id, title, version_no, basis, group_size, sessions, owner_name').eq('status', 'published').order('title')
      .then(({ data }) => setNorms((data as NormLite[]) ?? []))
  }, [orgId])
  return { acts, libs, rubs, norms }
}
export const libLabel = (l?: LibLite) => (l ? `${l.title}${l.kind === 'material' && l.content.type ? ` (${MAT_TYPE[l.content.type] ?? l.content.type})` : l.kind === 'lesson' ? ' (bài giảng)' : ''}` : '—')
export const actLabel = (a?: ActLite) => (a ? `${ACT[a.kind]?.label ?? a.kind}: ${a.title}` : '—')

// Các pha của tiến trình: theo mẫu, cộng các pha lạ còn trong giáo án (mẫu đã đổi), cộng "Khác"
export function phasesOf(tpl: Template | undefined, steps: Step[]): Phase[] {
  const base = tpl?.phases ?? []
  const extra = [...new Set(steps.map(s => s.phase ?? '').filter(k => k && !base.some(p => p.key === k)))].map(k => ({ key: k, title: k }))
  return [...base, ...extra, { key: '', title: base.length ? 'Hoạt động khác' : 'Các bước hoạt động' }]
}
export const totalMinutes = (steps: Step[]) => steps.reduce((s, x) => s + (Number(x.minutes) || 0), 0)

// ===== Bản xem trước giáo án (in được) =====
export function PlanDocument({ plan, tpl, acts, libs, rubs, norm, items, teacher, schoolName }: {
  plan: LPlan; tpl?: Template; acts: ActLite[]; libs: LibLite[]; rubs: RubLite[]; norm?: NormLite | null; items?: NormItem[]
  teacher?: string | null; schoolName?: string | null
}) {
  const sections: Section[] = tpl?.sections ?? Object.keys(plan.doc ?? {}).map(k => ({ key: k, title: k }))
  const phases = phasesOf(tpl, plan.steps)
  const adj = new Map((plan.norm_adjust ?? []).map(a => [a.item_id, a]))
  const libsOf = (ids?: string[]) => (ids ?? []).map(id => libLabel(libs.find(l => l.id === id))).join('; ')
  return (
    <article className="plandoc" id="plandoc">
      <header>
        {schoolName && <small>{schoolName}</small>}
        <h1>{plan.title}</h1>
        <p>{[plan.subject && `Môn ${plan.subject}`, plan.grades && `Khối ${plan.grades}`, plan.periods && `${plan.periods} tiết`, plan.program,
          tpl && `Mẫu: ${tpl.name}`, teacher && `Giáo viên: ${teacher}`, plan.version_no > 0 && `Phiên bản ${plan.version_no}`].filter(Boolean).join(' · ')}</p>
        {plan.summary && <p><i>{plan.summary}</i></p>}
      </header>
      {sections.filter(s => (plan.doc?.[s.key] ?? '').trim()).map((s, i) => (
        <section key={s.key}><h2>{['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][i] ?? i + 1}. {s.title}</h2>
          {(plan.doc[s.key] ?? '').split('\n').map((l, k) => <p key={k}>{l}</p>)}</section>
      ))}
      {plan.steps.length > 0 && (
        <section><h2>Tiến trình dạy học <small>({totalMinutes(plan.steps)} phút)</small></h2>
          {phases.map(ph => {
            const st = plan.steps.filter(s => (s.phase ?? '') === ph.key)
            if (!st.length) return null
            return (
              <div key={ph.key || '_'}>
                <h3>{ph.title}</h3>
                <table>
                  <thead><tr><th style={{ width: '22%' }}>Hoạt động</th><th>Giáo viên</th><th>Học sinh</th><th style={{ width: '18%' }}>Sản phẩm / đính kèm</th><th style={{ width: 56 }}>Phút</th></tr></thead>
                  <tbody>{st.map(s => (
                    <tr key={s.id}>
                      <td><b>{s.title}</b>{s.goal && <><br /><small>Mục tiêu: {s.goal}</small></>}</td>
                      <td>{s.teacher}</td><td>{s.student}</td>
                      <td>{[s.product, s.activity_id && actLabel(acts.find(a => a.id === s.activity_id)), libsOf(s.library_ids),
                        s.rubric_id && `Rubric: ${rubs.find(r => r.id === s.rubric_id)?.title ?? ''}`].filter(Boolean).map((x, k) => <div key={k}><small>{x}</small></div>)}</td>
                      <td>{s.minutes ?? ''}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )
          })}
        </section>
      )}
      {(plan.library_ids.length > 0 || plan.rubric_ids.length > 0) && (
        <section><h2>Học liệu và đánh giá</h2>
          {plan.library_ids.length > 0 && <p><b>Học liệu, phiếu học tập:</b> {libsOf(plan.library_ids)}</p>}
          {plan.rubric_ids.length > 0 && <p><b>Rubric đánh giá:</b> {plan.rubric_ids.map(id => rubs.find(r => r.id === id)?.title ?? '').join('; ')}</p>}
        </section>
      )}
      {norm && items && items.length > 0 && (
        <section><h2>Vật tư, thiết bị (định mức “{norm.title}” v{norm.version_no}, cho {BASIS[norm.basis]})</h2>
          <table>
            <thead><tr><th>Vật tư</th><th>Đơn vị</th><th>Định mức</th><th>Giáo án dùng</th><th>Ghi chú</th></tr></thead>
            <tbody>{items.map(i => {
              const a = adj.get(i.id)
              return <tr key={i.id}><td>{i.name}</td><td>{i.unit}</td><td>{i.qty}</td><td>{a ? <b>{a.qty}</b> : i.qty}</td><td>{a?.note ?? i.note ?? ''}</td></tr>
            })}</tbody>
          </table>
        </section>
      )}
    </article>
  )
}

// In bản xem trước trong cửa sổ riêng (không kèm menu)
export function printPlan(title: string) {
  const el = document.getElementById('plandoc'); if (!el) return
  const w = window.open('', '_blank'); if (!w) return
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>
    body{font-family:"Times New Roman",serif;font-size:13pt;line-height:1.45;margin:24px 32px;color:#000}
    h1{font-size:16pt;text-align:center;margin:4px 0}h2{font-size:13pt;margin:16px 0 6px}h3{font-size:12pt;margin:10px 0 4px}
    header{text-align:center}header small{display:block}p{margin:3px 0}
    table{border-collapse:collapse;width:100%;margin:4px 0 8px}th,td{border:1px solid #444;padding:4px 6px;vertical-align:top;text-align:left;font-size:11.5pt}
    th{background:#eee}small{font-size:10.5pt}
  </style></head><body>${el.outerHTML}</body></html>`)
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
}

// ===== Quản lý mẫu giáo án của đơn vị =====
const EMPTY_T = (): Omit<Template, 'id' | 'org_id'> => ({ name: '', description: '', sections: [{ key: 'muc_tieu', title: 'Mục tiêu', required: true }], phases: [{ key: 'khoi_dong', title: 'Khởi động' }], scope: 'children', active: true })
const keyOf = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || uid()

export function TemplatesManager({ orgId, canWrite, isSchool }: { orgId: string | null; canWrite: boolean; isSchool: boolean }) {
  const [rows, setRows] = useState<Template[]>([])
  const [form, setForm] = useState<(Omit<Template, 'id' | 'org_id'> & { id?: string; org_id?: string }) | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  // Quản trị hệ thống: mẫu của mọi đơn vị trong một danh sách, sửa thẳng; thêm mới chọn đơn vị trong form
  const every = useAllMode()
  async function load() {
    const { data, error } = await supabase.from('lesson_templates').select('*, owner_name').order('name')
    if (error) return setMsg([errText(error.message), true])
    setRows(((data as Template[]) ?? []).map(t => ({ ...t, owner_name: t.org_id === orgId && !every ? null : t.owner_name })))
  }
  useEffect(() => { load() }, [orgId])
  const mine = every ? rows : rows.filter(r => r.org_id === orgId), shared = every ? [] : rows.filter(r => r.org_id !== orgId && r.scope === 'children')
  const below = every ? [] : rows.filter(r => r.org_id !== orgId && r.scope !== 'children')   // mẫu riêng của trường trực thuộc (cấp trên xem được)

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form || !orgId) return
    const clean = <T extends { key: string; title: string }>(xs: T[]) => xs.filter(x => x.title.trim()).map(x => ({ ...x, title: x.title.trim(), key: x.key || keyOf(x.title) }))
    const org = form.org_id || orgId, school = isSchool || every?.find(o => o.id === org)?.type === 'school'
    const row = { name: form.name.trim(), description: form.description?.trim() || null, sections: clean(form.sections), phases: clean(form.phases), scope: school ? 'own' : form.scope, active: form.active }
    if (!row.name) return setMsg(['Nhập tên mẫu.', true])
    const r = form.id ? await supabase.from('lesson_templates').update(row).eq('id', form.id) : await supabase.from('lesson_templates').insert({ ...row, org_id: org })
    if (r.error) return setMsg([errText(r.error.message), true])
    setForm(null); setMsg(['Đã lưu mẫu giáo án.', false]); load()
  }
  async function remove(t: Template) {
    if (!confirm(`Xoá mẫu “${t.name}”? Giáo án đã soạn theo mẫu vẫn giữ nội dung.`)) return
    const { error } = await supabase.from('lesson_templates').delete().eq('id', t.id)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  function copyFrom(t: Template) { setForm({ name: t.name + ' (bản của đơn vị)', description: t.description, sections: t.sections, phases: t.phases, scope: isSchool ? 'own' : 'children', active: true }) }

  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0 }}>Mẫu giáo án gồm các <b>mục</b> (mục tiêu, thiết bị…) và các <b>pha hoạt động</b> của tiến trình dạy học. {isSchool ? 'Mẫu của trường dùng cho giáo viên trong trường.' : 'Mẫu dùng chung hiện cho mọi đơn vị trực thuộc.'}</p>
        {canWrite && !form && <button className="primary" onClick={() => setForm(EMPTY_T())}>Thêm mẫu</button>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={save} style={{ marginBottom: 12 }}>
          {!form.id && <OrgPick kind="any" value={form.org_id ?? orgId ?? ''} onChange={v => setForm({ ...form, org_id: v })} />}
          <label className="field"><span>Tên mẫu *</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          {!isSchool && <label className="field"><span>Phạm vi</span><select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Template['scope'] })}>
            <option value="children">Dùng chung cho đơn vị trực thuộc</option><option value="own">Chỉ đơn vị mình</option></select></label>}
          <label className="field"><span>Đang dùng</span><span><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Hiện cho giáo viên chọn</span></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mô tả</span><input value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <ListEditor label="Các mục của giáo án" items={form.sections} onChange={x => setForm({ ...form, sections: x })} withRequired />
          <ListEditor label="Các pha hoạt động" items={form.phases} onChange={x => setForm({ ...form, phases: x })} />
          <div className="formactions"><button className="primary" type="submit">Lưu mẫu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      <TplTable title={every ? `Mẫu giáo án các đơn vị (${mine.length})` : `Mẫu của đơn vị (${mine.length})`} rows={mine} actions={canWrite ? [['Sửa', t => setForm({ ...t })], ['Xoá', t => remove(t), true]] : []} />
      {shared.length > 0 && <TplTable title={`Mẫu dùng chung từ KDI / cấp trên (${shared.length})`} rows={shared} actions={canWrite ? [['Sao chép để sửa', copyFrom]] : []} />}
      {below.length > 0 && <TplTable title={`Mẫu riêng của các trường trực thuộc (${below.length})`} rows={below} actions={canWrite ? [['Sao chép để sửa', copyFrom]] : []} />}
    </>
  )
}
function ListEditor({ label, items, onChange, withRequired }: { label: string; items: Section[]; onChange: (x: Section[]) => void; withRequired?: boolean }) {
  return (
    <div className="field" style={{ gridColumn: '1 / -1' }}><span>{label}</span>
      {items.map((s, i) => (
        <div className="addrow" key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
          <input style={{ flex: 2 }} value={s.title} placeholder="Tên" onChange={e => onChange(items.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} aria-label={`${label} ${i + 1}`} />
          <input style={{ flex: 3 }} value={s.hint ?? ''} placeholder="Gợi ý cho giáo viên" onChange={e => onChange(items.map((x, j) => j === i ? { ...x, hint: e.target.value } : x))} />
          {withRequired && <label style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={!!s.required} onChange={e => onChange(items.map((x, j) => j === i ? { ...x, required: e.target.checked } : x))} /> bắt buộc</label>}
          <button type="button" disabled={i === 0} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n) }} aria-label="Lên">↑</button>
          <button type="button" className="x" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="Xoá">×</button>
        </div>
      ))}
      <button type="button" className="linkbtn" onClick={() => onChange([...items, { key: '', title: '' }])}>+ Thêm</button>
    </div>
  )
}
// Bảng mẫu giáo án: có tác vụ thì ô tick ở cột đầu, nút nằm trên bảng (bên phải)
function TplTable({ title, rows, actions }: { title: string; rows: Template[]; actions: [string, (t: Template) => void, boolean?][] }) {
  const sel = useRowSel(rows)
  const head = <h3 style={{ margin: '16px 0 8px' }}>{title}</h3>
  if (!rows.length) return <>{head}<div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có mẫu nào.</p></div></>
  const has = actions.length > 0
  return (<>
    {has ? <SelBar picked={sel.cur?.name ?? null} left={head}>
      {actions.map(([label, run, danger]) => <button key={label} className={danger ? 'danger' : undefined} disabled={!sel.cur}
        onClick={() => { if (sel.cur) { run(sel.cur); if (danger) sel.clear() } }}>{label}</button>)}
    </SelBar> : head}
    <div className="wrap"><table>
      <thead><tr>{has && <SelTh />}<th>Mẫu</th><th>Các mục</th><th>Pha hoạt động</th><th>Đơn vị</th></tr></thead>
      <tbody>{rows.map(t => (
        <tr key={t.id} className={sel.is(t) ? 'picked' : undefined}>
          {has && <SelTd on={sel.is(t)} onToggle={() => sel.toggle(t)} label={t.name} />}
          <td><b>{t.name}</b>{!t.active && <small className="sub"> · đã tắt</small>}{t.description && <><br /><small className="sub">{t.description}</small></>}</td>
          <td><small>{t.sections.map(s => s.title + (s.required ? ' *' : '')).join(' · ') || '—'}</small></td>
          <td><small>{t.phases.map(s => s.title).join(' → ') || '—'}</small></td>
          <td><small>{t.owner_name ?? ''}</small></td>
        </tr>
      ))}</tbody>
    </table></div>
  </>)
}

export type { Plan, Slide }
