// Phân hệ 1 — Danh sách giảng viên tập huấn (098). Đơn vị lập kế hoạch (KDI, Sở, Phòng) quản lý; chương trình trong kế hoạch
// và buổi tập huấn chọn nhiều giảng viên từ danh sách này (TrainerPick). Gõ tên chưa có thì thêm nhanh vào danh sách.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { MultiSelect } from '../../components/MultiSelect'
import { Chip } from '../dist/Editor'

export type Trainer = { id: string; org_id: string; full_name: string; title: string | null; workplace: string | null; expertise: string | null
  email: string | null; phone: string | null; note: string | null; active: boolean }
const SEL = 'id, org_id, full_name, title, workplace, expertise, email, phone, note, active'
const errText = (m: string) => /schema cache|does not exist|relation .*trainers/i.test(m) ? 'Hãy chạy migration 098 trên Supabase.'
  : /duplicate|23505|trainers_name/i.test(m) ? 'Đã có giảng viên cùng họ tên và đơn vị công tác.'
  : /row-level|42501|permission/i.test(m) ? 'Bạn không có quyền sửa danh sách giảng viên của đơn vị này.' : m
export const trainerName = (t: Pick<Trainer, 'title' | 'full_name'>) => (t.title ? t.title + ' ' : '') + t.full_name

/** Danh sách giảng viên của một đơn vị (đơn vị lập kế hoạch) */
export function useTrainers(orgId: string | null | undefined) {
  const [list, setList] = useState<Trainer[] | null>(null)
  const [rk, setRk] = useState(0)
  useEffect(() => {
    if (!orgId) { setList([]); return }
    supabase.from('trainers').select(SEL).eq('org_id', orgId).order('full_name').then(({ data }) => setList((data as Trainer[]) ?? []))
  }, [orgId, rk])
  return { list, reload: () => setRk(k => k + 1) }
}

/** Chọn nhiều giảng viên từ danh sách của đơn vị; gõ tên mới rồi Enter để thêm nhanh vào danh sách */
export function TrainerPick({ orgId, value, onChange, disabled, ariaLabel = 'Giảng viên' }: {
  orgId: string; value: string[]; onChange: (ids: string[]) => void | Promise<unknown>; disabled?: boolean; ariaLabel?: string
}) {
  const { list, reload } = useTrainers(orgId)
  const [err, setErr] = useState('')
  const options = useMemo(() => (list ?? []).filter(t => t.active || value.includes(t.id))
    .sort((a, b) => (a.workplace ?? '~').localeCompare(b.workplace ?? '~', 'vi') || a.full_name.localeCompare(b.full_name, 'vi'))
    .map(t => ({ value: t.id, label: trainerName(t) + (t.active ? '' : ' (ngừng mời)'), group: t.workplace ?? 'Chưa ghi đơn vị công tác' })), [list, value])
  if (!list) return <small className="sub">Đang tải…</small>
  async function change(v: string[]) {
    setErr('')
    const known = new Set(list!.map(t => t.id))
    const fresh = v.filter(x => !known.has(x))
    let ids = v
    if (fresh.length) {
      const { data, error } = await supabase.from('trainers').insert(fresh.map(n => ({ org_id: orgId, full_name: n }))).select('id, full_name')
      if (error) return setErr(errText(error.message))
      const made = new Map(((data ?? []) as { id: string; full_name: string }[]).map((t, k) => [fresh[k], t.id]))
      ids = v.map(x => made.get(x) ?? x)
      reload()
    }
    await onChange(ids)
  }
  return <>
    <MultiSelect value={value} onChange={change} options={options} disabled={disabled} ariaLabel={ariaLabel} allowCustom customLabel="Thêm giảng viên"
      placeholder="Chọn giảng viên…" empty="Chưa có giảng viên nào: gõ họ tên để thêm" />
    {err && <small className="warnline">{err}</small>}
  </>
}

// ===== Trang danh sách giảng viên =====
const BLANK = { full_name: '', title: '', workplace: '', expertise: '', email: '', phone: '', note: '' }
type Form = typeof BLANK
const toRow = (f: Form) => ({ full_name: f.full_name.trim(), title: f.title.trim() || null, workplace: f.workplace.trim() || null, expertise: f.expertise.trim() || null,
  email: f.email.trim() || null, phone: f.phone.trim() || null, note: f.note.trim() || null })

