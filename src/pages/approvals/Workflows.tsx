import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { KINDS } from './common'

type Org = { id: string; name: string; type: string; parent_id: string | null }
type Role = { id: string; key: string; name: string; org_id: string | null }
type DbStep = { step_no: number; name: string; approver: 'perm' | 'role'; role_id: string | null; org_type: string | null }
type Wf = { id: string; org_id: string; kind: string; name: string; applies_to_children: boolean; approval_steps: DbStep[]; organizations: { name: string } | null }
type EStep = { name: string; approver: 'perm' | 'role'; role_id: string; org_type: string }

const LEVEL: Record<string, string> = { '': 'Tại đơn vị gửi', district: 'Phòng GD&ĐT', department: 'Sở GD&ĐT', province: 'Tỉnh', ministry: 'Bộ GD&ĐT' }
const ABOVE: Record<string, string[]> = {
  school: ['district', 'department', 'province', 'ministry'], district: ['department', 'province', 'ministry'],
  department: ['province', 'ministry'], province: ['ministry'], ministry: [],
}
const SCHOOL_ROLES = ['principal', 'it_admin', 'teacher', 'office_staff']
const DEFAULT_STEP: EStep = { name: 'Ban giám hiệu duyệt', approver: 'perm', role_id: '', org_type: '' }

