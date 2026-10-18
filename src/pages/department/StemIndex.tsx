import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadWorkbook, norm } from '../../lib/sheet'
import { useDeptStats, LEVEL, type SchoolStat } from './data'
import { Tiles } from './charts'

// Chỉ số STEM (STEM Index), Bộ chỉ số, So sánh trường / địa bàn (migration 049).
// Điểm mỗi chỉ số 0–100 tính từ số liệu thật của trường (dept_school_stats); chỉ số tổng = bình quân có trọng số
// của các chỉ số đang bật (chỉ số chưa có dữ liệu không tính, trọng số chia lại).
type Ind = { key: string; group: string; label: string; hint: string; weight: number; target?: number; unit?: string; score: (s: SchoolStat, target: number) => number | null }
const r100 = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
const ratio = (a: number, b: number) => (b > 0 ? r100((100 * a) / b) : null)
const recent = (d: string | null, days: number) => !!d && Date.now() - new Date(d).getTime() < days * 86400000
export const INDICATORS: Ind[] = [
  { key: 'phong', group: 'Hạ tầng', label: 'Phòng STEM hoạt động', hint: '% phòng STEM đang hoạt động (0 nếu chưa có phòng)', weight: 10, score: s => (s.rooms ? ratio(s.rooms_active, s.rooms) : 0) },
  { key: 'thiet_bi', group: 'Hạ tầng', label: 'Thiết bị dùng được', hint: '% thiết bị không hỏng / bảo trì', weight: 5, score: s => ratio(s.units_available, s.units) },
  { key: 'nhan_luc', group: 'Nhân lực', label: 'Giáo viên đã tập huấn', hint: '% giáo viên hoàn thành tập huấn STEM', weight: 15, score: s => ratio(s.training_done, s.teachers) },
  { key: 'gv_stem', group: 'Nhân lực', label: 'Giáo viên dạy STEM', hint: '% giáo viên được phân công dạy STEM', weight: 10, score: s => ratio(s.stem_teachers, s.teachers) },
  { key: 'lop_stem', group: 'Triển khai', label: 'Lớp có chương trình STEM', hint: '% lớp có ít nhất một chương trình CT1–CT5', weight: 15, score: s => ratio(s.stem_classes, s.classes) },
  { key: 'tiet_stem', group: 'Triển khai', label: 'Tỉ lệ tiết STEM', hint: 'Tiết STEM / tổng tiết, so với mức mục tiêu (mặc định 10%)', weight: 10, target: 10, unit: '% tiết',
    score: (s, t) => (s.total_periods ? r100((100 * (100 * s.stem_periods) / s.total_periods) / t) : null) },
  { key: 'hoc_lieu', group: 'Triển khai', label: 'Giáo án & sản phẩm STEM', hint: 'Số giáo án + sản phẩm trên mỗi GV dạy STEM, so với mục tiêu (mặc định 5)', weight: 10, target: 5, unit: 'mỗi GV',
    score: (s, t) => (s.stem_teachers ? r100((100 * (s.lesson_plans + s.products) / s.stem_teachers) / t) : s.teachers ? 0 : null) },
  { key: 'hs_stem', group: 'Kết quả học sinh', label: 'Học sinh học STEM', hint: '% học sinh thuộc lớp có chương trình STEM', weight: 10, score: s => ratio(s.stem_students, s.students) },
  { key: 'chuyen_can', group: 'Kết quả học sinh', label: 'Chuyên cần', hint: 'Tỉ lệ có mặt bình quân các tiết đã điểm danh', weight: 5, score: s => (s.attendance_rate == null ? null : r100(s.attendance_rate)) },
  { key: 'diem', group: 'Kết quả học sinh', label: 'Kết quả bài STEM', hint: 'Điểm trung bình bài đã chấm (thang 10 → 100)', weight: 5, score: s => (s.graded && s.avg_score != null ? r100(s.avg_score * 10) : null) },
  { key: 'du_lieu', group: 'Quản trị dữ liệu', label: 'Cập nhật dữ liệu', hint: 'Có năm học, đồng bộ K12, hoạt động trong 14 ngày (mỗi tiêu chí 1/3)', weight: 5,
    score: s => r100((100 * ([s.has_year, s.k12_synced, recent(s.last_activity, 14)].filter(Boolean).length)) / 3) },
]
export const GROUPS = [...new Set(INDICATORS.map(i => i.group))]
export type Cfg = { name: string; indicators: Record<string, { on?: boolean; weight?: number; target?: number | null }>; level3: number; level2: number; source?: string; own?: boolean; org_id?: string }
export const DEFAULT_CFG: Cfg = { name: 'Bộ chỉ số STEM (mặc định KDI)', indicators: {}, level3: 70, level2: 50 }
const on = (c: Cfg, i: Ind) => c.indicators[i.key]?.on ?? true
const w = (c: Cfg, i: Ind) => c.indicators[i.key]?.weight ?? i.weight
const tgt = (c: Cfg, i: Ind) => c.indicators[i.key]?.target ?? i.target ?? 1

