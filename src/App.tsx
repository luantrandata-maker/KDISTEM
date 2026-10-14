import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { NAV, ROLE_LABEL, RoleKey } from './lib/nav'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Teachers from './pages/Teachers'
import Classes from './pages/Classes'

const PAGES: Record<string, () => JSX.Element> = {
  'Dashboard Trường': Dashboard,
  'Giáo viên': Teachers,
  'Lớp học': Classes,
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [role, setRole] = useState<RoleKey>('school_admin')
  const [page, setPage] = useState(NAV.school_admin[0].items[0])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return null
  if (!session) return <Login />

  const changeRole = (r: RoleKey) => { setRole(r); setPage(NAV[r][0].items[0]) }
  const Page = PAGES[page]

  return (
    <>
      <header className="top">
        <span className="logo">GELEXIMCO STEM</span>
        <select value={role} onChange={e => changeRole(e.target.value as RoleKey)} aria-label="Vai trò (demo)">
          {(Object.keys(ROLE_LABEL) as RoleKey[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button className="out" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      </header>
      <div className="shell">
        <nav className="side">
          {NAV[role].map(g => (
            <div key={g.title}>
              <h4>{g.title}</h4>
              {g.items.map(i => (
                <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>{i}</button>
              ))}
            </div>
          ))}
        </nav>
        <main className="main">
          <h1>{page}</h1>
          {Page ? <Page /> : <p>Màn hình này sẽ được xây dựng ở bước tiếp theo.</p>}
        </main>
      </div>
    </>
  )
}