export function TrainersPage({ orgId }: { orgId: string }) {
  const { list, reload } = useTrainers(orgId)
  const [can, setCan] = useState(false)
  const [use, setUse] = useState<Map<string, number>>(new Map())
  const [view, setView] = useState<{ kind: 'new' } | { kind: 'edit'; t: Trainer } | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [q, setQ] = useState('')
  const [fs, setFs] = useState<'' | 'active' | 'off'>('active')
  useEffect(() => { supabase.rpc('training_can_write', { p_org: orgId }).then(({ data }) => setCan(!!data)) }, [orgId])
  // Số chương trình trong kế hoạch + buổi tập huấn đã phân công mỗi giảng viên
  useEffect(() => {
    (async () => {
      const [i, s] = await Promise.all([
        supabase.from('training_plan_items').select('trainer_ids, training_plans!inner(org_id)').eq('training_plans.org_id', orgId),
        supabase.from('training_sessions').select('trainer_ids').eq('org_id', orgId),
      ])
      const m = new Map<string, number>()
      for (const r of [...(i.data ?? []), ...(s.data ?? [])] as { trainer_ids: string[] | null }[]) for (const id of r.trainer_ids ?? []) m.set(id, (m.get(id) ?? 0) + 1)
      setUse(m)
    })()
  }, [orgId, list])

  if (view) return <TrainerForm orgId={orgId} t={view.kind === 'edit' ? view.t : null} onBack={() => setView(null)}
    onDone={m => { setView(null); setMsg([m, false]); reload() }} />

  const all = list ?? []
  const shown = all.filter(t => (!fs || (fs === 'active') === t.active)
    && (!q || `${t.full_name} ${t.title ?? ''} ${t.workplace ?? ''} ${t.expertise ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  async function toggle(t: Trainer) {
    const { error } = await supabase.from('trainers').update({ active: !t.active }).eq('id', t.id)
    setMsg(error ? [errText(error.message), true] : [t.active ? `Đã chuyển ${t.full_name} sang Ngừng mời.` : `Đã mời lại ${t.full_name}.`, false]); reload()
  }
  async function del(t: Trainer) {
    if (!confirm(`Xoá giảng viên "${t.full_name}"?`)) return
    const { error } = await supabase.from('trainers').delete().eq('id', t.id)
    setMsg(error ? [errText(error.message), true] : ['Đã xoá giảng viên.', false]); reload()
  }
  return <>
    <div className="panel distintro">
      <p className="sub" style={{ margin: 0 }}>Danh sách giảng viên dùng chung cho mọi kế hoạch và buổi tập huấn của đơn vị. Ở kế hoạch và lịch, ô Giảng viên chọn được nhiều người từ danh sách này;
        gõ họ tên chưa có thì thêm nhanh. Giảng viên đã phân công không xoá được, chuyển sang "Ngừng mời" để ẩn khỏi ô chọn.</p>
    </div>
    <div className="distfilter">
      {([['active', 'Đang mời', all.filter(t => t.active).length], ['off', 'Ngừng mời', all.filter(t => !t.active).length], ['', 'Tất cả', all.length]] as ['' | 'active' | 'off', string, number][]).map(([s, l, c]) =>
        <button key={l} type="button" className={'distfchip' + (fs === s ? ' on' : '')} aria-pressed={fs === s} onClick={() => setFs(s)}>{l} <b>{c}</b></button>)}
    </div>
    <div className="bar">
      <div className="tools"><input placeholder="Tìm họ tên, đơn vị công tác, chuyên môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giảng viên" />
        <small className="sub">{shown.length}/{all.length} giảng viên</small></div>
      {can && <div className="tools"><button type="button" className="primary" onClick={() => { setMsg(null); setView({ kind: 'new' }) }}>Thêm giảng viên</button></div>}
    </div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {!list ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Giảng viên</th><th>Đơn vị công tác</th><th>Chuyên môn</th><th>Liên hệ</th><th style={{ width: 90 }}>Phân công</th><th>Trạng thái</th>{can && <th></th>}</tr></thead>
      <tbody>{shown.map(t => <tr key={t.id}>
        <td>{can ? <button type="button" className="namelink" onClick={() => { setMsg(null); setView({ kind: 'edit', t }) }}>{trainerName(t)}</button> : <b>{trainerName(t)}</b>}
          {t.note && <><br /><small className="sub">{t.note}</small></>}</td>
        <td>{t.workplace || '—'}</td>
        <td style={{ whiteSpace: 'normal' }}>{t.expertise || '—'}</td>
        <td>{[t.phone, t.email].filter(Boolean).join(' · ') || '—'}</td>
        <td>{use.get(t.id) ?? 0}</td>
        <td><Chip tone={t.active ? 'good' : ''}>{t.active ? 'Đang mời' : 'Ngừng mời'}</Chip></td>
        {can && <td><div className="tools"><button type="button" onClick={() => toggle(t)}>{t.active ? 'Ngừng mời' : 'Mời lại'}</button>
          {!use.get(t.id) && <button type="button" aria-label={`Xoá ${t.full_name}`} onClick={() => del(t)}>×</button>}</div></td>}
      </tr>)}
        {!shown.length && <tr><td colSpan={can ? 7 : 6}>{all.length ? 'Không có giảng viên nào khớp.' : can ? 'Chưa có giảng viên nào. Bấm "Thêm giảng viên".' : 'Chưa có giảng viên nào.'}</td></tr>}</tbody>
    </table></div>}
  </>
}

function TrainerForm({ orgId, t, onBack, onDone }: { orgId: string; t: Trainer | null; onBack: () => void; onDone: (m: string) => void }) {
  const [f, setF] = useState<Form>(t ? { full_name: t.full_name, title: t.title ?? '', workplace: t.workplace ?? '', expertise: t.expertise ?? '', email: t.email ?? '', phone: t.phone ?? '', note: t.note ?? '' } : BLANK)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr('')
    const { error } = t ? await supabase.from('trainers').update(toRow(f)).eq('id', t.id) : await supabase.from('trainers').insert({ ...toRow(f), org_id: orgId })
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onDone(t ? 'Đã lưu giảng viên. Tên ở kế hoạch và lịch đã cập nhật theo.' : `Đã thêm giảng viên ${f.full_name.trim()}.`)
  }
  return <ElView back="Giảng viên" onBack={onBack} title={t ? trainerName(t) : 'Thêm giảng viên'} sub="Thông tin dùng khi chọn giảng viên cho kế hoạch và buổi tập huấn.">
    <form className="panel" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <div className="formgrid">
        <label className="field"><span>Họ tên *</span><input required maxLength={120} value={f.full_name} onChange={set('full_name')} placeholder="VD: Nguyễn Văn An" /></label>
        <label className="field"><span>Học hàm, học vị</span><input maxLength={40} value={f.title} onChange={set('title')} placeholder="VD: TS., ThS." list="trainer-titles" />
          <datalist id="trainer-titles">{['GS.TS.', 'PGS.TS.', 'TS.', 'ThS.', 'CN.'].map(x => <option key={x} value={x} />)}</datalist></label>
        <label className="field"><span>Đơn vị công tác</span><input maxLength={200} value={f.workplace} onChange={set('workplace')} placeholder="VD: Trường ĐHSP Hà Nội" /></label>
        <label className="field"><span>Chuyên môn</span><input maxLength={300} value={f.expertise} onChange={set('expertise')} placeholder="VD: Giáo dục STEM, Robotics" /></label>
        <label className="field"><span>Điện thoại</span><input maxLength={30} value={f.phone} onChange={set('phone')} /></label>
        <label className="field"><span>Email</span><input type="email" maxLength={200} value={f.email} onChange={set('email')} /></label>
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Ghi chú</span><textarea rows={2} maxLength={500} value={f.note} onChange={set('note')} /></label>
      </div>
      {err && <p className="msg">{err}</p>}
      <div className="formactions"><button type="submit" className="primary" disabled={busy || !f.full_name.trim()}>{t ? 'Lưu' : 'Thêm giảng viên'}</button> <button type="button" onClick={onBack}>Huỷ</button></div>
    </form>
  </ElView>
}
