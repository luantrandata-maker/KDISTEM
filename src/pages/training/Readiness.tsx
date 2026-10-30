// Đáp ứng chương trình (migration 115): mỗi trường dạy những chương trình STEM nào, GV được phân công có đủ chuẩn không,
// thiếu thì lập kế hoạch tập huấn (tạo kế hoạch nháp với chương trình tập huấn gợi ý, hoặc gán trường vào kế hoạch đang mở).
// GV đạt chuẩn: có chứng chỉ tập huấn cùng loại chương trình, hoặc đạt mọi năng lực đích của một chương trình tập huấn cùng loại.
import { useEffect, useState } from 'react'
import { MultiSelect } from '../../components/MultiSelect'
import { supabase } from '../../lib/supabase'
import { Chip } from '../dist/Editor'
import { Drawer } from '../../components/Drawer'

type T = { id: string; name: string; cert: string | null; comp: boolean; program: string | null; missing: string[] | null; ok: boolean }
type Sug = { id: string; code: string | null; title: string }
type Row = { org_id: string; org_name: string; org_level: string | null; ct_code: string; ct_name: string | null; classes: number; grades: number[]
  edu_programs: string[]; teachers: T[]; assigned: number; qualified: number; suggest: Sug[] }
type Verdict = 'none' | 'short' | 'ok'
const PER_KEY = 'readiness.per'

function schoolYear(off = 0) { const d = new Date(), y = (d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1) + off; return `${y}-${y + 1}` }
const errText = (m: string) => /schema cache|does not exist|Could not find/i.test(m) ? 'Hãy chạy migration 115 trên Supabase để xem mức đáp ứng chương trình.' : m

// Số GV cần: theo số lớp và số lớp tối đa một GV dạy; trường có chương trình mà chưa có lớp thì cần ít nhất 1 GV
function need(r: Row, per: number) { return r.classes ? Math.max(1, Math.ceil(r.classes / Math.max(1, per))) : 1 }
function verdict(r: Row, per: number): Verdict { return !r.assigned ? 'none' : r.qualified >= need(r, per) ? 'ok' : 'short' }
const short = (r: Row, per: number) => Math.max(0, need(r, per) - r.qualified)

