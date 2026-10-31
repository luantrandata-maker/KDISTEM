// Bài giảng tập huấn soạn như bài học (102): mỗi bài là bộ 5 thẻ — Thông tin · Nội dung · Link tài liệu · Định mức vật tư · Kho hoạt động.
// Kho hoạt động tuỳ chọn (105): chốt đủ 4 thẻ còn lại là phát hành được.
// Thêm bài theo 4 cách như thêm bài học (tải giáo án Word/PowerPoint, tự tạo, sao chép, file mẫu Excel); mở bài để sửa, chốt từng thẻ, phát hành.
// Bài gắn với chương trình tập huấn và một nội dung trong chương trình; giáo viên thấy bài đã phát hành của kế hoạch mình tham gia.
import { useOrgFilter } from '../../components/OrgFilters'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAllMode } from '../../components/OrgScope'
import { fmtDate } from '../../lib/time'
import { LessonPage } from '../library/lesson/LessonPage'
import { CreateLesson, kitSubject, type ProgRef } from '../library/lesson/Create'
import type { KitRow } from '../library/lesson/save'

type TProg = ProgRef & { status: string }
type TUnit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string }
type TLesson = KitRow & { org_id: string; author: string | null; created_on: string | null; training_plans: { name: string } | null }
type St = '' | 'draft' | 'published' | 'inactive'
const STATUS: Record<string, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], inactive: ['Ngừng dùng', 'off'] }
const SEL = 'id, org_id, owner_org_id:org_id, title, subject, grades, program_id, unit_id, status, version, updated_at, content, author, created_on, training_plans(name)'
const Chip = ({ tone, children }: { tone?: string; children: React.ReactNode }) => <span className={'distchip2 ' + (tone ?? '')}>{children}</span>

/** Chương trình tập huấn + nội dung (Môn › Nội dung) để gắn bài giảng */
export function useTrainingPrograms() {
  const [progs, setProgs] = useState<TProg[]>([])
  const [units, setUnits] = useState<TUnit[]>([])
  useEffect(() => {
    Promise.all([
      supabase.from('training_programs').select('id, code, title, ct_code, status').neq('status', 'archived').order('code'),
      supabase.from('training_program_units').select('id, program_id, parent_id, kind, seq, title'),
    ]).then(([p, u]) => { setProgs((p.data as TProg[]) ?? []); setUnits(((u.data as TUnit[]) ?? []).sort((a, b) => a.seq - b.seq)) })
  }, [])
  return useMemo(() => {
    const opts = new Map<string, [string, string][]>()
    for (const p of progs) {
      const out: [string, string][] = []
      for (const s of units.filter(x => x.program_id === p.id && x.kind === 'subject'))
        for (const c of units.filter(x => x.parent_id === s.id && x.kind === 'content')) out.push([`${s.title} › ${c.title}`, c.id])
      opts.set(p.id, out)
    }
    const subjectsOf = (pid: string) => (opts.get(pid) ?? []).map(x => x[0])
    const unitOf = (pid: string, label: string) => (opts.get(pid) ?? []).find(x => x[0] === label)?.[1] ?? null
    const labelOf = (uid: string | null) => { const c = units.find(x => x.id === uid); const s = c && units.find(x => x.id === c.parent_id); return c ? (s ? `${s.title} › ${c.title}` : c.title) : '' }
    return { progs, subjectsOf, unitOf, labelOf }
  }, [progs, units])
}

