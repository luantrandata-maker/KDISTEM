// Học liệu tập huấn (khuôn Học liệu của Phân hệ 2): gom học liệu của mọi chương trình tập huấn vào một chỗ.
// Tab Nội dung tập huấn: mỗi nội dung của chương trình, mở ra soạn 5 phần. Chương trình nháp / bị trả lại thì sửa thẳng;
// đã phát hành thì tạo phiên bản mới (hoặc mở bản nháp đang có) rồi sửa đúng nội dung / dòng đó trong bản nháp.
// Tab Link tài liệu, Định mức vật tư, Kho hoạt động: gộp các dòng tương ứng của nội dung chương trình và của bài giảng tập huấn (bộ 5 thẻ).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { openFile } from '../../lib/files'
import { Chip } from '../dist/Editor'
import { STATUS } from './Programs'
import { ContentDetail, LISTS, detailCount, lab, type Detail } from './Content'
import { DOC_TYPE, kitOf } from '../library/lesson/model'
import { TrainingItemForm } from './MaterialForm'
import { MaterialItem } from './MaterialItem'
import { LessonPage } from '../library/lesson/LessonPage'
import { useTrainingPrograms } from './Lessons'

type Prog = { id: string; code: string; title: string; status: keyof typeof STATUS; pass_score: number | null; family_id: string | null }
type Unit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; hours: number; has_test: boolean; detail: Detail | null }
type Lesson = { id: string; org_id: string; title: string; program_id: string | null; unit_id: string | null; status: string; content: { kit?: unknown } | null }
export type Part = 'content' | 'docs' | 'mats' | 'acts'
// Một dòng gộp: từ nội dung chương trình (unit) hoặc từ bài giảng (lesson)
type Line = { key: string; prog: Prog | null; unit: Unit | null; lesson: Lesson | null; idx: number | null; cells: Record<string, string>; url?: string; file?: string }

const EDITABLE = ['draft', 'rejected']
const LSTATUS: Record<string, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], inactive: ['Ngừng dùng', 'off'] }
const MKIND: Record<string, string> = { supply: 'Vật tư tiêu hao', tool: 'Dụng cụ', equipment: 'Thiết bị' }
const PER = Object.fromEntries(LISTS.mats.cols.find(c => c.key === 'per')!.options!)
const SHEET: Record<Exclude<Part, 'content'>, string> = { docs: 'Link-tai-lieu', mats: 'Dinh-muc-vat-tu', acts: 'Kho-hoat-dong' }

// Đọc hết cấu trúc mọi chương trình theo trang 1000 dòng (máy chủ chỉ trả tối đa 1000 dòng mỗi lần)
async function allUnits() {
  const out: Unit[] = []
  for (let i = 0; ; i += 1000) {
    const r = await supabase.from('training_program_units').select('id, program_id, parent_id, kind, seq, title, hours, has_test, detail').order('id').range(i, i + 999)
    if (r.error) return { data: out.length ? out : null, error: r.error }
    out.push(...((r.data as Unit[]) ?? []))
    if ((r.data?.length ?? 0) < 1000) return { data: out, error: null }
  }
}

function useData() {
  const [d, setD] = useState<{ progs: Prog[]; units: Unit[]; lessons: Lesson[] } | null>(null)
  const [err, setErr] = useState('')
  const [rk, setRk] = useState(0)
  useEffect(() => {
    (async () => {
      const [p, u, l] = await Promise.all([
        supabase.from('training_programs').select('id, code, title, status, pass_score, family_id').order('code'),
        allUnits(),
        supabase.from('training_lessons').select('id, org_id, title, program_id, unit_id, status, content').order('title'),
      ])
      const e = p.error ?? u.error
      if (e) setErr(/schema cache|does not exist/i.test(e.message) ? 'Hãy chạy các migration Đào tạo & đánh giá năng lực nhà giáo trên Supabase.' : e.message)
      setD({ progs: (p.data as Prog[]) ?? [], units: ((u.data as Unit[]) ?? []).map(x => ({ ...x, hours: Number(x.hours) || 0 })).sort((a, b) => a.seq - b.seq),
        lessons: (l.data as Lesson[]) ?? [] })
    })()
  }, [rk])
  return { d, err, reload: () => setRk(k => k + 1) }
}

