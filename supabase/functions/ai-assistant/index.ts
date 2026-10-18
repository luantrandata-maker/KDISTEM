// Hàm máy chủ: Trợ lý AI (migration 052).
// - Quyền và hạn mức kiểm tra trong CSDL: gọi ai_begin bằng JWT của người dùng.
// - Gọi Claude API bằng secret ANTHROPIC_API_KEY (KDI đặt trong Supabase › Edge Functions › Secrets; không nằm trong repo).
// - Không lưu nội dung câu hỏi / trả lời. Chỉ ghi ai_usage (tác vụ, token, kết quả) bằng khoá service_role.
//
// POST { task: 'lesson' | 'quiz' | 'comment' | 'document' | 'chat', input: {...} } → { text, items?, usage }
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

type Msg = { role: 'user' | 'assistant'; content: string }
type In = Record<string, unknown>
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d }

const SYSTEM = `Bạn là Trợ lý AI của KSCHOOL STEM — nền tảng quản lý giáo dục STEM cho trường phổ thông, Sở GD&ĐT và KDI Education tại Việt Nam.
Người dùng là giáo viên, cán bộ quản lý trường, Sở GD&ĐT hoặc nhân viên KDI. Luôn trả lời bằng tiếng Việt chuẩn mực, rõ ràng, thiết thực cho trường học Việt Nam.
Nguyên tắc:
- Bám Chương trình giáo dục phổ thông 2018 và định hướng giáo dục STEM của Bộ GD&ĐT; khi nhắc tới văn bản pháp quy mà không chắc số hiệu hoặc nội dung hiện hành, nói rõ là cần đối chiếu văn bản gốc.
- Không yêu cầu, không suy đoán và không đưa vào câu trả lời thông tin cá nhân của học sinh (họ tên, ngày sinh, địa chỉ, số điện thoại…). Nếu người dùng dán thông tin cá nhân, nhắc nhẹ rằng không cần và dùng cách gọi chung ("học sinh", "em").
- An toàn: thí nghiệm, hoạt động thực hành phải kèm lưu ý an toàn phù hợp lứa tuổi; không hướng dẫn nội dung nguy hiểm.
- Trình bày bằng Markdown gọn: tiêu đề ngắn, gạch đầu dòng, bảng khi cần. Không mở đầu bằng lời chào dài.`

function build(task: string, input: In): { messages: Msg[]; max: number; error?: string } {
  if (task === 'lesson') {
    const topic = str(input.topic, 300)
    if (!topic) return { messages: [], max: 0, error: 'Nhập chủ đề bài học' }
    return { max: 5000, messages: [{ role: 'user', content:
`Soạn kế hoạch bài dạy STEM.
- Chủ đề: ${topic}
- Môn / lĩnh vực: ${str(input.subject, 100) || 'liên môn'}
- Khối lớp: ${str(input.grade, 20) || 'chưa nêu'}
- Thời lượng: ${num(input.periods, 1, 10, 2)} tiết (45 phút/tiết)
${str(input.program, 100) ? `- Thuộc chương trình / gói: ${str(input.program, 100)}\n` : ''}${str(input.equipment, 600) ? `- Thiết bị, vật tư sẵn có: ${str(input.equipment, 600)}\n` : ''}${str(input.notes, 800) ? `- Yêu cầu thêm: ${str(input.notes, 800)}\n` : ''}
Trình bày theo cấu trúc kế hoạch bài dạy (mẫu Phụ lục IV Công văn 5512/BGDĐT-GDTrH): I. Mục tiêu (kiến thức, năng lực, phẩm chất); II. Thiết bị dạy học và học liệu; III. Tiến trình dạy học gồm các hoạt động theo quy trình bài học STEM — xác định vấn đề, nghiên cứu kiến thức nền và đề xuất giải pháp, lựa chọn giải pháp và chế tạo / thử nghiệm, chia sẻ và đánh giá. Mỗi hoạt động nêu: mục tiêu, nội dung, sản phẩm, cách tổ chức (giao nhiệm vụ – thực hiện – báo cáo – kết luận) và thời gian.
Kết thúc bằng bảng tiêu chí đánh giá sản phẩm (3–5 tiêu chí, có mức điểm) và lưu ý an toàn.` }] }
  }
  if (task === 'quiz') {
    const topic = str(input.topic, 300)
    if (!topic) return { messages: [], max: 0, error: 'Nhập chủ đề' }
    const n = num(input.count, 1, 20, 10)
    return { max: 300 + n * 260, messages: [{ role: 'user', content:
`Tạo ${n} câu hỏi trắc nghiệm 4 lựa chọn (một đáp án đúng).
- Chủ đề: ${topic}
- Môn: ${str(input.subject, 100) || 'STEM'} · Khối: ${str(input.grade, 20) || 'chưa nêu'}
- Mức độ: ${str(input.level, 40) || 'hỗn hợp nhận biết / thông hiểu / vận dụng'}
Chỉ trả về một mảng JSON hợp lệ, không thêm chữ nào khác, mỗi phần tử có dạng:
{"q": "câu hỏi", "options": ["A","B","C","D"], "answer": 0, "explain": "giải thích ngắn", "level": "nhận biết|thông hiểu|vận dụng"}
"answer" là chỉ số (0–3) của đáp án đúng. Phân bố đáp án đúng đều giữa các vị trí. Không đánh số A/B/C/D trong nội dung lựa chọn.` }] }
  }
  if (task === 'comment') {
    const comps = Array.isArray(input.competencies) ? (input.competencies as In[]).slice(0, 15).map(c => `${str(c.name, 80)}: ${str(c.level, 10)}`).filter(x => x.length > 3) : []
    if (!comps.length) return { messages: [], max: 0, error: 'Chọn ít nhất một năng lực và mức' }
    return { max: 900, messages: [{ role: 'user', content:
`Viết 3 phương án nhận xét năng lực cho một học sinh (gọi là "em"), mỗi phương án 40–70 từ, giọng ${str(input.tone, 40) || 'động viên, cụ thể'}.
Mức đạt (thang M1 chưa đạt – M2 đạt một phần – M3 đạt – M4 vượt mong đợi):
${comps.map(c => '- ' + c).join('\n')}
${str(input.strengths, 400) ? `Điểm nổi bật GV ghi nhận: ${str(input.strengths, 400)}\n` : ''}${str(input.context, 200) ? `Bối cảnh: ${str(input.context, 200)}\n` : ''}
Mỗi phương án: ghi nhận điểm mạnh, chỉ ra một điểm cần cố gắng, gợi ý một việc cụ thể. Trình bày "Phương án 1/2/3" và không dùng tên riêng.` }] }
  }
  if (task === 'document') {
    const subject = str(input.subject, 300)
    if (!subject) return { messages: [], max: 0, error: 'Nhập trích yếu / nội dung chính' }
    return { max: 3500, messages: [{ role: 'user', content:
`Soạn dự thảo văn bản hành chính: ${str(input.kind, 60) || 'Kế hoạch'}.
- Đơn vị ban hành: ${str(input.unit, 200) || '[Tên đơn vị]'}
- Trích yếu: ${subject}
- Các ý chính cần có: ${str(input.points, 2000) || '(tự đề xuất hợp lý)'}
Trình bày theo thể thức văn bản hành chính (Nghị định 30/2020/NĐ-CP): quốc hiệu, tiêu ngữ, số / ký hiệu để trống "…", địa danh ngày tháng, tên loại và trích yếu, căn cứ (ghi chung, đánh dấu chỗ cần điền văn bản cụ thể), nội dung theo mục, nơi nhận, chức vụ người ký. Dùng [ … ] cho chỗ cần điền.` }] }
  }
  if (task === 'chat') {
    const raw = Array.isArray(input.messages) ? (input.messages as In[]) : []
    const messages = raw.slice(-12).map(m => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: str(m.content, 4000) })).filter(m => m.content)
    if (!messages.length || messages[messages.length - 1].role !== 'user') return { messages: [], max: 0, error: 'Nhập câu hỏi' }
    while (messages[0]?.role === 'assistant') messages.shift()
    return { max: 2000, messages }
  }
  return { messages: [], max: 0, error: 'Tác vụ không hợp lệ' }
}

