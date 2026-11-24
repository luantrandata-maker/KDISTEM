import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { openFile } from '../../lib/files'
import { useStemTracks, trackLabel } from '../../lib/stemTracks'
import { gradeName } from '../../lib/eduLevels'
import type { ProgramTopic } from '../../lib/programFrame'
import { PROGRAM_COLOR } from '../teacher/common'
import { Drawer } from '../../components/Drawer'
import { TOPIC_KINDS, TopicContents, Viewer, ExamView, Steps, type TopicItem } from '../topicContents'
import { useLibFrame } from './ByPackage'
import { DataTable, type Col } from '../../components/DataTable'

// Danh mục học liệu theo 6 nội dung của chủ đề: mỗi tab gom mục cùng loại của mọi chủ đề (trường: chủ đề thuộc gói đang dùng).
// Bấm "Xem ›" mở tệp / link / đề ngay trên trang; bấm tên chủ đề mở 6 nội dung. Tab Vật tư: mỗi dòng một vật tư của một chủ đề, cột Định mức; lọc theo chủ đề để xem định mức của chủ đề.

type Kind = typeof TOPIC_KINDS[number]['key']
type Row = TopicItem & { updated_at: string | null }
const PER: Record<string, string> = { product: 'sản phẩm', student: 'học sinh', group: 'nhóm', class: 'lớp' }
const chip = (code: string) => <span className="progchip" style={{ background: PROGRAM_COLOR[code], color: '#fff' }}>{trackLabel(code)}</span>
const ext = (n: string | null) => (n ?? '').split('.').pop()!.toLowerCase()
const form = (i: Row) => i.exam_id ? '📝 Đề' : i.file_path ? ({ docx: '📄 Word', doc: '📄 Word', pptx: '📊 PowerPoint', ppt: '📊 PowerPoint', pdf: '📕 PDF' } as Record<string, string>)[ext(i.file_name)] ?? '📎 Tệp'
  : i.url ? '🔗 Link' : i.content?.steps?.length ? '📋 Các hoạt động' : '—'
const fmtDate = (s: string | null) => s ? new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }) : ''

