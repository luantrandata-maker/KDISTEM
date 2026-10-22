import { Icon } from '../components/Icon'
// Bài giảng tương tác theo khối (migration 063): tiến trình theo CT1–CT5, mỗi giai đoạn gồm các khối nội dung
// (tiêu đề, đoạn văn, hình, video, tệp, mô phỏng 2D, giáo cụ ảo, kéo–thả, câu hỏi, đoạn code, hoạt động nhóm, game, rubric).
// Dùng chung cho: Soạn bài giảng (lesson_plans.lesson), Kho bài giảng, Thư viện STEM (nội dung buổi học edu_program_units.lesson),
// Xem trước như học sinh và Trình chiếu.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { SIMS, SIM_MODELS, SIM_DEFAULTS, SimView, type SimModel } from './sims'
import { RaceGame, WheelGame, TeamsGame, TimerGame } from './games'
import { ActivityPlayer, ContentEditor, ACT, toPlayable, emptyAnswers, type ActKind } from '../pages/teacher/activity'

export type BlockType = 'heading' | 'text' | 'image' | 'video' | 'file' | 'link' | 'sim' | 'tool' | 'order' | 'quiz' | 'code' | 'group' | 'game' | 'activity' | 'rubric'
export type Block = { id: string; type: BlockType; [k: string]: any }
export type LPhase = { key: string; title: string; minutes: number; hint?: string; blocks: Block[] }
export type ILesson = { phases: LPhase[]; goals?: string[]; tags?: string[]; cover?: string }
export type GameKind = 'race' | 'wheel' | 'teams' | 'timer'

export const BLOCKS: Record<BlockType, { label: string; icon: string; kind?: 'sim' | 'game' | 'tool' | 'drag' | 'quiz' }> = {
  heading: { label: 'Tiêu đề', icon: 'H' },
  text: { label: 'Đoạn văn', icon: '¶' },
  image: { label: 'Hình ảnh', icon: '▣' },
  video: { label: 'Video', icon: '▶' },
  file: { label: 'Tệp PDF / PPTX', icon: '⎙' },
  link: { label: 'Liên kết / SCORM', icon: '↗' },
  sim: { label: 'Mô phỏng 2D', icon: '⚛', kind: 'sim' },
  tool: { label: 'Giáo cụ ảo', icon: '📏', kind: 'tool' },
  order: { label: 'Kéo – thả', icon: '↕', kind: 'drag' },
  quiz: { label: 'Câu hỏi trắc nghiệm', icon: '?', kind: 'quiz' },
  code: { label: 'Đoạn code', icon: '</>' },
  group: { label: 'Hoạt động nhóm', icon: '👥' },
  game: { label: 'Game hoá', icon: '🎮', kind: 'game' },
  activity: { label: 'Hoạt động từ kho', icon: '◉', kind: 'game' },
  rubric: { label: 'Rubric đánh giá', icon: '▤' },
}
export const BLOCK_TYPES = Object.keys(BLOCKS) as BlockType[]
export const GAMES: Record<GameKind, string> = { race: 'Đường đua tri thức', wheel: 'Vòng quay may mắn', teams: 'Chia đội thi đấu', timer: 'Đồng hồ thử thách' }
export const INTERACTION: Record<'sim' | 'game' | 'tool' | 'drag', string> = { sim: 'Mô phỏng 2D', game: 'Game hoá', tool: 'Giáo cụ ảo', drag: 'Kéo – thả' }

type FlowPhase = { key: string; title: string; minutes: number; hint: string }
export const CT_FLOW: Record<string, FlowPhase[]> = {
  CT1: [
    { key: 'khoi_dong', title: 'Khởi động', minutes: 7, hint: 'Tình huống gần gũi, câu hỏi gợi mở; ghi nhanh dự đoán của học sinh.' },
    { key: 'kien_thuc', title: 'Kiến thức mới', minutes: 12, hint: 'Giải thích khái niệm kèm hình ảnh, giáo cụ ảo hoặc mô phỏng.' },
    { key: 'luyen_tap', title: 'Luyện tập', minutes: 18, hint: 'Kéo – thả, câu hỏi nhanh, game củng cố.' },
    { key: 'van_dung', title: 'Vận dụng STEM', minutes: 8, hint: 'Bài toán thực tế, bài tập về nhà gắn với đời sống.' },
  ],
  CT2: [
    { key: 'van_de', title: 'Xác định vấn đề', minutes: 8, hint: 'Nêu vấn đề thực tiễn cần giải quyết bằng kiến thức liên môn.' },
    { key: 'kien_thuc_nen', title: 'Nghiên cứu kiến thức nền', minutes: 15, hint: 'Kiến thức các môn liên quan: Toán, KHTN, Công nghệ…' },
    { key: 'giai_phap', title: 'Đề xuất giải pháp', minutes: 12, hint: 'Nhóm vẽ phác thảo, chọn phương án tối ưu.' },
    { key: 'che_tao', title: 'Chế tạo & thử nghiệm', minutes: 35, hint: 'Hoạt động nhóm, đo đạc, ghi số liệu.' },
    { key: 'chia_se', title: 'Chia sẻ & đánh giá', minutes: 10, hint: 'Trình bày sản phẩm, rubric đánh giá.' },
  ],
  CT3: [
    { key: 'kham_pha', title: 'Khám phá', minutes: 10, hint: 'Quan sát mẫu, video truyền cảm hứng.' },
    { key: 'y_tuong', title: 'Ý tưởng', minutes: 10, hint: 'Động não, vòng quay chọn nhóm trình bày ý tưởng.' },
    { key: 'thiet_ke', title: 'Thiết kế', minutes: 15, hint: 'Bản vẽ, danh sách vật liệu.' },
    { key: 'lam_san_pham', title: 'Làm sản phẩm', minutes: 45, hint: 'Hoạt động nhóm, đồng hồ thử thách.' },
    { key: 'trinh_bay', title: 'Trình bày', minutes: 10, hint: 'Demo sản phẩm, rubric và phản hồi.' },
  ],
  CT4: [
    { key: 'khoi_dong', title: 'Khởi động', minutes: 8, hint: 'Demo robot / AI / IoT để hút thành viên.' },
    { key: 'ly_thuyet', title: 'Lý thuyết', minutes: 12, hint: 'Kiến thức công nghệ, mô phỏng mạch.' },
    { key: 'lap_rap', title: 'Lắp ráp & Lập trình', minutes: 40, hint: 'Hardware + code, chia vai trong nhóm.' },
    { key: 'test_debug', title: 'Test & Debug', minutes: 20, hint: 'Thử nghiệm, sửa lỗi, đo kết quả.' },
    { key: 'danh_gia', title: 'Đánh giá', minutes: 10, hint: 'Demo sản phẩm + reflection, rubric.' },
  ],
  CT5: [
    { key: 'cau_hoi', title: 'Đặt câu hỏi nghiên cứu', minutes: 10, hint: 'Từ hiện tượng thực tế đến câu hỏi đo được.' },
    { key: 'gia_thuyet', title: 'Giả thuyết & thiết kế', minutes: 15, hint: 'Biến độc lập, biến phụ thuộc, biến kiểm soát.' },
    { key: 'thi_nghiem', title: 'Thí nghiệm', minutes: 35, hint: 'Đo lặp lại, ghi số liệu vào phiếu.' },
    { key: 'phan_tich', title: 'Phân tích dữ liệu', minutes: 15, hint: 'Bảng, biểu đồ, sai số.' },
    { key: 'bao_cao', title: 'Báo cáo', minutes: 15, hint: 'Poster / thuyết trình, rubric NCKH.' },
  ],
}
export const DEFAULT_FLOW = CT_FLOW.CT1

