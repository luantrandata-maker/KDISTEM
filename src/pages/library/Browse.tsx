import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { KindChip, ProgChip, ItemPreview, MAT_TYPE, PROGRAMS, fmtDate, type Item, type Copy } from './common'

type Props = { orgId: string | null; teacherId?: string | null; go?: (p: string) => void }
type K = 'all' | Item['kind']

// Thư viện STEM / Kho học liệu dùng chung: học liệu do Bộ, Tỉnh, Sở, Phòng, KDI Education và trường phát hành.
// Trường / giáo viên "Dùng" → tạo bản của mình để chỉnh sửa (không bị ghi đè khi kho cập nhật).
export function LibraryBrowse({ orgId, teacherId, go }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [copies, setCopies] = useState<Copy[]>([])
  const [me, setMe] = useState<{ id: string; type: string } | null>(null)
  const [uidMe, setUidMe] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [k, setK] = useState<K>('all')
  const [src, setSrc] = useState(''); const [prog, setProg] = useState(''); const [grade, setGrade] = useState(''); const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState<{ text: string; lesson?: boolean } | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    setUidMe(user?.id ?? null)
    const [i, c, o, a] = await Promise.all([
      supabase.from('library_items').select('*, owner_name, owner_type').order('published_at', { ascending: false, nullsFirst: false }),
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
  if (err) return <p className="msg">{err}</p>

  const isSchool = me?.type === 'school'
  // Bản sao của tôi (GV) hoặc của trường (quản trị) với từng mục
  const mineOf = (id: string) => copies.filter(c => c.item_id === id && (teacherId ? c.adopted_by === uidMe : true))
  const shown = items.filter(i => (k === 'all' || i.kind === k) && (!src || i.owner_name === src) && (!prog || i.program === prog)
    && (!grade || (i.grades ?? '').split(/[,\s–-]+/).includes(grade))
    && (!q || (i.title + ' ' + (i.summary ?? '') + ' ' + i.tags.join(' ')).toLowerCase().includes(q.toLowerCase())))

  async function adopt(i: Item, template: boolean) {
    setBusy(i.id); setMsg(''); setInfo(null)
    const { data, error } = await supabase.rpc('library_adopt', { p_item: i.id, p_template: template })
    setBusy(null)
    if (error) return setMsg(error.message)
    const d = data as { kind: string; count?: number }
    const where = template ? 'bài giảng mẫu của trường (mọi giáo viên thấy ở Soạn bài giảng)' : 'bản nháp của bạn trong Soạn bài giảng'
    setInfo({ text: d.kind === 'program' ? `Đã thêm chương trình “${i.title}”: ${d.count ?? 0} bài giảng thành ${where}.` : `Đã tạo ${where}: “${i.title}”. Bạn chỉnh sửa thoải mái — bản của kho không đổi.`, lesson: true })
    load()
  }

  return (
    <>
      <div className="bar">
        <Tabs items={[['all', 'Tất cả', items.length], ['program', 'Chương trình', items.filter(i => i.kind === 'program').length],
          ['lesson', 'Bài giảng', items.filter(i => i.kind === 'lesson').length], ['material', 'Học liệu', items.filter(i => i.kind === 'material').length]]} value={k} onChange={setK} />
        <input className="search" placeholder="Tìm theo tên, nội dung, từ khoá…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm học liệu" />
      </div>
      <div className="bar small">
        <select value={src} onChange={e => setSrc(e.target.value)} aria-label="Nguồn phát hành"><option value="">Mọi nguồn phát hành</option>{sources.map(s => <option key={s}>{s}</option>)}</select>
        <select value={prog} onChange={e => setProg(e.target.value)} aria-label="Chương trình"><option value="">Mọi chương trình</option>{PROGRAMS.map(p => <option key={p}>{p}</option>)}</select>
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
                {outdated && <span className="gpill warn" title={i.change_note ?? ''}><i aria-hidden="true">↻</i>Có bản mới v{i.version}</span>}
              </div>
              <h3>{i.title}</h3>
              <p className="sub libsrc">{i.owner_name}{i.owner_type === 'provider' ? ' · Đơn vị cung cấp' : ''} · v{i.version} · {fmtDate(i.published_at)}{i.grades ? ` · Khối ${i.grades}` : ''}{i.subject ? ` · ${i.subject}` : ''}</p>
              {i.summary && <p className="libsum">{i.summary}</p>}
              {outdated && i.change_note && <p className="sub">Cập nhật: {i.change_note}</p>}
              <div className="actions">
                <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} aria-expanded={open === i.id}>{open === i.id ? 'Thu gọn' : 'Xem trước'}</button>
                {isSchool && teacherId && <button type="button" className="primary" disabled={busy === i.id} onClick={() => adopt(i, false)}>
                  {i.kind === 'program' ? 'Dùng chương trình' : outdated ? 'Dùng bản mới' : mine.length ? 'Dùng thêm bản' : 'Dùng bài này'}</button>}
                {isSchool && isAdmin && <button type="button" className={teacherId ? '' : 'primary'} disabled={busy === i.id} onClick={() => adopt(i, true)}>Thêm làm bài mẫu của trường</button>}
                {i.kind === 'material' && i.content.url && <a className="linkbtn" href={i.content.url} target="_blank" rel="noreferrer">Mở học liệu ↗</a>}
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
