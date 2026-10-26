// Trang bài học theo video demo (23/10): bộ học liệu 5 thẻ, mỗi thẻ xem / cập nhật / chốt nội dung; đủ 5 thẻ thì phát hành.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { catalogOf, useSettings } from '../../../lib/settings'
import { supabase } from '../../../lib/supabase'
import { openFile, uploadLearningFile, fmtSize } from '../../../lib/files'
import { downloadWorkbook, readRows } from '../../../lib/sheet'
import { templateSheets } from '../../../lib/kitImport'
import { norm as normText } from '../../../lib/sheet'
import type { KitCard } from '../common'
import { CARDS, DOC_TYPE, ACT_LABEL, actTitles, suggestBank, cardCsv, cardFromRows, downloadText, kitFromDraft, kitOf, mergeKit, key, sessionMinutes, kitCounts,
  type KitData, type KBank, type KInfo, type KSession, type KDoc, type KMat, type Subj, type Who, type ParseResult } from './model'
import { chotCard, errMsg, fileDoc, fullContent, kitSel, kitTable, loadActivities, loadCatalog, parseFile, publishKit, type BankAct, type KitRow, type KitStore } from './save'
import { Modal, type ProgRef } from './Create'
import { MultiSelect } from '../../../components/MultiSelect'
import { GradeChecks, SubjectPicker, gradeList } from '../../../components/Pickers'

type Fields = { title: string; subject: string; grades: string; periods: string; program_id: string; prog_subject: string }
const STATUS: Record<KitRow['status'], [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], archived: ['Đã thu hồi', 'off'], inactive: ['Ngừng dùng', 'off'] }
/** Cách gọi theo nơi dùng: bài học (Học liệu) hay bài giảng tập huấn */
export type KitTerms = { noun: string; program: string; progSubject: string; per: string; catalogDocs: boolean }
export const LIB_TERMS: KitTerms = { noun: 'bài học', program: 'Chương trình', progSubject: 'Môn học trong chương trình', per: 'tiết', catalogDocs: true }
export const TRAINING_TERMS: KitTerms = { noun: 'bài giảng', program: 'Chương trình tập huấn', progSubject: 'Nội dung trong chương trình', per: 'giờ', catalogDocs: false }
const Terms = createContext<KitTerms>(LIB_TERMS)
export const cardsFor = (t: KitTerms) => (t.catalogDocs ? CARDS : CARDS.map(c => ({ ...c, title: c.title.replace('bài học', t.noun),
  desc: c.k === 'links' ? 'Tài liệu, slide, video và giáo án kèm theo bài giảng.' : c.desc.replace('bài học', t.noun) })))
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
const Chip = ({ tone, children }: { tone?: string; children: ReactNode }) => <span className={'distchip2 ' + (tone ?? '')}>{children}</span>
const Empty = ({ children }: { children: ReactNode }) => <i className="lempty">{children}</i>
const toLines = (t: string) => t.split('\n').map(x => x.trim()).filter(Boolean)
const subjBlocks = (ss: Subj[]) => ss.map(s => [s.name, ...s.reqs].join('\n')).join('\n\n')
const fromBlocks = (t: string): Subj[] => t.split(/\n\s*\n/).map(b => toLines(b)).filter(b => b.length).map(([name, ...reqs]) => ({ name, reqs }))
const UNITS = ['Cái', 'Miếng', 'Tờ', 'Bộ', 'Cm', 'm', 'Cuộn', 'Hộp', 'Lọ', 'Sợi', 'Gói', 'Chiếc', 'Quyển']

