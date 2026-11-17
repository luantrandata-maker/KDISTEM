// Câu hỏi của một đề ở trang chi tiết (đề luyện E-learning, đề cuối khoá, bài test nội dung, đề luyện đào tạo):
// câu cố định (nội dung, đáp án, môn · chủ đề, mức độ, nguồn) và ma trận rút ngẫu nhiên, chỉ xem.
import type { ReactNode } from 'react'
import { QuestionPicker } from './QuestionPicker'
import { ExamMatrix, matrixTotal, type MRow } from './ExamMatrix'
import { InfoTip } from './InfoTip'

export function ExamQuestionsPanel({ org, qids, matrix = [], subjects, grades, randomCount, sampleNote, title = 'Câu hỏi của đề' }: {
  org: string | null | undefined; qids: string[]; matrix?: MRow[]; subjects: string[]; grades: number[]
  /** Số câu rút ngẫu nhiên khi đề không có ma trận (đề cũ chỉ đặt số câu) */
  randomCount?: number
  /** Ghi chú cách rút câu (vd bài test rút n câu từ các câu đã chọn) */
  sampleNote?: ReactNode
  title?: string
}) {
  const nRnd = matrix.length ? matrixTotal(matrix) : randomCount ?? 0
  return <section className="panel examqs">
    <h4 className="pdcardh">{title} ({qids.length + nRnd} câu)
      <InfoTip left label="Câu hỏi lấy từ đâu">Mọi câu hỏi đều nằm trong <b>Ngân hàng câu hỏi</b> (E-learning & luyện thi › Ngân hàng câu hỏi): câu của đơn vị mình và câu cấp trên dùng chung.
        <br /><b>Câu cố định</b>: người ra đề chọn sẵn từ ngân hàng (hoặc soạn mới / nhập Excel, câu đó được lưu vào ngân hàng). Cột Nguồn cho biết câu của đơn vị nào và được soạn tay, nhập Excel hay do Trợ lý AI tạo.
        {nRnd > 0 && <><br /><b>Câu rút ngẫu nhiên</b>: mỗi lượt làm, hệ thống rút ngẫu nhiên từ ngân hàng theo ma trận (môn, chủ đề, mức độ) bên dưới, nên mỗi người có thể nhận câu khác nhau.</>}</InfoTip></h4>
    {sampleNote && <p className="sub" style={{ margin: '0 0 8px' }}>{sampleNote}</p>}
    {qids.length > 0 || !nRnd ? <QuestionPicker value={qids} onChange={() => {}} edit={false} showSource subjects={subjects} grades={grades} title="Câu cố định" /> : null}
    {nRnd > 0 && <>
      <h4 className="libparthead" style={{ margin: '14px 0 6px' }}>Rút ngẫu nhiên từ ngân hàng mỗi lượt ({nRnd} câu)</h4>
      {matrix.length ? <ExamMatrix org={org} subjects={subjects} grades={grades} rows={matrix} onChange={() => {}} disabled />
        : <p className="sub">{nRnd} câu, rút theo môn và khối của đề.</p>}
      <p className="sub" style={{ margin: '6px 0 0' }}>Bấm <b>Làm thử</b> ở đầu trang để xem một lượt rút cụ thể.</p></>}
  </section>
}
