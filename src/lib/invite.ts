import { supabase } from './supabase'

// Gửi email đăng nhập (liên kết dùng một lần) tới người được mời. Supabase tạo tài khoản nếu chưa có;
// khi người đó bấm liên kết, email được xác nhận và lời mời tự áp dụng (migration 014, 019).
export async function sendInviteEmail(email: string, full_name: string | null) {
  return supabase.auth.signInWithOtp({
    email, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin, data: full_name ? { full_name } : undefined },
  })
}
