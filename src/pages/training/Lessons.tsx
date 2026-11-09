// Bài giảng đào tạo soạn như bài học (102): mỗi bài là bộ 5 thẻ — Thông tin · Nội dung · Link tài liệu · Định mức vật tư · Kho hoạt động.
// Kho hoạt động tuỳ chọn (105): chốt đủ 4 thẻ còn lại là phát hành được.
// Thêm bài theo 4 cách như thêm bài học (tải giáo án Word/PowerPoint, tự tạo, sao chép, file mẫu Excel); mở bài để sửa, chốt từng thẻ, phát hành.
// Bài gắn với chương trình đào tạo và một nội dung trong chương trình; nhà giáo thấy bài đã phát hành của kế hoạch mình tham gia.
import { useOrgFilter } from '../../components/OrgFilters'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAllMode } from '../../components/OrgScope'
import { fmtDate } from '../../lib/time'
import { LessonPage } from '../library/lesson/LessonPage'
import { CreateLesson, kitSubject, type ProgRef } from '../library/lesson/Create'
import type { KitRow } from '../library/lesson/save'
import { FilterChips } from '../../components/FilterChips'
import { DataTable, MoreFilters, type Col } from '../../components/DataTable'

type TProg = ProgRef & { status: string }
type TUnit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string }
type TLesson = KitRow & { org_id: string; author: string | null; created_on: string | null; training_plans: { name: string } | null }
type St = '' | 'draft' | 'published' | 'inactive'
const STATUS: Record<string, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], inactive: ['Ngừng dùng', 'off'] }
const SEL = 'id, org_id, owner_org_id:org_id, title, subject, grades, program_id, unit_id, status, version, updated_at, content, author, created_on, training_plans(name)'
const Chip = ({ tone, children }: { tone?: string; children: React.ReactNode }) => <span className={'distchip2 ' + (tone ?? '')}>{children}</span>

