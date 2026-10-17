import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'
import { useDeptStats, type SchoolStat } from '../department/data'
import { usePlatform, pathOf, fmtTime } from './data'

// Triển khai khách hàng (migration 025): checklist cho từng trường.
// Bước tự động tính từ dữ liệu trường đã nhập; bước thủ công do KDI đánh dấu (rollout_checks).

type Ent = { org_id: string; state: 'open' | 'active' | 'expired' }
type Check = { org_id: string; step: string; done_at: string; note: string | null; done_by: string | null }
type Step = { key: string; label: string; manual?: boolean; hint?: string }

export const STEPS: Step[] = [
  { key: 'contract', label: 'Có hợp đồng hiệu lực', hint: 'Gói dịch vụ & hợp đồng' },
  { key: 'kickoff', label: 'Họp khởi động', manual: true },
  { key: 'activated', label: 'Kích hoạt trường', hint: 'Sở hoặc KDI kích hoạt' },
  { key: 'year', label: 'Khai báo năm học hiện tại' },
  { key: 'teachers', label: 'Có danh sách giáo viên' },
  { key: 'students', label: 'Có danh sách học sinh' },
  { key: 'admin_training', label: 'Tập huấn quản trị trường', manual: true },
  { key: 'rooms', label: 'Phòng STEM đang hoạt động' },
  { key: 'units', label: 'Có thiết bị trong kho' },
  { key: 'handover', label: 'Bàn giao thiết bị', manual: true },
  { key: 'timetable', label: 'Có thời khoá biểu' },
  { key: 'teacher_training', label: 'Tập huấn giáo viên', manual: true, hint: 'tự gợi ý khi có GV hoàn thành tập huấn' },
  { key: 'active', label: 'Đang dùng (hoạt động ≤ 7 ngày)' },
  { key: 'acceptance', label: 'Nghiệm thu triển khai', manual: true },
]
const daysAgo = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity

export function autoDone(k: string, s: SchoolStat, e: Ent | undefined): boolean {
  switch (k) {
    case 'contract': return e?.state === 'active'
    case 'activated': return s.activated
    case 'year': return s.has_year
    case 'teachers': return s.teachers > 0
    case 'students': return s.students > 0
    case 'rooms': return s.rooms_active > 0
    case 'units': return s.units > 0
    case 'timetable': return s.total_periods > 0
    case 'active': return daysAgo(s.last_activity) <= 7
    default: return false
  }
}
type F = 'progress' | 'done' | 'new' | 'idle' | 'all'