export function LibraryCatalog({ orgId }: { orgId: string | null }) {
  const { tracks } = useStemTracks()
  const { admin, modOf, usable, allowed, msg, loaded } = useLibFrame(orgId)
  const [items, setItems] = useState<Row[]>([])
  const [rk, setRk] = useState(0)
  const [kind, setKind] = useState<Kind>('plan')
  const [view, setView] = useState<Row | null>(null)
  const [topic, setTopic] = useState<ProgramTopic | null>(null)
  useEffect(() => { supabase.from('program_topic_items').select('*').order('seq').then(({ data }) => setItems((data ?? []) as Row[])) }, [rk])

  const topicOf = useMemo(() => new Map(usable.map(t => [t.id, t])), [usable])
  const mine = items.filter(i => topicOf.has(i.topic_id))
  const trOf = (t: ProgramTopic) => modOf.get(t.module_id)!.track_code
  const flat = (t: ProgramTopic) => tracks.find(x => x.code === trOf(t))?.use_modules === false
  const shown = mine.filter(i => i.kind === kind).sort((a, b) => {
    const ta = topicOf.get(a.topic_id)!, tb = topicOf.get(b.topic_id)!, ma = modOf.get(ta.module_id)!, mb = modOf.get(tb.module_id)!
    return tracks.findIndex(x => x.code === ma.track_code) - tracks.findIndex(x => x.code === mb.track_code) || ma.sort - mb.sort || ta.grade - tb.grade || ta.seq - tb.seq || a.seq - b.seq
  })

  const empty = <span className="sub">{!loaded ? 'Đang tải…' : allowed && !allowed.size ? 'Trường chưa được gán Gói STEM cho năm học hiện tại.' : 'Chưa có mục nào.'}</span>
  const topicLink = (t: ProgramTopic) => <button type="button" className="linkbtn" onClick={e => { e.stopPropagation(); setTopic(t) }}>{t.title}</button>
  const tp = (i: Row) => topicOf.get(i.topic_id)!
  const cols: Col<Row>[] = [
    { key: 'title', label: 'Tên', fixed: true, text: i => i.title, cell: i => <b>{i.title}</b> },
    { key: 'topic', label: 'Chủ đề', text: i => tp(i).title, cell: i => topicLink(tp(i)) },
    { key: 'track', label: 'Loại CT', text: i => trackLabel(trOf(tp(i))), cell: i => chip(trOf(tp(i))) },
    { key: 'mod', label: 'Học phần', text: i => flat(tp(i)) ? '' : modOf.get(tp(i).module_id)!.name, cell: i => flat(tp(i)) ? <span className="sub">—</span> : <small>{modOf.get(tp(i).module_id)!.name}</small> },
    { key: 'grade', label: 'Khối', text: i => gradeName(tp(i).grade), cell: i => gradeName(tp(i).grade) },
    { key: 'form', label: 'Dạng', text: i => form(i), cell: i => form(i) },
    { key: 'upd', label: 'Cập nhật', text: i => fmtDate(i.updated_at), cell: i => fmtDate(i.updated_at) },
    { key: 'view', label: 'Xem', fixed: true, cell: () => <span className="linkbtn">Xem ›</span> },
  ]
  // Vật tư: mỗi dòng là một vật tư của một chủ đề (như các tab khác); cột Định mức thay cho Dạng / Xem
  const norm = (i: Row) => `${i.qty ?? ''} ${i.unit ?? ''}`.trim() + (i.per ? ` / ${PER[i.per] ?? i.per}` : '')
  const mcols: Col<Row>[] = cols.filter(c => c.key !== 'form' && c.key !== 'view').map(c => c.key === 'title' ? { ...c, label: 'Vật tư' } : c)
  mcols.splice(mcols.findIndex(c => c.key === 'upd'), 0, { key: 'qty', label: 'Định mức', text: norm, cell: i => norm(i) || <span className="sub">—</span> })
  const cap = <span className="fwcap">{allowed ? <span className="sub">Theo gói trường đang dùng</span> : null}</span>
    return <>
    <div className="distpills" role="tablist" style={{ marginBottom: 10 }}>
      {TOPIC_KINDS.map(k => <button key={k.key} type="button" role="tab" aria-selected={kind === k.key} className={kind === k.key ? 'on' : ''} onClick={() => { setKind(k.key) }}>
        {k.label} <small className="sub">{mine.filter(i => i.kind === k.key).length}</small></button>)}
    </div>
    {msg && <p className="msg">{msg}</p>}
    {kind === 'material'
      ? <DataTable key="mat" id="lib-cat-material-v2" pro rows={shown} rowKey={i => i.id} cols={mcols} noun="mục" onRow={i => setTopic(tp(i))} className="slt" left={cap} empty={empty} />
      : <DataTable key={kind} id={'lib-cat-' + kind} pro rows={shown} rowKey={i => i.id} cols={cols} noun="mục" onRow={setView} className="slt" left={cap} empty={empty} />}
    {view && <Drawer onClose={() => setView(null)} title={view.title}>
      <p className="sub" style={{ marginTop: 0 }}>{topicOf.get(view.topic_id)?.title} · {TOPIC_KINDS.find(k => k.key === view.kind)?.label}</p>
      {view.detail && <p style={{ whiteSpace: 'pre-wrap' }}>{view.detail}</p>}
      {(view.file_path || view.url) && <p style={{ margin: '6px 0' }}>
        {view.file_path && <button type="button" onClick={() => openFile(view.file_path!)}>Tải về</button>}
        {view.url && <a href={view.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8 }}>Mở link ↗</a>}</p>}
      {view.content?.steps?.length ? <Steps steps={view.content.steps} /> : null}
      {view.exam_id ? <ExamView id={view.exam_id} /> : (view.file_path || view.url) ? <Viewer item={view} /> : null}
    </Drawer>}
    {topic && <Drawer onClose={() => { setTopic(null); setRk(k => k + 1) }} title={<>{modOf.get(topic.module_id) && chip(modOf.get(topic.module_id)!.track_code)} {topic.title}</>}>
      <TopicContents topic={topic} admin={admin} module={modOf.get(topic.module_id)} />
    </Drawer>}
  </>
}
