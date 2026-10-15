import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/kdi-logo.png'

type Step = { kind: 'loading' } | { kind: 'ok' } | { kind: 'verify'; factorId: string } | { kind: 'enroll'; factorId: string; qr: string; secret: string }

// Xác thực 2 lớp bắt buộc (migration 024): vai trò nằm trong security_settings.mfa_roles phải có phiên aal2 mới vào được.
// Chưa có ứng dụng xác thực → hướng dẫn đăng ký (quét mã QR); đã có → nhập mã 6 số.
export default function MfaGate({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function check() {
    setErr('')
    const req = await supabase.rpc('mfa_required')
    if (req.error || req.data !== true) return setStep({ kind: 'ok' })    // CSDL chưa có 024 hoặc không bắt buộc
    const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal.data?.currentLevel === 'aal2') return setStep({ kind: 'ok' })
    const f = await supabase.auth.mfa.listFactors()
    const verified = f.data?.totp?.find(x => x.status === 'verified')
    if (verified) return setStep({ kind: 'verify', factorId: verified.id })
    // Xoá các lần đăng ký dở dang rồi đăng ký mới
    for (const x of f.data?.all ?? []) if (x.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: x.id })
    const en = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'KDI ' + new Date().toISOString().slice(0, 10) })
    if (en.error || !en.data) { setErr(en.error?.message ?? 'Không tạo được mã đăng ký.'); return setStep({ kind: 'enroll', factorId: '', qr: '', secret: '' }) }
    setStep({ kind: 'enroll', factorId: en.data.id, qr: en.data.totp.qr_code, secret: en.data.totp.secret })
  }
  useEffect(() => { check() }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (step.kind !== 'verify' && step.kind !== 'enroll') return
    setBusy(true); setErr('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: step.factorId, code: code.trim() })
    setBusy(false)
    if (error) return setErr(/invalid|expired/i.test(error.message) ? 'Mã không đúng hoặc đã hết hạn. Nhập mã mới trong ứng dụng.' : error.message)
    setCode(''); setStep({ kind: 'ok' })
  }

  if (step.kind === 'loading') return null
  if (step.kind === 'ok') return <>{children}</>
  return (
    <div className="login">
      <form onSubmit={submit}>
        <img src={logo} alt="KDI education" />
        <h1>Xác thực 2 lớp</h1>
        {step.kind === 'enroll' ? <>
          <p>Vai trò của bạn bắt buộc xác thực 2 lớp. Mở ứng dụng xác thực (Google Authenticator, Microsoft Authenticator…), quét mã dưới đây rồi nhập mã 6 số.</p>
          {step.qr && <img className="mfaqr" src={step.qr} alt="Mã QR đăng ký xác thực 2 lớp" />}
          {step.secret && <p className="sub">Không quét được? Nhập khoá: <code>{step.secret}</code></p>}
        </> : <p>Nhập mã 6 số trong ứng dụng xác thực của bạn.</p>}
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="Mã 6 số" aria-label="Mã xác thực 6 số"
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
        <button className="primary" type="submit" disabled={busy || code.length !== 6}>Xác nhận</button>
        {err && <p className="msg">{err}</p>}
        <button type="button" className="ghost" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      </form>
    </div>
  )
}