export function ProgramReadinessPage({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [year, setYear] = useState(schoolYear())
  const [per, setPerS] = useState(() => { try { return Number(localStorage.getItem(PER_KEY)) || 6 } catch { return 6 } })
  const setPer = (n: number) => { setPerS(n); try { localStorage.setItem(PER_KEY, String(n)) } catch { /* bỏ qua */ } }
  const [ct, setCt] = useState('')
  const [orgs, setOrgs] = useState<string[]>([])
  const [f, setF] = useState<'' | Verdict>('')
  const [open, setOpen] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [plan, setPlan] = useState(false)
  const [can, setCan] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => {
    setRows(null)
    supabase.rpc('program_readiness', { p_year: year || null }).then(({ data, error }) => { setErr(error ? errText(error.message) : ''); setRows((data as Row[]) ?? []) })
  }, [year])
  useEffect(() => { supabase.rpc('training_can_write', { p_org: orgId }).then(({ data }) => setCan(!!data)) }, [orgId])

  const all = rows ?? []
  const key = (r: Row) => r.org_id + '|' + r.ct_code
  const cts = [...new Map(all.map(r => [r.ct_code, r.ct_name ?? r.ct_code])).entries()].sort()
  const scope = all.filter(r => (!ct || r.ct_code === ct) && (!orgs.length || orgs.includes(r.org_id)))
  const shown = scope.filter(r => !f || verdict(r, per) === f)
  const n = (v: Verdict) => scope.filter(r => verdict(r, per) === v).length
  const toTrain = scope.reduce((t, r) => t + r.teachers.filter(x => !x.ok).length, 0)
  const multi = new Set(all.map(r => r.org_id)).size > 1
  const picked = all.filter(r => sel.has(key(r)))
  const toggle = (r: Row) => setSel(s => { const x = new Set(s); if (x.has(key(r))) x.delete(key(r)); else x.add(key(r)); return x })
  const needsWork = (r: Row) => verdict(r, per) !== 'ok' || r.teachers.some(x => !x.ok)

  return <>
    <div className="panel distintro">
      <p className="sub" style={{ margin: 0 }}>Mỗi dòng là một chương trình STEM trường đang dạy (lớp học theo chương trình, chương trình giáo dục được gán) và giáo viên được phân công dạy.
        Giáo viên <b>đạt chuẩn</b> khi có chứng chỉ tập huấn cùng loại chương trình, hoặc đạt mọi năng lực đích của một chương trình tập huấn cùng loại ở lần đánh giá gần nhất.
        Số GV cần = số lớp ÷ số lớp tối đa một GV dạy.</p>
    </div>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">📚</i><span><b>{rows ? scope.length : '…'}</b><small>Chương trình đang dạy</small><small>{new Set(scope.map(r => r.org_id)).size} trường</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{n('ok')}</b><small>Đáp ứng</small><small>Đủ GV đạt chuẩn</small></span></div>
      <div className="panel"><i aria-hidden="true" className={n('short') ? 'warn' : 'good'}>!</i><span><b>{n('short')}</b><small>Thiếu GV đạt chuẩn</small><small>Thiếu {scope.reduce((t, r) => t + (r.assigned ? short(r, per) : 0), 0)} GV · {toTrain} GV cần bồi dưỡng</small></span></div>
      <div className="panel"><i aria-hidden="true" className={n('none') ? 'warn' : 'good'}>∅</i><span><b>{n('none')}</b><small>Chưa phân công GV</small><small>Có lớp / chương trình nhưng chưa có GV dạy</small></span></div>
    </div>
    {err && <p className="msg" role="alert">{err}</p>}
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 10, marginTop: 14 }}>
      <div className="distfilter">
        <select value={year} onChange={e => setYear(e.target.value)} aria-label="Năm học">{[-1, 0, 1].map(o => <option key={o} value={schoolYear(o)}>Năm học {schoolYear(o)}</option>)}<option value="">Mọi năm học</option></select>
        {cts.length > 1 && <select value={ct} onChange={e => setCt(e.target.value)} aria-label="Chương trình"><option value="">Mọi chương trình</option>{cts.map(([c, l]) => <option key={c} value={c}>{c} · {l}</option>)}</select>}
        {multi && <MultiSelect compact value={orgs} onChange={setOrgs} placeholder="Mọi trường" ariaLabel="Lọc trường" style={{ minWidth: 240 }}
          options={[...new Map(all.map(r => [r.org_id, r.org_name])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))} />}
        <label className="field inline"><span className="sub">Số lớp tối đa / GV</span> <input type="number" min={1} max={40} value={per} style={{ width: 64 }} onChange={e => setPer(Math.max(1, Math.round(Number(e.target.value) || 1)))} aria-label="Số lớp tối đa một giáo viên dạy" /></label>
      </div>
      <div className="distfilter">{([['', 'Tất cả', scope.length], ['short', 'Thiếu GV đạt chuẩn', n('short')], ['none', 'Chưa phân công', n('none')], ['ok', 'Đáp ứng', n('ok')]] as const)
        .map(([k, l, c]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} aria-pressed={f === k} onClick={() => setF(k)}>{l} ({c})</button>)}</div>
    </section>
    {can && sel.size === 0 && shown.some(needsWork) && <div className="panel readyhint" style={{ marginTop: 14 }} role="note">
      <b>Lập kế hoạch tập huấn từ màn này</b>
      <ol>
        <li>Tick ô ở đầu các dòng cần bồi dưỡng (dòng Thiếu GV đạt chuẩn / Chưa phân công, hoặc còn GV chưa đạt chuẩn). Bấm vào dòng để xem từng GV.</li>
        <li>Bấm <b>Lập kế hoạch tập huấn</b> ở thanh hiện ra phía trên bảng.</li>
        <li>Chọn <b>Tạo kế hoạch mới (nháp)</b>: chương trình gợi ý, chỉ tiêu từng trường và tên GV được điền sẵn. Hoặc chọn <b>Gán vào kế hoạch đang mở</b> có chương trình cùng loại.</li>
      </ol>
      <button type="button" onClick={() => setSel(new Set(shown.filter(needsWork).map(key)))}>Chọn tất cả {shown.filter(needsWork).length} dòng cần bồi dưỡng</button>
    </div>}
    {can && sel.size > 0 && <div className="panel bar" style={{ marginTop: 14 }} role="region" aria-label="Lập kế hoạch tập huấn">
      <span>Đã chọn <b>{sel.size}</b> dòng · {picked.reduce((t, r) => t + r.teachers.filter(x => !x.ok).length, 0)} GV chưa đạt chuẩn</span>
      <div className="tools"><button type="button" onClick={() => setSel(new Set())}>Bỏ chọn</button>
        <button type="button" className="primary" onClick={() => { setMsg(null); setPlan(true) }}>Lập kế hoạch tập huấn</button></div>
    </div>}
    <section className="panel" style={{ marginTop: 14 }}>
      {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr>{can && <th style={{ width: 32 }} aria-label="Chọn"></th>}{multi && <th>Trường</th>}<th>Chương trình</th><th>Lớp</th><th>GV phân công</th><th>Đạt chuẩn / cần</th><th>Kết luận</th></tr></thead>
        <tbody>{shown.map(r => { const v = verdict(r, per), k = key(r), bad = r.teachers.filter(x => !x.ok).length
          return [<tr key={k} className={`clickrow${open === k ? ' sel' : ''}`} tabIndex={0} onClick={() => setOpen(open === k ? null : k)} onKeyDown={e => { if (e.key === 'Enter') setOpen(open === k ? null : k) }} aria-expanded={open === k}>
            {can && <td onClick={e => e.stopPropagation()}>{needsWork(r) && <input type="checkbox" checked={sel.has(k)} onChange={() => toggle(r)} aria-label={`Chọn ${r.org_name} ${r.ct_code}`} />}</td>}
            {multi && <td><b>{r.org_name}</b></td>}
            <td><b>{r.ct_code}</b> · {r.ct_name}{r.edu_programs.length > 0 && <><br /><small className="sub">{r.edu_programs.join('; ')}</small></>}</td>
            <td>{r.classes || '—'}{r.grades.length > 0 && <><br /><small className="sub">Khối {r.grades.join(', ')}</small></>}</td>
            <td>{r.assigned}{bad > 0 && <><br /><small className="warnline">{bad} chưa đạt chuẩn</small></>}</td>
            <td style={{ whiteSpace: 'nowrap' }}>{r.qualified}/{need(r, per)}</td>
            <td>{v === 'ok' ? <Chip tone="good">Đáp ứng</Chip> : v === 'none' ? <Chip tone="bad">Chưa phân công GV</Chip> : <Chip tone="warn">Thiếu {short(r, per)} GV đạt chuẩn</Chip>}
              {v === 'short' && <><br /><small className="sub">{bad >= short(r, per) ? `Bồi dưỡng ${short(r, per)} GV đã phân công` : `Bồi dưỡng ${bad} GV, phân công thêm ${short(r, per) - bad} GV`}</small></>}
              {v === 'ok' && bad > 0 && <><br /><small className="sub">{bad} GV khác nên bồi dưỡng</small></>}</td>
          </tr>,
          open === k && <tr key={k + '-d'}><td colSpan={(can ? 1 : 0) + (multi ? 6 : 5)}>
            {r.teachers.length ? <ul className="rdteachers">{r.teachers.map(t => <li key={t.id}>
              {t.ok ? <Chip tone="good">Đạt chuẩn</Chip> : <Chip tone="warn">Chưa đạt</Chip>} <b>{t.name}</b>{' '}
              <small className="sub">{t.cert ? `Chứng chỉ ${t.cert}` : t.comp ? `Đạt năng lực của ${t.program}` : t.program ? `Thiếu năng lực: ${(t.missing ?? []).join(', ')}` : 'Chưa có chứng chỉ; chưa có chương trình tập huấn cùng loại để đối chiếu năng lực'}</small></li>)}</ul>
              : <small className="sub">Chưa phân công giáo viên dạy chương trình này (Phân công GV dạy STEM theo chương trình).</small>}
            <small className="sub">Chương trình tập huấn gợi ý: {r.suggest.length ? r.suggest.map(s => [s.code, s.title].filter(Boolean).join(' ')).join('; ') : 'chưa có chương trình tập huấn cùng loại đã phát hành'}</small>
          </td></tr>] })}
          {!shown.length && <tr><td colSpan={(can ? 1 : 0) + (multi ? 6 : 5)}><small className="sub">{all.length ? 'Không có dòng nào khớp bộ lọc.' : 'Chưa có trường nào có lớp học, chương trình STEM hoặc phân công GV theo chương trình.'}</small></td></tr>}</tbody>
      </table></div>}
    </section>
    {plan && <PlanFromGaps orgId={orgId} rows={picked} per={per} year={year || schoolYear()} onClose={() => setPlan(false)} onDone={m => { setPlan(false); setSel(new Set()); setMsg(m) }} />}
  </>
}

