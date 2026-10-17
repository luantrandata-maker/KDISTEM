import { supabase } from './supabase'

// Tài khoản đăng nhập bằng mã (migration 037): tên đăng nhập <mã trường>.<mã HS> / <mã trường>.gv<số>.
// Supabase Auth cần email → email nội bộ <tên đăng nhập>@<login_domain> (không có hộp thư thật).
export const LOGIN_RE = /^[a-z0-9]+(\.[a-z0-9]+)+$/
let domain: Promise<string> | null = null
export function loginDomain() {
  domain ??= Promise.resolve(supabase.rpc('login_domain')).then(({ data, error }) => {
    if (error || !data) { domain = null; throw new Error('Không lấy được cấu hình đăng nhập, thử lại sau.') }
    return data as string
  })
  return domain
}
// Ô đăng nhập nhận email hoặc tên đăng nhập
export const isLoginName = (s: string) => !s.includes('@')
export async function toAuthEmail(input: string) {
  const v = input.trim().toLowerCase()
  return isLoginName(v) ? `${v}@${await loginDomain()}` : v
}
// Tài khoản mã phải đổi mật khẩu ở lần đăng nhập đầu và sau khi trường đặt lại mật khẩu
export const mustChangePassword = (meta: Record<string, unknown> | undefined) => meta?.must_change_password === true
