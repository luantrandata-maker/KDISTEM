import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { isLoginName, toAuthEmail } from '../lib/login'
import logo from '../assets/kdi-logo.png'
import { useLoginBranding, DEFAULT_TITLE } from '../lib/branding'

type Mode = 'in' | 'link' | 'up' | 'forgot'
const TITLE: Record<Mode, string> = {
  in: 'Đăng nhập vào tài khoản của bạn',
  link: 'Nhận liên kết đăng nhập qua email (dùng cho tài khoản được mời)',
  up: 'Tạo tài khoản',
  forgot: 'Nhập email để đặt lại mật khẩu',
}
const redirectTo = () => window.location.origin

export default function Login() {
  const brand = useLoginBranding()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('in')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(''); setBusy(true)
    let error: { message: string } | null = null
    const code = isLoginName(email.trim())
    if (code && mode !== 'in') {
      setBusy(false)
      return setMsg(mode === 'forgot' ? 'Tài khoản đăng nhập bằng mã không có email: nhờ nhà trường đặt lại mật khẩu.' : 'Nhập địa chỉ email.')
    }
    if (mode === 'in') {
      try { ({ error } = await supabase.auth.signInWithPassword({ email: await toAuthEmail(email), password })) }
      catch (x) { error = x as Error }
      if (error && code && /invalid login credentials/i.test(error.message)) error = { message: 'Sai tên đăng nhập hoặc mật khẩu.' }
    }
    else if (mode === 'up') ({ error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo() } }))
    else if (mode === 'link') ({ error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo(), shouldCreateUser: true } }))
    else ({ error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo() }))
    setBusy(false)
    if (error) return setMsg(error.message)
    if (mode === 'up') setMsg('Đã tạo tài khoản. Hãy mở email và bấm liên kết xác nhận, sau đó đăng nhập.')
    if (mode === 'link') setMsg('Đã gửi liên kết đăng nhập. Hãy kiểm tra hộp thư (cả mục Spam).')
    if (mode === 'forgot') setMsg('Đã gửi email đặt lại mật khẩu. Bấm liên kết trong thư để đặt mật khẩu mới.')
  }

  const go = (m: Mode) => (e: React.MouseEvent) => { e.preventDefault(); setMode(m); setMsg('') }
  return (
    <div className="login">
      <form onSubmit={submit}>
        <img src={brand?.logo ?? logo} alt={brand?.display_name ?? 'KDI education'} />
        <h1>{brand?.display_name ?? DEFAULT_TITLE}</h1>
        {brand?.login_message && mode === 'in' && <p className="loginmsg">{brand.login_message}</p>}
        <p>{TITLE[mode]}</p>
        <input type={mode === 'in' ? 'text' : 'email'} required placeholder={mode === 'in' ? 'Email hoặc tên đăng nhập' : 'Địa chỉ email'}
          autoComplete={mode === 'in' ? 'username' : 'email'} autoCapitalize="none" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} />
        {(mode === 'in' || mode === 'up') && (
          <input type="password" required minLength={6} placeholder="Mật khẩu" autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password} onChange={e => setPassword(e.target.value)} />
        )}
        <button type="submit" disabled={busy}>
          {{ in: 'Đăng nhập', up: 'Tạo tài khoản', link: 'Gửi liên kết đăng nhập', forgot: 'Gửi email đặt lại' }[mode]}
        </button>
        {msg && <p className="msg">{msg}</p>}
        {mode === 'in' ? (
          <>
            <a href="#" onClick={go('forgot')}>Quên mật khẩu?</a>
            <a href="#" onClick={go('link')}>Đăng nhập bằng liên kết email</a>
            <a href="#" onClick={go('up')}>Chưa có tài khoản? Đăng ký</a>
          </>
        ) : (
          <a href="#" onClick={go('in')}>← Đăng nhập bằng mật khẩu</a>
        )}
        {brand && <p className="loginfoot">{brand.support_text ? brand.support_text + '\n' : ''}Nền tảng KSCHOOL STEM · vận hành bởi KDI Education</p>}
      </form>
    </div>
  )
}

// Hiện khi người dùng mở liên kết "Quên mật khẩu", hoặc tự chọn đặt mật khẩu sau khi vào bằng liên kết mời
export function SetPassword({ onDone, forced = false }: { onDone: () => void; forced?: boolean }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw !== pw2) return setMsg('Hai mật khẩu không khớp.')
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } })
    if (error) return setMsg(error.message)
    onDone()
  }
  return (
    <div className="login">
      <form onSubmit={submit}>
        <img src={logo} alt="KDI education" />
        <h1>Đặt mật khẩu mới</h1>
        {forced && <p className="sub">Mật khẩu hiện tại do nhà trường cấp. Hãy đặt mật khẩu riêng của bạn trước khi tiếp tục.</p>}
        <input type="password" required minLength={6} placeholder="Mật khẩu mới" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Nhập lại mật khẩu" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} />
        <button type="submit">Lưu mật khẩu</button>
        {msg && <p className="msg">{msg}</p>}
        {forced ? <a href="#" onClick={e => { e.preventDefault(); supabase.auth.signOut() }}>Đăng xuất</a>
          : <a href="#" onClick={e => { e.preventDefault(); onDone() }}>Để sau</a>}
      </form>
    </div>
  )
}
