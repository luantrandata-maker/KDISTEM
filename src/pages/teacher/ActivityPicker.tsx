// Bảng chọn hoạt động từ Kho hoạt động (dùng chung): chèn slide hoạt động vào bài giảng slide,
// và chọn cho khối "Hoạt động từ kho" của bài giảng tương tác. Có tìm, lọc khối / loại, ưu tiên hoạt động cùng bài, chơi thử.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Icon } from '../../components/Icon'
import { BlockView } from '../../lib/lessonBlocks'
import { ACT, activityToBlock, type ActKind } from './activity'
import type { KhoAct } from './Lessons'

const ActivityDesk = lazy(() => import('./Activities').then(m => ({ default: m.ActivityDesk })))
const COLS = 'id, org_id, kind, title, instructions, content, grades, subject, status, is_template, updated_at, teachers(full_name)'
type Row = { id: string; org_id: string; kind: ActKind; title: string; instructions: string | null; content: any; grades: string | null; subject: string | null
  status: string; is_template: boolean; updated_at: string; teachers?: { full_name: string } | null }

const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/^\s*(bài giảng|bài học)\s*:\s*/, '').replace(/\s+/g, ' ').trim()
const lessonOf = (ins?: string | null) => norm(/(?:^|\n)Bài học:\s*(.+)\s*$/m.exec(ins ?? '')?.[1])
/** Bản chụp hoạt động để lưu vào slide / khối (kèm mã để mở và cập nhật theo Kho) */
export const snapAct = (r: Pick<Row, 'id' | 'kind' | 'title' | 'content' | 'instructions' | 'updated_at' | 'status'>): KhoAct =>
  ({ id: r.id, kind: r.kind, label: ACT[r.kind]?.label, title: r.title, content: r.content ?? {}, instructions: r.instructions, updated_at: r.updated_at, status: r.status })
/** Lấy bản mới nhất của một hoạt động trong Kho (null nếu không còn hoặc không có quyền xem) */
export async function fetchAct(id: string): Promise<KhoAct | null> {
  const { data } = await supabase.from('activities').select('id, kind, title, content, instructions, updated_at, status').eq('id', id).maybeSingle()
  return data ? snapAct(data as Row) : null
}