export type Scored = SchoolStat & { index: number | null; mlevel: 1 | 2 | 3 | null; parts: Record<string, number | null>; groups: Record<string, number | null> }
export function scoreSchool(s: SchoolStat, c: Cfg): Scored {
  const parts: Record<string, number | null> = {}; let ws = 0, acc = 0
  const gw: Record<string, [number, number]> = {}
  for (const i of INDICATORS) {
    const v = on(c, i) ? i.score(s, tgt(c, i)) : null; parts[i.key] = v
    if (v == null || !on(c, i) || !w(c, i)) continue
    ws += w(c, i); acc += w(c, i) * v
    const g = (gw[i.group] ??= [0, 0]); g[0] += w(c, i); g[1] += w(c, i) * v
  }
  const index = ws ? Math.round(acc / ws) : null
  const groups = Object.fromEntries(GROUPS.map(g => [g, gw[g] ? Math.round(gw[g][1] / gw[g][0]) : null]))
  return { ...s, index, mlevel: index == null ? null : index >= c.level3 ? 3 : index >= c.level2 ? 2 : 1, parts, groups }
}
export const LV: Record<number, [string, string, string]> = { 3: ['Mức 3 · Tiên tiến', 'ok', '★'], 2: ['Mức 2 · Đạt', 'info', '✓'], 1: ['Mức 1 · Cần hỗ trợ', 'bad', '!'] }
const LvBadge = ({ l }: { l: number | null }) => (l ? <span className={'plbadge ' + (LV[l][1] === 'info' ? 'mute' : LV[l][1])}><i aria-hidden="true">{LV[l][2]}</i> {LV[l][0]}</span> : <span className="sub">—</span>)
const Bar = ({ v, tone }: { v: number | null; tone?: string }) => (
  <span className="ibar" title={v == null ? 'chưa có dữ liệu' : v + '/100'}><i style={{ width: (v ?? 0) + '%', background: tone }} /><b>{v ?? '—'}</b></span>)
const avgOf = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null }

export function useIndexConfig() {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [err, setErr] = useState('')
  async function load() {
    const { data, error } = await supabase.rpc('stem_index_config')
    if (error && /schema cache|does not exist/i.test(error.message)) setErr('Hãy chạy migration 049 trên Supabase.')
    setCfg(data ? { ...DEFAULT_CFG, ...(data as Cfg), level3: Number((data as Cfg).level3), level2: Number((data as Cfg).level2) } : DEFAULT_CFG)
  }
  useEffect(() => { load() }, [])
  return { cfg, err, reload: load }
}

// Gom theo Sở (cho KDI / Bộ) bằng cây đơn vị
function useParents(enabled: boolean) {
  const [map, setMap] = useState<Map<string, { id: string; parent_id: string | null; name: string; type: string }>>(new Map())
  useEffect(() => { if (enabled) supabase.from('organizations').select('id, parent_id, name, type').then(({ data }) => setMap(new Map(((data as any[]) ?? []).map(o => [o.id, o])))) }, [enabled])
  return (id: string, type: string) => { let o = map.get(id); for (let k = 0; o && k < 10; k++) { if (o.type === type) return o.name; o = o.parent_id ? map.get(o.parent_id) : undefined } return 'Khác' }
}