export function LessonPage({ orgId, id, programs, subjectsOf, code, onBack, onChanged, startEdit, backLabel = '← Danh sách bài học', store = 'library', unitOf }: {
  orgId: string; id: string; programs: ProgRef[]; subjectsOf: (pid: string) => string[]; code: string
  onBack: () => void; onChanged: () => void; startEdit?: boolean; backLabel?: string
  /** training: bài giảng tập huấn (training_lessons); unitOf tìm nội dung trong chương trình tập huấn theo tên */
  store?: KitStore; unitOf?: (pid: string, label: string) => string | null
}) {
  const T = store === 'training' ? TRAINING_TERMS : LIB_TERMS
  const CARDS = cardsFor(T)
  const [row, setRow] = useState<KitRow | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<KitCard>('info')
  const [edit, setEdit] = useState<KitCard | null>(startEdit ? 'info' : null)
  const [draft, setDraft] = useState<KitData | null>(null)
  const [fields, setFields] = useState<Fields | null>(null)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [docsOpen, setDocsOpen] = useState(false)
  const [check, setCheck] = useState<{ name: string; res: ParseResult; cards: KitCard[] } | null>(null)
  const [cat, setCat] = useState<{ id: string; name: string; unit: string; kind: KMat['kind'] }[]>([])
  const [acts, setActs] = useState<BankAct[]>([])
  const [rk, setRk] = useState(0)

  useEffect(() => {
    supabase.from(kitTable(store)).select(kitSel(store)).eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error) setErr(errMsg(error.message)); else if (!data) setErr(`Không tìm thấy ${T.noun}.`); else setRow(data as unknown as KitRow)
    })
  }, [id, rk])
  useEffect(() => { loadCatalog().then(setCat); loadActivities(orgId).then(setActs) }, [rk])
  const kit = useMemo(() => kitOf(row?.content.kit), [row])
  useEffect(() => { if (row && edit && !draft) begin(edit) }, [row])

  if (err) return <p className="msg">{err}</p>
  if (!row) return <p className="sub">Đang tải…</p>
  const checked = row.content.checked ?? []
  const prog = programs.find(p => p.id === row.program_id)
  const progLabel = prog ? `${prog.code ? prog.code + ' · ' : ''}${prog.title}` : ''
  const progSubject = kit.info.prog_subject || row.subject || ''
  const k = edit && draft ? draft : kit
  const empty = !kit.info.description && !kit.info.reqs.length && !kit.sessions.length && !kit.docs.length && !kit.mats.product.length && !kit.mats.group.length && !kit.bank.length
  const reload = () => { setRk(x => x + 1); onChanged() }

  function begin(card: KitCard) {
    setTab(card); setEdit(card); setDraft(JSON.parse(JSON.stringify(kit))); setMsg('')
    setFields({ title: row!.title, subject: row!.subject ?? '', grades: row!.grades ?? '', periods: row!.content.periods ? String(row!.content.periods) : '',
      program_id: row!.program_id ?? '', prog_subject: progSubject })
  }
  const cancel = () => { setEdit(null); setDraft(null); setFields(null) }
  async function write(next: KitData, patch: Partial<KitRow['content']>, cols: Partial<KitRow> = {}, done = 'Đã lưu.') {
    setBusy('Đang lưu…')
    const r = await supabase.from(kitTable(store)).update({ ...cols, content: fullContent(row!, next, patch) }).eq('id', row!.id)
    setBusy('')
    if (r.error) { setMsg(errMsg(r.error.message)); return false }
    setMsg(done); reload(); return true
  }
  async function save() {
    if (!draft || !fields || !edit) return
    let cols: Partial<KitRow> = {}, patch: Partial<KitRow['content']> = { checked: checked.filter(c => c !== edit) }
    if (edit === 'info') {
      if (!fields.title.trim()) return setMsg(`Nhập tên ${T.noun}.`)
      const per = /\d+([.,]\d+)?/.exec(fields.periods)?.[0]?.replace(',', '.')
      const p = programs.find(x => x.id === fields.program_id)
      cols = store === 'training'
        ? { title: fields.title.trim(), subject: fields.subject.trim() || null, grades: fields.grades.replace(/[^\d,]/g, '') || null,
            program_id: fields.program_id || null, unit_id: fields.program_id ? unitOf?.(fields.program_id, fields.prog_subject) ?? null : null }
        : { title: fields.title.trim(), subject: fields.subject.trim() || null, grades: fields.grades.replace(/[^\d,]/g, '') || null,
            program_id: fields.program_id || null, program: p?.ct_code ?? row!.program, ...(fields.program_id !== row!.program_id ? { unit_id: null } : {}) }
      draft.info.prog_subject = fields.prog_subject
      patch = { ...patch, periods: per ? Number(per) : null, objectives: draft.info.reqs.join('\n') || null }
    }
    const clean: KitData = { ...draft, docs: draft.docs.filter(d => d.title.trim() || d.url.trim() || d.file),
      mats: { product: draft.mats.product.filter(m => m.name.trim()), group: draft.mats.group.filter(m => m.name.trim()) },
      bank: draft.bank.filter(b => b.title.trim()).map(b => ({ ...b, title: b.title.trim() })) }
    if (await write(clean, patch, cols, 'Đã lưu thẻ. Kiểm tra lại rồi bấm “Chốt nội dung”.')) cancel()
  }
  async function chot(card: KitCard) {
    setBusy('Đang chốt…'); setMsg('')
    const r = await chotCard(orgId, row!, kit, card, store)
    setBusy('')
    if (r.error) return setMsg(r.error)
    setMsg(`Đã chốt thẻ ${CARDS.find(c => c.k === card)!.no}.`); reload()
  }
  const unchot = (card: KitCard) => write(kit, { checked: checked.filter(c => c !== card) }, {}, 'Đã bỏ chốt thẻ.')
  async function publish() {
    const ask = store === 'library' && row!.version > 0
    const note = ask ? prompt('Ghi chú cho bản cập nhật (trường đã dùng sẽ thấy):', '') : null
    if (note === null && ask) return
    setBusy('Đang phát hành…'); setMsg('')
    const r = await publishKit(orgId, row!, note, store)
    setBusy('')
    if (r.error) return setMsg(r.error)
    setMsg(`Đã phát hành ${store === 'training' ? T.noun : 'bộ học liệu'} (phiên bản ${r.version}).`); reload()
  }
  /** Áp dụng phần đọc được từ file vào các thẻ: thẻ được điền chuyển về "Cần kiểm tra" */
  async function apply(res: ParseResult, cards: KitCard[], docs: KDoc[] = []) {
    let next = mergeKit(kit, res.kit, cards)
    if (docs.length) next = { ...next, docs: [...next.docs.filter(d => !(docs.some(x => x.type === d.type) && (d.type === 'plan' || d.type === 'slides') && !d.item_id)), ...docs] }
    const all = new Set([...cards, ...(docs.length ? ['links' as KitCard] : [])])
    const cols: Partial<KitRow> = cards.includes('info') ? { ...(res.subject && !row!.subject ? { subject: res.subject } : {}), ...(res.grades ? { grades: res.grades } : {}) } : {}
    const patch: Partial<KitRow['content']> = { checked: checked.filter(c => !all.has(c)),
      ...(cards.includes('info') ? { periods: res.periods ?? row!.content.periods ?? null, objectives: next.info.reqs.join('\n') || row!.content.objectives || null } : {}) }
    return write(next, patch, cols, `Đã điền ${all.size} thẻ từ file. Rà lại từng thẻ rồi chốt.`)
  }
  async function upload(f: File, only?: KitCard) {
    setMsg(''); setBusy('Đang đọc ' + f.name + '…')
    try {
      if (only) {
        const rows = await readRows(f)
        const res = kitFromDraft(cardFromRows(only, rows), f.name)
        setBusy('')
        if (!res.touched.includes(only)) return setMsg(['Không đọc được dòng nào cho thẻ này.', ...res.kit.issues].join(' '))
        return apply(res, [only])
      }
      const { draft: d, res } = await parseFile(f)
      if (d.source === 'xlsx') { setBusy(''); return setCheck({ name: f.name, res, cards: res.touched }) }
      setBusy('Đang tải lên ' + f.name + '…')
      const doc = await fileDoc(orgId, f, d)
      setBusy('')
      await apply(res, res.touched, [doc])
    } catch (e) { setBusy(''); setMsg(e instanceof Error ? e.message : String(e)) }
  }
  const tplAll = () => downloadWorkbook(`Mau-giao-an-${row.title.slice(0, 40)}.xlsx`,
    templateSheets(row.title).map(s => ({ name: s.name, columns: s.header.map(h => ({ key: h, label: h, width: Math.max(14, h.length + 6) })), rows: s.rows })))
  const pick = (accept: string, label: string, on: (f: File) => void, cls = '') => (
    <label className={'filebtn ' + cls}>{label}<input type="file" hidden accept={accept} disabled={!!busy} onChange={e => { const f = e.target.files?.[0]; if (f) on(f); e.target.value = '' }} /></label>
  )
  const srcFiles = kit.docs.filter(d => d.type === 'plan' || d.type === 'slides')
  const card = CARDS.find(c => c.k === tab)!
  const on = checked.includes(tab)

  return (
    <Terms.Provider value={T}>
    <div className="lpage">
      <div className="lhead">
        <button type="button" className="ghostbtn" onClick={onBack}>{backLabel}</button>
        <div className="lheadrow">
          <div><h2>{row.title}</h2>
            <p className="sub">{[progLabel, progSubject, row.grades && `Khối ${row.grades}`, code].filter(Boolean).join(' · ')}</p></div>
          <button type="button" onClick={() => begin('info')}>{store === 'training' ? 'Sửa thông tin' : 'Sửa tên, môn'}</button>
        </div>
      </div>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      {busy && <p className="sub" role="status">{busy}</p>}
      {empty && !edit && <div className="ldash lempty-kit"><div><b>Giáo án đang trống</b>
        <small>Khung 5 thẻ đã sẵn sàng. Điền trực tiếp vào khung ở từng thẻ rồi bấm “Lưu”. Chốt thẻ khi nhập xong.</small></div>
        <button type="button" className="primary" onClick={() => begin('info')}>Bắt đầu nhập thẻ 01</button></div>}
      <div className="ldash">
        <button type="button" className="ldocbar" aria-expanded={docsOpen} onClick={() => setDocsOpen(!docsOpen)}><span aria-hidden="true">🗎</span> <b>Tài liệu</b> <span className="sub">· Xem trước và cập nhật</span></button>
        {docsOpen && <div className="ldocs">
          {srcFiles.length === 0 && <p className="sub">Bài chưa có tệp giáo án hay bài giảng gốc.</p>}
          {srcFiles.map(d => <div key={d.key} className="ldocrow"><span><b>{d.title}</b><small className="sub">{d.file?.file_name ?? d.file_name ?? d.url}{d.meta ? ' · ' + d.meta : ''}</small></span>
            {d.file ? <button type="button" className="linkbtn" onClick={() => openFile(d.file!.path)}>Mở tệp</button> : d.url ? <a className="linkbtn" href={d.url} target="_blank" rel="noreferrer">Mở liên kết</a> : <small className="sub">chưa đính kèm</small>}</div>)}
          <div className="tools">{pick('.docx,.pptx', 'Cập nhật từ giáo án Word / bài giảng PowerPoint', upload, 'primary')}
            <small className="sub">Đọc lại tệp và điền các thẻ có trong tệp; thẻ được điền chuyển về “Cần kiểm tra”.</small></div>
        </div>}
      </div>
      <div className="panel lquick"><b>Điền nhanh bằng file mẫu</b><span className="sub">Không có giáo án Word? Tải mẫu, điền rồi tải lên, hệ thống tự điền các thẻ.</span>
        <div className="tools"><button type="button" onClick={tplAll}>Tải mẫu cả giáo án (Excel)</button>{pick('.xlsx', 'Tải file lên', upload)}</div></div>

      <div className="lkithead"><h3>{store === 'training' ? 'Bài giảng' : 'Bộ học liệu'} · 5 thẻ</h3><span className="sub">{checked.length}/{CARDS.length} thẻ đã chốt</span></div>
      <div className="ltabs" role="tablist">
        {CARDS.map(c => <button key={c.k} type="button" role="tab" aria-selected={tab === c.k} className={(tab === c.k ? 'on' : '') + (checked.includes(c.k) ? ' done' : '')}
          onClick={() => { if (edit && edit !== c.k) return setMsg('Lưu hoặc hủy thẻ đang sửa trước.'); setTab(c.k) }}>
          <small>{c.no}</small> {c.title}{checked.includes(c.k) && <i aria-label="Đã chốt">✓</i>}</button>)}
      </div>
      {kit.issues.length > 0 && <div className="lwarn"><b>Hệ thống ghi nhận {kit.issues.length} điểm cần kiểm tra khi tách giáo án</b>
        <ul>{kit.issues.map((w, i) => <li key={i}>{w}</li>)}</ul>
        <button type="button" className="linkbtn" onClick={() => write({ ...kit, issues: [] }, {}, {}, 'Đã ẩn các điểm cần kiểm tra.')}>Đã kiểm tra, ẩn đi</button></div>}

      <section className="panel lcard" aria-label={card.title}>
        <header className="lcardhead">
          <span className="lno">{card.no}</span>
          <div><b>{card.title}</b><small className="sub">{card.desc}</small>
            <small className="lcsv"><button type="button" className="linkbtn" onClick={() => downloadText(`Mau-the-${card.no}-${row.title.slice(0, 30)}.csv`, cardCsv(tab, row.title))}>Tải mẫu CSV</button>
              {' · '}{pick('.csv,.xlsx', 'Tải CSV lên', f => upload(f, tab), 'linkbtn')}</small></div>
          <Chip tone={on ? 'good' : 'warn'}>{on ? 'Đã chốt' : 'Cần kiểm tra'}</Chip>
        </header>
        <div className="lcardbody">
          {tab === 'info' && (edit === 'info' && draft && fields
            ? <InfoEdit info={draft.info} set={info => setDraft({ ...draft, info })} f={fields} setF={setFields} programs={programs} subjectsOf={subjectsOf} />
            : <InfoView row={row} info={kit.info} progLabel={progLabel} progSubject={progSubject} />)}
          {tab === 'content' && (edit === 'content' && draft
            ? <SessionsEdit ss={draft.sessions} set={sessions => setDraft({ ...draft, sessions })} />
            : <SessionsView ss={k.sessions} />)}
          {tab === 'links' && (edit === 'links' && draft
            ? <DocsEdit docs={draft.docs} set={docs => setDraft({ ...draft, docs })} orgId={orgId} />
            : <DocsView docs={kit.docs} />)}
          {tab === 'norms' && (edit === 'norms' && draft
            ? <MatsEdit mats={draft.mats} set={mats => setDraft({ ...draft, mats })} cat={cat} />
            : <MatsView mats={kit.mats} cat={cat} />)}
          {tab === 'bank' && (edit === 'bank' && draft
            ? <BankEdit bank={draft.bank} set={bank => setDraft({ ...draft, bank })} acts={acts} places={actTitles(draft)} onSuggest={() => {
                const have = new Set(draft.bank.map(b => b.title.trim().toLowerCase()))
                const add = suggestBank(draft).filter(b => !have.has(b.title.toLowerCase()))
                setMsg(add.length ? `Đã gợi ý ${add.length} hoạt động từ nội dung thẻ 02. Rà lại rồi bấm “Lưu”.` : 'Không thấy gợi ý mới trong nội dung thẻ 02.')
                setDraft({ ...draft, bank: [...draft.bank, ...add] })
              }} />
            : <BankView bank={kit.bank} acts={acts} />)}
        </div>
        <footer className="lcardfoot">
          {edit === tab
            ? <><button type="button" onClick={cancel} disabled={!!busy}>Hủy</button><button type="button" className="primary" onClick={save} disabled={!!busy}>Lưu</button></>
            : <><button type="button" onClick={() => begin(tab)} disabled={!!busy || !!edit}>✎ Cập nhật</button>
              {on ? <button type="button" onClick={() => unchot(tab)} disabled={!!busy || !!edit}>Bỏ chốt</button>
                : <button type="button" className="primary" onClick={() => chot(tab)} disabled={!!busy || !!edit}>✓ Chốt nội dung</button>}</>}
        </footer>
      </section>

      <div className="panel lstatus">
        <div><b>Trạng thái {store === 'training' ? T.noun : 'bộ học liệu'}</b><small className="sub">Chỉ chốt khi đã kiểm tra nội dung từng thẻ. Có thể cập nhật lại sau khi chốt.</small></div>
        <Chip tone={STATUS[row.status][1]}>{STATUS[row.status][0]}{row.status === 'published' ? ` · v${row.version}` : ''}</Chip>
        <button type="button" className="primary" disabled={checked.length < CARDS.length || !!busy || !!edit} onClick={publish}
          title={checked.length < CARDS.length ? `Chốt đủ ${CARDS.length} thẻ để phát hành (đang ${checked.length}/${CARDS.length})` : undefined}>{row.status === 'published' ? 'Phát hành bản cập nhật' : store === 'training' ? 'Phát hành bài giảng' : 'Phát hành bộ học liệu'}</button>
      </div>

      {check && (() => {
        const c = kitCounts(check.res.kit)
        const rows: [KitCard, string, string][] = [['info', `Thẻ 01 · Thông tin ${T.noun}`, `${[check.res.title, check.res.subject, check.res.grades, check.res.periods, check.res.kit.info.reqs.length].filter(Boolean).length} mục thông tin`],
          ['content', `Thẻ 02 · Nội dung ${T.noun}`, `${c.sessions} buổi · ${c.acts} hoạt động · ${c.steps} bước`], ['links', 'Thẻ 03 · Link tài liệu', `${c.docs} tài liệu`],
          ['norms', 'Thẻ 04 · Định mức vật tư', `${c.supplies} nguyên vật liệu · ${c.tools} công cụ, thiết bị`], ['bank', 'Thẻ 05 · Kho hoạt động', `${c.bank} hoạt động`]]
        return <Modal title="Kiểm tra file" sub={check.name} onClose={() => setCheck(null)}
          foot={<><button type="button" onClick={() => setCheck(null)}>Hủy</button>
            <button type="button" className="primary" disabled={!check.cards.length || !!busy} onClick={async () => { if (await apply(check.res, check.cards)) setCheck(null) }}>Điền {check.cards.length} thẻ</button></>}>
          <div className="lcheck">{rows.map(([ck, l, n]) => <label key={ck}><span><input type="checkbox" disabled={!check.res.touched.includes(ck)} checked={check.cards.includes(ck)}
            onChange={e => setCheck({ ...check, cards: e.target.checked ? [...check.cards, ck] : check.cards.filter(x => x !== ck) })} /> <b>{l}</b></span><span className="distchip2 good">{n}</span></label>)}</div>
          {check.res.kit.issues.length > 0 && <ul className="lwarn">{check.res.kit.issues.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <p className="sub">Thẻ được điền sẽ chuyển về “Cần kiểm tra”.</p>
        </Modal>
      })()}
    </div>
    </Terms.Provider>
  )
}

// ===== Xem bộ học liệu 5 thẻ (chỉ đọc) — dùng ở chi tiết bài học trong Học liệu / Học liệu dùng chung =====
// extra: nội dung thêm cho từng thẻ (vd. giáo án, bài giảng, định mức gắn theo cách cũ)
export function KitView({ row, progLabel, extra }: { row: KitRow; progLabel: string; extra?: Partial<Record<KitCard, ReactNode>> }) {
  const [tab, setTab] = useState<KitCard>('info')
  const [cat, setCat] = useState<Cat[]>([])
  const [acts, setActs] = useState<BankAct[]>([])
  useEffect(() => { loadCatalog().then(setCat); loadActivities(row.owner_org_id).then(setActs) }, [row.id])
  const kit = useMemo(() => kitOf(row.content.kit), [row])
  const checked = row.content.checked ?? []
  const card = CARDS.find(c => c.k === tab)!
  const on = checked.includes(tab)
  return <div className="lkitview">
    <div className="lkithead"><h3>Bộ học liệu · 5 thẻ</h3><span className="sub">{checked.length}/{CARDS.length} thẻ đã chốt</span></div>
    <div className="ltabs" role="tablist">
      {CARDS.map(c => <button key={c.k} type="button" role="tab" aria-selected={tab === c.k} className={(tab === c.k ? 'on' : '') + (checked.includes(c.k) ? ' done' : '')}
        onClick={() => setTab(c.k)}><small>{c.no}</small> {c.title}{checked.includes(c.k) && <i aria-label="Đã chốt">✓</i>}</button>)}
    </div>
    <section className="panel lcard" aria-label={card.title}>
      <header className="lcardhead">
        <span className="lno">{card.no}</span>
        <div><b>{card.title}</b><small className="sub">{card.desc}</small></div>
        <Chip tone={on ? 'good' : 'warn'}>{on ? 'Đã chốt' : 'Chưa chốt'}</Chip>
      </header>
      <div className="lcardbody">
        {tab === 'info' && <InfoView row={row} info={{ ...kit.info, description: kit.info.description || ((row.content as { objectives?: string | null }).objectives ?? '') }}
          progLabel={progLabel} progSubject={kit.info.prog_subject || row.subject || ''} />}
        {tab === 'content' && <SessionsView ss={kit.sessions} />}
        {tab === 'links' && (kit.docs.length || !extra?.links ? <DocsView docs={kit.docs} /> : null)}
        {tab === 'norms' && (kit.mats.product.length || kit.mats.group.length || !extra?.norms ? <MatsView mats={kit.mats} cat={cat} /> : null)}
        {tab === 'bank' && <BankView bank={kit.bank} acts={acts} />}
        {extra?.[tab]}
      </div>
    </section>
  </div>
}

// ===== Thẻ 01 =====
const whoText = (w: Who) => [w.date || (w.dates.length === 1 ? w.dates[0] : ''), w.by].filter(Boolean).join(' · ')
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return <div className="lpair"><span>{label}</span><div>{children}</div></div>
}
const Bullets = ({ xs }: { xs: string[] }) => <ul className="lbul">{xs.map((x, i) => <li key={i}>{x}</li>)}</ul>
function InfoView({ row, info, progLabel, progSubject }: { row: KitRow; info: KInfo; progLabel: string; progSubject: string }) {
  const T = useContext(Terms)
  const W = (w: Who, ph: string) => {
    const t = whoText(w)
    return <>{t || <Empty>{ph}</Empty>}{w.dates.length > 1 && !w.date && <> <Chip tone="warn">Cần chọn ngày</Chip> <small className="sub">({w.dates.join(' · ')})</small></>}</>
  }
  return <div className="lpairs">
    <Pair label={T.program}>{progLabel || <Empty>Chưa gắn chương trình</Empty>}</Pair>
    <Pair label={T.progSubject}>{progSubject || <Empty>Chưa chọn</Empty>}</Pair>
    <Pair label={'Tên ' + T.noun}><b>{row.title}</b></Pair>
    <Pair label="Môn">{row.subject || <Empty>Chưa nhập</Empty>}</Pair>
    <Pair label="Khối">{row.grades || <Empty>Chưa nhập</Empty>}</Pair>
    <Pair label="Thời lượng">{row.content.periods ? `${row.content.periods} ${T.per}` : <Empty>Chưa nhập</Empty>}</Pair>
    <Pair label={'Mô tả ' + T.noun}>{info.description || <Empty>Chưa có mô tả</Empty>}</Pair>
    <Pair label="Môn học chủ đạo">{info.main.name || info.main.reqs.length ? <><b>{info.main.name}</b><Bullets xs={info.main.reqs} /></> : <Empty>Chưa nhập</Empty>}</Pair>
    <Pair label="Môn học tích hợp">{info.integrated.length ? info.integrated.map((s, i) => <div key={i}><b>{s.name}</b><Bullets xs={s.reqs} /></div>) : <Empty>Không có</Empty>}</Pair>
    <Pair label="Yêu cầu cần đạt">{info.reqs.length ? <Bullets xs={info.reqs} /> : <Empty>Chưa nhập</Empty>}</Pair>
    <Pair label="Được soạn">{W(info.authored, 'Ngày soạn · người soạn')}</Pair>
    <Pair label="Được review">{W(info.reviewed, 'Ngày review · người review')}</Pair>
    <Pair label="Được hiệu chỉnh">{W(info.revised, 'Ngày hiệu chỉnh · người hiệu chỉnh')}</Pair>
  </div>
}
function WhoEdit({ label, w, set }: { label: string; w: Who; set: (w: Who) => void }) {
  return <div className="lgrid2">
    <label className="field"><span>{label} ngày</span>
      {w.dates.length > 1
        ? <select value={w.date} onChange={e => set({ ...w, date: e.target.value })}><option value="">— Chọn ngày đúng —</option>{w.dates.map(d => <option key={d}>{d}</option>)}</select>
        : <input value={w.date || w.dates[0] || ''} placeholder="dd/mm/yyyy" onChange={e => set({ ...w, date: e.target.value, dates: [] })} />}</label>
    <label className="field"><span>Bởi</span><input value={w.by} placeholder="Họ tên, cách nhau dấu phẩy" onChange={e => set({ ...w, by: e.target.value })} /></label>
  </div>
}
function Area({ label, value, set, rows = 3, ph, hint }: { label: string; value: string; set: (v: string) => void; rows?: number; ph?: string; hint?: string }) {
  return <label className="field"><span>{label}</span><textarea rows={rows} value={value} placeholder={ph} onChange={e => set(e.target.value)} />{hint && <small className="sub">{hint}</small>}</label>
}
function InfoEdit({ info, set, f, setF, programs, subjectsOf }: {
  info: KInfo; set: (i: KInfo) => void; f: Fields; setF: (f: Fields) => void; programs: ProgRef[]; subjectsOf: (pid: string) => string[]
}) {
  const T = useContext(Terms)
  const subs = f.program_id ? subjectsOf(f.program_id) : []
  const own = T.catalogDocs ? subs : []
  // Ô nhiều dòng giữ nguyên chữ đang gõ (kể cả dòng trống); chỉ tách thành danh sách khi lưu
  const [txt, setTxt] = useState({ main: info.main.reqs.join('\n'), integ: subjBlocks(info.integrated), reqs: info.reqs.join('\n') })
  const upd = (t: typeof txt) => { setTxt(t); set({ ...info, main: { ...info.main, reqs: toLines(t.main) }, integrated: fromBlocks(t.integ), reqs: toLines(t.reqs) }) }
  return <div className="lform">
    <label className="field"><span>{cap('tên ' + T.noun)}</span><input autoFocus value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
    <div className="field"><span>Môn</span><SubjectPicker value={f.subject} onChange={v => setF({ ...f, subject: v })} extra={own} emptyLabel="— Chọn môn —" /></div>
    <div className="field"><span>Khối</span><GradeChecks value={gradeList(f.grades)} onChange={g => setF({ ...f, grades: [...g].sort((a, b) => a - b).join(',') })} placeholder="Tick chọn khối…" /></div>
    <label className="field"><span>Thời lượng</span><input value={f.periods} onChange={e => setF({ ...f, periods: e.target.value })} placeholder={`Ví dụ: 2 ${T.per}`} /></label>
    <div className="field"><span>{T.program}</span>
      <MultiSelect value={f.program_id ? [f.program_id] : []} placeholder="— Không gắn — (gõ để tìm)" ariaLabel="Chương trình" empty="Chưa có chương trình."
        options={programs.map(p => [p.id, (p.code ? p.code + ' · ' : '') + p.title] as [string, string])}
        onChange={v => { const pid = v[v.length - 1] ?? ''; setF({ ...f, program_id: pid, prog_subject: pid === f.program_id ? f.prog_subject : subjectsOf(pid)[0] ?? '' }) }} /></div>
 <div className="field"><span>{T.progSubject}</span>
      <MultiSelect value={f.prog_subject ? [f.prog_subject] : []} placeholder={f.program_id ? 'Chọn…' : 'Chọn chương trình trước'} ariaLabel={T.progSubject}
        disabled={!f.program_id} empty={T.catalogDocs ? 'Chương trình chưa có môn.' : 'Chương trình chưa có nội dung.'} options={subs.map(s => [s, s] as [string, string])}
        onChange={v => setF({ ...f, prog_subject: v[v.length - 1] ?? '' })} /></div>
    <Area label={cap('mô tả ' + T.noun)} value={info.description} set={v => set({ ...info, description: v })} />
    <div className="field"><span>Môn học chủ đạo</span><SubjectPicker value={info.main.name} onChange={v => set({ ...info, main: { ...info.main, name: v } })} extra={own} ariaLabel="Môn học chủ đạo" /></div>
    <Area label="Yêu cầu của môn chủ đạo (mỗi dòng một yêu cầu)" value={txt.main} set={v => upd({ ...txt, main: v })} ph={'Nêu được vị trí trong không gian\nVận dụng được vào thiết kế mô hình'} />
    <Area label="Môn học tích hợp" rows={5} value={txt.integ} set={v => upd({ ...txt, integ: v })} ph={'Khoa học\nNêu được tác dụng của đèn hiệu\n\nCông nghệ\nChế tạo được mô hình'}
      hint="Mỗi môn một khối: dòng đầu là tên môn, các dòng sau là yêu cầu. Các môn cách nhau một dòng trống." />
    <Area label="Yêu cầu cần đạt (mỗi dòng một yêu cầu)" rows={4} value={txt.reqs} set={v => upd({ ...txt, reqs: v })} ph={'Nêu được …\nThực hiện được …'} />
    <WhoEdit label="Được soạn" w={info.authored} set={w => set({ ...info, authored: w })} />
    <WhoEdit label="Được review" w={info.reviewed} set={w => set({ ...info, reviewed: w })} />
    <WhoEdit label="Được hiệu chỉnh" w={info.revised} set={w => set({ ...info, revised: w })} />
  </div>
}

