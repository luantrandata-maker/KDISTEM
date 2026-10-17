import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/kdi-logo.png'

// Điều khoản sử dụng & Chính sách quyền riêng tư (migration 039): người dùng chấp thuận bản mới nhất đã công bố trước khi vào hệ thống.
type Doc = { id: string; kind: string; version: number; title: string; body: string; published_at: string }

export default function LegalGate({ children }: { children: ReactNode }) {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.rpc('legal_pending').then(({ data, error }) => setDocs(error ? [] : (data as Doc[]) ?? []))   // chưa có migration 039 → không chặn
  }, [])
  if (docs === null) return null
  if (!docs.length) return <>{children}</>
  async function accept() {
    setBusy(true)
    const { error } = await supabase.rpc('legal_accept', { p_ids: docs!.map(d => d.id) })
    setBusy(false)
    if (error) return setErr(error.message)
    setDocs([])
  }
  return (
    <div className="login legal">
      <form onSubmit={e => { e.preventDefault(); if (ok) accept() }}>
        <img src={logo} alt="KDI education" />
        <h1>{docs.length > 1 ? 'Điều khoản và chính sách' : docs[0].title}</h1>
        <p className="sub">Vui lòng đọc và đồng ý trước khi tiếp tục sử dụng hệ thống.</p>
        {docs.map(d => (
          <section key={d.id} className="legaldoc" aria-label={d.title}>
            {docs.length > 1 && <h2>{d.title} <small>· phiên bản {d.version}</small></h2>}
            <div className="legalbody" tabIndex={0}>{d.body}</div>
          </section>
        ))}
        <label className="field inline"><input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} /> Tôi đã đọc và đồng ý với {docs.map(d => d.title).join(' và ')}</label>
        <button type="submit" disabled={!ok || busy}>{busy ? 'Đang lưu…' : 'Đồng ý và tiếp tục'}</button>
        {err && <p className="msg">{err}</p>}
        <a href="#" onClick={e => { e.preventDefault(); supabase.auth.signOut() }}>Đăng xuất</a>
      </form>
    </div>
  )
}
