// Trang chi tiết bài giảng KDI (kho học liệu): xem slide ngay dưới tiêu đề, dải slide, hoạt động từ Kho đánh dấu tím;
// cột phải: Thông tin chung (thu gọn được như trang Chương trình), Phát hành & quyền dùng, Lịch sử phiên bản.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { openFile, fmtSize } from '../../lib/files'
import { Icon } from '../../components/Icon'
import { RowMenu, type RowAction } from '../../components/ProTools'
import { SlideView, SlideShow } from '../teacher/Lessons'
import { LessonOutline, LessonPlayer, LessonShow, asLesson, lessonStats, allBlocks } from '../../lib/lessonBlocks'
import { RightsChip, SCOPE, StatusChip, fmtDate, type Item, type Version } from './common'

type Stat = { item_id: string; schools: number; copies: number; outdated: number }
const SIDE_KEY = 'lsd-side'

async function loadItem(id: string): Promise<{ item: Item | null; error?: string }> {
  let r = await supabase.from('library_items').select('*, owner_name, owner_type, edu_programs(title, version_no), edu_program_units(title)').eq('id', id).maybeSingle()
  if (r.error && /relationship|schema cache|column/i.test(r.error.message)) r = await supabase.from('library_items').select('*, owner_name, owner_type').eq('id', id).maybeSingle()
  return r.error ? { item: null, error: r.error.message } : { item: r.data as unknown as Item | null }
}