function parseItems(text: string) {
  const a = text.indexOf('['), b = text.lastIndexOf(']')
  if (a < 0 || b <= a) return null
  try {
    const arr = JSON.parse(text.slice(a, b + 1))
    if (!Array.isArray(arr)) return null
    return arr.filter(x => x && typeof x.q === 'string' && Array.isArray(x.options) && x.options.length >= 2 && Number.isInteger(x.answer))
      .map(x => ({ q: String(x.q), options: x.options.slice(0, 6).map(String), answer: Math.min(x.answer, x.options.length - 1), explain: x.explain ? String(x.explain) : '', level: x.level ? String(x.level) : '' }))
  } catch { return null }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Chỉ nhận POST' }, 405)
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Chưa đăng nhập' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const pub = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY')!
  const asUser = createClient(url, pub, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: { task?: string; input?: In }
  try { body = await req.json() } catch { return json({ error: 'Dữ liệu gửi lên không hợp lệ' }, 400) }
  const task = String(body.task ?? '')
  const { data: st, error: e1 } = await asUser.rpc('ai_begin', { p_task: task })
  if (e1) return json({ error: e1.message }, e1.code === '42501' ? 403 : 429)
  const s = st as { model: string; org_id: string | null; user_id: string }

  const p = build(task, body.input ?? {})
  if (p.error) return json({ error: p.error }, 400)
  const key = Deno.env.get('ANTHROPIC_API_KEY')
  if (!key) return json({ error: 'KDI chưa cấu hình khoá API cho Trợ lý AI (secret ANTHROPIC_API_KEY).' }, 503)

  const log = (ok: boolean, inTok = 0, outTok = 0, error: string | null = null) =>
    admin.from('ai_usage').insert({ org_id: s.org_id, user_id: s.user_id, task, model: s.model, input_tokens: inTok, output_tokens: outTok, ok, error })

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: s.model, max_tokens: p.max, system: SYSTEM, messages: p.messages }),
    })
  } catch (e) {
    await log(false, 0, 0, 'network: ' + String(e).slice(0, 200))
    return json({ error: 'Không kết nối được dịch vụ AI, thử lại sau.' }, 502)
  }
  const out = await res.json().catch(() => null) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number }; error?: { message?: string } } | null
  if (!res.ok || !out) {
    const msg = out?.error?.message ?? `HTTP ${res.status}`
    await log(false, 0, 0, msg.slice(0, 300))
    return json({ error: res.status === 429 || res.status === 529 ? 'Dịch vụ AI đang quá tải, thử lại sau ít phút.' : 'Dịch vụ AI báo lỗi: ' + msg }, 502)
  }
  const text = (out.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n').trim()
  await log(true, out.usage?.input_tokens ?? 0, out.usage?.output_tokens ?? 0)
  return json({ text, items: task === 'quiz' ? parseItems(text) : undefined, usage: out.usage })
})