// ================= Chỉ số STEM =================
export function StemIndexPage({ platform = false, groupBy: g0 = 'none' }: { platform?: boolean; groupBy?: 'none' | 'ward' | 'department' }) {
  const { schools, loading, err } = useDeptStats()
  const { cfg, err: e2 } = useIndexConfig()
  const [level, setLevel] = useState(''); const [q, setQ] = useState(''); const [lv, setLv] = useState<number | ''>('')
  const [groupBy, setGroupBy] = useState(g0)
  const [open, setOpen] = useState<string | null>(null)
  const sod = useParents(platform)
  const scored = useMemo(() => (cfg ? schools.map(s => scoreSchool(s, cfg)) : []), [schools, cfg])
  if (err || e2) return <p className="msg">{err || e2}</p>
  if (loading || !cfg) return <p className="sub">Đang tính chỉ số…</p>
  const list = scored.filter(s => (!level || s.level === level) && (!lv || s.mlevel === lv) && (!q || norm(s.name + ' ' + (s.ward ?? '') + ' ' + s.code).includes(norm(q))))
    .sort((a, b) => (b.index ?? -1) - (a.index ?? -1))
  const n = (l: number) => scored.filter(s => s.mlevel === l).length
  const keyOf = (s: Scored) => (groupBy === 'ward' ? s.ward ?? 'Chưa cập nhật' : groupBy === 'department' ? sod(s.school_id, 'department') : '')
  const grouped = groupBy === 'none' ? [] : [...list.reduce((m, s) => m.set(keyOf(s), [...(m.get(keyOf(s)) ?? []), s]), new Map<string, Scored[]>())]
    .map(([k, l]) => ({ k, l, index: avgOf(l.map(x => x.index)), l3: l.filter(x => x.mlevel === 3).length, l1: l.filter(x => x.mlevel === 1).length, groups: Object.fromEntries(GROUPS.map(g => [g, avgOf(l.map(x => x.groups[g]))])) }))
    .sort((a, b) => (b.index ?? -1) - (a.index ?? -1))
  function excel() {
    downloadWorkbook('chi-so-stem', [{ name: 'Chỉ số STEM', columns: [{ key: 'r', label: 'Hạng' }, { key: 'n', label: 'Trường', width: 30 }, { key: 'c', label: 'Cấp' }, { key: 'w', label: 'Xã/phường', width: 18 },
      { key: 'i', label: 'Chỉ số STEM' }, { key: 'l', label: 'Mức', width: 18 }, ...GROUPS.map(g => ({ key: g, label: g, width: 14 })), ...INDICATORS.filter(i => on(cfg!, i)).map(i => ({ key: i.key, label: i.label, width: 16 }))],
      rows: list.map((s, k) => [k + 1, s.name, LEVEL[s.level ?? ''] ?? '', s.ward, s.index, s.mlevel ? LV[s.mlevel][0] : '', ...GROUPS.map(g => s.groups[g]), ...INDICATORS.filter(i => on(cfg!, i)).map(i => s.parts[i.key])]) }])
  }
  return (
    <>
      <p className="sub">Đang dùng <b>{cfg.name}</b>{cfg.source ? ` (${cfg.source})` : ''} · Mức 3 ≥ {cfg.level3} · Mức 2 ≥ {cfg.level2}. Chỉ số 0–100 tính từ số liệu thật của từng trường; sửa trọng số ở <i>Bộ chỉ số</i>.</p>
      <Tiles items={[
        { label: 'Chỉ số STEM bình quân', value: avgOf(scored.map(s => s.index)) ?? '—', sub: `${scored.length} trường` },
        { label: LV[3][0], value: n(3), tone: 'good', sub: scored.length ? Math.round((100 * n(3)) / scored.length) + '% số trường' : undefined },
        { label: LV[2][0], value: n(2) },
        { label: LV[1][0], value: n(1), tone: n(1) ? 'bad' : undefined },
      ]} />
      <div className="panel">
        <b>Bình quân theo nhóm chỉ số</b>
        <div className="igroups">{GROUPS.map(g => <div key={g}><small>{g}</small><Bar v={avgOf(scored.map(s => s.groups[g]))} /></div>)}</div>
      </div>
      <div className="bar" style={{ marginTop: 12 }}>
        <span className="tools">
          <input className="search" style={{ margin: 0 }} placeholder="Tìm trường, xã/phường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <select value={level} onChange={e => setLevel(e.target.value)} aria-label="Cấp học"><option value="">Mọi cấp</option>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={lv} onChange={e => setLv(e.target.value ? +e.target.value as 1 : '')} aria-label="Mức"><option value="">Mọi mức</option>{[3, 2, 1].map(l => <option key={l} value={l}>{LV[l][0]}</option>)}</select>
          <div className="segmented" style={{ margin: 0 }}>{([['none', 'Theo trường'], ['ward', 'Theo xã/phường'], ...(platform ? [['department', 'Theo Sở']] : [])] as [typeof groupBy, string][]).map(([k, l]) =>
            <button key={k} className={groupBy === k ? 'on' : ''} onClick={() => setGroupBy(k)}>{l}</button>)}</div>
        </span>
        <button onClick={excel}>Xuất Excel</button>
      </div>
      {groupBy !== 'none' ? (
        <div className="wrap"><table>
          <thead><tr><th>#</th><th>{groupBy === 'ward' ? 'Xã / phường' : 'Sở'}</th><th>Số trường</th><th>Chỉ số STEM</th><th>Mức 3</th><th>Mức 1</th>{GROUPS.map(g => <th key={g}>{g}</th>)}</tr></thead>
          <tbody>{grouped.map((r, k) => <tr key={r.k}><td>{k + 1}</td><td><b>{r.k}</b></td><td>{r.l.length}</td><td><Bar v={r.index} /></td><td>{r.l3}</td><td>{r.l1 ? <span className="due bad">{r.l1}</span> : 0}</td>
            {GROUPS.map(g => <td key={g}>{r.groups[g] ?? '—'}</td>)}</tr>)}</tbody>
        </table></div>
      ) : (
        <div className="wrap"><table>
          <thead><tr><th>#</th><th>Trường</th><th>Chỉ số STEM</th><th>Mức</th>{GROUPS.map(g => <th key={g}>{g}</th>)}<th /></tr></thead>
          <tbody>{list.slice(0, 400).flatMap((s, k) => [
            <tr key={s.school_id}><td>{k + 1}</td><td><b>{s.name}</b><br /><small>{[LEVEL[s.level ?? ''], s.ward].filter(Boolean).join(' · ')}</small></td>
              <td style={{ minWidth: 140 }}><Bar v={s.index} /></td><td><LvBadge l={s.mlevel} /></td>{GROUPS.map(g => <td key={g}>{s.groups[g] ?? '—'}</td>)}
              <td><button onClick={() => setOpen(open === s.school_id ? null : s.school_id)}>{open === s.school_id ? 'Đóng' : 'Chi tiết'}</button></td></tr>,
            open === s.school_id && <tr key={s.school_id + 'd'}><td colSpan={5 + GROUPS.length}>
              <div className="ibreak">{INDICATORS.filter(i => on(cfg, i)).map(i => <div key={i.key}><small>{i.group} · trọng số {w(cfg, i)}</small><b>{i.label}</b><Bar v={s.parts[i.key]} /><small className="sub">{i.hint}</small></div>)}</div>
            </td></tr>])}
            {!list.length && <tr><td colSpan={5 + GROUPS.length}>Không có trường phù hợp.</td></tr>}</tbody>
        </table></div>
      )}
    </>
  )
}