// Lập kế hoạch tập huấn cho các dòng đã chọn: chỉ tiêu mỗi trường = số GV chưa đạt chuẩn (ít nhất bằng số GV còn thiếu)
type OpenPlan = { id: string; plan_code: string | null; name: string; ends_on: string | null; training_plan_items: { training_programs: { ct_codes: string[] | null } | null }[] }
function PlanFromGaps({ orgId, rows, per, year, onClose, onDone }: { orgId: string; rows: Row[]; per: number; year: string; onClose: () => void; onDone: (m: [string, boolean]) => void }) {
  const cts = [...new Set(rows.map(r => r.ct_code))].sort()
  const sugs = [...new Map(rows.flatMap(r => r.suggest).map(s => [s.id, s])).values()]
  const [progs, setProgs] = useState<Set<string>>(new Set(sugs.slice(0, 1).map(s => s.id)))
  const quota = new Map<string, number>()
  rows.forEach(r => quota.set(r.org_id, (quota.get(r.org_id) ?? 0) + Math.max(r.teachers.filter(t => !t.ok).length, r.assigned ? short(r, per) : 0)))
  const names = new Map(rows.map(r => [r.org_id, r.org_name]))
  const [name, setName] = useState(`Bồi dưỡng GV dạy ${cts.join(', ')} năm học ${year}`)
  const [mode, setMode] = useState<'new' | 'open'>('new')
  const [opens, setOpens] = useState<OpenPlan[]>([])
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('training_plans').select('id, plan_code, name, ends_on, training_plan_items(training_programs(ct_codes))').eq('pub_status', 'published').order('plan_code', { ascending: false })
      .then(({ data }) => setOpens(((data as unknown as OpenPlan[]) ?? []).filter(p => (!p.ends_on || p.ends_on >= new Date().toISOString().slice(0, 10))
        && p.training_plan_items.some(i => (i.training_programs?.ct_codes ?? []).some(c => cts.includes(c))))))
  }, [])
  const note = `Lập từ màn Đáp ứng chương trình (${cts.join(', ')}). Trường cần bồi dưỡng: ` + [...quota.entries()].map(([o, k]) => `${names.get(o)} ${k} GV`).join('; ') + '.'
    + ' GV chưa đạt chuẩn: ' + rows.map(r => `${r.org_name} (${r.ct_code}): ${r.teachers.filter(t => !t.ok).map(t => t.name).join(', ') || '—'}`).join('; ')
  async function create() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('training_plans').insert({ org_id: orgId, name: name.trim(), year_name: year, mode: 'hybrid', term: 'summer', pub_status: 'draft', status: 'planned', note: note.slice(0, 2000) }).select('id, plan_code').single()
    if (error) { setBusy(false); return setErr(error.message) }
    const p = data as { id: string; plan_code: string | null }
    const ids = [...progs]
    const r = ids.length ? await supabase.from('training_plan_items').insert(ids.map((id, i) => ({ plan_id: p.id, program_id: id, seq: i + 1 }))) : { error: null }
    setBusy(false)
    onDone(r.error ? [`Đã tạo kế hoạch nháp ${p.plan_code ?? ''} nhưng chưa thêm được chương trình: ${r.error.message}`, true]
      : [`Đã tạo kế hoạch nháp ${p.plan_code ?? ''} "${name.trim()}". Mở Kế hoạch tập huấn để xếp lịch, phát hành rồi gán ${quota.size} trường (chỉ tiêu ghi ở phần ghi chú).`, false])
  }
  async function assign() {
    setBusy(true); setErr('')
    const fails: string[] = []
    for (const [o, k] of quota) {
      const { error } = await supabase.rpc('training_plan_assign', { p_plan: target, p_orgs: [o], p_quota: k })
      if (error) fails.push(`${names.get(o)}: ${error.message}`)
    }
    setBusy(false)
    if (fails.length === quota.size) return setErr(fails.join(' · '))
    const pl = opens.find(p => p.id === target)
    onDone([`Đã gán ${quota.size - fails.length} trường vào ${pl?.plan_code ?? ''} "${pl?.name}" với chỉ tiêu bằng số GV cần bồi dưỡng.${fails.length ? ' Không gán được: ' + fails.join(' · ') : ''}`, fails.length > 0])
  }
  return <Drawer title="Lập kế hoạch tập huấn" onClose={onClose} closeOnOutside={false}>
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="wrap"><table className="libtable"><thead><tr><th>Trường</th><th>Chỉ tiêu đề xuất</th></tr></thead>
        <tbody>{[...quota.entries()].map(([o, k]) => <tr key={o}><td>{names.get(o)}</td><td>{k} GV</td></tr>)}</tbody></table></div>
      <div className="segmented" role="group" aria-label="Cách lập">{([['new', 'Tạo kế hoạch mới (nháp)'], ['open', `Gán vào kế hoạch đang mở (${opens.length})`]] as const).map(([k, l]) =>
        <button key={k} type="button" className={mode === k ? 'on' : ''} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}</div>
      {mode === 'new' ? <>
        <label className="field"><span>Tên kế hoạch *</span><input maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}><legend className="sub">Chương trình tập huấn (gợi ý cùng loại chương trình)</legend>
          {sugs.length ? sugs.map(s => <label key={s.id} className="field inline"><input type="checkbox" checked={progs.has(s.id)} onChange={() => setProgs(x => { const y = new Set(x); if (y.has(s.id)) y.delete(s.id); else y.add(s.id); return y })} /> {[s.code, s.title].filter(Boolean).join(' · ')}</label>)
            : <small className="sub">Chưa có chương trình tập huấn cùng loại đã phát hành; tạo kế hoạch rồi chọn chương trình sau.</small>}</fieldset>
        <small className="sub">Kế hoạch tạo ở dạng nháp, ghi sẵn danh sách trường, chỉ tiêu và GV cần bồi dưỡng. Xếp lịch, phát hành rồi gán trường như mọi kế hoạch.</small>
        {err && <p className="msg">{err}</p>}
        <div className="formactions"><button type="button" className="primary" disabled={busy || !name.trim()} onClick={create}>{busy ? 'Đang tạo…' : 'Tạo kế hoạch nháp'}</button></div>
      </> : <>
        {opens.length ? <label className="field"><span>Kế hoạch đã phát hành có chương trình cùng loại</span><select value={target} onChange={e => setTarget(e.target.value)}>
          <option value="">— Chọn kế hoạch —</option>{opens.map(p => <option key={p.id} value={p.id}>{[p.plan_code, p.name].filter(Boolean).join(' · ')}</option>)}</select></label>
          : <small className="sub">Không có kế hoạch đang mở có chương trình cùng loại.</small>}
        {err && <p className="msg">{err}</p>}
        <div className="formactions"><button type="button" className="primary" disabled={busy || !target} onClick={assign}>{busy ? 'Đang gán…' : 'Gán trường với chỉ tiêu đề xuất'}</button></div>
      </>}
    </div>
  </Drawer>
}