export const uidB = () => Math.random().toString(36).slice(2, 9)
export function newBlock(type: BlockType): Block {
  const id = uidB()
  switch (type) {
    case 'heading': return { id, type, text: '' }
    case 'text': return { id, type, text: '' }
    case 'image': return { id, type, url: '', caption: '' }
    case 'video': return { id, type, url: '', caption: '' }
    case 'file': return { id, type, url: '', name: '' }
    case 'link': return { id, type, url: '', title: '', note: '', style: 'link' }
    case 'sim': return { id, type, model: 'circuit_series', title: '', task: '' }
    case 'tool': return { id, type, model: 'ruler', title: '', task: '' }
    case 'order': return { id, type, prompt: '', steps: ['', '', ''] }
    case 'quiz': return { id, type, q: '', options: ['', '', '', ''], answer: 0, explain: '' }
    case 'code': return { id, type, lang: 'arduino_c', code: '' }
    case 'group': return { id, type, title: '', size: 4, minutes: 20, goal: '', steps: [''], roles: [{ role: 'Trưởng nhóm', task: '' }] }
    case 'game': return { id, type, game: 'wheel', title: '', names: [], questions: [], items: [], seconds: 300 }
    case 'activity': return { id, type, kind: 'match', title: '', content: { pairs: [{ left: '', right: '' }, { left: '', right: '' }] } }
    case 'rubric': return { id, type, title: 'Rubric đánh giá', criteria: [{ name: '', weight: 25, levels: ['', '', '', ''] }] }
  }
}
export function emptyLesson(ct?: string | null): ILesson {
  return { goals: [], phases: (CT_FLOW[ct ?? ''] ?? DEFAULT_FLOW).map(p => ({ key: p.key, title: p.title, minutes: p.minutes, hint: p.hint, blocks: [] })) }
}
/** Bài giảng tương tác hợp lệ (có ít nhất một giai đoạn), không thì null. */
export function asLesson(x: any): ILesson | null {
  if (!x || typeof x !== 'object' || !Array.isArray(x.phases) || !x.phases.length) return null
  return { ...x, phases: x.phases.map((p: any) => ({ key: p.key ?? uidB(), title: p.title ?? '', minutes: Number(p.minutes) || 0, hint: p.hint, blocks: Array.isArray(p.blocks) ? p.blocks : [] })) }
}
export const allBlocks = (l: ILesson | null) => (l?.phases ?? []).flatMap(p => p.blocks)
export function lessonStats(l: ILesson | null) {
  const bs = allBlocks(l)
  const kinds = new Set(bs.map(b => BLOCKS[b.type]?.kind).filter(Boolean) as string[])
  return {
    blocks: bs.length, minutes: (l?.phases ?? []).reduce((s, p) => s + (Number(p.minutes) || 0), 0),
    interactive: bs.filter(b => ['sim', 'tool', 'order', 'quiz', 'game', 'activity'].includes(b.type)).length,
    kinds: (['sim', 'game', 'tool', 'drag'] as const).filter(k => kinds.has(k)),
  }
}
export function blockSummary(b: Block): string {
  const s = (x: any) => String(x ?? '').replace(/\*\*/g, '').split('\n')[0].trim()
  switch (b.type) {
    case 'heading': case 'text': return s(b.text)
    case 'image': case 'video': return s(b.caption) || s(b.url)
    case 'file': return s(b.name) || s(b.url)
    case 'link': return s(b.title) || s(b.url)
    case 'sim': case 'tool': return s(b.title) || SIMS[b.model as SimModel]?.label || ''
    case 'order': return s(b.prompt)
    case 'quiz': return s(b.q)
    case 'code': return 'Đoạn code ' + (b.lang ?? '')
    case 'group': return s(b.title)
    case 'game': return s(b.title) || GAMES[b.game as GameKind] || ''
    case 'activity': return s(b.title) || ACT[b.kind as ActKind]?.label || ''
    case 'rubric': return s(b.title)
  }
  return ''
}

