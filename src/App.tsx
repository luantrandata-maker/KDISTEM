import { useEffect, useState, lazy, Suspense, type ComponentType } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { NAV, ROLE_LABEL, MODULE_OF, RoleKey } from './lib/nav'
import { useAccess, switchOrg, type MyOrg } from './lib/auth'
import { useYears, yearLabel } from './lib/year'
import Bell from './components/Bell'
import Years from './pages/Years'
import logo from './assets/kdi-logo.png'
import Login, { SetPassword } from './pages/Login'
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
import Packages from './pages/Packages'
import EduPlan from './pages/EduPlan'
import StemAssign from './pages/StemAssign'
import { Curriculum, SchoolProfile } from './pages/School'
import { TrainingPlans, TrainingSchedule, TrainingLessons, VirtualClass, Certificates } from './pages/Training'
import { TeacherHome, TeacherSchedule, TeacherClasses, TeacherBooking } from './pages/TeacherPortal'
import { TeacherAssignments, TeacherGrading } from './pages/teacher/Assignments'
import { TeacherLessonStudio } from './pages/teacher/Lessons'
import { TeacherClassroom } from './pages/teacher/Classroom'
import { StudentHome } from './pages/student/Home'
import { StudentAssignments } from './pages/student/Assignments'
import { StudentSchedule } from './pages/student/Schedule'
import { StudentClassroom } from './pages/student/Classroom'
import { StudentTopics } from './pages/student/Topics'
import { DeptDashboard, DeptWardKpi, DeptSchools, DeptPrograms, DeptSubjects, DeptTrainingMonitor, DeptRoomEffect } from './pages/department/Overview'
import { DeptReports } from './pages/department/Reports'
import { DeptAdmin } from './pages/department/Admin'
// Kho học liệu dùng chung (023)
const LibraryBrowse = lazy(() => import('./pages/library/Browse').then(m => ({ default: m.LibraryBrowse })))
const LibraryManage = lazy(() => import('./pages/library/Manage').then(m => ({ default: m.LibraryManage })))
// Phê duyệt (022): tải riêng khi mở
const ApprovalInbox = lazy(() => import('./pages/approvals/Inbox').then(m => ({ default: m.ApprovalInbox })))
const ApprovalWorkflows = lazy(() => import('./pages/approvals/Workflows').then(m => ({ default: m.ApprovalWorkflows })))
const PackageOrders = lazy(() => import('./pages/approvals/PackageOrders').then(m => ({ default: m.PackageOrders })))
// Cổng quản trị nền tảng: tải riêng khi mở (không làm nặng bản tải chung của trường/giáo viên/học sinh)
const PlatformOverview = lazy(() => import('./pages/platform/Overview').then(m => ({ default: m.PlatformOverview })))
const PlatformOrgs = lazy(() => import('./pages/platform/Orgs').then(m => ({ default: m.PlatformOrgs })))
const PlatformUsers = lazy(() => import('./pages/platform/Users').then(m => ({ default: m.PlatformUsers })))
const PlatformInvites = lazy(() => import('./pages/platform/Users').then(m => ({ default: m.PlatformInvites })))
const PlatformAudit = lazy(() => import('./pages/platform/Audit').then(m => ({ default: m.PlatformAudit })))

type PageMap = Record<string, ComponentType<any>>
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
  'Phân công GV dạy STEM': StemAssign,
  'Phân phối chương trình': Curriculum,
  'Hồ sơ Trường học': SchoolProfile,
  'Kế hoạch tập huấn': TrainingPlans,
  'Lịch tập huấn': TrainingSchedule,
  'Bài giảng': TrainingLessons,
  'Lớp học ảo': VirtualClass,
  'Chứng chỉ': Certificates,
  'Năm học & học kỳ': Years,
  'Hộp phê duyệt': ApprovalInbox,
  'Quy trình phê duyệt': ApprovalWorkflows,
  'Đề xuất mua gói': PackageOrders,
  'Kho học liệu dùng chung': LibraryBrowse,
  'Phát hành học liệu': LibraryManage,
}
const TEACHER: PageMap = {
  'Tổng quan': TeacherHome,
  'Kế hoạch giáo dục': TeacherSchedule,
  'Lớp giảng dạy': TeacherClasses,
  'Đặt phòng STEM': TeacherBooking,
  'Bài tập': TeacherAssignments,
  'Chấm bài': TeacherGrading,
  'Giáo dục STEM': TeacherClassroom,
  'Soạn bài giảng': TeacherLessonStudio,
  'Hộp phê duyệt': ApprovalInbox,
  'Thư viện STEM': LibraryBrowse,
}
const STUDENT: PageMap = {
  'Tổng quan': StudentHome,
  'Bài tập': StudentAssignments,
  'Lịch học': StudentSchedule,
  'Giáo dục STEM': StudentClassroom,
  'Chủ đề': StudentTopics,
}
const DEPARTMENT: PageMap = {
  'Dashboard toàn Sở': DeptDashboard,
  'KPI & Xếp hạng Xã/Phường': DeptWardKpi,
  'Danh sách Trường': DeptSchools,
  'Chương trình CT1–CT5': DeptPrograms,
  'Theo dõi Môn học STEM': DeptSubjects,
  'Giám sát Tập huấn GV': DeptTrainingMonitor,
  'Kế hoạch tập huấn': TrainingPlans,
  'Lịch tập huấn': TrainingSchedule,
  'Hiệu quả Phòng STEM': DeptRoomEffect,
  'Báo cáo Bộ GD&ĐT': DeptReports,
  'Điều hành & Cấu hình': DeptAdmin,
  'Hộp phê duyệt': ApprovalInbox,
  'Quy trình phê duyệt': ApprovalWorkflows,
  'Phát hành học liệu': LibraryManage,
  'Kho học liệu dùng chung': LibraryBrowse,
}
const PLATFORM: PageMap = {
  'Tổng quan hệ thống': PlatformOverview,
  'Cây tổ chức': PlatformOrgs,
  'Người dùng & vai trò': PlatformUsers,
  'Lời mời': PlatformInvites,
  'Nhật ký hệ thống': PlatformAudit,
  'Phát hành học liệu': LibraryManage,
}
const PAGES: Partial<Record<RoleKey, PageMap>> = { school_admin: SCHOOL, teacher: TEACHER, student: STUDENT, department: DEPARTMENT, platform: PLATFORM }

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s)
      if (e === 'PASSWORD_RECOVERY') setRecovery(true)   // mở từ liên kết "Quên mật khẩu"
    })
    return () => data.subscription.unsubscribe()
  }, [])
  if (session === undefined) return null
  if (!session) return <Login />
  if (recovery) return <SetPassword onDone={() => setRecovery(false)} />
  return <Shell session={session} />
}