export function PlatformRollout() {
  const { schools, loading, err, reload } = useDeptStats()
  const p = usePlatform()
  const [ents, setEnts] = useState<Map<string, Ent>>(new Map())
  const [checks, setChecks] = useState<Check[]>([])
  const [f, setF] = useState<F>('progress')
  const [dept, setDept] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  async function loadChecks() {
    const [e, c] = await Promise.all([supabase.rpc('platform_entitlements'), supabase.from('rollout_checks').select('*')])
    if (c.error) setMsg(/schema cache|does not exist|relation/i.test(c.error.message) ? 'Hãy chạy migration 025_platform_wave2_rollout_catalog_broadcast.sql trên Supabase.' : c.error.message)
    setEnts(new Map(((e.data as Ent[]) ?? []).map(x => [x.org_id, x])))
    setChecks((c.data as Check[]) ?? [])
  }
  useEffect(() => { loadChecks() }, [])

  const byId = useMemo(() => new Map(p.orgs.map(o => [o.id, o])), [p.orgs])
  const deptOf = (id: string) => pathOf(id, byId).find(o => o.type === 'department')
  const done = (s: SchoolStat, k: string) => STEPS.find(x => x.key === k)!.manual
    ? checks.some(c => c.org_id === s.school_id && c.step === k) : autoDone(k, s, ents.get(s.school_id))
  const score = (s: SchoolStat) => STEPS.filter(x => done(s, x.key)).length
  const state = (s: SchoolStat): F => score(s) === STEPS.length ? 'done' : score(s) <= 3 ? 'new' : 'progress'
  const idle = (s: SchoolStat) => s.activated && daysAgo(s.last_activity) > 14
  const depts = [...new Map(schools.map(s => { const d = deptOf(s.school_id); return [d?.id ?? '', d?.name ?? 'Chưa thuộc Sở'] })).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))

  if (loading || p.loading) return <p className="sub">Đang tải…</p>
  if (err) return <p className="msg">{err}</p>

  const s0 = q.trim().toLowerCase()
  const inDept = schools.filter(s => !dept || (deptOf(s.school_id)?.id ?? '') === dept)
  const shown = inDept.filter(s => (f === 'all' || (f === 'idle' ? idle(s) : state(s) === f)) && (!s0 || (s.name + ' ' + s.code).toLowerCase().includes(s0)))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'vi'))

  async function toggle(s: SchoolStat, step: string, on: boolean) {
    const r = on ? await supabase.from('rollout_checks').insert({ org_id: s.school_id, step })
      : await supabase.from('rollout_checks').delete().eq('org_id', s.school_id).eq('step', step)
    if (r.error) return setMsg(r.error.message)
    setMsg(''); loadChecks()
  }

  return (
    <>
      <Tiles items={[
        { label: 'Trường', value: inDept.length },
        { label: 'Hoàn tất triển khai', value: inDept.filter(s => state(s) === 'done').length, sub: `đủ ${STEPS.length} bước`, tone: 'good' },
        { label: 'Đang triển khai', value: inDept.filter(s => state(s) === 'progress').length },
        { label: 'Mới bắt đầu (≤ 3 bước)', value: inDept.filter(s => state(s) === 'new').length, tone: inDept.some(s => state(s) === 'new') ? 'warn' : '' },
        { label: 'Đã kích hoạt nhưng không dùng 14 ngày', value: inDept.filter(idle).length, tone: inDept.some(idle) ? 'bad' : 'good' },
      ]} />
      <div className="bar">
        <Tabs items={[['progress', 'Đang triển khai', inDept.filter(s => state(s) === 'progress').length], ['new', 'Mới bắt đầu', inDept.filter(s => state(s) === 'new').length],
          ['idle', 'Không hoạt động', inDept.filter(idle).length], ['done', 'Hoàn tất', inDept.filter(s => state(s) === 'done').length], ['all', 'Tất cả', inDept.length]]} value={f} onChange={setF} />
        <div className="plactions">
          <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Lọc theo Sở"><option value="">Mọi Sở</option>{depts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <input className="search" type="search" placeholder="Tìm trường…" aria-label="Tìm trường" value={q} onChange={e => setQ(e.target.value)} />
          <button type="button" onClick={() => { reload(); loadChecks() }}>Làm mới</button>
        </div>
      </div>
      {msg && <p className="msg">{msg}</p>}
      <div className="wrap">
        <table>
          <thead><tr><th>Trường</th><th>Tiến độ</th><th>Bước còn thiếu</th><th>Hoạt động gần nhất</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {shown.map(s => {
              const n = score(s); const miss = STEPS.filter(x => !done(s, x.key))
              return (
                <Fragment key={s.school_id}>
                  <tr className={open === s.school_id ? 'selrow' : ''}>
                    <td><b>{s.name}</b><br /><small>{s.code} · {deptOf(s.school_id)?.name ?? 'Chưa thuộc Sở'}</small></td>
                    <td><span className="plbar"><span className="track"><span className={'fill ' + (n === STEPS.length ? 'g' : n > 3 ? 'b' : 'o')} style={{ width: (n / STEPS.length * 100) + '%' }} /></span><small>{n}/{STEPS.length}</small></span></td>
                    <td>{miss.slice(0, 3).map(x => <span key={x.key} className="plbadge mute misschip">{x.label}</span>)}{miss.length > 3 && <small> +{miss.length - 3}</small>}{miss.length === 0 && <span className="plbadge ok">Đủ</span>}</td>
                    <td className={idle(s) ? 'late' : ''}>{s.last_activity ? fmtTime(s.last_activity) : 'Chưa có'}</td>
                    <td><button type="button" onClick={() => setOpen(open === s.school_id ? null : s.school_id)}>{open === s.school_id ? 'Đóng' : 'Checklist'}</button></td>
                  </tr>
                  {open === s.school_id && (
                    <tr><td colSpan={5}>
                      <ol className="rollout">
                        {STEPS.map(x => {
                          const ok = done(s, x.key); const c = checks.find(c => c.org_id === s.school_id && c.step === x.key)
                          const suggest = x.key === 'teacher_training' && !ok && s.training_done > 0
                          return (
                            <li key={x.key} className={ok ? 'ok' : ''}>
                              {x.manual
                                ? <label className="field inline"><input type="checkbox" checked={ok} onChange={e => toggle(s, x.key, e.target.checked)} /> {x.label}</label>
                                : <span><span className="ck" aria-hidden="true">{ok ? '✓' : '·'}</span> {x.label}</span>}
                              <small>{x.manual ? (c ? `KDI đánh dấu ${fmtTime(c.done_at)}` : 'KDI đánh dấu') : 'tự động'}{x.hint ? ' · ' + x.hint : ''}
                                {suggest && ` · ${s.training_done} GV đã hoàn thành tập huấn`}</small>
                            </li>
                          )
                        })}
                      </ol>
                    </td></tr>
                  )}
                </Fragment>
              )
            })}
            {shown.length === 0 && <tr><td colSpan={5}>Không có trường nào trong mục này.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