// ===== Hiển thị =====
function Rich({ text }: { text: string }) {
  const lines = String(text ?? '').split('\n')
  const inline = (l: string) => l.split(/(\*\*[^*]+\*\*)/g).map((p, i) => p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <Fragment key={i}>{p}</Fragment>)
  const out: JSX.Element[] = []; let ul: string[] = []
  const flush = () => { if (ul.length) { out.push(<ul key={'u' + out.length}>{ul.map((x, i) => <li key={i}>{inline(x)}</li>)}</ul>); ul = [] } }
  lines.forEach((l, i) => {
    if (/^\s*[-•]\s+/.test(l)) ul.push(l.replace(/^\s*[-•]\s+/, ''))
    else { flush(); if (l.trim()) out.push(<p key={i}>{inline(l)}</p>) }
  })
  flush()
  return <div className="rich">{out}</div>
}
const ytEmbed = (url: string) => { const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/); return m ? `https://www.youtube.com/embed/${m[1]}` : null }
const extOf = (u: string, n?: string) => ((n || u).split('?')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? 'tệp').toUpperCase()

function OrderBlock({ b }: { b: Block }) {
  const steps: string[] = (b.steps ?? []).filter((x: string) => x?.trim())
  const fresh = () => { const a = [...steps]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } if (a.length > 1 && a.every((x, i) => x === steps[i])) a.reverse(); return a }
  const [cur, setCur] = useState<string[]>(fresh); const [checked, setChecked] = useState(false); const [drag, setDrag] = useState<number | null>(null)
  useEffect(() => { setCur(fresh()); setChecked(false) }, [steps.join('|')])
  const move = (i: number, j: number) => { if (j < 0 || j >= cur.length) return; const n = [...cur]; const [x] = n.splice(i, 1); n.splice(j, 0, x); setCur(n); setChecked(false) }
  const right = cur.filter((x, i) => x === steps[i]).length
  return (
    <div className="dragbox">
      {b.prompt && <p style={{ marginTop: 0 }}>{b.prompt}</p>}
      <ol className="draglist">{cur.map((s, i) => (
        <li key={s} draggable onDragStart={() => setDrag(i)} onDragOver={e => e.preventDefault()} onDrop={() => { if (drag !== null) move(drag, i); setDrag(null) }}
          className={checked ? (s === steps[i] ? 'ok' : 'bad') : ''}>
          <span className="dragnum">{i + 1}</span><span style={{ flex: 1 }}>{s}</span>
          <button type="button" className="x" aria-label={`Đưa "${s}" lên`} onClick={() => move(i, i - 1)} disabled={i === 0}>↑</button>
          <button type="button" className="x" aria-label={`Đưa "${s}" xuống`} onClick={() => move(i, i + 1)} disabled={i === cur.length - 1}>↓</button>
        </li>))}</ol>
      {checked && <div className="timebar"><i style={{ width: `${(100 * right) / Math.max(1, steps.length)}%`, background: right === steps.length ? 'var(--ok)' : 'var(--orange)' }} /></div>}
      <div className="actions">
        <button type="button" className="primary" onClick={() => setChecked(true)}>Kiểm tra kết quả</button>
        <button type="button" onClick={() => { setCur(fresh()); setChecked(false) }}>↺ Làm lại</button>
        {checked && <span className={right === steps.length ? 'okline' : 'warnline'}>Đúng {right}/{steps.length} vị trí{right === steps.length ? ' — tuyệt vời!' : ''}</span>}
      </div>
    </div>
  )
}
function QuizBlock({ b, teacher }: { b: Block; teacher?: boolean }) {
  const [pick, setPick] = useState<number | null>(null)
  const show = teacher || pick !== null
  return (
    <div className="quizbox">
      <b>{b.q}</b>
      <div className="actopts">{(b.options ?? []).map((o: string, j: number) => (
        <button type="button" key={j} className={'actopt' + (show && j === b.answer ? ' right' : '') + (pick === j && j !== b.answer ? ' wrong' : '')} onClick={() => setPick(j)} aria-pressed={pick === j}>
          <b>{String.fromCharCode(65 + j)}</b> {o}</button>))}</div>
      {pick !== null && <p className={pick === b.answer ? 'okline' : 'warnline'}>{pick === b.answer ? 'Chính xác!' : `Chưa đúng — đáp án là ${String.fromCharCode(65 + (b.answer ?? 0))}.`}</p>}
      {show && b.explain && <div className="explain"><small>GIẢI THÍCH</small><br />{b.explain}</div>}
    </div>
  )
}
function ActivityBlock({ b }: { b: Block }) {
  const kind = b.kind as ActKind
  const data = useMemo(() => toPlayable(kind, b.content ?? {}), [kind, JSON.stringify(b.content)])
  const [ans, setAns] = useState<any>(() => emptyAnswers(kind, data))
  const [sol, setSol] = useState(false)
  useEffect(() => { setAns(emptyAnswers(kind, data)); setSol(false) }, [data])
  return (
    <div>
      <ActivityPlayer kind={kind} data={data} answers={ans} onChange={setAns} solution={sol ? b.content : null} />
      {ACT[kind]?.graded && <div className="actions"><button type="button" onClick={() => setSol(!sol)}>{sol ? 'Ẩn đáp án' : 'Xem đáp án'}</button>
        <button type="button" onClick={() => { setAns(emptyAnswers(kind, data)); setSol(false) }}>↺ Làm lại</button></div>}
    </div>
  )
}
export function GameView({ b }: { b: Block }) {
  switch (b.game as GameKind) {
    case 'race': return <RaceGame items={(b.items ?? []).filter((x: any) => x?.q)} seconds={b.seconds && b.seconds < 120 ? b.seconds : 20} />
    case 'teams': return <TeamsGame names={b.names ?? []} teams={b.teams ?? 4} />
    case 'timer': return <TimerGame seconds={b.seconds ?? 300} task={b.task} />
    default: return <WheelGame names={b.names ?? []} questions={b.questions ?? []} />
  }
}