// ================= Bộ chỉ số =================
export function IndexConfigPage({ orgId, platform = false }: { orgId: string | null; platform?: boolean }) {
  const { cfg, err, reload } = useIndexConfig()
  const { schools } = useDeptStats()
  const [c, setC] = useState<Cfg | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => { if (cfg) setC(cfg.own ? cfg : { ...cfg, name: cfg.own ? cfg.name : 'Bộ chỉ số STEM' }) }, [cfg])
  if (err) return <p className="msg">{err}</p>
  if (!c) return <p className="sub">Đang tải…</p>
  const set = (k: string, p: { on?: boolean; weight?: number; target?: number | null }) => setC({ ...c, indicators: { ...c.indicators, [k]: { ...c.indicators[k], ...p } } })
  const total = INDICATORS.filter(i => on(c, i)).reduce((a, i) => a + w(c, i), 0)
  const prev = schools.map(s => scoreSchool(s, c)), cur = cfg ? schools.map(s => scoreSchool(s, cfg)) : []
  const cnt = (xs: Scored[], l: number) => xs.filter(x => x.mlevel === l).length
  async function save() {
    if (!orgId) return
    const row = { org_id: orgId, name: c!.name.trim() || 'Bộ chỉ số STEM', indicators: c!.indicators, level3: c!.level3, level2: c!.level2 }
    const { error } = await supabase.from('stem_index_configs').upsert(row)
    if (error) return setMsg([/row-level/i.test(error.message) ? 'Chỉ cán bộ Sở / Phòng (hoặc KDI) đặt được bộ chỉ số của đơn vị mình.' : /level2|check/i.test(error.message) ? 'Ngưỡng Mức 2 phải thấp hơn Mức 3.' : error.message, true])
    setMsg(['Đã lưu bộ chỉ số. Các trường trực thuộc dùng bộ này ngay.', false]); reload()
  }
  async function reset() {
    if (!orgId || !confirm('Bỏ bộ chỉ số riêng của đơn vị, dùng lại bộ của cấp trên / mặc định KDI?')) return
    const { error } = await supabase.from('stem_index_configs').delete().eq('org_id', orgId)
    if (error) return setMsg([error.message, true]); setMsg(['Đã dùng lại bộ chỉ số mặc định.', false]); reload()
  }
  return (
    <>
      <p className="sub">{cfg?.own ? 'Đơn vị đang dùng bộ chỉ số riêng.' : `Đơn vị đang dùng ${cfg?.source ? 'bộ chỉ số của ' + cfg.source : 'bộ chỉ số mặc định của KDI'} — lưu để tạo bộ riêng.`}
        {platform && ' Bộ chỉ số lưu ở cổng KDI là mặc định cho mọi Sở chưa đặt bộ riêng.'} Mỗi chỉ số cho điểm 0–100; trọng số không cần cộng đủ 100 (hệ thống tự chia tỉ lệ).</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <div className="panel formgrid">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên bộ chỉ số</span><input value={c.name} onChange={e => setC({ ...c, name: e.target.value })} /></label>
        <label className="field"><span>Ngưỡng Mức 3 · Tiên tiến (≥)</span><input type="number" min={1} max={100} value={c.level3} onChange={e => setC({ ...c, level3: +e.target.value })} /></label>
        <label className="field"><span>Ngưỡng Mức 2 · Đạt (≥)</span><input type="number" min={0} max={99} value={c.level2} onChange={e => setC({ ...c, level2: +e.target.value })} /></label>
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Dùng</th><th>Nhóm</th><th>Chỉ số</th><th>Trọng số</th><th>Tỉ trọng</th><th>Mục tiêu</th></tr></thead>
        <tbody>{INDICATORS.map(i => <tr key={i.key} className={on(c, i) ? '' : 'muted'}>
          <td><input type="checkbox" checked={on(c, i)} onChange={e => set(i.key, { on: e.target.checked })} aria-label={'Dùng ' + i.label} /></td>
          <td><small>{i.group}</small></td><td><b>{i.label}</b><br /><small className="sub">{i.hint}</small></td>
          <td><input type="number" min={0} max={100} value={w(c, i)} disabled={!on(c, i)} onChange={e => set(i.key, { weight: Math.max(0, Math.min(100, +e.target.value)) })} style={{ width: 70 }} aria-label={'Trọng số ' + i.label} /></td>
          <td>{on(c, i) && total ? Math.round((100 * w(c, i)) / total) + '%' : '—'}</td>
          <td>{i.target != null ? <><input type="number" min={0.1} step="any" value={tgt(c, i)} disabled={!on(c, i)} onChange={e => set(i.key, { target: +e.target.value || i.target })} style={{ width: 70 }} aria-label={'Mục tiêu ' + i.label} /> <small>{i.unit}</small></> : '—'}</td></tr>)}</tbody>
      </table></div>
      {schools.length > 0 && <p className="sub">Xem trước với {schools.length} trường trong phạm vi: Mức 3 {cnt(cur, 3)} → <b>{cnt(prev, 3)}</b> · Mức 2 {cnt(cur, 2)} → <b>{cnt(prev, 2)}</b> · Mức 1 {cnt(cur, 1)} → <b>{cnt(prev, 1)}</b></p>}
      <div className="formactions"><button className="primary" onClick={save}>Lưu bộ chỉ số</button>{cfg?.own && <button onClick={reset}>Dùng lại mặc định</button>}</div>
    </>
  )
}

