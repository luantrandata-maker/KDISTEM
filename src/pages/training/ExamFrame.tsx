// Chương trình tập huấn › Đề kiểm tra và Khung đánh giá (109).
// Đề kiểm tra: bài test từng nội dung (soạn trong nội dung) + đề cuối khoá rút câu theo ma trận chủ đề × mức độ.
// Khung đánh giá: trọng số thành phần, điều kiện bắt buộc để đạt, thang xếp loại; dùng khi đánh giá kết quả và in chứng chỉ.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ExamMatrix, cleanMatrix, listGrades, listSubjects, matrixText, matrixTotal, useBankSubjects, type MRow } from '../../components/ExamMatrix'
import { MultiSelect } from '../../components/MultiSelect'
import { GradeMulti } from '../../components/Pickers'
import type { Detail } from './Content'
import { TryButton, type TrySpec } from '../../components/ExamTryout'

export type FinalExam = { title?: string; subject?: string; grade?: number | null; subjects?: string[]; grades?: number[]; matrix?: MRow[]; qids?: string[]; minutes?: number | null; attempts?: number | null; pass?: number | null; shuffle?: boolean }
const finalSpec = (x: FinalExam): TrySpec => ({ kind: 'pick', subjects: listSubjects(x), grades: listGrades(x), matrix: cleanMatrix(x.matrix ?? []), qids: x.qids ?? [], shuffle: x.shuffle !== false })
export type Frame = {
  weights: { att: number; tests: number; final: number; product: number }
  req: { att: number | null; tests: boolean; units: boolean; final: number | null; product: number | null; total: number | null }
  grades: { label: string; min: number }[]; fail_label: string
}
type Unit = { id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; has_test: boolean; detail: Detail }
type Prog = { id: string; org_id: string; pass_attendance: number; pass_score: number | null; need_product: boolean; final_exam?: FinalExam | null; eval_frame?: Frame | null }

const num = (n: number | null | undefined) => n == null ? '—' : String(n).replace('.', ',')
const nOrNull = (v: string) => v.trim() === '' ? null : Number(v.replace(',', '.'))
export const defaultFrame = (p: Pick<Prog, 'pass_attendance' | 'need_product'>): Frame => ({
  weights: { att: 20, tests: 30, final: 30, product: 20 },
  req: { att: p.pass_attendance, tests: true, units: true, final: null, product: p.need_product ? 5 : null, total: null },
  grades: [{ label: 'Xuất sắc', min: 9 }, { label: 'Giỏi', min: 8 }, { label: 'Khá', min: 6.5 }, { label: 'Đạt', min: 5 }], fail_label: 'Chưa đạt',
})

type Save = (patch: Record<string, unknown>, ok: string) => Promise<boolean>

