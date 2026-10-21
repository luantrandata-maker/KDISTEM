import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { openFile } from '../../lib/files'
import { KindChip, ProgChip, ItemPreview, MAT_TYPE, RightsChip, ProgLine, fmtDate, selectItems, type Item, type Copy } from './common'
import { useStemTracks } from '../../lib/stemTracks'

type Props = { orgId: string | null; teacherId?: string | null; go?: (p: string) => void }
type K = 'all' | Item['kind'] | 'plan'
const isPlan = (i: Item) => i.kind === 'material' && i.content.type === 'lesson_plan'
// Chương trình soạn ở "Chương trình giáo dục"; mục chương trình cũ trong kho không hiện ở đây
const ofK = (i: Item, k: K) => i.kind !== 'program' && (k === 'all' || (k === 'plan' ? isPlan(i) : k === 'material' ? i.kind === 'material' && !isPlan(i) : i.kind === k))

// Thư viện STEM / Kho học liệu dùng chung: học liệu do Bộ, Tỉnh, Sở, Phòng, KDI Education và trường phát hành.
// Trường / giáo viên "Dùng" → tạo bản của mình để chỉnh sửa (không bị ghi đè khi kho cập nhật).
export function LibraryBrowse({ orgId, teacherId, go }: Props) {
  const { allCodes: PROGRAMS } = useStemTracks()
  const [items, setItems] = useState<Item[]>([])
  const [copies, setCopies] = useState<Copy[]>([])
  const [me, setMe] = useState<{ id: string; type: string } | null>(null)
  const [uidMe, setUidMe] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [k, setK] = useState<K>('all')
  const [src, setSrc] = useState(''); const [prog, setProg] = useState(''); const [grade, setGrade] = useState(''); const [q, setQ] = useState('')
  const [eprog, setEprog] = useState(''); const [mtype, setMtype] = useState(''); const [subj, setSubj] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState<{ text: string; lesson?: boolean } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    setUidMe(user?.id ?? null)
    const [i, c, o, a] = await Promise.all([
      selectItems('published_at'),
      supabase.from('library_copies').select('item_id, adopted_version, lesson_plan_id, created_at, adopted_by').eq('org_id', orgId ?? ''),
      supabase.from('organizations').select('id, type').eq('id', orgId ?? '').maybeSingle(),
      supabase.rpc('is_admin'),
    ])
    if (i.error) return setErr(/schema cache|does not exist|owner_name/i.test(i.error.message) ? 'Hãy chạy migration 023_shared_library.sql trên Supabase.' : i.error.message)
    // Chỉ hiện mục đã phát hành (mục nháp của chính đơn vị xem ở màn Phát hành học liệu)
    setItems(((i.data as Item[]) ?? []).filter(x => x.status === 'published'))
    setCopies((c.data as Copy[]) ?? []); setMe(o.data as { id: string; type: string } | null); setIsAdmin(!!a.data)
  }
  useEffect(() => { load() }, [orgId])

  const sources = useMemo(() => [...new Set(items.map(i => i.owner_name ?? '—'))].sort((a, b) => a.localeCompare(b, 'vi')), [items])
  const eprogs = useMemo(() => {
    const m = new Map<string, string>()
    items.forEach(i => { if (i.program_id && i.edu_programs) m.set(i.program_id, `${i.edu_programs.title} (v${i.edu_programs.version_no})`) })
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  }, [items])
  const subjects = useMemo(() => [...new Set(items.map(i => i.subject).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi')), [items])
  if (err) return <p className="msg">{err}</p>

  const isSchool = me?.type === 'school'
  // Bản sao của tôi (GV) hoặc của trường (quản trị) với từng mục
  const mineOf = (id: string) => copies.filter(c => c.item_id === id && (teacherId ? c.adopted_by === uidMe : true))
  const shown = items.filter(i => ofK(i, k) && (!src || i.owner_name === src) && (!prog || i.program === prog)
    && (!eprog || i.program_id === eprog) && (!subj || i.subject === subj)
    && (!mtype || (i.kind === 'material' && (i.content.type ?? 'link') === mtype))
    && (!grade || (i.grades ?? '').split(/[,\s–-]+/).includes(grade))
    && (!q || (i.title + ' ' + (i.summary ?? '') + ' ' + i.tags.join(' ')).toLowerCase().includes(q.toLowerCase())))

  async function adopt(i: Item, template: boolean) {
    setBusy(i.id); setMsg(''); setInfo(null)
    const { data, error } = await supabase.rpc('library_adopt', { p_item: i.id, p_template: template })
    setBusy(null)
    if (error) return setMsg(error.message)
    const d = data as { kind: string; count?: number }
    const where = template ? 'bài giảng mẫu của trường (mọi giáo viên thấy ở Soạn bài giảng)' : 'bản nháp của bạn trong Soạn bài giảng'
    setInfo({ text: d.kind === 'program' || d.kind === 'unit' ? `Đã thêm ${d.kind === 'unit' ? 'bài học' : 'chương trình'} “${i.title}”: ${d.count ?? 0} bài giảng thành ${where}.` : `Đã tạo ${where}: “${i.title}”. Bạn chỉnh sửa thoải mái — bản của kho không đổi.`, lesson: true })
    load()
  }

  return (
    <>
      <div className="bar">
        <Tabs items={([['all', 'Tất cả'], ['unit', 'Bài học'], ['plan', 'Giáo án'], ['lesson', 'Bài giảng'], ['material', 'Học liệu']] as [K, string][])
          .map(([key, l]) => [key, l, items.filter(i => ofK(i, key)).length] as [K, string, number])} value={k} onChange={setK} />
        <input className="search" placeholder="Tìm theo tên, nội dung, từ khoá…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm học liệu" />
      </div>
      <div className="bar small">
        <select value={src} onChange={e => setSrc(e.target.value)} aria-label="Nguồn phát hành"><option value="">Mọi nguồn phát hành</option>{sources.map(s => <option key={s}>{s}</option>)}</select>
        <select value={prog} onChange={e => setProg(e.target.value)} aria-label="Chương trình"><option value="">Mọi loại chương trình</option>{PROGRAMS.map(p => <option key={p}>{p}</option>)}</select>
        {eprogs.length > 0 && <select value={eprog} onChange={e => setEprog(e.target.value)} aria-label="Chương trình giáo dục"><option value="">Mọi chương trình giáo dục</option>{eprogs.map(([id, t]) => <option key={id} value={id}>{t}</option>)}</select>}
        <select value={mtype} onChange={e => setMtype(e.target.value)} aria-label="Loại học liệu"><option value="">Mọi loại học liệu</option>{Object.entries(MAT_TYPE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select value={subj} onChange={e => setSubj(e.target.value)} aria-label="Môn"><option value="">Mọi môn</option>{subjects.map(x => <option key={x}>{x}</option>)}</select>
        <select value={grade} onChange={e => setGrade(e.target.value)} aria-label="Khối"><option value="">Mọi khối</option>{['6', '7', '8', '9', '10', '11', '12'].map(g => <option key={g} value={g}>Khối {g}</option>)}</select>
      </div>
      {!isSchool && me && <p className="sub">Đây là học liệu cấp trên và KDI Education phát hành tới đơn vị của bạn. Trường học mới “dùng” được học liệu vào bài giảng.</p>}
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info.text}</b> {info.lesson && go && <button type="button" className="linkbtn" onClick={() => go('Soạn bài giảng')}>Mở Soạn bài giảng →</button>}</p>}

      <div className="libgrid">
        {shown.map(i => {
          const mine = mineOf(i.id)
          const latest = mine.reduce((m, c) => Math.max(m, c.adopted_version), 0)
          const outdated = mine.length > 0 && latest < i.version
          return (
            <article className={'panel libcard' + (open === i.id ? ' open' : '')} key={i.id}>
              <div className="libhead">
                <KindChip kind={i.kind} /><ProgChip p={i.program} />
                {i.kind === 'material' && <small className="sub">{MAT_TYPE[i.content.type ?? 'link']}</small>}
                {mine.length > 0 && !outdated && <span className="gpill good"><i aria-hidden="true">✓</i>Đã dùng</span>}
                {i.usage_rights && i.usage_rights !== 'adapt' && <RightsChip r={i.usage_rights} />}
                {outdated && <span className="gpill warn" title={i.change_note ?? ''}><i aria-hidden="true">↻</i>Có bản mới v{i.version}</span>}
              </div>
              <h3>{i.title}</h3>
              <p className="sub libsrc">{i.owner_name}{i.owner_type === 'provider' ? ' · Đơn vị cung cấp' : ''} · v{i.version} · {fmtDate(i.published_at)}{i.grades ? ` · Khối ${i.grades}` : ''}{i.subject ? ` · ${i.subject}` : ''}</p>
              {i.edu_programs && <p style={{ margin: '2px 0' }}><ProgLine i={i} /></p>}
              {i.summary && <p className="libsum">{i.summary}</p>}
              {outdated && i.change_note && <p className="sub">Cập nhật: {i.change_note}</p>}
              <div className="actions">
                <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id}>{open === i.id ? 'Thu gọn' : 'Xem trước'}</button>
                {isSchool && teacherId && i.usage_rights !== 'view' && <button type="button" className="primary" disabled={busy === i.id} onClick={() => adopt(i, false)}>
                  {i.kind === 'program' ? 'Dùng chương trình' : i.kind === 'unit' ? 'Dùng bài học' : outdated ? 'Dùng bản mới' : mine.length ? 'Dùng thêm bản' : 'Dùng bài này'}</button>}
                {isSchool && isAdmin && i.usage_rights !== 'view' && <button type="button" className={teacherId ? '' : 'primary'} disabled={busy === i.id} onClick={() => adopt(i, true)}>Thêm làm bài mẫu của trường</button>}
                {i.kind === 'material' && i.content.path && <button type="button" className="linkbtn" onClick={() => openFile(i.content.path!)}>Mở tệp ↗</button>}
                {i.kind === 'material' && !i.content.path && i.content.url && <a className="linkbtn" href={i.content.url} target="_blank" rel="noreferrer">Mở học liệu ↗</a>}
              </div>
              {open === i.id && <ItemPreview item={i} all={items} />}
            </article>
          )
        })}
        {shown.length === 0 && <div className="panel"><p className="sub" style={{ margin: 0 }}>{items.length ? 'Không có học liệu phù hợp bộ lọc.' : 'Chưa có học liệu nào được phát hành tới đơn vị của bạn.'}</p></div>}
      </div>
    </>
  )
}