// ================= So sánh trường / địa bàn =================
export function ComparePage() {
  const { schools, loading, err } = useDeptStats()
  const { cfg } = useIndexConfig()
  const [mode, setMode] = useState<'school' | 'ward'>('school')
  const [picked, setPicked] = useState<string[]>([])
  const [q, setQ] = useState('')
  const scored = useMemo(() => (cfg ? schools.map(s => scoreSchool(s, cfg)) : []), [schools, cfg])
  if (err) return <p className="msg">{err}</p>
  if (loading || !cfg) return <p className="sub">Đang tải…</p>
  type Col = { id: string; name: string; index: number | null; groups: Record<string, number | null>; parts: Record<string, number | null>; n: number }
  const wards = [...new Set(scored.map(s => s.ward ?? 'Chưa cập nhật'))].sort((a, b) => a.localeCompare(b, 'vi'))
  const colOf = (id: string): Col | null => {
    if (mode === 'school') { const s = scored.find(x => x.school_id === id); return s ? { id, name: s.name, index: s.index, groups: s.groups, parts: s.parts, n: 1 } : null }
    const l = scored.filter(x => (x.ward ?? 'Chưa cập nhật') === id)
    return { id, name: id, index: avgOf(l.map(x => x.index)), groups: Object.fromEntries(GROUPS.map(g => [g, avgOf(l.map(x => x.groups[g]))])), parts: Object.fromEntries(INDICATORS.map(i => [i.key, avgOf(l.map(x => x.parts[i.key]))])), n: l.length }
  }
  const all: Col = { id: '*', name: 'Bình quân toàn đơn vị', index: avgOf(scored.map(x => x.index)), groups: Object.fromEntries(GROUPS.map(g => [g, avgOf(scored.map(x => x.groups[g]))])), parts: Object.fromEntries(INDICATORS.map(i => [i.key, avgOf(scored.map(x => x.parts[i.key]))])), n: scored.length }
  const cols = [...picked.map(colOf).filter((x): x is Col => !!x), all]
  const options = mode === 'school' ? scored.filter(s => !picked.includes(s.school_id) && (!q || norm(s.name + ' ' + (s.ward ?? '')).includes(norm(q)))).slice(0, 80).map(s => [s.school_id, s.name] as const)
    : wards.filter(x => !picked.includes(x) && (!q || norm(x).includes(norm(q)))).map(x => [x, x] as const)
  const PAL = ['#2563eb', '#d97706', '#059669', '#9333ea', '#dc2626']
  const best = (vals: (number | null)[]) => Math.max(...vals.filter((x): x is number => x != null))
  return (
    <>
      <div className="bar">
        <div className="segmented" style={{ margin: 0 }}>{([['school', 'So sánh trường'], ['ward', 'So sánh xã / phường']] as const).map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setPicked([]) }}>{l}</button>)}</div>
        <span className="tools"><input className="search" style={{ margin: 0 }} placeholder={mode === 'school' ? 'Tìm trường…' : 'Tìm xã / phường…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <select value="" disabled={picked.length >= 5} onChange={e => e.target.value && setPicked([...picked, e.target.value])} aria-label="Thêm vào so sánh"><option value="">{picked.length >= 5 ? 'Tối đa 5' : '+ Thêm vào so sánh'}</option>{options.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></span>
      </div>
      {!picked.length && <p className="sub">Chọn 2–5 {mode === 'school' ? 'trường' : 'xã / phường'} để so sánh từng nhóm và từng chỉ số; cột cuối là bình quân toàn đơn vị.</p>}
      {picked.length > 0 && <>
        <div className="panel">
          <b>Theo nhóm chỉ số</b>
          <div className="cmpgrid">{['Chỉ số STEM', ...GROUPS].map(g => <div key={g} className="cmpgroup"><small>{g}</small>
            {cols.map((c, k) => { const v = g === 'Chỉ số STEM' ? c.index : c.groups[g]; return (
              <div key={c.id} className="cmprow" title={`${c.name}: ${v ?? '—'}`}><span className="cmpname">{c.name}</span><span className="ibar"><i style={{ width: (v ?? 0) + '%', background: c.id === '*' ? '#94a3b8' : PAL[k] }} /><b>{v ?? '—'}</b></span></div>) })}
          </div>)}</div>
        </div>
        <div className="wrap"><table>
          <thead><tr><th>Chỉ số</th>{cols.map((c, k) => <th key={c.id}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c.id === '*' ? '#94a3b8' : PAL[k], marginRight: 6 }} />{c.name}
            {c.id !== '*' && <button className="xbtn" onClick={() => setPicked(picked.filter(x => x !== c.id))} aria-label={'Bỏ ' + c.name}> ✕</button>}{mode === 'ward' && <><br /><small className="sub">{c.n} trường</small></>}</th>)}</tr></thead>
          <tbody>
            <tr><td><b>Chỉ số STEM</b></td>{cols.map(c => <td key={c.id}><b className={c.index === best(cols.map(x => x.index)) && c.id !== '*' ? 'good' : ''}>{c.index ?? '—'}</b></td>)}</tr>
            {INDICATORS.filter(i => on(cfg, i)).map(i => { const vals = cols.map(c => c.parts[i.key]); return (
              <tr key={i.key}><td>{i.label}<br /><small className="sub">{i.group}</small></td>{cols.map((c, k) => <td key={c.id} className={vals[k] != null && vals[k] === best(vals.slice(0, -1)) && c.id !== '*' && picked.length > 1 ? 'good' : ''}>{vals[k] ?? '—'}</td>)}</tr>) })}
          </tbody>
        </table></div>
      </>}
    </>
  )
}