// ===== Đề kiểm tra =====
export function ProgramExams({ p, units, edit, onOpen, save, autoStart }: { p: Prog; units: Unit[]; edit: boolean; onOpen: (unitId: string) => void; save: Save; autoStart?: boolean }) {
  const subjects = useBankSubjects(p.org_id)
  const fe = p.final_exam ?? null
  const [f, setF] = useState<FinalExam | null>(null)
  const tests = units.filter(u => u.kind === 'content' && u.has_test).sort((a, b) => (units.find(x => x.id === a.parent_id)?.seq ?? 0) - (units.find(x => x.id === b.parent_id)?.seq ?? 0) || a.seq - b.seq)
  const startEdit = () => setF(fe ? { ...fe, subjects: listSubjects(fe), grades: listGrades(fe), matrix: [...(fe.matrix ?? [])] } : { title: '', subjects: subjects[0] ? [subjects[0].subject] : [], grades: [], matrix: [], minutes: 30, attempts: 2, pass: 5, shuffle: true })
  // Mở từ "+ Thêm đề kiểm tra": vào thẳng form đề cuối khoá (một lần)
  const [auto, setAuto] = useState(!!autoStart)
  useEffect(() => { if (auto && edit) { setAuto(false); if (!f) startEdit() } }, [auto, edit])
  const total = f ? matrixTotal(f.matrix ?? []) + (f.qids?.length ?? 0) : 0
  async function saveFinal() {
    if (!f) return
    const subs = listSubjects(f), grs = listGrades(f)
    if (!subs.length) return alert('Chọn môn của đề.')
    if (total < 1) return alert('Ma trận cần ít nhất 1 câu.')
    const clean: FinalExam = { ...f, title: f.title?.trim() || undefined, subjects: subs, grades: grs, subject: subs[0], grade: grs[0] ?? null,
      matrix: cleanMatrix(f.matrix ?? []).map(r => (r.subject && !subs.includes(r.subject) ? { ...r, subject: undefined } : r)) }
    if (await save({ final_exam: clean }, 'Đã lưu đề cuối khoá.')) setF(null)
  }

  return <section className="panel" style={{ display: 'grid', gap: 14 }}>
    <div><h3 style={{ margin: 0 }}>Bài test theo nội dung</h3>
      <p className="sub" style={{ margin: '4px 0 0' }}>Mỗi nội dung có bài test riêng (chọn câu từ ngân hàng hoặc làm qua link). Bấm "Mở" để soạn ở phần Bài kiểm tra của nội dung.</p></div>
    <div className="wrap"><table>
      <thead><tr><th>Nội dung</th><th>Hình thức</th><th className="num">Số câu</th><th className="num">Phút</th><th className="num">Lượt</th><th className="num">Điểm đạt</th><th></th></tr></thead>
      <tbody>{tests.map(u => { const t = u.detail?.test as Record<string, unknown> | undefined; const link = t?.kind === 'link'
        const nq = Array.isArray(t?.qids) ? (t!.qids as string[]).length : 0
        return <tr key={u.id}><td><b>{u.title}</b><br /><small className="sub">{units.find(x => x.id === u.parent_id)?.title}</small></td>
          <td>{link ? 'Qua link' : 'Ngân hàng câu hỏi'}</td>
          <td className="num">{link ? '—' : nq ? `${t?.count ?? nq}/${nq}` : <small className="warnline">chưa chọn</small>}</td>
          <td className="num">{link ? '—' : num(t?.minutes as number ?? null)}</td><td className="num">{link ? '—' : t?.attempts ? String(t.attempts) : 'Không giới hạn'}</td>
          <td className="num">{num((t?.pass as number) ?? p.pass_score ?? 5)}</td>
          <td><span className="tools">{!link && nq > 0 && <TryButton orgId={p.org_id} spec={{ kind: 'sample', qids: t!.qids as string[], count: (t?.count as number) ?? null }} title={`Bài test: ${u.title}`}
            minutes={(t?.minutes as number) ?? null} pass={(t?.pass as number) ?? p.pass_score ?? 5} />}<button type="button" onClick={() => onOpen(u.id)}>Mở</button></span></td></tr> })}
        {!tests.length && <tr><td colSpan={7}><small className="sub">Chưa nội dung nào có bài test. Bật "Có bài test" ở nội dung trong tab Cấu trúc.</small></td></tr>}</tbody>
    </table></div>

    <div className="bar" style={{ margin: '8px 0 0' }}><div><h3 style={{ margin: 0 }}>Đề cuối khoá</h3>
      <p className="sub" style={{ margin: '4px 0 0' }}>Rút ngẫu nhiên từ Ngân hàng câu hỏi theo ma trận chủ đề × mức độ. Giáo viên làm sau khi học xong mọi nội dung của chương trình.</p></div>
      {!f && fe && !edit && <TryButton orgId={p.org_id} spec={finalSpec(fe)} title={fe.title || 'Đề cuối khoá'} minutes={fe.minutes} pass={fe.pass} />}
      {edit && !f && <div className="tools">{fe ? <><TryButton orgId={p.org_id} spec={finalSpec(fe)} title={fe.title || 'Đề cuối khoá'} minutes={fe.minutes} pass={fe.pass} /><button type="button" onClick={startEdit}>Sửa đề</button>
        <button type="button" className="danger" onClick={() => confirm('Bỏ đề cuối khoá của chương trình?') && save({ final_exam: null }, 'Đã bỏ đề cuối khoá.')}>Bỏ đề</button></>
        : <button type="button" className="primary" onClick={startEdit}>+ Thêm đề cuối khoá</button>}</div>}</div>

    {f ? <div style={{ display: 'grid', gap: 12 }}>
      <div className="formgrid">
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên đề</span><input maxLength={200} value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Để trống = Đề cuối khoá · tên chương trình" /></label>
        <div className="field" style={{ gridColumn: 'span 2' }}><span>Môn (ngân hàng câu hỏi, chọn được nhiều) *</span>
          <MultiSelect value={listSubjects(f)} onChange={v => setF({ ...f, subjects: v, subject: v[0] })} ariaLabel="Môn của đề" placeholder="— Chọn môn —"
            options={[...subjects.map(s => [s.subject, `${s.subject} (${s.n} câu)`] as [string, string]), ...listSubjects(f).filter(x => !subjects.some(s => s.subject === x)).map(x => [x, x] as [string, string])]} empty="Ngân hàng chưa có câu hỏi." /></div>
        <div className="field"><span>Khối (chọn được nhiều)</span><GradeMulti value={listGrades(f)} onChange={v => setF({ ...f, grades: v, grade: v[0] ?? null })} /></div>
        <label className="field"><span>Thời gian (phút)</span><input type="number" min={1} max={300} value={f.minutes ?? ''} placeholder="Không giới hạn" onChange={e => setF({ ...f, minutes: nOrNull(e.target.value) })} /></label>
        <label className="field"><span>Số lượt làm</span><input type="number" min={0} max={50} value={f.attempts ?? 0} onChange={e => setF({ ...f, attempts: Number(e.target.value) || 0 })} /><small className="sub">0 = không giới hạn</small></label>
        <label className="field"><span>Điểm đạt (thang 10)</span><input type="number" min={0} max={10} step={0.5} value={f.pass ?? ''} placeholder="Không xét" onChange={e => setF({ ...f, pass: nOrNull(e.target.value) })} /></label>
        <div className="field"><span>Trộn câu</span><label><input type="checkbox" checked={f.shuffle !== false} onChange={e => setF({ ...f, shuffle: e.target.checked })} /> Trộn thứ tự câu mỗi lượt</label></div>
      </div>
      <ExamMatrix org={p.org_id} subjects={listSubjects(f)} grades={listGrades(f)} rows={f.matrix ?? []} onChange={m => setF({ ...f, matrix: m })} />
      <div className="formactions"><button type="button" className="primary" onClick={saveFinal}>Lưu đề ({total} câu)</button> <TryButton orgId={p.org_id} spec={finalSpec(f)} title={f.title || 'Đề cuối khoá'} minutes={f.minutes} pass={f.pass} /> <button type="button" onClick={() => setF(null)}>Huỷ</button></div>
    </div>
    : fe ? <dl className="tpkv">
      <dt>Tên đề</dt><dd>{fe.title || 'Đề cuối khoá'}</dd>
      <dt>Môn · khối</dt><dd>{listSubjects(fe).join(', ') || '—'}{listGrades(fe).length ? ` · khối ${listGrades(fe).join(', ')}` : ' · mọi khối'}</dd>
      <dt>Ma trận</dt><dd>{matrixTotal(fe.matrix ?? [])} câu: {matrixText(fe.matrix ?? []) || '—'}</dd>
      <dt>Cách làm</dt><dd>{fe.minutes ? `${fe.minutes} phút` : 'không giới hạn thời gian'} · {fe.attempts ? `${fe.attempts} lượt` : 'không giới hạn lượt'} · điểm đạt {fe.pass != null ? num(fe.pass) : 'không xét'} · {fe.shuffle !== false ? 'trộn câu' : 'giữ thứ tự'}</dd>
    </dl>
    : <p className="sub" style={{ margin: 0 }}>Chương trình chưa có đề cuối khoá.</p>}
    {!edit && <p className="sub" style={{ margin: 0 }}>Phiên bản này không sửa được. Tạo phiên bản mới ở tab "Phiên bản & duyệt" để sửa đề.</p>}
  </section>
}

