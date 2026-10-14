import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [msg, setMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg('')
    const { error } = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    if (error) setMsg(error.message)
    else if (mode === 'up') setMsg('Đã tạo tài khoản. Nếu được yêu cầu, hãy xác nhận email rồi đăng nhập.')
  }

  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>Quản trị STEM</h1>
        <p>{mode === 'in' ? 'Đăng nhập vào tài khoản của bạn' : 'Tạo tài khoản'}</p>
        <input type="email" required placeholder="Địa chỉ email" value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Mật khẩu" value={password} onChange={e => setPassword(e.target.value)} />
        <button type="submit">{mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}</button>
        {msg && <p className="msg">{msg}</p>}
        <a href="#" onClick={e => { e.preventDefault(); setMode(mode === 'in' ? 'up' : 'in') }}>
          {mode === 'in' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập'}
        </a>
      </form>
    </div>
  )
}