export function BlockView({ b, teacher, slide }: { b: Block; teacher?: boolean; slide?: boolean }) {
  const cap = (t?: string) => t ? <figcaption>{t}</figcaption> : null
  switch (b.type) {
    case 'heading': return <h3 className="bk-h">{b.text || <i className="sub">Tiêu đề</i>}</h3>
    case 'text': return b.text ? <Rich text={b.text} /> : <i className="sub">Đoạn văn trống</i>
    case 'image': return b.url ? <figure className="bk-media"><img src={b.url} alt={b.caption || 'Hình minh hoạ'} loading="lazy" />{cap(b.caption)}</figure> : <i className="sub">Chưa có đường dẫn hình</i>
    case 'video': {
      if (!b.url) return <i className="sub">Chưa có đường dẫn video</i>
      const yt = ytEmbed(b.url)
      return <figure className="bk-media">{yt ? <iframe src={yt} title={b.caption || 'Video'} allow="encrypted-media; fullscreen" allowFullScreen /> : <video src={b.url} controls preload="metadata" />}{cap(b.caption)}</figure>
    }
    case 'file': return (
      <div className="bk-file"><span className="fileicon">{extOf(b.url ?? '', b.name)}</span><div style={{ flex: 1 }}><b>{b.name || 'Tệp đính kèm'}</b><br /><small className="sub">{b.note || 'Tài liệu ' + extOf(b.url ?? '', b.name)}</small></div>
        {b.url && <><a className="btnlink" href={b.url} target="_blank" rel="noreferrer">Xem</a><a className="btnlink" href={b.url} download>Tải xuống</a></>}</div>
    )
    case 'link': return (
      <div className={'bk-file' + (b.style === 'lesson' ? ' lessonlink' : '')}><span className="fileicon">{b.style === 'lesson' ? '⧉' : '↗'}</span>
        <div style={{ flex: 1 }}><b>{b.title || b.url || 'Liên kết'}</b><br /><small className="sub">{b.note || (b.url ? new URL(b.url, location.href).hostname : '')}</small></div>
        {b.url && <a className={b.style === 'lesson' ? 'btnlink primary' : 'btnlink'} href={b.url} target="_blank" rel="noreferrer">{b.style === 'lesson' ? '▷ Mở bài học' : 'Mở tab mới'}</a>}</div>
    )
    case 'sim': case 'tool': {
      const m = SIMS[b.model as SimModel]
      return (
        <div className={'bk-sim ' + b.type}>
          <div className="bk-simhead"><small>{b.type === 'sim' ? 'MÔ PHỎNG TƯƠNG TÁC' : 'GIÁO CỤ ẢO'}</small><b>{b.title || m?.label}</b>{m && <span className="simtag">{m.label}</span>}</div>
          {b.task && <p className="sub" style={{ margin: '0 0 8px' }}>{b.task}</p>}
          {m ? <SimView model={b.model} params={b.params} compact={slide} /> : <i className="sub">Chưa chọn mô phỏng</i>}
        </div>
      )
    }
    case 'order': return <div className="bk-sim drag"><div className="bk-simhead"><small>KÉO – THẢ TƯƠNG TÁC</small><b>{b.title || 'Sắp xếp thứ tự'}</b></div><OrderBlock b={b} /></div>
    case 'quiz': return <div className="bk-quiz"><small className="bk-tag">CÂU HỎI</small><QuizBlock b={b} teacher={teacher} /></div>
    case 'code': return <div><span className="codetag">{b.lang}</span><pre className="bk-code"><code>{b.code}</code></pre></div>
    case 'group': return (
      <div className="bk-group">
        <div className="bk-simhead"><small>HOẠT ĐỘNG NHÓM</small><b>{b.title}</b></div>
        <p className="sub" style={{ margin: '0 0 6px' }}><Icon n="users" /> Nhóm {b.size} HS · <Icon n="clock" /> {b.minutes} phút</p>
        {b.goal && <p><b>Mục tiêu:</b> {b.goal}</p>}
        {(b.steps ?? []).some((s: string) => s?.trim()) && <><b>Các bước</b><ol>{(b.steps ?? []).filter((s: string) => s?.trim()).map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></>}
        {(b.roles ?? []).some((r: any) => r.role) && <table className="roletable"><tbody>{(b.roles ?? []).filter((r: any) => r.role).map((r: any, i: number) => <tr key={i}><td><b>{r.role}</b></td><td>{r.task}</td></tr>)}</tbody></table>}
      </div>
    )
    case 'game': return <div className="bk-game"><div className="bk-simhead"><small>GAME HOÁ LỚP HỌC</small><b>{b.title || GAMES[b.game as GameKind]}</b><span className="simtag">{GAMES[b.game as GameKind]}</span></div>{b.note && <p className="sub">{b.note}</p>}<GameView b={b} /></div>
    case 'activity': return <div className="bk-game"><div className="bk-simhead"><small>{ACT[b.kind as ActKind]?.label?.toUpperCase()}</small><b>{b.title}</b></div><ActivityBlock b={b} /></div>
    case 'rubric': {
      const cr: any[] = b.criteria ?? []; const sum = cr.reduce((s, c) => s + (Number(c.weight) || 0), 0)
      return (
        <div className="bk-rubric">
          <div className="bar"><b>▤ {b.title || 'Rubric đánh giá'}</b><span className={sum === 100 ? 'okline' : 'warnline'}>{sum}%{sum === 100 ? ' ✓' : ''}</span></div>
          <div className="wrap"><table><thead><tr><th>Tiêu chí</th><th>%</th><th>Yếu (1)</th><th>TB (2)</th><th>Khá (3)</th><th>Tốt (4)</th></tr></thead>
            <tbody>{cr.map((c, i) => <tr key={i}><td><b>{c.name}</b></td><td>{c.weight}</td>{[0, 1, 2, 3].map(k => <td key={k}><small>{c.levels?.[k]}</small></td>)}</tr>)}</tbody></table></div>
        </div>
      )
    }
  }
  return null
}

// ===== Sửa một khối =====
const lines = (a?: string[]) => (a ?? []).join('\n')
const unlines = (s: string) => s.split('\n')
export function BlockForm({ b, onChange }: { b: Block; onChange: (b: Block) => void }) {
  const set = (patch: Record<string, any>) => onChange({ ...b, ...patch })
  const F = ({ label, k, area, rows, placeholder }: { label: string; k: string; area?: boolean; rows?: number; placeholder?: string }) => (
    <label className="field" style={area ? { gridColumn: '1 / -1' } : undefined}><span>{label}</span>
      {area ? <textarea rows={rows ?? 3} value={b[k] ?? ''} placeholder={placeholder} onChange={e => set({ [k]: e.target.value })} />
        : <input value={b[k] ?? ''} placeholder={placeholder} onChange={e => set({ [k]: e.target.value })} />}</label>
  )
  switch (b.type) {
    case 'heading': return <div className="formgrid">{F({ label: 'Tiêu đề', k: 'text' })}</div>
    case 'text': return <div className="formgrid">{F({ label: 'Nội dung (mỗi dòng một đoạn; "- " đầu dòng là gạch đầu dòng; **đậm**)', k: 'text', area: true, rows: 5 })}</div>
    case 'image': case 'video': return <div className="formgrid">{F({ label: b.type === 'image' ? 'Đường dẫn hình (https://…)' : 'Đường dẫn video (YouTube hoặc .mp4)', k: 'url' })}{F({ label: 'Chú thích', k: 'caption' })}</div>
    case 'file': return <div className="formgrid">{F({ label: 'Tên tệp', k: 'name', placeholder: 'Phieu-quan-sat.pdf' })}{F({ label: 'Đường dẫn tệp', k: 'url' })}{F({ label: 'Ghi chú', k: 'note', placeholder: 'Tài liệu PDF' })}</div>
    case 'link': return (
      <div className="formgrid">{F({ label: 'Tiêu đề', k: 'title', placeholder: 'Mô phỏng PhET: Xây dựng nguyên tử' })}{F({ label: 'Đường dẫn', k: 'url' })}{F({ label: 'Ghi chú', k: 'note' })}
        <label className="field"><span>Kiểu</span><select value={b.style ?? 'link'} onChange={e => set({ style: e.target.value })}><option value="link">Liên kết ngoài</option><option value="lesson">Bài học tương tác (SCORM)</option></select></label></div>
    )
    case 'sim': case 'tool': {
      const models = SIM_MODELS.filter(m => SIMS[m].group === b.type)
      const def = SIM_DEFAULTS[b.model as SimModel] ?? {}
      return (
        <div className="formgrid">
          <label className="field"><span>{b.type === 'sim' ? 'Mô phỏng' : 'Giáo cụ'}</span><select value={b.model} onChange={e => set({ model: e.target.value, params: undefined })}>
            {models.map(m => <option key={m} value={m}>{SIMS[m].label}</option>)}</select></label>
          {F({ label: 'Tên hiển thị', k: 'title', placeholder: SIMS[b.model as SimModel]?.label })}
          {F({ label: 'Nhiệm vụ cho học sinh', k: 'task', area: true, rows: 2, placeholder: SIMS[b.model as SimModel]?.desc })}
          {Object.keys(def).map(k => (
            <label className="field" key={k}><span>{({ V: 'Hiệu điện thế ban đầu (V)', R: 'Điện trở mỗi bóng (Ω)', L: 'Chiều dài dây (m)', target: 'Giá trị mục tiêu', left: 'Vật trái', right: 'Vật phải' } as Record<string, string>)[k] ?? k}</span>
              <input type="number" step="any" value={b.params?.[k] ?? def[k]} onChange={e => set({ params: { ...(b.params ?? {}), [k]: Number(e.target.value) } })} /></label>
          ))}
        </div>
      )
    }
    case 'order': return <div className="formgrid">{F({ label: 'Tên hoạt động', k: 'title' })}{F({ label: 'Yêu cầu', k: 'prompt' })}
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Các bước theo ĐÚNG thứ tự (mỗi dòng một bước — học sinh sẽ thấy bị xáo trộn)</span>
        <textarea rows={5} value={lines(b.steps)} onChange={e => set({ steps: unlines(e.target.value) })} /></label></div>
    case 'quiz': return (
      <div className="formgrid">{F({ label: 'Câu hỏi', k: 'q', area: true, rows: 2 })}
        <div className="field" style={{ gridColumn: '1 / -1' }}><span>Phương án — chọn đáp án đúng</span>
          {(b.options ?? []).map((o: string, i: number) => (
            <div className="addrow" key={i}><input type="radio" name={'ans' + b.id} checked={b.answer === i} onChange={() => set({ answer: i })} aria-label={`Đáp án ${String.fromCharCode(65 + i)} đúng`} />
              <input value={o} placeholder={`Phương án ${String.fromCharCode(65 + i)}`} onChange={e => set({ options: b.options.map((x: string, j: number) => j === i ? e.target.value : x) })} />
              <button type="button" className="x" disabled={b.options.length <= 2} onClick={() => set({ options: b.options.filter((_: string, j: number) => j !== i), answer: 0 })} aria-label="Xoá phương án">×</button></div>
          ))}
          {(b.options ?? []).length < 6 && <button type="button" className="linkbtn" onClick={() => set({ options: [...(b.options ?? []), ''] })}>+ Phương án</button>}
        </div>
        {F({ label: 'Giải thích', k: 'explain', area: true, rows: 2 })}</div>
    )
    case 'code': return <div className="formgrid"><label className="field"><span>Ngôn ngữ</span><select value={b.lang} onChange={e => set({ lang: e.target.value })}>
      {['arduino_c', 'python', 'scratch', 'javascript', 'microbit'].map(x => <option key={x}>{x}</option>)}</select></label>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Code</span><textarea rows={8} className="mono" value={b.code ?? ''} onChange={e => set({ code: e.target.value })} /></label></div>
    case 'group': return (
      <div className="formgrid">{F({ label: 'Tên hoạt động', k: 'title' })}
        <label className="field"><span>Số HS / nhóm</span><input type="number" min={1} max={12} value={b.size ?? 4} onChange={e => set({ size: Number(e.target.value) })} /></label>
        <label className="field"><span>Thời gian (phút)</span><input type="number" min={1} max={180} value={b.minutes ?? 20} onChange={e => set({ minutes: Number(e.target.value) })} /></label>
        {F({ label: 'Mục tiêu', k: 'goal', area: true, rows: 2 })}
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Các bước (mỗi dòng một bước)</span><textarea rows={4} value={lines(b.steps)} onChange={e => set({ steps: unlines(e.target.value) })} /></label>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Vai trò trong nhóm (mỗi dòng: Vai trò: nhiệm vụ)</span>
          <textarea rows={3} value={(b.roles ?? []).map((r: any) => `${r.role}: ${r.task}`).join('\n')} onChange={e => set({ roles: unlines(e.target.value).map(l => { const [r, ...t] = l.split(':'); return { role: r.trim(), task: t.join(':').trim() } }) })} /></label>
      </div>
    )
    case 'game': return (
      <div className="formgrid">
        <label className="field"><span>Trò chơi</span><select value={b.game} onChange={e => set({ game: e.target.value })}>{(Object.keys(GAMES) as GameKind[]).map(g => <option key={g} value={g}>{GAMES[g]}</option>)}</select></label>
        {F({ label: 'Tên hiển thị', k: 'title' })}{F({ label: 'Ghi chú cho lớp', k: 'note' })}
        {(b.game === 'wheel' || b.game === 'teams') && <label className="field" style={{ gridColumn: '1 / -1' }}><span>Danh sách học sinh / nhóm (mỗi dòng một tên)</span><textarea rows={4} value={lines(b.names)} onChange={e => set({ names: unlines(e.target.value) })} /></label>}
        {b.game === 'wheel' && <label className="field" style={{ gridColumn: '1 / -1' }}><span>Câu hỏi bốc ngẫu nhiên (mỗi dòng một câu)</span><textarea rows={3} value={lines(b.questions)} onChange={e => set({ questions: unlines(e.target.value) })} /></label>}
        {b.game === 'teams' && <label className="field"><span>Số đội</span><input type="number" min={2} max={8} value={b.teams ?? 4} onChange={e => set({ teams: Number(e.target.value) })} /></label>}
        {b.game === 'timer' && <><label className="field"><span>Thời gian (giây)</span><input type="number" min={10} max={3600} value={b.seconds ?? 300} onChange={e => set({ seconds: Number(e.target.value) })} /></label>{F({ label: 'Thử thách', k: 'task', area: true, rows: 2 })}</>}
        {b.game === 'race' && <div className="field" style={{ gridColumn: '1 / -1' }}><span>Câu hỏi đường đua</span>
          <ContentEditor kind="quiz" value={{ items: b.items?.length ? b.items : [{ q: '', options: ['', '', '', ''], answer: 0 }] }} onChange={v => set({ items: v.items })} /></div>}
      </div>
    )
    case 'activity': return (
      <div className="formgrid">{F({ label: 'Tên hoạt động', k: 'title' })}
        <label className="field"><span>Loại</span><select value={b.kind} onChange={e => set({ kind: e.target.value, content: undefined })}>{(Object.keys(ACT) as ActKind[]).map(k => <option key={k} value={k}>{ACT[k].label}</option>)}</select></label>
        <div className="field" style={{ gridColumn: '1 / -1' }}><ContentEditor kind={b.kind} value={b.content ?? {}} onChange={v => set({ content: v })} /></div></div>
    )
    case 'rubric': return (
      <div className="formgrid">{F({ label: 'Tên rubric', k: 'title' })}
        <div className="field" style={{ gridColumn: '1 / -1' }}><span>Tiêu chí — tỉ lệ % và mô tả 4 mức (Yếu, TB, Khá, Tốt)</span>
          {(b.criteria ?? []).map((c: any, i: number) => (
            <div className="addrow" key={i} style={{ flexWrap: 'wrap' }}>
              <input style={{ flex: 2, minWidth: 160 }} value={c.name} placeholder="Tiêu chí" aria-label={`Tiêu chí ${i + 1}`} onChange={e => set({ criteria: b.criteria.map((x: any, j: number) => j === i ? { ...x, name: e.target.value } : x) })} />
              <input style={{ width: 64 }} type="number" min={0} max={100} value={c.weight} aria-label="Tỉ lệ %" onChange={e => set({ criteria: b.criteria.map((x: any, j: number) => j === i ? { ...x, weight: Number(e.target.value) } : x) })} />
              {[0, 1, 2, 3].map(k => <input key={k} style={{ flex: 1, minWidth: 110 }} value={c.levels?.[k] ?? ''} placeholder={['Yếu', 'TB', 'Khá', 'Tốt'][k]}
                onChange={e => set({ criteria: b.criteria.map((x: any, j: number) => j === i ? { ...x, levels: [0, 1, 2, 3].map(q => q === k ? e.target.value : x.levels?.[q] ?? '') } : x) })} />)}
              <button type="button" className="x" onClick={() => set({ criteria: b.criteria.filter((_: any, j: number) => j !== i) })} aria-label="Xoá tiêu chí">×</button>
            </div>))}
          <button type="button" className="linkbtn" onClick={() => set({ criteria: [...(b.criteria ?? []), { name: '', weight: 0, levels: ['', '', '', ''] }] })}>+ Tiêu chí</button>
        </div></div>
    )
  }
  return null
}

// ===== Trình soạn bài giảng tương tác =====
export function LessonEditor({ value, ct, onChange, readOnly }: { value: ILesson | null; ct?: string | null; onChange: (l: ILesson) => void; readOnly?: boolean }) {
  const lesson = value ?? emptyLesson(ct)
  const [sel, setSel] = useState(0)
  const [edit, setEdit] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const ph = lesson.phases[Math.min(sel, lesson.phases.length - 1)]
  const st = lessonStats(lesson)
  const flow = CT_FLOW[ct ?? ''] ?? DEFAULT_FLOW
  const setPhase = (patch: Partial<LPhase>) => onChange({ ...lesson, phases: lesson.phases.map((p, i) => i === sel ? { ...p, ...patch } : p) })
  const setBlocks = (blocks: Block[]) => setPhase({ blocks })
  const mv = (i: number, d: number) => { const bs = [...ph.blocks]; const j = i + d; if (j < 0 || j >= bs.length) return; [bs[i], bs[j]] = [bs[j], bs[i]]; setBlocks(bs) }
  const add = (t: BlockType) => { const nb = newBlock(t); setBlocks([...ph.blocks, nb]); setEdit(nb.id); setAdding(false) }
  if (!ph) return <div className="panel"><p className="sub">Chưa có giai đoạn nào.</p>{!readOnly && <button className="primary" onClick={() => onChange(emptyLesson(ct))}>Dùng tiến trình {ct ?? 'CT1'}</button>}</div>
  return (
    <div className="lessoned">
      <aside className="panel lphases">
        <small className="sub">TIẾN TRÌNH {ct ?? ''}</small>
        {lesson.phases.map((p, i) => (
          <button key={p.key + i} type="button" className={'lphase' + (i === sel ? ' on' : '')} onClick={() => { setSel(i); setEdit(null) }}>
            <span className={'lnum c' + (i % 5)}>{i + 1}</span><span><b>{p.title}</b><small>khoảng {p.minutes} phút</small></span><em>{p.blocks.length}</em>
          </button>
        ))}
        {!readOnly && <button type="button" className="linkbtn" onClick={() => { onChange({ ...lesson, phases: [...lesson.phases, { key: uidB(), title: 'Giai đoạn mới', minutes: 10, blocks: [] }] }); setSel(lesson.phases.length) }}>+ Thêm giai đoạn</button>}
        {(ph.hint || flow.find(f => f.key === ph.key)?.hint) && <div className="lhint"><small>GỢI Ý CHO GIAI ĐOẠN NÀY</small><br />{ph.hint || flow.find(f => f.key === ph.key)?.hint}</div>}
        <div className="ltotals"><span>Tổng số khối <b>{st.blocks}</b></span><span>Khối tương tác <b className="accent">{st.interactive}</b></span><span>Thời lượng <b>{st.minutes} phút</b></span></div>
      </aside>
      <section className="lcenter">
        <div className="panel lphasehead">
          {readOnly ? <h3 style={{ margin: 0 }}>{ph.title} <span className="pill">{ph.blocks.length} khối</span></h3> : (
            <div className="addrow" style={{ alignItems: 'center' }}>
              <input value={ph.title} onChange={e => setPhase({ title: e.target.value })} aria-label="Tên giai đoạn" style={{ flex: 1, fontWeight: 700 }} />
              <input type="number" min={0} max={300} value={ph.minutes} onChange={e => setPhase({ minutes: Number(e.target.value) || 0 })} aria-label="Số phút" style={{ width: 70 }} /><small>phút</small>
              <button type="button" disabled={sel === 0} aria-label="Đưa giai đoạn lên" onClick={() => { const a = [...lesson.phases]; [a[sel - 1], a[sel]] = [a[sel], a[sel - 1]]; onChange({ ...lesson, phases: a }); setSel(sel - 1) }}>↑</button>
              <button type="button" className="x" disabled={lesson.phases.length <= 1} aria-label="Xoá giai đoạn"
                onClick={() => { if (!ph.blocks.length || confirm(`Xoá giai đoạn "${ph.title}" và ${ph.blocks.length} khối?`)) { onChange({ ...lesson, phases: lesson.phases.filter((_, i) => i !== sel) }); setSel(Math.max(0, sel - 1)) } }}>×</button>
            </div>
          )}
        </div>
        {ph.blocks.length === 0 && <div className="panel"><p className="sub" style={{ margin: 0 }}>Giai đoạn này chưa có khối nội dung.{!readOnly && ' Bấm "Thêm khối nội dung" bên dưới.'}</p></div>}
        {ph.blocks.map((b, i) => (
          <div className="panel lblock" key={b.id} id={'blk-' + b.id}>
            <div className="lblockhead">
              <span className="sub">#{i + 1}</span><span className="btag"><Icon n={BLOCKS[b.type]?.icon ?? ''} /> {BLOCKS[b.type]?.label}</span><small className="sub ellipsis">{blockSummary(b)}</small>
              {!readOnly && <span className="tools">
                <button type="button" className={edit === b.id ? 'primary' : ''} onClick={() => setEdit(edit === b.id ? null : b.id)}>{edit === b.id ? 'Xong' : 'Sửa'}</button>
                <button type="button" aria-label="Lên" disabled={i === 0} onClick={() => mv(i, -1)}>↑</button>
                <button type="button" aria-label="Xuống" disabled={i === ph.blocks.length - 1} onClick={() => mv(i, 1)}>↓</button>
                <button type="button" aria-label="Nhân bản khối" onClick={() => { const bs = [...ph.blocks]; bs.splice(i + 1, 0, { ...JSON.parse(JSON.stringify(b)), id: uidB() }); setBlocks(bs) }}>⧉</button>
                <button type="button" className="x" aria-label="Xoá khối" onClick={() => setBlocks(ph.blocks.filter(x => x.id !== b.id))}>×</button></span>}
            </div>
            {edit === b.id && !readOnly && <div className="lblockform"><BlockForm b={b} onChange={nb => setBlocks(ph.blocks.map(x => x.id === b.id ? nb : x))} /></div>}
            <div className="lblockview"><BlockView b={b} teacher /></div>
          </div>
        ))}
        {!readOnly && (adding ? (
          <div className="panel"><div className="bar"><b>Thêm khối nội dung</b><button type="button" onClick={() => setAdding(false)}>Đóng</button></div>
            <div className="blockpick">{BLOCK_TYPES.map(t => <button type="button" key={t} onClick={() => add(t)}><span><Icon n={BLOCKS[t].icon} /></span>{BLOCKS[t].label}</button>)}</div></div>
        ) : <button type="button" className="addblock" onClick={() => setAdding(true)}>＋ Thêm khối nội dung <small>{BLOCK_TYPES.length} loại khối dùng cho {ct ?? 'bài giảng'}</small></button>)}
      </section>
      <aside className="panel loutline">
        <small className="sub">DÀN Ý</small>
        {lesson.phases.map((p, i) => (
          <div key={p.key + i}>
            <button type="button" className={'olphase c' + (i % 5)} onClick={() => { setSel(i); setEdit(null) }}>{p.title}<em>{p.blocks.length}</em></button>
            {p.blocks.map(b => <button type="button" key={b.id} className="olblock" onClick={() => { setSel(i); setTimeout(() => document.getElementById('blk-' + b.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50) }}>
              {['sim', 'tool', 'order', 'quiz', 'game', 'activity'].includes(b.type) ? '● ' : ''}{blockSummary(b) || BLOCKS[b.type].label}</button>)}
          </div>
        ))}
      </aside>
    </div>
  )
}

// ===== Dàn ý chỉ đọc (Kho bài giảng) =====
export function LessonOutline({ lesson, ct }: { lesson: ILesson; ct?: string | null }) {
  return (
    <div className="lsoutline">
      <b>Tiến trình {ct ?? ''}</b>
      {lesson.phases.map((p, i) => (
        <div key={p.key + i} className={'lsphase c' + (i % 5)}>
          <div className="lsphasehead"><b>{p.title}</b><small>{p.blocks.length} khối · gợi ý {p.minutes}′</small></div>
          {p.blocks.map(b => <div key={b.id} className="lsblock"><span className="btag"><Icon n={BLOCKS[b.type]?.icon ?? ''} /></span><div><b>{BLOCKS[b.type]?.label}</b><br /><small>{blockSummary(b)}</small></div></div>)}
        </div>
      ))}
    </div>
  )
}

// ===== Xem như học sinh =====
export function LessonPlayer({ title, ct, sub, lesson, onClose }: { title: string; ct?: string | null; sub?: string; lesson: ILesson; onClose: () => void }) {
  const flat = lesson.phases.flatMap((p, pi) => p.blocks.map(b => ({ b, pi })))
  const [seen, setSeen] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = scroller.current; if (!root) return
    const io = new IntersectionObserver(es => setSeen(s => { const n = new Set(s); es.forEach(e => { if (e.isIntersecting) n.add((e.target as HTMLElement).dataset.id ?? '') }); return n }), { root, threshold: 0.4 })
    root.querySelectorAll('[data-id]').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [lesson])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [])
  const pct = done ? 100 : Math.round((100 * seen.size) / Math.max(1, flat.length))
  return (
    <div className="overlay player" role="dialog" aria-modal="true" aria-label={'Xem như học sinh: ' + title}>
      <div className="playtop">
        <button type="button" className="x" onClick={onClose} aria-label="Đóng">×</button><span className="pill">Xem như học sinh</span>{ct && <span className="progchip ct">{ct}</span>}<b className="ellipsis">{title}</b>
        <span className="playprog"><i style={{ width: pct + '%' }} /></span><small>{pct}%</small>
        <button type="button" className={done ? 'okbtn' : 'primary'} onClick={() => setDone(true)}>{done ? '✓ Đã hoàn thành' : 'Hoàn thành bài'}</button>
      </div>
      <div className="playbody">
        <div className="playmain" ref={scroller}>
          {sub && <p className="sub">{sub}</p>}
          {lesson.phases.map((p, pi) => (
            <section key={p.key + pi}>
              <h2 className="playphase">{p.title}</h2>
              {p.blocks.map(b => <div key={b.id} data-id={b.id} id={'pl-' + b.id} className="playblock"><BlockView b={b} /></div>)}
            </section>
          ))}
          <div className="playend"><small className="sub">Em đã xem hết nội dung bài học này.</small><br />
            <button type="button" className={done ? 'okbtn' : 'primary'} onClick={() => setDone(true)}>{done ? '✓ Đã hoàn thành bài học' : 'Đánh dấu hoàn thành'}</button></div>
        </div>
        <nav className="playside" aria-label="Nội dung bài học">
          <div className="bar"><b>Nội dung bài học</b><small>{flat.length} mục</small></div>
          {flat.map(({ b }) => (
            <button type="button" key={b.id} className={seen.has(b.id) ? 'seen' : ''} onClick={() => document.getElementById('pl-' + b.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span className="btag"><Icon n={BLOCKS[b.type]?.icon ?? ''} /></span><span><b>{BLOCKS[b.type]?.label}</b><small>{blockSummary(b)}</small></span></button>
          ))}
        </nav>
      </div>
    </div>
  )
}

// ===== Trình chiếu: mỗi khối một trang =====
export function LessonShow({ title, ct, sub, lesson, onClose }: { title: string; ct?: string | null; sub?: string; lesson: ILesson; onClose: () => void }) {
  const slides = lesson.phases.flatMap(p => [{ phase: p.title, b: null as Block | null }, ...p.blocks.filter(b => b.type !== 'heading' || b.text).map(b => ({ phase: p.title, b }))])
  const [i, setI] = useState(0)
  const go = (d: number) => setI(x => Math.max(0, Math.min(slides.length - 1, x + d)))
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') go(1); else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1); else if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [slides.length])
  const s = slides[i]
  return (
    <div className="overlay show" role="dialog" aria-modal="true" aria-label={'Trình chiếu: ' + title}>
      <div className="showtop">{ct && <span className="progchip ct">{ct}</span>}<b>{title}</b>{sub && <small>{sub}</small>}<span style={{ marginLeft: 'auto' }}>Slide {i + 1}/{slides.length}</span>
        <button type="button" className="x" onClick={onClose} aria-label="Thoát trình chiếu">×</button></div>
      <div className="showstage">
        {s && (s.b === null
          ? <div className="showcard heading"><small>GIAI ĐOẠN</small><h2>{s.phase}</h2></div>
          : <div className={'showcard' + (s.b.type === 'heading' ? ' heading' : '')}>{s.b.type === 'heading' ? <><small>ĐỀ MỤC</small><h2>{s.b.text}</h2></> : <><small className="btag"><Icon n={BLOCKS[s.b.type]?.icon ?? ''} /> {BLOCKS[s.b.type]?.label}</small><BlockView b={s.b} slide /></>}</div>)}
      </div>
      <div className="showbot">
        <button type="button" onClick={() => go(-1)} disabled={i === 0}>‹ Trước</button>
        <span className="dots">{slides.map((_, k) => <i key={k} className={k === i ? 'on' : ''} onClick={() => setI(k)} />)}</span>
        <button type="button" onClick={() => go(1)} disabled={i === slides.length - 1}>Sau ›</button>
      </div>
    </div>
  )
}