/** Chương trình đào tạo + nội dung (Môn › Nội dung) để gắn bài giảng */
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
  // base: theo chương trình, đơn vị, ô tìm; thẻ tổng số và nút trạng thái đếm trên base
  const base = useMemo(() => (rows ?? []).filter(r => (!fp || r.program_id === fp) && ofl.fit(r.org_id)
    && (!q || `${r.title} ${r.subject ?? ''} ${r.author ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [rows, fp, ofl, q])
  const [card, setCard] = useState<string | null>(null)
  const ready4 = (r: TLesson) => (r.content?.checked ?? []).filter(k => k !== 'bank').length >= 4
  const shown = useMemo(() => base.filter(r => (!fs || r.status === fs) && (card !== 'ready' || ready4(r))), [base, fs, card])

  if (open) return <>
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    <LessonPage key={open} orgId={rows?.find(r => r.id === open)?.org_id ?? orgId} id={open} store="training" unitOf={unitOf}
      programs={progs} subjectsOf={subjectsOf} code="" backLabel="← Bài giảng đào tạo"
      onBack={() => { setOpen(null); setMsg(''); reload() }} onChanged={reload} />
  </>

  const n = (s: St) => base.filter(r => r.status === s).length
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

  const lessonCols: Col<TLesson>[] = [
    { key: 'name', label: 'Bài giảng đào tạo', fixed: true, values: r => [r.title], text: r => `${r.title} ${r.subject ?? ''} ${r.author ?? ''}`,
      cell: r => <><button type="button" className="namelink" onClick={() => { setMsg(''); setOpen(r.id) }}>{r.title}</button><br />
        <small className="sub">{[r.subject, r.grades && `Khối ${r.grades}`, r.author].filter(Boolean).join(' · ')}</small></> },
    { key: 'prog', label: 'Chương trình đào tạo · nội dung', values: r => [String(progLabel(r.program_id) || r.training_plans?.name || '')], text: r => `${progLabel(r.program_id) || r.training_plans?.name || ''} ${labelOf(r.unit_id) || ''}`,
      cell: r => <>{progLabel(r.program_id) || r.training_plans?.name || <small className="sub">Chưa gắn</small>}
        {(labelOf(r.unit_id) || (r.program_id && kitSubject(r))) && <><br /><small className="sub">{labelOf(r.unit_id) || kitSubject(r)}</small></>}</> },
    { key: 'cards', label: 'Thẻ đã chốt', cell: r => !r.content?.kit ? <small className="sub">Bài cũ, chưa có 5 thẻ</small> : <><span className="tpdot" /> {checked(r)}/4 thẻ bắt buộc{(r.content?.checked ?? []).includes('bank') ? ' · có Kho hoạt động' : ''}</> },
    { key: 'st', label: 'Trạng thái', text: r => STATUS[r.status]?.[0] ?? r.status, cell: r => <Chip tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}{r.status === 'published' && r.version ? ` · v${r.version}` : ''}</Chip> },
    { key: 'upd', label: 'Cập nhật', cell: r => <small>{fmtDate((r.updated_at ?? r.created_on ?? '').slice(0, 10))}</small> },
    { key: 'act', label: 'Thao tác', fixed: true, cell: r => <details className="distmore"><summary aria-label="Thao tác">···</summary><div className="distmenu">
      <button type="button" onClick={() => setOpen(r.id)}>Mở bài giảng</button>
      {r.status === 'inactive' ? <button type="button" onClick={() => setStatus(r, r.version > 0 ? 'published' : 'draft')}>Dùng lại</button>
        : <button type="button" onClick={() => setStatus(r, 'inactive')}>Ngừng dùng</button>}
      <button type="button" className="danger" onClick={() => remove(r)}>Xoá</button></div></details> },
  ]
  return (
    <>
      <FilterChips value={fs} onPick={setFs} items={[['', 'Tất cả', base.length], ['draft', 'Nháp', n('draft')], ['published', 'Đã phát hành', n('published')], ['inactive', 'Ngừng dùng', n('inactive')]]} />
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      {err ? <p className="msg">{err}</p> : !rows ? <p className="sub">Đang tải…</p> :
        <DataTable id="training-lessons" className="tllist" rows={shown} rowKey={r => r.id} cols={lessonCols}
          empty={rows.length ? 'Không có bài giảng nào khớp bộ lọc.' : 'Chưa có bài giảng đào tạo nào. Bấm “+ Thêm bài giảng”.'}
          left={<>
            <input placeholder="Tìm tên bài giảng, môn, tác giả…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
            <select value={fp} onChange={e => setFp(e.target.value)} aria-label="Chương trình đào tạo"><option value="">Tất cả chương trình đào tạo</option>
              {progs.map(p => <option key={p.id} value={p.id}>{progLabel(p.id)}</option>)}</select>
            <MoreFilters active={ofl.active || card === 'ready'}>
              {ofl.node((rows ?? []).map(r => r.org_id))}
              <label className="chk"><input type="checkbox" checked={card === 'ready'} onChange={e => setCard(e.target.checked ? 'ready' : null)} /> Đã chốt đủ 4 thẻ ({base.filter(ready4).length})</label>
            </MoreFilters>
            <small className="sub">{shown.length}/{rows.length} bài giảng · {new Set(base.map(r => r.program_id).filter(Boolean)).size} chương trình</small></>}
          right={<button type="button" className="primary ttadd" disabled={!p0} title={p0 ? undefined : 'Chưa có chương trình đào tạo để gắn bài giảng'}
            onClick={() => { setMsg(''); setAdding(true) }}>+ Thêm bài giảng</button>} />}
      {adding && p0 && <CreateLesson orgId={orgId} store="training" unitOf={unitOf} programs={progs} subjectsOf={subjectsOf}
        program={progs.find(p => p.id === fp) ?? p0} subject={subjectsOf((progs.find(p => p.id === fp) ?? p0).id)[0] ?? ''} pickPlace
        kits={rows ?? []} onClose={() => setAdding(false)} onCreated={(id, m) => { setAdding(false); setMsg(m); reload(); setOpen(id) }} />}
    </>
  )
}