export function TrainingLessonsPage({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<TLesson[] | null>(null)
  const [err, setErr] = useState('')
  const [rk, setRk] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  const [q, setQ] = useState(''); const [fp, setFp] = useState(''); const [fs, setFs] = useState<St>(''); const ofl = useOrgFilter()
  const all = !!useAllMode()
  const { progs, subjectsOf, unitOf, labelOf } = useTrainingPrograms()
  const reload = () => setRk(x => x + 1)
  useEffect(() => {
    supabase.from('training_lessons').select(SEL).order('updated_at', { ascending: false }).then(({ data, error }) => {
      if (error) setErr(/column|schema cache/i.test(error.message) ? 'Hãy chạy migration 102 trên Supabase.' : error.message)
      else setRows((data as unknown as TLesson[]) ?? [])
    })
  }, [rk])

  const progLabel = (pid: string | null) => { const p = progs.find(x => x.id === pid); return p ? `${p.code ? p.code + ' · ' : ''}${p.title}` : '' }
  const shown = useMemo(() => (rows ?? []).filter(r => (!fs || r.status === fs) && (!fp || r.program_id === fp) && ofl.fit(r.org_id)
    && (!q || `${r.title} ${r.subject ?? ''} ${r.author ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [rows, fs, fp, ofl, q])

  if (open) return <>
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    <LessonPage key={open} orgId={rows?.find(r => r.id === open)?.org_id ?? orgId} id={open} store="training" unitOf={unitOf}
      programs={progs} subjectsOf={subjectsOf} code="" backLabel="← Bài giảng tập huấn"
      onBack={() => { setOpen(null); setMsg(''); reload() }} onChanged={reload} />
  </>

  const n = (s: St) => (rows ?? []).filter(r => r.status === s).length
  async function setStatus(r: TLesson, status: 'inactive' | 'published' | 'draft') {
    const x = await supabase.from('training_lessons').update({ status }).eq('id', r.id)
    setMsg(x.error ? x.error.message : status === 'inactive' ? `Đã ngừng dùng “${r.title}”.` : `Đã dùng lại “${r.title}”.`); reload()
  }
  async function remove(r: TLesson) {
    if (!confirm(`Xoá bài giảng “${r.title}”? Không khôi phục được.`)) return
    const x = await supabase.from('training_lessons').delete().eq('id', r.id)
    setMsg(x.error ? x.error.message : `Đã xoá “${r.title}”.`); reload()
  }
  const p0 = progs[0]
  const checked = (r: TLesson) => (r.content?.checked ?? []).filter(k => k !== 'bank').length

  return (
    <>
      <div className="diststatcards">
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{rows?.length ?? '…'}</b><small>Bài giảng tập huấn</small><small>{n('published')} đã phát hành · {n('draft')} nháp</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{(rows ?? []).filter(r => checked(r) >= 4).length}</b><small>Đã chốt đủ 4 thẻ bắt buộc</small></span></div>
        <div className="panel"><i aria-hidden="true">▤</i><span><b>{new Set((rows ?? []).map(r => r.program_id).filter(Boolean)).size}</b><small>Chương trình tập huấn có bài giảng</small></span></div>
      </div>
      <div className="distfilter">
        {([['', 'Tất cả', rows?.length ?? 0], ['draft', 'Nháp', n('draft')], ['published', 'Đã phát hành', n('published')], ['inactive', 'Ngừng dùng', n('inactive')]] as [St, string, number][]).map(([s, l, c]) =>
          <button key={l} type="button" className={'distfchip' + (fs === s ? ' on' : '')} aria-pressed={fs === s} onClick={() => setFs(s)}>{l} <b>{c}</b></button>)}
      </div>
      <div className="bar">
        <div className="tools">
          <input placeholder="Tìm tên bài giảng, môn, tác giả…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <select value={fp} onChange={e => setFp(e.target.value)} aria-label="Chương trình tập huấn"><option value="">Mọi chương trình tập huấn</option>
            {progs.map(p => <option key={p.id} value={p.id}>{progLabel(p.id)}</option>)}</select>
          {ofl.node((rows ?? []).map(r => r.org_id))}
          <small className="sub">{shown.length}/{rows?.length ?? 0} bài giảng</small>
        </div>
        <div className="tools"><button type="button" className="primary" disabled={!p0} title={p0 ? undefined : 'Chưa có chương trình tập huấn để gắn bài giảng'}
          onClick={() => { setMsg(''); setAdding(true) }}>+ Thêm bài giảng tập huấn</button></div>
      </div>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      {err ? <p className="msg">{err}</p> : !rows ? <p className="sub">Đang tải…</p> :
        <div className="wrap"><table className="libtable tllist">
          <thead><tr><th>Bài giảng tập huấn</th><th>Chương trình tập huấn · nội dung</th><th>Thẻ đã chốt</th><th>Trạng thái</th><th>Cập nhật</th><th /></tr></thead>
          <tbody>{shown.map(r => { const c = checked(r), legacy = !r.content?.kit
            return <tr key={r.id}>
              <td><button type="button" className="namelink" onClick={() => { setMsg(''); setOpen(r.id) }}>{r.title}</button><br />
                <small className="sub">{[r.subject, r.grades && `Khối ${r.grades}`, r.author].filter(Boolean).join(' · ')}</small></td>
              <td style={{ whiteSpace: 'normal' }}>{progLabel(r.program_id) || r.training_plans?.name || <small className="sub">Chưa gắn</small>}
                {(labelOf(r.unit_id) || (r.program_id && kitSubject(r))) && <><br /><small className="sub">{labelOf(r.unit_id) || kitSubject(r)}</small></>}</td>
              <td>{legacy ? <small className="sub">Bài cũ, chưa có 5 thẻ</small> : <><span className="tpdot" /> {c}/4 thẻ bắt buộc{(r.content?.checked ?? []).includes('bank') ? ' · có Kho hoạt động' : ''}</>}</td>
              <td><Chip tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}{r.status === 'published' && r.version ? ` · v${r.version}` : ''}</Chip></td>
              <td><small>{fmtDate((r.updated_at ?? r.created_on ?? '').slice(0, 10))}</small></td>
              <td><details className="distmore"><summary aria-label="Thao tác">···</summary><div className="distmenu">
                <button type="button" onClick={() => setOpen(r.id)}>Mở bài giảng</button>
                {r.status === 'inactive' ? <button type="button" onClick={() => setStatus(r, r.version > 0 ? 'published' : 'draft')}>Dùng lại</button>
                  : <button type="button" onClick={() => setStatus(r, 'inactive')}>Ngừng dùng</button>}
                <button type="button" className="danger" onClick={() => remove(r)}>Xoá</button></div></details></td>
            </tr> })}
            {shown.length === 0 && <tr><td colSpan={6}>{rows.length ? 'Không có bài giảng nào khớp bộ lọc.' : 'Chưa có bài giảng tập huấn nào. Bấm “+ Thêm bài giảng tập huấn”.'}</td></tr>}</tbody>
        </table></div>}
      {adding && p0 && <CreateLesson orgId={orgId} store="training" unitOf={unitOf} programs={progs} subjectsOf={subjectsOf}
        program={progs.find(p => p.id === fp) ?? p0} subject={subjectsOf((progs.find(p => p.id === fp) ?? p0).id)[0] ?? ''} pickPlace
        kits={rows ?? []} onClose={() => setAdding(false)} onCreated={(id, m) => { setAdding(false); setMsg(m); reload(); setOpen(id) }} />}
    </>
  )
}