// ===== Thẻ 02 =====
function SessionsView({ ss }: { ss: KSession[] }) {
  if (!ss.length) return <Empty>Chưa có buổi học nào. Bấm “Cập nhật” để thêm buổi, hoạt động và các bước.</Empty>
  return <div className="lsess">{ss.map((s, si) => (
    <details key={si} open={si === 0} className="lses">
      <summary><b>Buổi {si + 1}</b> · {sessionMinutes(s)} phút · {s.acts.length} hoạt động</summary>
      {s.note && <p className="sub pre">{s.note}</p>}
      {s.acts.map((a, ai) => <div key={ai} className="lact">
        <div className="lacthead"><b>{a.title || <Empty>Hoạt động chưa đặt tên</Empty>}</b>{a.minutes != null && <span className="lmin">{a.minutes} phút</span>}</div>
        {a.general && <p className="pre">{a.general}</p>}
        {a.steps.map((st, ti) => <div key={ti} className="lstep"><b>{st.title}</b><Bullets xs={st.lines} /></div>)}
      </div>)}
    </details>))}</div>
}
function SessionsEdit({ ss, set }: { ss: KSession[]; set: (s: KSession[]) => void }) {
  const at = (si: number, s: KSession) => set(ss.map((x, i) => (i === si ? s : x)))
  return <div className="lsess">
    {ss.map((s, si) => <div key={si} className="lses edit">
      <div className="lacthead"><b>Buổi {si + 1}</b><button type="button" className="linkbtn danger" onClick={() => set(ss.filter((_, i) => i !== si))}>Xóa buổi</button></div>
      <Area label="Ghi chú của buổi" rows={2} value={s.note} set={note => at(si, { ...s, note })} />
      {s.acts.map((a, ai) => {
        const setA = (na: typeof a) => at(si, { ...s, acts: s.acts.map((x, i) => (i === ai ? na : x)) })
        return <div key={ai} className="lact edit">
          <div className="lactrow">
            <input aria-label="Tên hoạt động" placeholder="Tên hoạt động, ví dụ: Hoạt động 1: Xác định vấn đề" value={a.title} onChange={e => setA({ ...a, title: e.target.value })} />
            <input aria-label="Phút" type="number" min={0} placeholder="Phút" value={a.minutes ?? ''} onChange={e => setA({ ...a, minutes: e.target.value === '' ? null : Number(e.target.value) })} />
            <button type="button" className="linkbtn danger" onClick={() => at(si, { ...s, acts: s.acts.filter((_, i) => i !== ai) })}>Xóa</button>
          </div>
          <Area label="Nội dung chung" rows={2} value={a.general} set={general => setA({ ...a, general })} />
          {a.steps.map((st, ti) => <div key={ti} className="lstep edit">
            <div className="lactrow"><input aria-label="Tên bước" placeholder="Tên bước, ví dụ: Khởi động" value={st.title}
              onChange={e => setA({ ...a, steps: a.steps.map((x, i) => (i === ti ? { ...x, title: e.target.value } : x)) })} />
              <button type="button" className="linkbtn danger" onClick={() => setA({ ...a, steps: a.steps.filter((_, i) => i !== ti) })}>Xóa</button></div>
            <StepLines lines={st.lines} set={lines => setA({ ...a, steps: a.steps.map((x, i) => (i === ti ? { ...x, lines } : x)) })} />
          </div>)}
          <button type="button" className="linkbtn" onClick={() => setA({ ...a, steps: [...a.steps, { title: '', lines: [] }] })}>+ Thêm bước</button>
        </div>
      })}
      <button type="button" onClick={() => at(si, { ...s, acts: [...s.acts, { title: '', minutes: null, general: '', steps: [] }] })}>+ Thêm hoạt động</button>
    </div>)}
    <button type="button" onClick={() => set([...ss, { note: '', acts: [{ title: '', minutes: null, general: '', steps: [] }] }])}>+ Thêm buổi</button>
  </div>
}
function StepLines({ lines, set }: { lines: string[]; set: (l: string[]) => void }) {
  const [t, setT] = useState(lines.join('\n'))
  return <textarea rows={Math.min(8, Math.max(2, lines.length + 1))} aria-label="Các ý của bước (mỗi dòng một ý)" placeholder="Mỗi dòng một ý" value={t}
    onChange={e => { setT(e.target.value); set(toLines(e.target.value)) }} />
}

