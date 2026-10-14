import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { NAV, ROLE_LABEL, MODULE_OF, VIEW_OF_ROLE, RoleKey } from './lib/nav'
import { useAccess } from './lib/auth'
import logo from './assets/kdi-logo.png'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Teachers from './pages/Teachers'
import Classes from './pages/Classes'
import Rooms from './pages/Rooms'
import Equipment from './pages/Equipment'
import Warranty from './pages/Warranty'
import Assignments from './pages/Assignments'
import Timetable from './pages/Timetable'
import Registrations from './pages/Registrations'
import Students from './pages/Students'
import Buildings from './pages/Buildings'
import Periods from './pages/Periods'
import Roles from './pages/Roles'
import Accounts from './pages/Accounts'
import { Packages, EduPlan, StemTeachers, Curriculum, SchoolProfile } from './pages/School'
import { TrainingPlans, TrainingSchedule, TrainingLessons, VirtualClass, Certificates } from './pages/Training'
import { TeacherHome, TeacherSchedule, TeacherClasses, TeacherBooking } from './pages/TeacherPortal'

type PageMap = Record<string, (props: any) => JSX.Element>
const SCHOOL: PageMap = {
  'Dashboard Trường': Dashboard,
  'Giáo viên': Teachers,
  'Lớp học': Classes,
  'Quản lý Phòng STEM': Rooms,
  'Quản lý Thiết bị': Equipment,
  'Bảo hành thiết bị': Warranty,
  'Phân công giảng dạy': Assignments,
  'Thời khóa biểu': Timetable,
  'Duyệt đăng ký dạy STEM': Registrations,
  'Học sinh': Students,
  'Tòa nhà & Tầng': Buildings,
  'Cấu hình tiết học': Periods,
  'Vai trò và phân quyền': Roles,
  'Tài khoản': Accounts,
  'Gói STEM': Packages,
  'Kế hoạch GD toàn trường': EduPlan,
  'Phân công GV dạy STEM': StemTeachers,
  'Phân phối chương trình': Curriculum,
  'Hồ sơ Trường học': SchoolProfile,
  'Kế hoạch tập huấn': TrainingPlans,
  'Lịch tập huấn': TrainingSchedule,
  'Bài giảng': TrainingLessons,
  'Lớp học ảo': VirtualClass,
  'Chứng chỉ': Certificates,
}
const TEACHER: PageMap = {
  'Tổng quan': TeacherHome,
  'Kế hoạch giáo dục': TeacherSchedule,
  'Lớp giảng dạy': TeacherClasses,
  'Đặt phòng STEM': TeacherBooking,
}
const PAGES: Partial<Record<RoleKey, PageMap>> = { school_admin: SCHOOL, teacher: TEACHER }

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return null
  if (!session) return <Login />
  return <Shell session={session} />
}

function Shell({ session }: { session: Session }) {
  const access = useAccess(session)
  const [role, setRole] = useState<RoleKey | null>(null)
  const [page, setPage] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; profile_id: string | null }[]>([])
  const [actingTeacher, setActingTeacher] = useState<string | null>(null)

  const views: RoleKey[] = access.isAdmin
    ? ['school_admin', 'teacher', 'student', 'department']
    : [...new Set(access.roleKeys.map(k => VIEW_OF_ROLE[k]).filter(Boolean))] as RoleKey[]

  useEffect(() => {
    if (!access.loading && !role && views.length) { setRole(views[0]); setPage(NAV[views[0]][0].items[0]) }
  }, [access.loading, views.length])

  useEffect(() => {
    if (access.profile?.org_id) supabase.from('teachers').select('id, full_name, profile_id').order('full_name').then(({ data }) => setTeachers(data ?? []))
  }, [access.profile?.org_id])

  if (access.loading) return null
  if (!access.profile?.org_id || views.length === 0) {
    return (
      <div className="login"><form onSubmit={e => e.preventDefault()}>
        <img src={logo} alt="KDI education" /><h1>Đang chờ cấp quyền</h1>
        <p>Tài khoản <b>{session.user.email}</b> chưa được gán vào trường hoặc chưa có vai trò. Hãy nhờ quản trị trường gán trong mục Tài khoản.</p>
        <button type="button" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      </form></div>
    )
  }
  if (!role) return null

  const changeRole = (r: RoleKey) => { setRole(r); setPage(NAV[r][0].items[0]) }
  const myTeacher = teachers.find(t => t.profile_id === session.user.id)?.id ?? null
  const teacherId = role === 'teacher' ? (access.isAdmin ? actingTeacher ?? teachers[0]?.id ?? null : myTeacher) : null

  const groups = NAV[role]
    .map(g => ({ ...g, items: g.items.filter(i => role !== 'school_admin' || !MODULE_OF[i] || access.canView(MODULE_OF[i])) }))
    .filter(g => g.items.length)
  const Page = PAGES[role]?.[page]
  const email = session.user.email ?? ''

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
      <nav className="side" aria-label="Menu chính">
        {groups.map(g => (
          <div key={g.title}>
            <h4>{g.title}</h4>
            {g.items.map(i => <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>{i}</button>)}
          </div>
        ))}
      </nav>
      <div className="content">
        <header className="top">
          <button className="toggle" onClick={() => setCollapsed(!collapsed)} aria-label="Ẩn/hiện menu">☰</button>
          <img src={logo} alt="KDI education" />
          <span className="title">Hệ thống Quản trị STEM</span>
          <div className="user">
            {access.isAdmin && role === 'teacher' && (
              <select value={teacherId ?? ''} onChange={e => setActingTeacher(e.target.value)} aria-label="Xem với tư cách giáo viên">
                {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            )}
            {views.length > 1 && (
              <select value={role} onChange={e => changeRole(e.target.value as RoleKey)} aria-label="Chế độ xem">
                {views.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            )}
            <span className="avatar">{email.charAt(0).toUpperCase()}</span>
            <button onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
          </div>
        </header>
        <main className="main">
          <h1>{page}</h1>
          {Page ? <Page teacherId={teacherId} orgId={access.profile.org_id} /> : <p className="sub">Màn hình này sẽ được xây dựng ở bước tiếp theo.</p>}
        </main>
      </div>
    </div>
  )
}