// Quy trình phê duyệt: mỗi đơn vị đặt các bước duyệt cho từng loại hồ sơ
export function ApprovalWorkflows({ orgId }: { orgId: string | null }) {
  const [me, setMe] = useState<Org | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [own, setOwn] = useState<Map<string, Wf>>(new Map())
  const [eff, setEff] = useState<Map<string, Wf | null>>(new Map())
  const [edit, setEdit] = useState<{ kind: string; name: string; applies: boolean; steps: EStep[] } | null>(null)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    if (!orgId) return
    const [o, r, w] = await Promise.all([
      supabase.from('organizations').select('id, name, type, parent_id').eq('id', orgId).single(),
      supabase.from('roles').select('id, key, name, org_id').order('name'),
      supabase.from('approval_workflows').select('*, approval_steps(*), organizations(name)'),
    ])
    if (w.error) return setErr(/schema cache|does not exist/i.test(w.error.message) ? 'Hãy chạy migration 022_approval_engine.sql trên Supabase.' : w.error.message)
    setMe(o.data as Org); setRoles((r.data as Role[]) ?? [])
    const all = ((w.data as Wf[]) ?? []).map(x => ({ ...x, approval_steps: [...x.approval_steps].sort((a, b) => a.step_no - b.step_no) }))
    setOwn(new Map(all.filter(x => x.org_id === orgId).map(x => [x.kind, x])))
    const effIds = await Promise.all(KINDS.map(([k]) => supabase.rpc('approval_effective_workflow', { p_org: orgId, p_kind: k })))
    setEff(new Map(KINDS.map(([k], i) => [k, all.find(x => x.id === effIds[i].data) ?? null])))
  }
  useEffect(() => { load() }, [orgId])
  if (err) return <p className="msg">{err}</p>
  if (!me) return <p className="sub">Đang tải…</p>

  const isSchool = me.type === 'school'
  const levels = ['', ...(ABOVE[me.type] ?? [])]
  // Vai trò chọn được ở một cấp duyệt
  const rolesAt = (lvl: string) => lvl
    ? roles.filter(r => !r.org_id && r.key === lvl)
    : roles.filter(r => (r.org_id === orgId) || (!r.org_id && SCHOOL_ROLES.includes(r.key)))
  const roleName = (id: string | null) => roles.find(r => r.id === id)?.name ?? '?'
  const describe = (s: DbStep) => `${s.name} — ${s.approver === 'role' ? roleName(s.role_id) : 'người có quyền duyệt'}${s.org_type ? ' · ' + LEVEL[s.org_type] : ''}`

  function start(kind: string) {
    const w = own.get(kind) ?? eff.get(kind)
    setMsg(''); setInfo('')
    setEdit({
      kind, name: own.get(kind)?.name ?? KINDS.find(k => k[0] === kind)![1], applies: own.get(kind)?.applies_to_children ?? !isSchool,
      steps: w ? w.approval_steps.map(s => ({ name: s.name, approver: s.approver, role_id: s.role_id ?? '', org_type: s.org_type ?? '' })) : [{ ...DEFAULT_STEP }],
    })
  }
  const setStep = (i: number, p: Partial<EStep>) => edit && setEdit({ ...edit, steps: edit.steps.map((s, j) => j === i ? { ...s, ...p } : s) })
  const move = (i: number, d: number) => {
    if (!edit) return
    const st = [...edit.steps]; const [x] = st.splice(i, 1); st.splice(i + d, 0, x); setEdit({ ...edit, steps: st })
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return
    const bad = edit.steps.findIndex(s => s.approver === 'role' && !s.role_id)
    if (bad >= 0) return setMsg(`Bước ${bad + 1}: chọn vai trò người duyệt.`)
    const { error } = await supabase.rpc('approval_save_workflow', {
      p_kind: edit.kind, p_name: edit.name, p_applies: edit.applies,
      p_steps: edit.steps.map(s => ({ name: s.name, approver: s.approver, role_id: s.approver === 'role' ? s.role_id : null, org_type: s.org_type || null })),
    })
    if (error) return setMsg(error.message)
    setInfo('Đã lưu quy trình. Hồ sơ gửi từ bây giờ sẽ đi theo quy trình mới; hồ sơ đang duyệt giữ quy trình cũ.'); setEdit(null); load()
  }
  async function reset(kind: string) {
    if (!confirm('Bỏ quy trình riêng? Hồ sơ mới sẽ dùng quy trình của cấp trên (nếu có) hoặc 1 bước mặc định.')) return
    const { error } = await supabase.rpc('approval_reset_workflow', { p_kind: kind })
    if (error) setMsg(error.message); else { setInfo('Đã bỏ quy trình riêng.'); load() }
  }

  return (
    <>
      <p className="sub">
        Mỗi loại hồ sơ đi qua các bước theo thứ tự; đủ bước mới thành <b>Đã duyệt</b>. Người duyệt mỗi bước là <i>người có quyền sửa chức năng đó</i>
        (theo mục Vai trò và phân quyền) hoặc <i>một vai trò cụ thể</i>, ở tại đơn vị hoặc ở cấp trên.
        {isSchool ? ' Chưa đặt quy trình riêng thì dùng quy trình Sở/Phòng áp dụng cho trường, nếu không có thì 1 bước như trước.' : ' Bật “Áp dụng cho đơn vị trực thuộc” để các trường chưa có quy trình riêng dùng theo.'}
      </p>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}
      <div className="wfgrid">
        {KINDS.map(([kind, label]) => {
          const mine = own.get(kind); const e = eff.get(kind)
          const source = mine ? 'Quy trình riêng của đơn vị' : e ? `Theo ${e.organizations?.name}` : 'Mặc định: 1 bước'
          return (
            <section className="panel wf" key={kind}>
              <div className="bar">
                <div><h3>{label}</h3><small className="sub">{source}{kind === 'project' ? ' · dùng khi có chức năng Dự án STEM' : ''}</small></div>
                <div className="actions">
                  <button type="button" onClick={() => start(kind)}>{mine ? 'Sửa' : 'Thiết lập riêng'}</button>
                  {mine && <button type="button" onClick={() => reset(kind)}>Bỏ</button>}
                </div>
              </div>
              <ol className="wfsteps">
                {(e?.approval_steps ?? [{ step_no: 1, name: 'Duyệt', approver: 'perm', role_id: null, org_type: null } as DbStep]).map(s => <li key={s.step_no}>{describe(s)}</li>)}
              </ol>
              {mine?.applies_to_children && <small className="sub">Áp dụng cho đơn vị trực thuộc</small>}

              {edit?.kind === kind && (
                <form className="wfedit" onSubmit={save}>
                  <label className="field"><span>Tên quy trình</span><input value={edit.name} onChange={ev => setEdit({ ...edit, name: ev.target.value })} /></label>
                  {edit.steps.map((s, i) => {
                    const opts = rolesAt(s.org_type)
                    return (
                      <div className="wfrow" key={i}>
                        <b className="no">{i + 1}</b>
                        <input value={s.name} onChange={ev => setStep(i, { name: ev.target.value })} placeholder="Tên bước" aria-label={`Tên bước ${i + 1}`} />
                        <select value={s.org_type} onChange={ev => setStep(i, { org_type: ev.target.value, approver: ev.target.value ? 'role' : s.approver, role_id: '' })} aria-label="Cấp duyệt">
                          {levels.map(l => <option key={l} value={l}>{l === '' && !isSchool ? 'Tại trường gửi' : LEVEL[l]}</option>)}
                        </select>
                        <select value={s.approver === 'perm' ? 'perm' : s.role_id} aria-label="Người duyệt"
                          onChange={ev => ev.target.value === 'perm' ? setStep(i, { approver: 'perm', role_id: '' }) : setStep(i, { approver: 'role', role_id: ev.target.value })}>
                          {!s.org_type && <option value="perm">Người có quyền duyệt (theo phân quyền)</option>}
                          {s.org_type && !s.role_id && <option value="">Chọn vai trò…</option>}
                          {opts.map(r => <option key={r.id} value={r.id}>{r.name}{r.org_id ? ' (tuỳ chỉnh)' : ''}</option>)}
                        </select>
                        <span className="actions">
                          <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên">↑</button>
                          <button type="button" disabled={i === edit.steps.length - 1} onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
                          <button type="button" disabled={edit.steps.length === 1} onClick={() => setEdit({ ...edit, steps: edit.steps.filter((_, j) => j !== i) })} aria-label="Xoá bước">×</button>
                        </span>
                      </div>
                    )
                  })}
                  <div className="actions">
                    {edit.steps.length < 10 && <button type="button" onClick={() => setEdit({ ...edit, steps: [...edit.steps, { name: `Bước ${edit.steps.length + 1}`, approver: 'perm', role_id: '', org_type: '' }] })}>+ Thêm bước</button>}
                    {!isSchool && <label><input type="checkbox" checked={edit.applies} onChange={ev => setEdit({ ...edit, applies: ev.target.checked })} /> Áp dụng cho đơn vị trực thuộc</label>}
                  </div>
                  <div className="actions"><button className="primary">Lưu quy trình</button> <button type="button" onClick={() => setEdit(null)}>Huỷ</button></div>
                </form>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}