export function LessonDetail({ id, orgId, onBack, onEdit }: { id: string; orgId: string | null; onBack: () => void; onEdit: (id: string) => void }) {
  const [item, setItem] = useState<Item | null>(null)
  const [err, setErr] = useState('')
  const [targets, setTargets] = useState<string[]>([])
  const [stat, setStat] = useState<Stat | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [i, setI] = useState(0)
  const [play, setPlay] = useState<'show' | 'player' | null>(null)
  const [busy, setBusy] = useState(false)
  const [side, setSide] = useState(() => { try { const v = localStorage.getItem(SIDE_KEY); if (v) return v === '1' } catch { /* bỏ qua */ } return true })
  const toggleSide = () => setSide(v => { try { localStorage.setItem(SIDE_KEY, v ? '0' : '1') } catch { /* bỏ qua */ } return !v })

  useEffect(() => {
    let live = true
    setItem(null); setErr(''); setI(0)
    loadItem(id).then(({ item, error }) => { if (!live) return; if (!item) setErr(error ?? 'Không tìm thấy bài giảng (có thể đã xoá hoặc chưa phát hành cho đơn vị).'); else setItem(item) })
    supabase.from('library_targets').select('org_id').eq('item_id', id).then(async ({ data }) => {
      const ids = ((data as { org_id: string }[]) ?? []).map(x => x.org_id)
      if (!ids.length) return
      const o = await supabase.from('organizations').select('id, name').in('id', ids)
      if (live) setTargets(((o.data as { id: string; name: string }[]) ?? []).map(x => x.name))
    })
    supabase.rpc('library_stats').then(({ data }) => { if (live) setStat(((data as Stat[]) ?? []).find(x => x.item_id === id) ?? null) })
    supabase.from('library_item_versions').select('id, item_id, version, title, change_note, published_at').eq('item_id', id).order('version', { ascending: false })
      .then(({ data }) => { if (live) setVersions((data as Version[]) ?? []) })
    return () => { live = false }
  }, [id])

  const slides = item?.content.slides ?? []
  const il = item?.content.mode === 'interactive' ? asLesson(item.content.lesson) : null
  const st = il ? lessonStats(il) : null
  const acts = slides.map((s, k) => s.kind === 'activity' ? k : -1).filter(k => k >= 0)
  const nActs = il ? allBlocks(il).filter(b => b.ref || b.type === 'activity').length : acts.length
  const go = (k: number) => setI(Math.max(0, Math.min(slides.length - 1, k)))
  useEffect(() => {
    if (!slides.length || play) return
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return
      if (e.key === 'ArrowRight') go(i + 1); else if (e.key === 'ArrowLeft') go(i - 1)
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [i, slides.length, play])

  // Nhân bản: tạo bài giảng nháp mới cùng nội dung rồi mở trình soạn
  async function dup() {
    if (!item || !orgId) return
    setBusy(true)
    const { data, error } = await supabase.from('library_items').insert({
      owner_org_id: orgId, kind: 'lesson', title: `Bản sao: ${item.title}`.slice(0, 300), summary: item.summary, subject: item.subject, grades: item.grades,
      program: item.program, program_id: item.program_id ?? null, unit_id: item.unit_id ?? null, tags: item.tags ?? [], content: item.content,
      scope: item.scope, usage_rights: item.usage_rights ?? 'use',
    }).select('id').single()
    setBusy(false)
    if (error || !data) return setErr('Không nhân bản được: ' + (error?.message ?? ''))
    onEdit((data as { id: string }).id)
  }

  if (!item) return <>
    <div className="bar"><span className="tools"><button type="button" onClick={onBack}>← Danh sách</button></span></div>
    {err ? <p className="err" role="alert">{err}</p> : <p className="sub">Đang mở bài giảng…</p>}
  </>

  const c = item.content
  const file = c.path || c.url
  const canShow = il ? !!st?.blocks : slides.length > 0
  const menu: RowAction[] = [
    ...(il && st?.blocks ? [{ label: 'Xem như học sinh', onClick: () => setPlay('player') }] : []),
    ...(c.path ? [{ label: 'Mở tệp đính kèm', onClick: () => openFile(c.path!) }] : c.url ? [{ label: 'Mở đường dẫn đính kèm', onClick: () => window.open(c.url, '_blank', 'noopener') }] : []),
    { label: 'Sao chép mã bài giảng', onClick: () => navigator.clipboard?.writeText(item.id) },
  ]
  const prog = item.edu_programs ? `${item.edu_programs.title} (v${item.edu_programs.version_no})` : item.program
  const pending = !!item.pending && item.status === 'published'

  return <div className="lsd">
    <div className="bar lsdhead">
      <span className="tools"><button type="button" onClick={onBack}>← Danh sách</button>
        <b className="lsdtitle">{item.title}</b>
        <StatusChip s={item.status} />{item.status === 'published' && <span className="gpill">v{item.version}</span>}
        {pending && <span className="gpill warn">Có bản sửa chưa phát hành</span>}</span>
      <span className="tools">
        <button type="button" onClick={() => onEdit(item.id)}>✏️ Sửa</button>
        {orgId && <button type="button" disabled={busy} onClick={dup}>{busy ? 'Đang nhân bản…' : '⧉ Nhân bản'}</button>}
        <button type="button" onClick={() => onEdit(item.id)} title="Mở trình soạn để chọn nơi nhận và phát hành">⤴ Phát hành…</button>
        <button type="button" className="primary" disabled={!canShow} onClick={() => setPlay('show')}>▶ Trình chiếu</button>
        <RowMenu items={menu} label={item.title} />
      </span>
    </div>
    {err && <p className="err" role="alert">{err}</p>}

    <div className={'pdgrid lsdgrid' + (side ? '' : ' pdnoside')}>
      <div className="pdmain">
        {!side && <div className="pdtoprow"><button type="button" className="pdsidetg" onClick={toggleSide} title="Mở cột thông tin bài giảng">‹ Thông tin</button></div>}
        {il ? <div className="panel">
          <p style={{ marginTop: 0 }}><b>Bài giảng tương tác</b> · {st!.blocks} khối nội dung · {st!.interactive} khối tương tác · khoảng {st!.minutes} phút
            {nActs > 0 && <> · <span className="lsdact">🧪 {nActs} hoạt động</span></>}</p>
          <LessonOutline lesson={il} ct={item.program} />
        </div>
        : slides.length > 0 ? <>
          <div className="lsdstage"><SlideView slide={slides[i]} reveal n={i + 1} total={slides.length} /></div>
          <div className="lsdnav">
            <button type="button" disabled={i === 0} onClick={() => go(i - 1)}>‹ Trước</button>
            <small className="sub">Slide {i + 1} / {slides.length} · bấm slide hoặc ← → để chuyển</small>
            {acts.length > 0 && <button type="button" className="lsdact" title="Đến slide hoạt động tiếp theo"
              onClick={() => go(acts.find(k => k > i) ?? acts[0])}>🧪 {acts.length} hoạt động</button>}
            <button type="button" style={{ marginLeft: 'auto' }} disabled={i >= slides.length - 1} onClick={() => go(i + 1)}>Sau ›</button>
          </div>
          <ol className="lsdstrip">{slides.map((s, k) => <li key={s.id}>
            <button type="button" className={(k === i ? 'on' : '') + (s.kind === 'activity' ? ' act' : '')} onClick={() => go(k)} aria-label={`Slide ${k + 1}: ${s.title || 'Chưa có tiêu đề'}`} aria-current={k === i}>
              <div className="slmini" aria-hidden><SlideView slide={s} n={k + 1} total={slides.length} thumb /></div>
              <small>{k + 1}{s.kind === 'activity' ? ' · 🧪' : ''}</small></button></li>)}</ol>
        </>
        : <div className="panel"><p className="sub" style={{ margin: 0 }}>Bài giảng chưa có slide.{file ? ' Nội dung nằm trong tệp đính kèm (xem ở cột bên phải).' : ' Bấm “✏️ Sửa” để soạn.'}</p></div>}
      </div>

      {side && <div className="pdside">
        <div className="panel pdcard"><h4 className="pdcardh">Thông tin chung<button type="button" className="pdsidetg incard" onClick={toggleSide} title="Thu cột thông tin để slide rộng hơn">Thu gọn ›</button></h4>
          <dl className="pddl sm">
            <dt>Môn · khối</dt><dd>{[item.subject, item.grades && 'Khối ' + item.grades].filter(Boolean).join(' · ') || '—'}</dd>
            <dt>Chương trình</dt><dd>{prog ? <>{prog}{item.edu_program_units?.title ? <> › <b>{item.edu_program_units.title}</b></> : null}</> : '—'}</dd>
            <dt>Thời lượng</dt><dd>{il ? `khoảng ${st!.minutes} phút · ${st!.blocks} khối` : `${slides.length} slide`}{nActs > 0 ? ` · ${nActs} hoạt động` : ''}</dd>
            <dt>Người soạn</dt><dd>{item.owner_name ?? 'KDI'}</dd>
            <dt>Cập nhật</dt><dd>{new Date(item.updated_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</dd>
            {item.summary && <><dt>Mô tả</dt><dd>{item.summary}</dd></>}
            {(item.tags ?? []).length > 0 && <><dt>Từ khoá</dt><dd className="pvchips">{item.tags.map(t => <span key={t} className="pill">{t}</span>)}</dd></>}
          </dl>
        </div>
        <div className="panel pdcard"><h4>Phát hành & quyền dùng</h4>
          <dl className="pddl sm">
            <dt>Phạm vi</dt><dd>{SCOPE[item.scope] ?? item.scope}</dd>
            {item.scope === 'selected' && <><dt>Nơi nhận</dt><dd className="pvchips">{targets.length ? targets.map(t => <span key={t} className="pill">{t}</span>) : '—'}</dd></>}
            <dt>Đang dùng</dt><dd>{stat ? `${stat.schools} đơn vị · ${stat.copies} bản sao${stat.outdated ? ` · ${stat.outdated} bản cũ` : ''}` : item.status === 'published' ? 'Chưa đơn vị nào dùng' : 'Chưa phát hành'}</dd>
            <dt>Quyền</dt><dd>{item.usage_rights ? <RightsChip r={item.usage_rights} /> : '—'}{item.usage_note ? <small className="sub"> {item.usage_note}</small> : null}</dd>
            {file && <><dt>Tệp kèm</dt><dd>{c.path
              ? <button type="button" className="linkbtn" onClick={() => openFile(c.path!)}><Icon n="file" /> {c.file_name ?? 'Mở tệp'}{c.size ? ` · ${fmtSize(c.size)}` : ''}</button>
              : <a href={c.url} target="_blank" rel="noreferrer">{c.url}</a>}</dd></>}
          </dl>
        </div>
        <div className="panel pdcard"><h4>Lịch sử phiên bản</h4>
          <ul className="lsdver">
            {(pending || item.status === 'draft') && <li><span><b>{pending ? 'Bản sửa' : 'Bản nháp'}</b> · chưa phát hành</span><small>{fmtDate(item.pending?.saved_at ?? item.updated_at)}</small></li>}
            {versions.map(v => <li key={v.id}><span>v{v.version}{v.version === item.version && item.status === 'published' ? ' · đang phát hành' : ''}{v.change_note ? <small className="sub"> · {v.change_note}</small> : null}</span>
              <small>{fmtDate(v.published_at)}</small></li>)}
            {!versions.length && item.status !== 'draft' && !pending && <li className="sub">Chưa có phiên bản.</li>}
          </ul>
        </div>
      </div>}
    </div>

    {play === 'show' && !il && <SlideShow slides={slides} start={i} title={item.title} onClose={() => setPlay(null)} />}
    {play === 'show' && il && <LessonShow title={item.title} ct={item.program} lesson={il} onClose={() => setPlay(null)} />}
    {play === 'player' && il && <LessonPlayer title={item.title} ct={item.program} lesson={il} onClose={() => setPlay(null)} />}
  </div>
}