// ===== Khung đánh giá =====
const COMP: [keyof Frame['weights'], string, string][] = [
  ['att', 'Chuyên cần', 'Tỉ lệ có mặt các buổi (100% = 10 điểm)'], ['tests', 'Bài test nội dung', 'Trung bình điểm cao nhất các bài test, chưa làm tính 0'],
  ['final', 'Đề cuối khoá', 'Điểm cao nhất của đề cuối khoá'], ['product', 'Sản phẩm cuối khoá', 'Điểm giảng viên chấm sản phẩm']]

export function ProgramEvalFrame({ p, edit, hasFinal, hasTests, save }: { p: Prog; edit: boolean; hasFinal: boolean; hasTests: boolean; save: Save }) {
  const [f, setF] = useState<Frame>(() => p.eval_frame ? { ...defaultFrame(p), ...p.eval_frame, req: { ...defaultFrame(p).req, ...p.eval_frame.req } } : defaultFrame(p))
  const [dirty, setDirty] = useState(false)
  const up = (x: Partial<Frame>) => { setF({ ...f, ...x }); setDirty(true) }
  const has: Record<keyof Frame['weights'], boolean> = { att: true, tests: hasTests, final: hasFinal, product: p.need_product }
  const wsum = COMP.reduce((a, [k]) => a + (has[k] ? f.weights[k] : 0), 0)
  const grades = [...f.grades].sort((a, b) => b.min - a.min)
  const dupe = new Set(f.grades.map(g => g.min)).size !== f.grades.length
  async function doSave() {
    if (!wsum) return alert('Cần ít nhất một thành phần có trọng số.')
    if (dupe || f.grades.some(g => !g.label.trim())) return alert('Mỗi mức xếp loại cần tên và điểm khác nhau.')
    const frame: Frame = { ...f, grades: grades.map(g => ({ label: g.label.trim(), min: g.min })), fail_label: f.fail_label.trim() || 'Chưa đạt' }
    if (await save({ eval_frame: frame }, 'Đã lưu khung đánh giá.')) setDirty(false)
  }
  const dis = !edit
  return <section className="panel" style={{ display: 'grid', gap: 14 }}>
    <div><h3 style={{ margin: 0 }}>Khung đánh giá</h3>
      <p className="sub" style={{ margin: '4px 0 0' }}>Tổng điểm (thang 10) = trung bình có trọng số của các thành phần. Thành phần không có trong kế hoạch (VD chưa có đề cuối khoá) được bỏ ra, các thành phần còn lại chia lại theo tỉ lệ.
        Đạt khi đủ mọi điều kiện bắt buộc; xếp loại theo tổng điểm.{!p.eval_frame && ' Chương trình đang dùng khung mặc định.'}</p></div>

    <fieldset className="libtargets wide"><legend>Thành phần điểm và trọng số</legend>
      <div className="wrap"><table>
        <thead><tr><th>Thành phần</th><th>Cách tính</th><th className="num">Trọng số</th><th className="num">Tỉ lệ</th></tr></thead>
        <tbody>{COMP.map(([k, l, d]) => <tr key={k} style={has[k] ? undefined : { opacity: .55 }}>
          <td><b>{l}</b>{!has[k] && <><br /><small className="sub">{k === 'final' ? 'chưa có đề cuối khoá' : k === 'tests' ? 'chưa có bài test' : 'sản phẩm không bắt buộc'}</small></>}</td>
          <td><small>{d}</small></td>
          <td className="num"><input type="number" min={0} max={100} disabled={dis} value={f.weights[k]} style={{ width: 80 }} aria-label={`Trọng số ${l}`}
            onChange={e => up({ weights: { ...f.weights, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })} /></td>
          <td className="num">{has[k] && wsum ? `${Math.round(f.weights[k] * 100 / wsum)}%` : '—'}</td></tr>)}</tbody>
      </table></div>
    </fieldset>

    <fieldset className="libtargets wide"><legend>Điều kiện bắt buộc để đạt</legend>
      <div className="formgrid">
        <label className="field"><span>Chuyên cần tối thiểu (%)</span><input type="number" min={0} max={100} disabled={dis} value={f.req.att ?? ''} placeholder="Không xét"
          onChange={e => up({ req: { ...f.req, att: nOrNull(e.target.value) } })} /></label>
        <label className="field"><span>Tổng điểm tối thiểu</span><input type="number" min={0} max={10} step={0.5} disabled={dis} value={f.req.total ?? ''} placeholder="Không xét"
          onChange={e => up({ req: { ...f.req, total: nOrNull(e.target.value) } })} /><small className="sub">VD 5: dưới 5 điểm là {f.fail_label || 'Chưa đạt'}</small></label>
        <label className="field"><span>Điểm đề cuối khoá tối thiểu</span><input type="number" min={0} max={10} step={0.5} disabled={dis} value={f.req.final ?? ''} placeholder="Không xét"
          onChange={e => up({ req: { ...f.req, final: nOrNull(e.target.value) } })} /></label>
        {p.need_product && <label className="field"><span>Điểm sản phẩm tối thiểu</span><input type="number" min={0} max={10} step={0.5} disabled={dis} value={f.req.product ?? ''} placeholder="5"
          onChange={e => up({ req: { ...f.req, product: nOrNull(e.target.value) } })} /></label>}
        <div className="field"><span>Nội dung</span><label><input type="checkbox" disabled={dis} checked={f.req.units} onChange={e => up({ req: { ...f.req, units: e.target.checked } })} /> Học xong mọi nội dung</label></div>
        <div className="field"><span>Bài test</span><label><input type="checkbox" disabled={dis} checked={f.req.tests} onChange={e => up({ req: { ...f.req, tests: e.target.checked } })} /> Đạt mọi bài test nội dung</label></div>
      </div>
      {p.need_product && <small className="sub">Sản phẩm bắt buộc phải được nhận (đạt) theo cấu hình chương trình.</small>}
    </fieldset>

    <fieldset className="libtargets wide"><legend>Thang xếp loại</legend>
      <div className="wrap"><table>
        <thead><tr><th>Xếp loại</th><th className="num">Tổng điểm từ</th>{!dis && <th></th>}</tr></thead>
        <tbody>{f.grades.map((g, i) => <tr key={i}>
          <td><input disabled={dis} maxLength={40} value={g.label} aria-label="Tên xếp loại" onChange={e => up({ grades: f.grades.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} /></td>
          <td className="num"><input type="number" min={0} max={10} step={0.5} disabled={dis} value={g.min} style={{ width: 90 }} aria-label="Điểm từ"
            onChange={e => up({ grades: f.grades.map((x, j) => j === i ? { ...x, min: Math.max(0, Math.min(10, Number(e.target.value) || 0)) } : x) })} /></td>
          {!dis && <td><button type="button" className="x" aria-label="Bỏ mức" disabled={f.grades.length < 2} onClick={() => up({ grades: f.grades.filter((_, j) => j !== i) })}>×</button></td>}
        </tr>)}
          <tr><td><input disabled={dis} maxLength={40} value={f.fail_label} aria-label="Tên mức chưa đạt" onChange={e => up({ fail_label: e.target.value })} /></td>
            <td className="num"><small className="sub">không đủ điều kiện</small></td>{!dis && <td></td>}</tr></tbody>
      </table></div>
      {dupe && <small className="warnline">Các mức phải có điểm khác nhau.</small>}
      {!dis && f.grades.length < 8 && <div><button type="button" onClick={() => up({ grades: [...f.grades, { label: '', min: Math.max(0, Math.min(...f.grades.map(g => g.min)) - 1) }] })}>+ Thêm mức</button></div>}
      <small className="sub">Đạt đủ điều kiện nhưng tổng điểm dưới mức thấp nhất thì xếp mức thấp nhất ({grades[grades.length - 1]?.label || '—'}).</small>
    </fieldset>

    {edit ? <div className="formactions"><button type="button" className="primary" disabled={!dirty && !!p.eval_frame} onClick={doSave}>{p.eval_frame ? 'Lưu khung đánh giá' : 'Lưu và dùng khung này'}</button>
      {' '}<button type="button" onClick={() => { setF(defaultFrame(p)); setDirty(true) }}>Về mặc định</button></div>
      : <p className="sub" style={{ margin: 0 }}>Phiên bản này không sửa được. Tạo phiên bản mới ở tab "Phiên bản & duyệt" để sửa khung.</p>}
  </section>
}