export function ActivityPicker({ lesson, grades, current, action, onPick, onClose }: {
  /** Tên bài giảng / bài học để đưa hoạt động cùng bài lên trước */
  lesson?: (string | null | undefined)[]; grades?: string | null; current?: string
  /** Chữ trên nút chọn, VD "Chèn vào sau slide 2" */
  action: string; onPick: (a: KhoAct) => void; onClose: () => void
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [grade, setGrade] = useState('')
  const [kind, setKind] = useState('')
  const keys = useMemo(() => (lesson ?? []).map(norm).filter(Boolean), [JSON.stringify(lesson)])
  const [same, setSame] = useState(true)
  const [sel, setSel] = useState<string | null>(current ?? null)
  const [play, setPlay] = useState<string | null>(null)
  useEffect(() => {
    (async () => {
      let r = await supabase.from('activities').select(COLS).eq('domain', 'school').order('updated_at', { ascending: false }).limit(500)
      if (r.error && /domain/.test(r.error.message)) r = await supabase.from('activities').select(COLS).order('updated_at', { ascending: false }).limit(500)
      if (r.error) return setErr(r.error.message)
      const all = (r.data as unknown as Row[]) ?? []
      setRows(all)
      // Mặc định lọc theo khối của bài nếu có hoạt động cùng khối
      const g = (grades ?? '').split(/[,;]/)[0]?.trim()
      if (g && all.some(x => (x.grades ?? '').includes(g))) setGrade(g)
    })()
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])
  const gradeOpts = useMemo(() => [...new Set((rows ?? []).flatMap(r => (r.grades ?? '').split(/[,;]/).map(x => x.trim()).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true })), [rows])
  const isSame = (r: Row) => { const l = lessonOf(r.instructions); return !!l && keys.some(k => k === l || k.includes(l) || l.includes(k)) }
  const list = (rows ?? []).filter(r => (!kind || r.kind === kind) && (!grade || (r.grades ?? '').includes(grade))
    && (!q.trim() || norm(`${r.title} ${r.subject ?? ''} ${r.instructions ?? ''}`).includes(norm(q))))
  const top = same && keys.length ? list.filter(isSame) : []
  const rest = top.length ? list.filter(r => !top.includes(r)) : list
  const pick = rows?.find(r => r.id === sel)
  const row = (r: Row) => {
    const a = ACT[r.kind]
    return <div key={r.id} className={'actpick' + (sel === r.id ? ' on' : '')}>
      <button type="button" className="actpickmain" aria-pressed={sel === r.id} onClick={() => setSel(r.id)}>
        <span className={'actpickic k-' + r.kind} aria-hidden>{a ? <Icon n={a.icon} /> : '🧪'}</span>
        <span><b>{r.title}</b><small>{[a?.label, r.grades && 'Khối ' + r.grades.replace(/^khối\s*/i, ''), r.teachers?.full_name ?? 'KDI', r.status === 'published' ? 'Đã xuất bản' : 'Nháp'].filter(Boolean).join(' · ')}</small></span>
      </button>
      <button type="button" onClick={() => setPlay(play === r.id ? null : r.id)} aria-expanded={play === r.id}>{play === r.id ? 'Đóng chơi thử' : '👁 Chơi thử'}</button>
      {play === r.id && <div className="actpickplay"><BlockView b={activityToBlock(r)} teacher /></div>}
    </div>
  }
  return <div className="modalbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="modal wide actpicker" role="dialog" aria-modal="true" aria-label="Chọn hoạt động từ Kho hoạt động">
      <div className="modalhead"><h3>Chọn hoạt động từ Kho hoạt động</h3><button type="button" className="x" onClick={onClose} aria-label="Đóng">×</button></div>
      <div className="modalbody">
        <div className="actpickfilter">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 Tìm tên hoạt động…" aria-label="Tìm hoạt động" autoFocus />
          <select value={grade} onChange={e => setGrade(e.target.value)} aria-label="Khối"><option value="">Mọi khối</option>{gradeOpts.map(g => <option key={g} value={g}>Khối {g.replace(/^khối\s*/i, '')}</option>)}</select>
          <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Loại hoạt động"><option value="">Mọi loại</option>{(Object.keys(ACT) as ActKind[]).map(k => <option key={k} value={k}>{ACT[k].label}</option>)}</select>
          {keys.length > 0 && <label className="inl"><input type="checkbox" checked={same} onChange={e => setSame(e.target.checked)} /> Cùng bài trước</label>}
        </div>
        {err && <p className="err" role="alert">Không tải được Kho hoạt động: {err}</p>}
        {!rows && !err && <p className="sub">Đang tải Kho hoạt động…</p>}
        {rows && !list.length && <p className="sub">Không có hoạt động nào khớp bộ lọc.</p>}
        {top.length > 0 && <><small className="sub">Cùng bài: {lesson?.find(Boolean)}</small>{top.map(row)}</>}
        {rest.length > 0 && <>{top.length > 0 && <small className="sub">Hoạt động khác</small>}{rest.slice(0, 200).map(row)}</>}
        {rest.length > 200 && <small className="sub">Còn {rest.length - 200} hoạt động nữa, gõ tên để tìm.</small>}
      </div>
      <div className="modalfoot">
        {pick && <small className="sub" style={{ marginRight: 'auto' }}>Đã chọn: <b>{pick.title}</b></small>}
        <button type="button" onClick={onClose}>Huỷ</button>
        <button type="button" className="primary" disabled={!pick} onClick={() => pick && onPick(snapAct(pick))}>{action}</button>
      </div>
    </div>
  </div>
}

/** Mở hoạt động trong Kho (xem, chơi thử, sửa nếu có quyền) ngay trên trang đang soạn; đóng thì báo để cập nhật bản trong bài */
export function KhoOpen({ id, orgId, onClose }: { id: string; orgId: string | null; onClose: () => void }) {
  return <div className="overlay player khoopen" role="dialog" aria-modal="true" aria-label="Hoạt động trong Kho">
    <div className="khoopenin"><Suspense fallback={<p className="sub">Đang tải…</p>}><ActivityDesk orgId={orgId} start={{ mode: 'open', id }} onClose={onClose} /></Suspense></div>
  </div>
}