function Shell({ session }: { session: Session }) {
  const access = useAccess(session)
  const [role, setRole] = useState<RoleKey | null>(null)
  const [page, setPage] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  // Nhóm menu đang thu gọn (nhớ theo trình duyệt)
  const [closed, setClosed] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('menu.closed') ?? '[]')) } catch { return new Set() } })
  const toggleGroup = (key: string) => setClosed(prev => {
    const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key)
    try { localStorage.setItem('menu.closed', JSON.stringify([...next])) } catch { /* bỏ qua */ }
    return next
  })
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; profile_id: string | null }[]>([])
  const [actingTeacher, setActingTeacher] = useState<string | null>(null)
  const [students, setStudents] = useState<{ id: string; full_name: string; profile_id: string | null; classes: { name: string } | null }[]>([])
  const [actingStudent, setActingStudent] = useState<string | null>(null)
  const [changingPw, setChangingPw] = useState(false)
  const yrs = useYears(access.profile?.org_id)

  const views: RoleKey[] = access.portals

  useEffect(() => {
    if (!access.loading && !role && views.length) { setRole(views[0]); setPage(NAV[views[0]][0].items[0]) }
  }, [access.loading, views.length])

  useEffect(() => {
    if (access.profile?.org_id) supabase.from('teachers').select('id, full_name, profile_id').order('full_name').then(({ data }) => setTeachers(data ?? []))
    // Học sinh: hồ sơ của chính mình; quản trị: danh sách để xem thử giao diện học sinh
    if (access.profile?.org_id && access.portals.includes('student'))
      supabase.from('students').select('id, full_name, profile_id, classes(name)').order('student_code').then(({ data }) => setStudents((data as any) ?? []))
  }, [access.profile?.org_id, access.portals.length])

  if (access.loading) return null
  if (changingPw) return <SetPassword onDone={() => setChangingPw(false)} />
  if (!access.profile?.org_id || views.length === 0) {
    return (
      <div className="login"><form onSubmit={e => e.preventDefault()}>
        <img src={logo} alt="KDI education" /><h1>Đang chờ cấp quyền</h1>
        <p>Tài khoản <b>{session.user.email}</b> chưa được gán vào trường hoặc chưa có vai trò. Hãy nhờ quản trị trường gán trong mục Tài khoản.</p>
        {access.orgs.filter(o => !o.active).length > 0 && <>
          <p>Bạn có vai trò ở các đơn vị sau, chọn để vào làm việc:</p>
          {access.orgs.filter(o => !o.active).map(o => (
            <button type="button" key={o.org_id} className="primary" onClick={() => switchOrg(o.org_id)}>{o.name}</button>
          ))}
        </>}
        <button type="button" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      </form></div>
    )
  }
  if (!role) return null

  const changeRole = (r: RoleKey) => { setRole(r); setPage(NAV[r][0].items[0]) }
  // Mở một trang từ thông báo (có thể ở giao diện khác)
  const openFrom = (portal: RoleKey | null, target: string) => {
    const p = portal && views.includes(portal) ? portal : role
    if (!NAV[p].some(g => g.items.includes(target))) return
    setRole(p); setPage(target)
  }
  const myTeacher = teachers.find(t => t.profile_id === session.user.id)?.id ?? null
  const teacherId = role === 'teacher' ? (access.isAdmin ? actingTeacher ?? teachers[0]?.id ?? null : myTeacher) : null
  const myStudent = students.find(s => s.profile_id === session.user.id)?.id ?? null
  const studentId = role === 'student' ? (access.isAdmin ? actingStudent ?? students.find(s => s.classes?.name === 'Lớp 9A')?.id ?? students[0]?.id ?? null : myStudent) : null

  const groups = NAV[role]
    .map(g => ({ ...g, items: g.items.filter(i => role !== 'school_admin' || !MODULE_OF[i] || access.canView(MODULE_OF[i])) }))
    .filter(g => g.items.length)
  const Page = PAGES[role]?.[page]
  const email = session.user.email ?? ''

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
      <nav className="side" aria-label="Menu chính">
        {role !== 'department' && role !== 'platform' && <label className="yearpick">
          <span>Năm học · học kỳ</span>
          <select value={yrs.year?.id ?? ''} onChange={e => e.target.value === '__manage' ? (role === 'school_admin' ? setPage('Năm học & học kỳ') : null) : yrs.select(e.target.value)}
            aria-label="Chọn năm học và học kỳ">
            {yrs.years.length === 0 && <option value="">Chưa có năm học</option>}
            {yrs.years.map(y => <option key={y.id} value={y.id}>{yearLabel(y)}{y.is_current ? ' (hiện tại)' : ''}</option>)}
            {role === 'school_admin' && access.canView('periods') && <option value="__manage">Quản lý năm học…</option>}
          </select>
        </label>}
        {role !== 'department' && role !== 'platform' && yrs.year && !yrs.year.is_current && <p className="yearwarn">Đang xem học kỳ không phải hiện tại</p>}
        {groups.map(g => {
          const key = role + ':' + g.title
          const shut = closed.has(key)
          const id = 'grp-' + key.replace(/[^\p{L}\p{N}]+/gu, '-')
          return (
          <div key={g.title} className="navgroup">
            <button className={'grouphead' + (shut ? ' shut' : '')} onClick={() => toggleGroup(key)} aria-expanded={!shut} aria-controls={id}>
              <span>{g.title}</span>
              {shut && g.items.includes(page) && <i className="dot" aria-label="Đang mở trang trong nhóm này" />}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <div id={id} hidden={shut}>
            {g.items.map(i => <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>{i}</button>)}
            </div>
          </div>
          )
        })}
        
      </nav>
      <div className="content">
        <header className="top">
          <button className="toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Hiện menu' : 'Ẩn menu'} aria-expanded={!collapsed}>☰</button>
          <img src={logo} alt="KDI education" />
          <span className="title">Hệ thống Quản trị STEM</span>
          <div className="user">
            {access.isAdmin && role === 'teacher' && (
              <select value={teacherId ?? ''} onChange={e => setActingTeacher(e.target.value)} aria-label="Xem với tư cách giáo viên">
                {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </select>
            )}
            {access.isAdmin && role === 'student' && (
              <select value={studentId ?? ''} onChange={e => setActingStudent(e.target.value)} aria-label="Xem với tư cách học sinh">
                {students.map(s => <option key={s.id} value={s.id}>{s.classes?.name} · {s.full_name}</option>)}
              </select>
            )}
            <OrgSwitch orgs={access.orgs} />
            {views.length > 1 && (
              <select value={role} onChange={e => changeRole(e.target.value as RoleKey)} aria-label="Chế độ xem">
                {views.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            )}
            <Bell open={openFrom} portals={views} orgId={access.profile.org_id} />
            <span className="avatar">{email.charAt(0).toUpperCase()}</span>
            <button onClick={() => setChangingPw(true)}>Đổi mật khẩu</button>
            <button onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
          </div>
        </header>
        <main className="main">
          <h1>{page}</h1>
          {Page ? <Suspense fallback={<p className="sub">Đang tải…</p>}><Page key={page + (yrs.year?.id ?? '') + (studentId ?? '')} teacherId={teacherId} studentId={studentId} orgId={access.profile.org_id} userName={access.profile.full_name} go={(p: string) => setPage(p)}
            year={yrs.year} years={yrs.years} reloadYears={yrs.reload} selectYear={yrs.select} /></Suspense> : <p className="sub">Màn hình này sẽ được xây dựng ở bước tiếp theo.</p>}
        </main>
      </div>
    </div>
  )
}

// "Đang làm việc tại": chỉ hiện khi người dùng có vai trò ở từ hai tổ chức trở lên
function OrgSwitch({ orgs }: { orgs: MyOrg[] }) {
  const [err, setErr] = useState('')
  if (orgs.length < 2) return null
  const active = orgs.find(o => o.active)
  return (
    <label className="orgpick" title={err || 'Đổi đơn vị đang làm việc'}>
      <span>Đang làm việc tại</span>
      <select value={active?.org_id ?? ''} onChange={async e => setErr((await switchOrg(e.target.value)) ?? '')} aria-label="Đơn vị đang làm việc">
        {!active && <option value="">Chọn đơn vị…</option>}
        {orgs.map(o => <option key={o.org_id} value={o.org_id}>{o.name} · {o.roles.join(', ')}</option>)}
      </select>
    </label>
  )
}