// ===== Thẻ 03 =====
export function useColsLocal(store: string, all: [string, string][]) {
  const [off, setOff] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(store) ?? '[]') } catch { return [] } })
  const has = (k: string) => !off.includes(k)
  const menu = <details className="distmore distcols"><summary>⚙ Thiết lập cột</summary><div className="distmenu">
    {all.map(([k, l]) => <label key={k}><input type="checkbox" checked={has(k)} onChange={e => { const n = e.target.checked ? off.filter(x => x !== k) : [...off, k]; setOff(n); try { localStorage.setItem(store, JSON.stringify(n)) } catch { /* bỏ qua */ } }} /> {l}</label>)}</div></details>
  return { has, menu }
}
function DocsView({ docs }: { docs: KDoc[] }) {
  const T = useContext(Terms)
  const cols = useColsLocal('lib.docs.cols', [['type', 'Loại'], ['link', 'Liên kết / tệp'], ...(T.catalogDocs ? [['cat', 'Học liệu trong danh mục'] as [string, string]] : [])])
  const { menu } = cols, has = (k: string) => (k !== 'cat' || T.catalogDocs) && cols.has(k)
  if (!docs.length) return <Empty>Chưa có tài liệu nào. Bấm “Cập nhật” để thêm phiếu học tập, video, đường dẫn…</Empty>
  return <>
    <div className="selbar"><span /><div className="tools">{menu}</div></div>
    <div className="wrap"><table className="libtable"><thead><tr><th>Tên</th>{has('type') && <th>Loại</th>}{has('link') && <th>Liên kết / tệp</th>}{has('cat') && <th>Học liệu trong danh mục</th>}</tr></thead>
      <tbody>{docs.map(d => <tr key={d.key}>
        <td><b>{d.title}</b></td>
        {has('type') && <td>{DOC_TYPE[d.type] ?? d.type}</td>}
        {has('link') && <td>{d.file ? <><button type="button" className="linkbtn" onClick={() => openFile(d.file!.path)}>{d.file.file_name}</button>{d.meta && <><br /><small className="sub">{d.meta}</small></>}</>
          : d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="linkbtn">Mở liên kết</a>
          : d.file_name ? <><span>{d.file_name}</span><br /><small className="sub">{[d.meta, d.size && fmtSize(d.size), 'chưa đính kèm (quá giới hạn tải lên)'].filter(Boolean).join(' · ')}</small></> : <Empty>—</Empty>}
          {d.outline && d.outline.length > 0 && <details className="loutline"><summary>Xem dàn ý</summary><ol>{d.outline.map((o, i) => <li key={i}>{o}</li>)}</ol></details>}</td>}
        {has('cat') && <td>{d.item_id ? <Chip tone="good">Đã tạo</Chip> : <small className="sub">Chưa tạo (tạo khi chốt)</small>}</td>}
      </tr>)}</tbody></table></div>
  </>
}
function DocsEdit({ docs, set, orgId }: { docs: KDoc[]; set: (d: KDoc[]) => void; orgId: string }) {
  const T = useContext(Terms)
  const [up, setUp] = useState('')
  const at = (i: number, d: KDoc) => set(docs.map((x, j) => (j === i ? d : x)))
  async function attach(i: number, f: File) {
    setUp(f.name)
    try { const r = await uploadLearningFile(orgId, 'hoc-lieu', f); at(i, { ...docs[i], file: { path: r.path, file_name: r.name, size: r.size, mime: r.mime }, title: docs[i].title || f.name.replace(/\.[^.]+$/, ''), file_name: undefined }) }
    catch (e) { alert(e instanceof Error ? e.message : String(e)) }
    setUp('')
  }
  return <div className="lrows">
    {docs.map((d, i) => <div key={d.key} className="lrow docs">
      <input aria-label="Tên tài liệu" placeholder="Tên tài liệu" value={d.title} onChange={e => at(i, { ...d, title: e.target.value })} />
      <select aria-label="Loại" value={d.type} onChange={e => at(i, { ...d, type: e.target.value })}>{Object.entries(DOC_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      {d.file ? <span className="lfilechip">{d.file.file_name} <button type="button" className="linkbtn" onClick={() => at(i, { ...d, file: null })}>bỏ tệp</button></span>
        : <span className="lurl"><input aria-label="Đường dẫn" placeholder="https://…" value={d.url} onChange={e => at(i, { ...d, url: e.target.value })} />
          <label className="linkbtn">{up ? 'Đang tải…' : 'Tải tệp'}<input type="file" hidden disabled={!!up} onChange={e => { const f = e.target.files?.[0]; if (f) attach(i, f); e.target.value = '' }} /></label></span>}
      {T.catalogDocs ? <small className="sub">{d.item_id ? 'Đã có trong danh mục' : 'Tự tạo khi chốt'}</small> : <span />}
      <button type="button" className="linkbtn danger" onClick={() => set(docs.filter((_, j) => j !== i))}>Xóa</button>
    </div>)}
    <button type="button" onClick={() => set([...docs, { key: key(), title: '', type: 'worksheet', url: '', file: null, item_id: null }])}>+ Thêm dòng</button>
  </div>
}

// ===== Thẻ 04 =====
type Cat = { id: string; name: string; unit: string; kind: KMat['kind'] }
const catOf = (m: KMat, cat: Cat[]) => cat.find(c => c.id === m.catalog_id) ?? cat.find(c => normText(c.name) === normText(m.name))
function MatTable({ title, rows, cat }: { title: string; rows: KMat[]; cat: Cat[] }) {
  return <div className="lmat"><h4>{title}</h4>
    {rows.length === 0 ? <Empty>Chưa có dòng nào.</Empty> : <div className="wrap"><table className="libtable"><thead><tr><th>Tên</th><th>Đơn vị</th><th>Số lượng</th><th>Học liệu trong danh mục</th></tr></thead>
      <tbody>{rows.map(m => <tr key={m.key}><td><b>{m.name}</b></td><td>{m.unit}</td><td>{m.qty}</td>
        <td>{catOf(m, cat) ? <Chip tone="good">Đã có trong danh mục</Chip> : <small className="sub">Chưa tạo (tạo khi chốt)</small>}</td></tr>)}</tbody></table></div>}
  </div>
}
function MatsView({ mats, cat }: { mats: KitData['mats']; cat: Cat[] }) {
  return <><MatTable title="Nguyên vật liệu cho một sản phẩm" rows={mats.product} cat={cat} /><MatTable title="Công cụ và thiết bị cho một nhóm" rows={mats.group} cat={cat} /></>
}
function MatRows({ title, rows, set, cat, kind }: { title: string; rows: KMat[]; set: (r: KMat[]) => void; cat: Cat[]; kind: KMat['kind'] }) {
  const settings = useSettings()
  const at = (i: number, m: KMat) => set(rows.map((x, j) => (j === i ? m : x)))
  const list = 'cat-' + kind
  const opts = cat.filter(c => (kind === 'supply' ? c.kind === 'supply' : c.kind !== 'supply'))
  return <div className="lmat"><h4>{title}</h4>
    <datalist id={list}>{opts.map(c => <option key={c.id} value={c.name} />)}</datalist>
    <datalist id="mat-units">{catalogOf(settings, 'units', UNITS).map(u => <option key={u} value={u} />)}</datalist>
    <div className="lrows">
      {rows.map((m, i) => <div key={m.key} className="lrow mats">
        <input aria-label="Tên" list={list} placeholder="– Chọn hoặc gõ tên –" value={m.name} onChange={e => {
          const c = opts.find(x => normText(x.name) === normText(e.target.value))
          at(i, { ...m, name: e.target.value, catalog_id: c?.id ?? null, unit: c && !m.unit ? c.unit : m.unit, kind: c?.kind ?? m.kind })
        }} />
        <input aria-label="Đơn vị" list="mat-units" placeholder="– Đơn vị –" value={m.unit} onChange={e => at(i, { ...m, unit: e.target.value })} />
        <input aria-label="Số lượng" inputMode="decimal" placeholder="0" value={m.qty} onChange={e => at(i, { ...m, qty: e.target.value })} />
        <small className="sub">{catOf(m, cat) ? 'Đã có trong danh mục' : 'Tự tạo khi chốt'}</small>
        <button type="button" className="linkbtn danger" onClick={() => set(rows.filter((_, j) => j !== i))}>Xóa</button>
      </div>)}
      <button type="button" onClick={() => set([...rows, { key: key(), catalog_id: null, name: '', unit: '', qty: '', kind, reusable: kind !== 'supply' }])}>+ Thêm dòng</button>
    </div></div>
}
function MatsEdit({ mats, set, cat }: { mats: KitData['mats']; set: (m: KitData['mats']) => void; cat: Cat[] }) {
  return <>
    <MatRows title="Nguyên vật liệu cho một sản phẩm" rows={mats.product} set={product => set({ ...mats, product })} cat={cat} kind="supply" />
    <MatRows title="Công cụ và thiết bị cho một nhóm" rows={mats.group} set={group => set({ ...mats, group })} cat={cat} kind="tool" />
  </>
}

// ===== Thẻ 05 =====
const actOf = (b: KBank, acts: BankAct[]) => acts.find(a => a.id === b.activity_id)
function BankView({ bank, acts }: { bank: KBank[]; acts: BankAct[] }) {
  if (!bank.length) return <Empty>Chưa có hoạt động nào. Bấm “Cập nhật” để chọn hoạt động từ Kho hoạt động hoặc ghi hoạt động cần có. Bài không dùng hoạt động tương tác thì chốt luôn thẻ này.</Empty>
  return <div className="wrap"><table className="libtable"><thead><tr><th>Hoạt động</th><th>Loại</th><th>Dùng ở</th><th>Ghi chú</th><th>Trong Kho hoạt động</th></tr></thead>
    <tbody>{bank.map(b => { const a = actOf(b, acts); return <tr key={b.key}>
      <td><b>{b.title}</b></td><td>{ACT_LABEL[b.kind] ?? b.kind}</td><td>{b.act || <Empty>Cả bài</Empty>}</td><td>{b.note || <Empty>—</Empty>}</td>
      <td>{a ? <Chip tone="good">{a.status === 'published' ? 'Đã có · đã xuất bản' : a.is_template ? 'Đã có · bản mẫu' : 'Đã có · nháp'}</Chip>
        : b.activity_id ? <small className="sub">Không còn trong kho</small> : <small className="sub">Chưa tạo (tạo khi chốt)</small>}</td>
    </tr> })}</tbody></table></div>
}
function BankEdit({ bank, set, acts, places, onSuggest }: { bank: KBank[]; set: (b: KBank[]) => void; acts: BankAct[]; places: string[]; onSuggest: () => void }) {
  const at = (i: number, b: KBank) => set(bank.map((x, j) => (j === i ? b : x)))
  const label = (a: BankAct) => `${a.title} · ${ACT_LABEL[a.kind] ?? a.kind}`
  return <div className="lrows">
    <datalist id="bank-acts">{acts.map(a => <option key={a.id} value={label(a)} />)}</datalist>
    <datalist id="bank-places">{places.map(p => <option key={p} value={p} />)}</datalist>
    <p className="sub">Gõ để chọn hoạt động có sẵn trong Kho hoạt động, hoặc đặt tên mới và chọn loại: khi chốt thẻ, hệ thống tạo bản mẫu trong kho để giáo viên soạn tiếp câu hỏi.</p>
    {bank.map((b, i) => { const a = actOf(b, acts); return <div key={b.key} className="lrow bank">
      <input aria-label="Tên hoạt động" list="bank-acts" placeholder="– Chọn trong kho hoặc gõ tên mới –" value={b.title} onChange={e => {
        const v = e.target.value, hit = acts.find(x => label(x) === v || normText(x.title) === normText(v))
        at(i, hit ? { ...b, title: hit.title, kind: hit.kind, activity_id: hit.id } : { ...b, title: v, activity_id: a && normText(a.title) === normText(v) ? b.activity_id : null })
      }} />
      <select aria-label="Loại" value={b.kind} disabled={!!a} onChange={e => at(i, { ...b, kind: e.target.value })}>{Object.entries(ACT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <input aria-label="Dùng ở hoạt động" list="bank-places" placeholder="Dùng ở hoạt động…" value={b.act} onChange={e => at(i, { ...b, act: e.target.value })} />
      <input aria-label="Ghi chú" placeholder="Ghi chú" value={b.note} onChange={e => at(i, { ...b, note: e.target.value })} />
      <small className="sub">{a ? 'Đã có trong kho' : 'Tự tạo khi chốt'}</small>
      <button type="button" className="linkbtn danger" onClick={() => set(bank.filter((_, j) => j !== i))}>Xóa</button>
    </div> })}
    <div className="tools">
      <button type="button" onClick={() => set([...bank, { key: key(), activity_id: null, title: '', kind: 'quiz', act: '', note: '' }])}>+ Thêm dòng</button>
      <button type="button" onClick={onSuggest} disabled={!places.length} title={places.length ? undefined : 'Thẻ 02 chưa có hoạt động'}>Gợi ý từ nội dung bài</button>
    </div>
  </div>
}
