// Hàm máy chủ: tạo tài khoản đăng nhập bằng mã (không cần email) cho HS/GV và đặt lại mật khẩu (migration 037).
// Quyền và phạm vi kiểm tra trong CSDL: hàm gọi account_prepare / account_reset_target bằng JWT của người bấm.
// Chỉ phần cần quyền quản trị Auth (tạo tài khoản, đặt mật khẩu) dùng khoá service_role — Supabase tự cấp qua biến môi trường,
// không lưu trong repo. Mật khẩu chỉ trả về một lần cho người bấm (để in phiếu), không lưu ở đâu.
//
// POST { action: 'create', kind: 'student' | 'teacher' | 'parent', ids: uuid[] }   (parent: id dòng guardians, 048; judge: id competition_judges, 051)
//   → { results: [{ person_id, full_name, class_name, login, password?, status, message? }] }
// POST { action: 'reset', kind, id } → { login, password }
// POST { action: 'erase', kind: 'student', id, reason } → { ok, account }  (039: xoá dữ liệu cá nhân HS; email/tên trong Auth
//   được thay bằng giá trị ẩn danh và tài khoản bị cấm đăng nhập)
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// 8 ký tự dễ đọc (bỏ 0/o, 1/l/i) — đủ cho tài khoản HS khi đã có giới hạn số lần đăng nhập sai của Supabase Auth
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'
function password(n = 8) {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return Array.from(b, x => ALPHA[x % ALPHA.length]).join('')
}

type Prep = { person_id: string; full_name: string | null; class_name: string | null; login: string | null; email: string | null; status: string }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Chỉ nhận POST' }, 405)
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Chưa đăng nhập' }, 401)

  const url = Deno.env.get('SUPABASE_URL')!
  // Khoá công khai: lấy từ yêu cầu (trình duyệt gửi kèm apikey), dự phòng biến môi trường
  const pub = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY')!
  const asUser = createClient(url, pub, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: { action?: string; kind?: string; ids?: string[]; id?: string; reason?: string }
  try { body = await req.json() } catch { return json({ error: 'Dữ liệu gửi lên không hợp lệ' }, 400) }
  const kind = body.kind === 'teacher' ? 'teacher' : body.kind === 'student' ? 'student' : body.kind === 'parent' ? 'parent' : body.kind === 'judge' ? 'judge' : null
  if (!kind) return json({ error: 'Thiếu loại tài khoản (student/teacher/parent/judge)' }, 400)

  if (body.action === 'create') {
    const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') : []
    if (!ids.length) return json({ error: 'Chưa chọn người nào' }, 400)
    const { data, error } = await asUser.rpc('account_prepare', { p_kind: kind, p_ids: ids })
    if (error) return json({ error: error.message, code: error.code }, error.code === '42501' ? 403 : 400)
    const results = []
    for (const r of (data as Prep[]) ?? []) {
      if (r.status !== 'new' || !r.email) { results.push({ ...r, email: undefined }); continue }
      const pw = password()
      const attrs = { email: r.email, password: pw, email_confirm: true,
        user_metadata: { full_name: r.full_name, login: r.login, must_change_password: true } }
      let res = await admin.auth.admin.createUser(attrs)
      if (res.error) {
        // Email nội bộ đã bị đăng ký trước (chưa xác nhận, không thuộc đơn vị nào) → xoá rồi tạo lại
        const { data: ex } = await admin.rpc('account_auth_user', { p_email: r.email })
        const u = (ex as { id: string; confirmed: boolean; linked: boolean }[] | null)?.[0]
        if (u && !u.confirmed && !u.linked) {
          await admin.auth.admin.deleteUser(u.id)
          res = await admin.auth.admin.createUser(attrs)
        }
      }
      if (res.error || !res.data.user) {
        results.push({ person_id: r.person_id, full_name: r.full_name, class_name: r.class_name, login: r.login, status: 'error', message: res.error?.message ?? 'Không tạo được tài khoản' })
        continue
      }
      const { error: le } = await admin.from('profiles').update({ login: r.login }).eq('id', res.data.user.id)
      results.push({ person_id: r.person_id, full_name: r.full_name, class_name: r.class_name, login: r.login, password: pw,
        status: le ? 'created_no_login' : 'created', message: le?.message })
    }
    return json({ results })
  }

  if (body.action === 'reset') {
    if (!body.id) return json({ error: 'Thiếu người cần đặt lại mật khẩu' }, 400)
    const { data: uid, error } = await asUser.rpc('account_reset_target', { p_kind: kind, p_id: body.id })
    if (error) return json({ error: error.message, code: error.code }, error.code === '42501' ? 403 : 400)
    const pw = password()
    const { data: u, error: ue } = await admin.auth.admin.updateUserById(uid as string,
      { password: pw, user_metadata: { must_change_password: true } })
    if (ue) return json({ error: ue.message }, 500)
    return json({ login: (u.user?.user_metadata as { login?: string } | undefined)?.login ?? null, password: pw })
  }
  if (body.action === 'erase') {
    if (kind !== 'student' || !body.id) return json({ error: 'Chỉ xoá dữ liệu học sinh' }, 400)
    const { data: uid, error } = await asUser.rpc('student_erase', { p_student: body.id, p_reason: body.reason ?? '' })
    if (error) return json({ error: error.message, code: error.code }, error.code === '42501' ? 403 : 400)
    if (!uid) return json({ ok: true, account: false })
    const { data: dom } = await admin.rpc('login_domain')
    const { error: ue } = await admin.auth.admin.updateUserById(uid as string, {
      email: `daxoa.${(uid as string).slice(0, 8)}.${Date.now().toString(36)}@${dom ?? 'tk.kdi.edu.vn'}`, email_confirm: true,
      user_metadata: { full_name: null, login: null, must_change_password: null }, ban_duration: '876000h' })
    // Dữ liệu trong CSDL đã xoá và tài khoản đã khoá; lỗi ở bước Auth chỉ báo lại để làm lại
    if (ue) return json({ ok: true, account: true, warning: 'Chưa xoá được email trong Auth: ' + ue.message })
    return json({ ok: true, account: true })
  }
  return json({ error: 'Thao tác không hợp lệ' }, 400)
})