export function TrainingMaterials({ part, orgId }: { part: Part; orgId?: string | null }) {
  const { d, err, reload } = useData()
  const [admin, setAdmin] = useState(false)
  const [prog, setProg] = useState('')
  const [src, setSrc] = useState<'' | 'unit' | 'lesson'>('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [adding, setAdding] = useState(false)
  const [item, setItem] = useState<Line | null>(null)
  // Sau khi tạo / mở bản nháp: mở lại đúng nội dung (idx null) hoặc dòng (idx) trong bản nháp đó
  const [go, setGo] = useState<{ prog: string; unit: string; idx: number | null } | null>(null)
  const [autoEdit, setAutoEdit] = useState(false)
  const [lesson, setLesson] = useState<string | null>(null)
  const tp = useTrainingPrograms()
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)) }, [])

  const progOf = (id: string | null) => d?.progs.find(p => p.id === id) ?? null
  const unitOf = (id: string | null) => d?.units.find(u => u.id === id) ?? null
  const crumb = (u: Unit) => [progOf(u.program_id)?.title, unitOf(u.parent_id)?.title].filter(Boolean).join(' › ')
  const contents = useMemo(() => {
    if (!d) return []
    const ord = (u: Unit) => [d.progs.findIndex(p => p.id === u.program_id), unitOf(u.parent_id)?.seq ?? 0, u.seq]
    return d.units.filter(u => u.kind === 'content').sort((a, b) => { const x = ord(a), y = ord(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })
  }, [d])

  // Dòng gộp cho 3 tab danh sách
  const lines = useMemo<Line[]>(() => {
    if (!d || part === 'content') return []
    const out: Line[] = []
    contents.forEach(u => (u.detail?.[part] ?? []).forEach((r, i) => {
      const cells = Object.fromEntries(LISTS[part].cols.map(c => [c.key, c.type === 'select' ? lab(c.options, r[c.key] ?? '') : r[c.key] ?? '']))
      if (part === 'mats') { cells.per = PER[r.per] ?? ''; cells.note = [MKIND[r.mkind], r.reusable === '1' && 'dùng lại được', r.note].filter(Boolean).join(' · ') }
      if (part === 'docs' && r.summary) cells.note = [r.summary, r.note].filter(Boolean).join(' · ')
      out.push({ key: `u${u.id}-${i}`, prog: progOf(u.program_id), unit: u, lesson: null, idx: i, cells, url: part === 'docs' ? r.url || undefined : undefined, file: part === 'docs' ? r.file || undefined : undefined })
    }))
    d.lessons.forEach(l => {
      if (!l.content?.kit) return
      const k = kitOf(l.content.kit), base = { prog: progOf(l.program_id), unit: unitOf(l.unit_id), lesson: l, idx: null }
      if (part === 'docs') k.docs.forEach(x => out.push({ ...base, key: `l${l.id}-${x.key}`, cells: { title: x.title, kind: DOC_TYPE[x.type] ?? x.type, note: x.meta ?? '' }, url: x.url || undefined, file: x.file?.path }))
      if (part === 'mats') ([['product', 'Mỗi sản phẩm'], ['group', 'Mỗi nhóm']] as const).forEach(([g, per]) => k.mats[g].forEach(x =>
        out.push({ ...base, key: `l${l.id}-${x.key}`, cells: { name: x.name, unit: x.unit, qty: x.qty, per, note: [MKIND[x.kind], x.reusable && 'dùng lại được'].filter(Boolean).join(' · ') } })))
      if (part === 'acts') k.bank.forEach(x => out.push({ ...base, key: `l${l.id}-${x.key}`, cells: { title: x.title, kind: x.kind, minutes: '', note: [x.act, x.note].filter(Boolean).join(' · ') } }))
    })
    return out
  }, [d, part, contents])

  // Nội dung tương ứng trong bản nháp: cùng thứ tự môn và thứ tự nội dung (bản sao giữ nguyên cấu trúc), không khớp thì theo tên
  const twin = (uid: string, prog: string) => {
    if (!d) return null
    const u = unitOf(uid), s = u && unitOf(u.parent_id)
    if (!u) return null
    const subs = d.units.filter(x => x.program_id === prog && x.kind === 'subject')
    const s2 = s && (subs.find(x => x.seq === s.seq && x.title === s.title) ?? subs.find(x => x.title === s.title) ?? subs.find(x => x.seq === s.seq))
    const cs = d.units.filter(x => x.program_id === prog && x.kind === 'content' && (!s2 || x.parent_id === s2.id))
    return cs.find(x => x.seq === u.seq && x.title === u.title) ?? cs.find(x => x.title === u.title) ?? cs.find(x => x.seq === u.seq) ?? null
  }
  useEffect(() => {
    if (!go || !d || !d.progs.some(p => p.id === go.prog)) return
    const t = twin(go.unit, go.prog)
    setGo(null); setProg(go.prog)
    if (!t) { setMsg(['Đã mở bản nháp nhưng không tìm thấy nội dung tương ứng. Chọn lại trong danh sách.', true]); return }
    if (go.idx == null) { setOpen(t.id); return }
    const ln = lines.find(x => x.key === `u${t.id}-${go.idx}`)
    if (ln) { setAutoEdit(true); setItem(ln) } else setOpen(t.id)
  }, [go, d, lines])
  const toDraft = (m: string, draft: string, unit: string, idx: number | null) => { setMsg([m, false]); setGo({ prog: draft, unit, idx }); reload() }

  if (!d) return <p className="sub">Đang tải…</p>
  if (lesson) return <LessonPage key={lesson} orgId={d.lessons.find(l => l.id === lesson)?.org_id ?? orgId ?? ''} id={lesson} store="training" unitOf={tp.unitOf} programs={tp.progs} subjectsOf={tp.subjectsOf} code=""
    backLabel={`← ${LISTS[part === 'content' ? 'docs' : part].tab}`} startEdit onBack={() => { setLesson(null); reload() }} onChanged={reload} />
  const oc = open ? unitOf(open) : null
  if (oc) { const p = progOf(oc.program_id)
    const draft = p?.family_id && p.status === 'published' ? d.progs.find(x => x.family_id === p.family_id && EDITABLE.includes(x.status)) ?? null : null
    const canVersion = admin && p?.status === 'published'
    async function newVersion() {
      if (!p || !confirm('Chương trình đã phát hành nên không sửa trực tiếp được. Tạo phiên bản mới (bản nháp chép từ phiên bản này) để sửa? Phiên bản đang phát hành vẫn dùng đến khi bản mới được phát hành.')) return
      const { data, error } = await supabase.rpc('training_program_new_version', { p_program: p.id })
      if (error) return setMsg([error.message, true])
      toDraft(`Đã tạo phiên bản nháp mới của ${p.code}. Sửa nội dung này rồi gửi duyệt và phát hành lại chương trình.`, data as string, oc!.id, null)
    }
    return <ContentDetail key={oc.id} title={oc.title} crumb={crumb(oc)} hours={oc.hours} detail={oc.detail ?? {}} editable={admin && !!p && EDITABLE.includes(p.status)}
      notice={!admin ? 'Bạn chỉ có quyền xem nội dung này.' : canVersion ? (draft ? `Chương trình đã phát hành nên chỉ xem. Đang có bản nháp ${draft.code}: mở bản nháp để sửa nội dung này.`
        : 'Chương trình đã phát hành nên chỉ xem. Tạo phiên bản mới để sửa; bản đang phát hành vẫn dùng đến khi bản mới được phát hành.')
        : p ? `Chương trình đang ở trạng thái "${STATUS[p.status]?.[0] ?? p.status}", chưa sửa được.` : undefined}
      extra={canVersion && (draft ? <button type="button" className="primary" onClick={() => toDraft('Đang sửa trong phiên bản nháp của chương trình.', draft.id, oc.id, null)}>Mở bản nháp để sửa</button>
        : <button type="button" className="primary" onClick={newVersion}>Tạo phiên bản mới để sửa</button>)}
      hasTest={oc.has_test} passScore={p?.pass_score} onBack={() => setOpen(null)}
      onSave={async dd => { const { error } = await supabase.from('training_program_units').update({ detail: dd }).eq('id', oc.id)
        if (error) { setMsg([error.message, true]); return false } setMsg(['Đã lưu nội dung tập huấn.', false]); reload(); return true }} /> }

  const ql = q.trim().toLowerCase()
  const progs = d.progs.filter(p => contents.some(u => u.program_id === p.id) || d.lessons.some(l => l.program_id === p.id))
  const shownC = contents.filter(u => (!prog || u.program_id === prog) && (!ql || `${u.title} ${crumb(u)}`.toLowerCase().includes(ql)))
  const shownL = lines.filter(x => (!prog || x.prog?.id === prog) && (!src || (src === 'unit' ? !x.lesson : !!x.lesson))
    && (!ql || `${Object.values(x.cells).join(' ')} ${x.unit?.title ?? ''} ${x.lesson?.title ?? ''} ${x.prog?.title ?? ''}`.toLowerCase().includes(ql)))
  const cols = part === 'content' ? [] : LISTS[part].cols.filter(c => c.key !== 'url')
  const where = (x: Line) => x.lesson ? <>Bài giảng: {x.lesson.title}</> : <>Nội dung: {x.unit?.title}</>
  const lessonsOf = (u: Unit) => d.lessons.filter(l => l.unit_id === u.id)

  function exportXlsx() {
    if (part === 'content') return downloadXlsx('Noi-dung-tap-huan.xlsx',
      [{ key: 'p', label: 'Chương trình', width: 30 }, { key: 's', label: 'Học phần', width: 26 }, { key: 'c', label: 'Nội dung tập huấn', width: 34 }, { key: 'h', label: 'Số giờ', width: 8 },
       { key: 'm', label: 'Học liệu', width: 40 }, { key: 'l', label: 'Bài giảng', width: 30 }],
      shownC.map(u => [progOf(u.program_id)?.title, unitOf(u.parent_id)?.title, u.title, u.hours, detailCount(u.detail), lessonsOf(u).map(l => l.title).join('; ')]), 'Nội dung tập huấn')
    downloadXlsx(`${SHEET[part]}-tap-huan.xlsx`,
      [...cols.map(c => ({ key: c.key, label: c.label, width: c.width ? Math.round(c.width / 7) : 30 })), ...(part === 'docs' ? [{ key: 'url', label: 'Link', width: 40 }] : []),
       { key: 'src', label: 'Thuộc', width: 34 }, { key: 'p', label: 'Chương trình', width: 30 }],
      shownL.map(x => [...cols.map(c => x.cells[c.key]), ...(part === 'docs' ? [x.url ?? ''] : []), x.lesson ? `Bài giảng: ${x.lesson.title}` : `Nội dung: ${x.unit?.title ?? ''}`, x.prog?.title]), LISTS[part].tab)
  }

  const nU = lines.filter(x => !x.lesson).length
  return <>
    <div className="diststatcards">
      {part === 'content' ? <>
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{contents.length}</b><small>Nội dung tập huấn</small><small>{progs.length} chương trình</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">▤</i><span><b>{contents.filter(u => detailCount(u.detail)).length}</b><small>Nội dung đã có học liệu</small><small>{contents.filter(u => !detailCount(u.detail)).length} chưa có</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">✎</i><span><b>{d.lessons.length}</b><small>Bài giảng tập huấn</small><small>{d.lessons.filter(l => l.status === 'published').length} đã phát hành</small></span></div>
      </> : <>
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{lines.length}</b><small>{LISTS[part].tab}</small><small>{progs.length} chương trình</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">▤</i><span><b>{nU}</b><small>Từ nội dung chương trình</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">✎</i><span><b>{lines.length - nU}</b><small>Từ bài giảng tập huấn</small></span></div>
      </>}
    </div>
    <div className="bar">
      <div className="tools">
        <input placeholder={part === 'content' ? 'Tìm nội dung, chương trình…' : 'Tìm tên, ghi chú, nội dung, bài giảng…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        <select value={prog} onChange={e => setProg(e.target.value)} aria-label="Chương trình tập huấn"><option value="">Mọi chương trình</option>
          {progs.map(p => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select>
        {part !== 'content' && <select value={src} onChange={e => setSrc(e.target.value as typeof src)} aria-label="Nguồn"><option value="">Nội dung CT và bài giảng</option>
          <option value="unit">Chỉ nội dung chương trình</option><option value="lesson">Chỉ bài giảng</option></select>}
        <small className="sub">{part === 'content' ? `${shownC.length}/${contents.length}` : `${shownL.length}/${lines.length}`} dòng</small>
      </div>
      <div className="tools"><button type="button" onClick={exportXlsx}>Xuất Excel</button>
        {admin && <button type="button" className="primary" onClick={() => { setMsg(null); setAdding(true) }}>+ Thêm {part === 'content' ? 'nội dung' : part === 'docs' ? 'tài liệu' : part === 'mats' ? 'vật tư' : 'hoạt động'}</button>}</div>
    </div>
    {adding && <TrainingItemForm orgId={orgId ?? null} part={part} progs={d.progs.filter(p => EDITABLE.includes(p.status))} units={d.units} initialProg={prog}
      onClose={() => setAdding(false)} onDone={(m, more) => { if (!more) setAdding(false); setMsg([m, false]); reload() }} />}
    {item && part !== 'content' && <MaterialItem key={item.key} it={{ ...item, part }} admin={admin} autoEdit={autoEdit} onClose={() => { setItem(null); setAutoEdit(false) }}
      draftId={item.prog?.family_id ? d.progs.find(p => p.family_id === item.prog!.family_id && EDITABLE.includes(p.status))?.id ?? null : null}
      onOpenLesson={id => { setItem(null); setLesson(id) }}
      onDone={(m, draft) => { const it = item; setItem(null); setAutoEdit(false)
        if (draft && it.unit) toDraft(m, draft, it.unit.id, it.idx); else { setMsg([m, false]); reload() } }} />}
    {(msg || err) && <p className={msg?.[1] || err ? 'msg' : 'sub'} role="status"><b>{err || msg?.[0]}</b></p>}
    {part === 'content' ? <div className="wrap"><table className="libtable">
      <thead><tr><th>Nội dung tập huấn</th><th>Số giờ</th><th>Học liệu</th><th>Bài giảng</th><th>Chương trình</th></tr></thead>
      <tbody>{shownC.map(u => { const p = progOf(u.program_id), ls = lessonsOf(u), dc = detailCount(u.detail)
        return <tr key={u.id}>
          <td style={{ whiteSpace: 'normal' }}><button type="button" className="namelink" onClick={() => { setMsg(null); setOpen(u.id) }}>{u.title}</button><br /><small className="sub">{crumb(u)}</small></td>
          <td>{String(u.hours).replace('.', ',')}</td>
          <td style={{ whiteSpace: 'normal' }}>{dc ? <small>{dc}</small> : <small className="warnline">Chưa có học liệu</small>}{u.has_test && !dc.includes('kiểm tra') ? <><br /><small className="sub">Có bài test</small></> : null}</td>
          <td style={{ whiteSpace: 'normal' }}>{ls.length ? ls.map(l => <div key={l.id}><small>{l.title} <Chip tone={LSTATUS[l.status]?.[1]}>{LSTATUS[l.status]?.[0] ?? l.status}</Chip></small></div>) : <small className="sub">—</small>}</td>
          <td>{p ? <><small>{p.code}</small><br /><Chip tone={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0]}</Chip></> : '—'}</td>
        </tr> })}
        {!shownC.length && <tr><td colSpan={5}><small className="sub">{contents.length ? 'Không có nội dung nào khớp bộ lọc.' : 'Chưa có nội dung tập huấn. Tạo chương trình và nội dung ở mục Chương trình tập huấn.'}</small></td></tr>}</tbody>
    </table></div>
      : <div className="wrap"><table className="libtable">
        <thead><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}{part === 'docs' && <th>Link</th>}<th>Thuộc</th><th>Chương trình</th></tr></thead>
        <tbody>{shownL.map(x => <tr key={x.key} className="clickrow" onClick={e => { if (!(e.target as HTMLElement).closest('a,button')) { setMsg(null); setItem(x) } }}>
          {cols.map((c, i) => <td key={c.key} style={{ whiteSpace: 'normal' }}>{i === 0 ? <button type="button" className="namelink" onClick={() => { setMsg(null); setItem(x) }}>{x.cells[c.key] || '—'}</button> : x.cells[c.key] || '—'}</td>)}
          {part === 'docs' && <td>{x.file ? <button type="button" className="linkbtn" onClick={() => openFile(x.file!)}>Mở tệp</button>
            : x.url ? <a href={x.url} target="_blank" rel="noreferrer">Mở link ↗</a> : <small className="sub">—</small>}</td>}
          <td style={{ whiteSpace: 'normal' }}>{x.unit && !x.lesson ? <button type="button" className="namelink" onClick={() => { setMsg(null); setOpen(x.unit!.id) }}>{where(x)}</button> : <small>{where(x)}</small>}</td>
          <td style={{ whiteSpace: 'normal' }}><small>{x.prog ? `${x.prog.code} · ${x.prog.title}` : '—'}</small></td>
        </tr>)}
          {!shownL.length && <tr><td colSpan={cols.length + (part === 'docs' ? 3 : 2)}><small className="sub">{lines.length ? 'Không có dòng nào khớp bộ lọc.'
            : `Chưa có ${LISTS[part].tab.toLowerCase()}. Thêm ở tab Nội dung tập huấn (mở một nội dung) hoặc trong bài giảng tập huấn.`}</small></td></tr>}</tbody>
      </table></div>}
  </>
}

