import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { openFile } from '../../lib/files'
import { useStemTracks, trackLabel } from '../../lib/stemTracks'
import { gradeName } from '../../lib/eduLevels'
import type { ProgramTopic } from '../../lib/programFrame'
import { PROGRAM_COLOR } from '../teacher/common'
import { Drawer } from '../../components/Drawer'
import { TOPIC_KINDS, TopicContents, Viewer, ExamView, Steps, type TopicItem } from '../topicContents'
import { useLibFrame } from './ByPackage'

// Danh mục học liệu theo 6 nội dung của chủ đề: mỗi tab gom mục cùng loại của mọi chủ đề (trường: chủ đề thuộc gói đang dùng).
// Bấm "Xem ›" mở tệp / link / đề ngay trên trang; bấm tên chủ đề mở 6 nội dung. Tab Vật tư gộp theo tên, đơn vị và cách tính.

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
  const [q, setQ] = useState('')
  const [track, setTrack] = useState('')
  const [grade, setGrade] = useState(0)
  const [view, setView] = useState<Row | null>(null)
  const [topic, setTopic] = useState<ProgramTopic | null>(null)
  const [mat, setMat] = useState<string | null>(null)   // vật tư đang mở danh sách chủ đề
  useEffect(() => { supabase.from('program_topic_items').select('*').order('seq').then(({ data }) => setItems((data ?? []) as Row[])) }, [rk])

  const topicOf = useMemo(() => new Map(usable.map(t => [t.id, t])), [usable])
  const mine = items.filter(i => topicOf.has(i.topic_id))
  const qq = q.trim().toLowerCase()
  const where = (t: ProgramTopic) => { const m = modOf.get(t.module_id)!; const tr = tracks.find(x => x.code === m.track_code)
    return <>{chip(m.track_code)} {tr?.use_modules === false ? '' : m.name + ' · '}{gradeName(t.grade)}</> }
  const shown = mine.filter(i => {
    const t = topicOf.get(i.topic_id)!, m = modOf.get(t.module_id)!
    if (i.kind !== kind || (track && m.track_code !== track) || (grade && t.grade !== grade)) return false
    return !qq || `${i.title} ${i.detail} ${t.title} ${m.name}`.toLowerCase().includes(qq)
  }).sort((a, b) => {
    const ta = topicOf.get(a.topic_id)!, tb = topicOf.get(b.topic_id)!, ma = modOf.get(ta.module_id)!, mb = modOf.get(tb.module_id)!
    return tracks.findIndex(x => x.code === ma.track_code) - tracks.findIndex(x => x.code === mb.track_code) || ma.sort - mb.sort || ta.grade - tb.grade || ta.seq - tb.seq || a.seq - b.seq
  })
  const trackOpts = tracks.filter(tr => usable.some(t => modOf.get(t.module_id)?.track_code === tr.code))
  const grades = [...new Set(usable.map(t => t.grade))].sort((a, b) => a - b)

  // Vật tư: gộp theo tên + đơn vị + cách tính
  const mats = useMemo(() => {
    const g = new Map<string, { name: string; unit: string; per: string; qty: number; rows: Row[] }>()
    for (const i of shown) {
      const k = [i.title.trim().toLowerCase(), i.unit ?? '', i.per ?? ''].join('|')
      const x = g.get(k) ?? { name: i.title.trim(), unit: i.unit ?? '', per: i.per ?? '', qty: 0, rows: [] }
      x.qty += Number(i.qty ?? 0); x.rows.push(i); g.set(k, x)
    }
    return [...g.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name, 'vi'))
  }, [shown])

  const empty = !loaded ? 'Đang tải…' : allowed && !allowed.size ? 'Trường chưa được gán Gói STEM cho năm học hiện tại.' : 'Chưa có mục nào.'
  const topicLink = (t: ProgramTopic) => <button type="button" className="linkbtn" onClick={e => { e.stopPropagation(); setTopic(t) }}>{t.title}</button>
  return <>
    <div className="distpills" role="tablist" style={{ marginBottom: 10 }}>
      {TOPIC_KINDS.map(k => <button key={k.key} type="button" role="tab" aria-selected={kind === k.key} className={kind === k.key ? 'on' : ''} onClick={() => { setKind(k.key); setMat(null) }}>
        {k.label} <small className="sub">{mine.filter(i => i.kind === k.key).length}</small></button>)}
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm tên, chủ đề…" style={{ minWidth: 240 }} />
      <select value={track} onChange={e => setTrack(e.target.value)}><option value="">Loại CT: Tất cả</option>{trackOpts.map(tr => <option key={tr.code} value={tr.code}>{trackLabel(tr.code)} · {tr.name}</option>)}</select>
      <select value={grade} onChange={e => setGrade(Number(e.target.value))}><option value={0}>Khối: Tất cả</option>{grades.map(g => <option key={g} value={g}>{gradeName(g)}</option>)}</select>
      <span className="sub" style={{ alignSelf: 'center' }}>{kind === 'material' ? `${mats.length} vật tư · ${shown.length} dòng` : `${shown.length} mục`}{allowed ? ' · theo gói trường đang dùng' : ''}</span>
    </div>
    {msg && <p className="msg">{msg}</p>}
    <div className="wrap" style={{ overflowX: 'auto' }}>
      {kind === 'material'
        ? <table className="slt ttdense" style={{ width: '100%' }}>
          <thead><tr><th>Vật tư</th><th>Đơn vị</th><th>Tổng số lượng</th><th>Dùng ở</th></tr></thead>
          <tbody>{mats.map(([k, x]) => <Fragment key={k}>
            <tr onClick={() => setMat(mat === k ? null : k)} style={{ cursor: 'pointer' }}>
              <td><b>{x.name}</b></td><td>{x.unit}</td><td>{x.qty || ''}{x.per ? ` / ${PER[x.per] ?? x.per}` : ''}</td>
              <td>{new Set(x.rows.map(r => r.topic_id)).size} chủ đề {mat === k ? '▾' : '▸'}</td></tr>
            {mat === k && x.rows.map(r => { const t = topicOf.get(r.topic_id)!
              return <tr key={k + r.id} style={{ background: 'var(--soft)' }}><td style={{ paddingLeft: 28 }}>{topicLink(t)}</td><td colSpan={2}><small>{where(t)}</small></td>
                <td>{r.qty ?? ''} {r.unit ?? ''}{r.per ? ` / ${PER[r.per] ?? r.per}` : ''}</td></tr> })}
          </Fragment>)}
            {!mats.length && <tr><td colSpan={4} className="sub">{empty}</td></tr>}</tbody></table>
        : <table className="slt ttdense" style={{ width: '100%' }}>
          <thead><tr><th>Tên</th><th>Chủ đề</th><th>Loại CT · Học phần · Khối</th><th>Dạng</th><th>Cập nhật</th><th /></tr></thead>
          <tbody>{shown.map(i => { const t = topicOf.get(i.topic_id)!
            return <tr key={i.id} onClick={() => setView(i)} style={{ cursor: 'pointer' }}>
              <td><b>{i.title}</b>{i.detail && <div className="sub" style={{ fontSize: 12 }}>{i.detail.slice(0, 120)}</div>}</td>
              <td>{topicLink(t)}</td><td><small>{where(t)}</small></td><td>{form(i)}</td><td>{fmtDate(i.updated_at)}</td>
              <td><span className="linkbtn">Xem ›</span></td></tr> })}
            {!shown.length && <tr><td colSpan={6} className="sub">{empty}</td></tr>}</tbody></table>}
    </div>
    {view && <Drawer onClose={() => setView(null)} title={view.title}>
      <p className="sub" style={{ marginTop: 0 }}>{topicOf.get(view.topic_id)?.title} · {TOPIC_KINDS.find(k => k.key === view.kind)?.label}</p>
      {view.detail && <p style={{ whiteSpace: 'pre-wrap' }}>{view.detail}</p>}
      {(view.file_path || view.url) && <p style={{ margin: '6px 0' }}>
        {view.file_path && <button type="button" onClick={() => openFile(view.file_path!)}>Tải về</button>}
        {view.url && <a href={view.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8 }}>Mở link ↗</a>}</p>}
      {view.exam_id ? <ExamView id={view.exam_id} /> : (view.file_path || view.url) ? <Viewer item={view} /> : null}
      {view.content?.steps?.length ? <Steps steps={view.content.steps} /> : null}
    </Drawer>}
    {topic && <Drawer onClose={() => { setTopic(null); setRk(k => k + 1) }} title={<>{modOf.get(topic.module_id) && chip(modOf.get(topic.module_id)!.track_code)} {topic.title}</>}>
      <p className="sub" style={{ marginTop: 0 }}>{modOf.get(topic.module_id)?.name} · {gradeName(topic.grade)} · {topic.periods} tiết</p>
      <TopicContents topic={topic} admin={admin} />
    </Drawer>}
  </>
}
