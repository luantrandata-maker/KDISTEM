import { useEffect, useState, lazy, Suspense, type ComponentType } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { NAV, ROLE_LABEL, MODULE_OF, ENT_MODULE_OF, RoleKey, UPSELL_PORTALS, PHASE_OF, labelOf } from './lib/nav'
import { LockedModule } from './components/LockedModule'
import { useAccess, switchOrg } from './lib/auth'
import { useYears, yearLabel } from './lib/year'
import Bell from './components/Bell'
import { navigatePage, onHistoryPage } from './lib/history'
import MfaGate from './components/MfaGate'
import Years from './pages/Years'
import logo from './assets/kdi-logo.png'
import logoWhite from './assets/kdi-logo-white.png'
import { NavIcon } from './components/NavIcon'
import { MenuSearch, UserMenu } from './components/TopBar'
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
import { TeacherTrainingSchedule, TeacherTrainingLessons } from './pages/teacher/Training'
import { TeacherActivities } from './pages/teacher/Activities'
import { TeacherSelfStudy } from './pages/teacher/SelfStudy'
import { TeacherAttendance, SchoolSessions } from './pages/attendance/Sessions'
// Dashboard điểm danh & TKB toàn hệ thống (027): tải riêng khi mở
const AttendanceDashboard = lazy(() => import('./pages/attendance/Dashboard').then(m => ({ default: m.AttendanceDashboard })))
const TimetableOverview = lazy(() => import('./pages/attendance/Dashboard').then(m => ({ default: m.TimetableOverview })))
import { StudentHome } from './pages/student/Home'
import { StudentAssignments } from './pages/student/Assignments'
import { StudentSchedule } from './pages/student/Schedule'
import { StudentClassroom } from './pages/student/Classroom'
import { StudentTopics } from './pages/student/Topics'
import { StudentSelfStudy } from './pages/student/SelfStudy'
import { StudentAttendance } from './pages/student/Attendance'
import { Holidays } from './pages/Holidays'
import { TabbedPages } from './components/TabbedPages'
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
// Khung giao diện cho phân hệ chưa build + Sơ đồ hệ thống
const PlannedPage = lazy(() => import('./pages/platform/Planned').then(m => ({ default: m.PlannedPage })))
const SystemMap = lazy(() => import('./pages/platform/Planned').then(m => ({ default: m.SystemMap })))
// Đợt 1 (024): khách hàng, gói & hợp đồng, bảo mật, hỗ trợ
const PlatformCustomers = lazy(() => import('./pages/platform/Commerce').then(m => ({ default: m.PlatformCustomers })))
const PlatformContracts = lazy(() => import('./pages/platform/Commerce').then(m => ({ default: m.PlatformContracts })))
const PlatformSecurity = lazy(() => import('./pages/platform/Security').then(m => ({ default: m.PlatformSecurity })))
const PlatformSupport = lazy(() => import('./pages/support/Support').then(m => ({ default: m.PlatformSupport })))
// Đợt 2 (025): triển khai khách hàng, danh mục gói, đơn đặt gói, thông báo hàng loạt, tích hợp
const PlatformRollout = lazy(() => import('./pages/platform/Rollout').then(m => ({ default: m.PlatformRollout })))
const PlatformCatalog = lazy(() => import('./pages/platform/Catalog').then(m => ({ default: m.PlatformCatalog })))
const PlatformOrders = lazy(() => import('./pages/platform/Catalog').then(m => ({ default: m.PlatformOrders })))
const PlatformBroadcast = lazy(() => import('./pages/platform/Broadcast').then(m => ({ default: m.PlatformBroadcast })))
const PlatformIntegrations = lazy(() => import('./pages/platform/Integrations').then(m => ({ default: m.PlatformIntegrations })))
// S3 (029): phòng STEM & lịch phòng, thiết bị toàn hệ thống
const RoomsOverview = lazy(() => import('./pages/platform/Resources').then(m => ({ default: m.RoomsOverview })))
const ModuleUsage = lazy(() => import('./pages/platform/Modules').then(m => ({ default: m.ModuleUsage })))
const DefaultPermissions = lazy(() => import('./pages/platform/Modules').then(m => ({ default: m.DefaultPermissions })))
const PlatformSchools = lazy(() => import('./pages/platform/Schools').then(m => ({ default: m.PlatformSchools })))
const EquipmentOverview = lazy(() => import('./pages/platform/Resources').then(m => ({ default: m.EquipmentOverview })))
const CustomerSupport = lazy(() => import('./pages/support/Support').then(m => ({ default: m.CustomerSupport })))

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
  'Hỗ trợ từ KDI': CustomerSupport,
  'Buổi dạy & điểm danh': SchoolSessions,
  'Dashboard điểm danh': AttendanceDashboard,
  'Ngày nghỉ & lễ': Holidays,
}
const TEACHER: PageMap = {
  'Tổng quan': TeacherHome,
  'Kế hoạch giáo dục': TeacherSchedule,
  'Lớp giảng dạy': TeacherClasses,
  'Điểm danh': TeacherAttendance,
  'Đặt phòng STEM': TeacherBooking,
  'Bài tập': TeacherAssignments,
  'Chấm bài': TeacherGrading,
  'Giáo dục STEM': TeacherClassroom,
  'Soạn bài giảng': TeacherLessonStudio,
  'Hộp phê duyệt': ApprovalInbox,
  'Thư viện STEM': LibraryBrowse,
  'Lịch tập huấn': TeacherTrainingSchedule,
  'Bài giảng tập huấn': TeacherTrainingLessons,
  'Hỗ trợ từ KDI': CustomerSupport,
  'Kho hoạt động & Bài giảng': TeacherActivities,
  'Học trước & tự học': TeacherSelfStudy,
}
const STUDENT: PageMap = {
  'Tổng quan': StudentHome,
  'Bài tập': StudentAssignments,
  'Lịch học': StudentSchedule,
  'Giáo dục STEM': StudentClassroom,
  'Chủ đề': StudentTopics,
  'Học trước & tự học': StudentSelfStudy,
  'Chuyên cần': StudentAttendance,
}
const DEPARTMENT: PageMap = {
  'Dashboard toàn Sở': DeptDashboard,
  'KPI & Xếp hạng Xã/Phường': DeptWardKpi,
  'Danh sách Trường': DeptSchools,
  'Dashboard điểm danh': AttendanceDashboard,
  'Chương trình CT1–CT5': DeptPrograms,
  'Theo dõi Môn học STEM': DeptSubjects,
  'Giám sát Tập huấn GV': DeptTrainingMonitor,
  'Kế hoạch tập huấn': TrainingPlans,
  'Lịch tập huấn': TrainingSchedule,
  'Hiệu quả Phòng STEM': DeptRoomEffect,
  'Phòng STEM & lịch phòng': RoomsOverview,
  'Thiết bị & kho': EquipmentOverview,
  'Ngày nghỉ & lễ': Holidays,
  'Báo cáo Bộ GD&ĐT': DeptReports,
  'Điều hành & Cấu hình': DeptAdmin,
  'Hộp phê duyệt': ApprovalInbox,
  'Quy trình phê duyệt': ApprovalWorkflows,
  'Phát hành học liệu': LibraryManage,
  'Kho học liệu dùng chung': LibraryBrowse,
  'Hỗ trợ từ KDI': CustomerSupport,
}
// Cổng Quản trị nền tảng: chỉ nối các trang đọc được dữ liệu toàn hệ thống (trang nền tảng, trang cấp Sở, học liệu, phê duyệt, tập huấn).
// Mục menu không có ở đây hiện khung giao diện (PlannedPage); build xong phân hệ nào thì thêm trang vào đây.
const PLATFORM: PageMap = {
  'Tổng quan hệ thống': PlatformOverview,
  'Nhật ký hệ thống': PlatformAudit,
  'Cấu hình chung (năm học)': DeptAdmin,
  'Cây tổ chức': PlatformOrgs,
  'Người dùng & vai trò': PlatformUsers,
  'Lời mời': PlatformInvites,
  'Hộp phê duyệt': ApprovalInbox,
  'Quy trình phê duyệt': ApprovalWorkflows,
  'Thông báo': PlatformBroadcast,
  'Cơ sở giáo dục': DeptSchools,
  'Cơ sở triển khai': PlatformSchools,
  'Vai trò & quyền mặc định': DefaultPermissions,
  'Bảo mật tài khoản': PlatformSecurity,
  'Vấn đề & phản hồi': PlatformSupport,
  'Thông tin khách hàng': PlatformCustomers,
  'Gói dịch vụ & hợp đồng': PlatformContracts,
  'Triển khai khách hàng': PlatformRollout,
  'Đơn đặt gói STEM': PlatformOrders,
  'Tích hợp & dữ liệu': PlatformIntegrations,
  // 1. Đào tạo & đánh giá năng lực nhà giáo
  'Kế hoạch tập huấn': TrainingPlans,
  'Lịch tập huấn': TrainingSchedule,
  'Giám sát tập huấn nhà giáo': DeptTrainingMonitor,
  // 2. Chương trình & học liệu
  'Chương trình giáo dục': PlatformCatalog,
  'Học liệu': (p: any) => <TabbedPages {...p} tabs={[['Phát hành học liệu', LibraryManage], ['Kho học liệu dùng chung', LibraryBrowse]]} />,
  'Theo dõi chương trình CT1–CT5 (Môn học)': (p: any) => <TabbedPages {...p} tabs={[['Chương trình CT1–CT5', DeptPrograms], ['Môn học STEM', DeptSubjects]]} />,
  // 3. Vật tư, thiết bị dạy & học
  'Thiết bị & vật tư': EquipmentOverview,
  'Phòng STEM & lịch phòng': RoomsOverview,
  'Hiệu quả sử dụng phòng STEM': DeptRoomEffect,
  // 4. Vận hành giảng dạy & đánh giá người học
  'Thời khóa biểu & xếp lịch': TimetableOverview,
  'Buổi dạy & điểm danh': AttendanceDashboard,
  // 5. Hệ thống quản lý vận hành
  'Báo cáo vận hành': DeptDashboard,
  'KPI & xếp hạng': DeptWardKpi,
  'Báo cáo cấp trên (Bộ GD&ĐT)': DeptReports,
  'Điều hành & cấu hình (Sở)': DeptAdmin,
  // 5.5–5.6: tên theo file rà soát, dùng lại màn chung
  'Tổ chức & phân quyền': (p: any) => <TabbedPages {...p} tabs={[['Cây tổ chức', PlatformOrgs], ['Người dùng & vai trò', PlatformUsers], ['Lời mời', PlatformInvites]]} />,
  'Nhật ký hoạt động': PlatformAudit,
  'Lộ trình triển khai': PlatformRollout,
  'Cấu hình chung (kỳ học...)': DeptAdmin,
}
const PLATFORM_LIVE = new Set(Object.keys(PLATFORM))
PLATFORM['Sơ đồ hệ thống'] = (p: any) => <SystemMap {...p} live={PLATFORM_LIVE} />
PLATFORM['Phân hệ & mức sử dụng'] = (p: any) => <ModuleUsage {...p} live={PLATFORM_LIVE} />
PLATFORM_LIVE.add('Phân hệ & mức sử dụng')
// Tên trang cũ (liên kết nội bộ của trang Sở) → tên trong menu Quản trị nền tảng
const PLATFORM_ALIAS: Record<string, string> = {
  'KPI & Xếp hạng Xã/Phường': 'KPI & xếp hạng', 'Thiết bị & kho': 'Thiết bị & vật tư', 'Hiệu quả Phòng STEM': 'Hiệu quả sử dụng phòng STEM',
  'Dashboard điểm danh': 'Buổi dạy & điểm danh', 'Thời khoá biểu & xếp lịch': 'Thời khóa biểu & xếp lịch',
}
const PAGES: Partial<Record<RoleKey, PageMap>> = { school_admin: SCHOOL, teacher: TEACHER, student: STUDENT, department: DEPARTMENT, platform: PLATFORM }
// Khi dev: mục menu không có trang (thường do sửa chuỗi mã trong NAV thay vì thêm LABEL — xem lib/nav.ts)
if (import.meta.env.DEV) (Object.keys(PAGES) as RoleKey[]).filter(r => r !== 'platform').forEach(r =>
  NAV[r].flatMap(g => g.items).filter(i => !PAGES[r]![i]).forEach(i => console.warn(`[menu] ${r}: "${i}" không có trang`)))

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
  return <MfaGate key={session.user.id}><Shell session={session} /></MfaGate>
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
    if (!access.loading && !role && views.length) {
      // Tải lại trang: mở lại đúng trang đang xem (lưu trong lịch sử trình duyệt) nếu vẫn còn quyền
      const st = (history.state ?? {}) as { role?: RoleKey; page?: string }
      const keep = st.role && views.includes(st.role) && NAV[st.role].some(g => g.items.includes(st.page ?? ''))
      const r = keep ? st.role! : views[0], p = keep ? st.page! : NAV[views[0]][0].items[0]
      navigatePage(r, p, true); setRole(r); setPage(p)
    }
  }, [access.loading, views.length])

  // Nút Back/Forward của trình duyệt: chuyển giữa các trang đã mở trong ứng dụng
  useEffect(() => {
    onHistoryPage(s => {
      const r = s.role as RoleKey | undefined
      if (r && s.page && views.includes(r) && NAV[r].some(g => g.items.includes(s.page!))) { setRole(r); setPage(s.page) }
    })
    return () => onHistoryPage(null)
  }, [views.join(',')])

  useEffect(() => {
    if (access.profile?.org_id) supabase.from('teachers').select('id, full_name, profile_id').order('full_name').then(({ data }) => setTeachers(data ?? []))
    // Học sinh: hồ sơ của chính mình; quản trị: danh sách để xem thử giao diện học sinh
    if (access.profile?.org_id && access.portals.includes('student'))
      supabase.from('students').select('id, full_name, profile_id, classes(name)').order('student_code').then(({ data }) => setStudents((data as any) ?? []))
  }, [access.profile?.org_id, access.portals.length])

  // Tự đăng xuất khi không thao tác (cài đặt ở Bảo mật tài khoản)
  useEffect(() => {
    if (!access.idleMinutes) return
    let last = Date.now()
    const touch = () => { last = Date.now() }
    const ev = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll']
    ev.forEach(e => window.addEventListener(e, touch, { passive: true }))
    const t = setInterval(() => { if (Date.now() - last > access.idleMinutes * 60000) supabase.auth.signOut() }, 30000)
    return () => { ev.forEach(e => window.removeEventListener(e, touch)); clearInterval(t) }
  }, [access.idleMinutes])

  if (access.loading) return null
  if (changingPw) return <SetPassword onDone={() => setChangingPw(false)} />
  if (access.profile?.locked_at) {
    return (
      <div className="login"><form onSubmit={e => e.preventDefault()}>
        <img src={logo} alt="KDI education" /><h1>Tài khoản đã bị khoá</h1>
        <p>Tài khoản <b>{session.user.email}</b> đã bị khoá{access.profile.locked_reason ? `: ${access.profile.locked_reason}` : ''}. Liên hệ KDI Education để được hỗ trợ.</p>
        <button type="button" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      </form></div>
    )
  }
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

  // Mọi lần đổi trang đi qua show() để ghi vào lịch sử trình duyệt
  const show = (r: RoleKey, p: string) => { navigatePage(r, p); setRole(r); setPage(p) }
  const changeRole = (r: RoleKey) => show(r, NAV[r][0].items[0])
  // Mở một trang từ thông báo (có thể ở giao diện khác)
  const openFrom = (portal: RoleKey | null, target: string) => {
    const p = portal && views.includes(portal) ? portal : role
    if (!NAV[p].some(g => g.items.includes(target))) return
    show(p, target)
  }
  const myTeacher = teachers.find(t => t.profile_id === session.user.id)?.id ?? null
  const teacherId = role === 'teacher' ? (access.isAdmin ? actingTeacher ?? teachers[0]?.id ?? null : myTeacher) : null
  const myStudent = students.find(s => s.profile_id === session.user.id)?.id ?? null
  const studentId = role === 'student' ? (access.isAdmin ? actingStudent ?? students.find(s => s.classes?.name === 'Lớp 9A')?.id ?? students[0]?.id ?? null : myStudent) : null

  // Mục được vai trò xem (không xét gói) và mục có trong gói. Cổng Trường/Sở: mục chưa có trong gói hiện mờ;
  // cổng khác: ẩn hẳn như trước.
  const roleOk = (i: string) => role !== 'school_admin' || !MODULE_OF[i] || access.permitted(MODULE_OF[i])
  const inPlan = (i: string) => role === 'platform' || !ENT_MODULE_OF[i] || access.entitled(ENT_MODULE_OF[i])
  const locked = new Set(NAV[role].flatMap(g => g.items).filter(i => UPSELL_PORTALS.has(role) && roleOk(i) && !inPlan(i)))
  const groups = NAV[role]
    .map(g => ({ ...g, items: g.items.filter(i => roleOk(i) && (inPlan(i) || locked.has(i))) }))
    .filter(g => g.items.length)
  // Gom các nhóm cùng phân hệ (section) thành một khối cây: phân hệ → nhóm con → mục
  const blocks: { section?: string; groups: typeof groups }[] = []
  groups.forEach(g => {
    const last = blocks[blocks.length - 1]
    if (g.section && last?.section === g.section) last.groups.push(g)
    else blocks.push({ section: g.section, groups: [g] })
  })
  const Page: ComponentType<any> | undefined = PAGES[role]?.[page] ?? (role === 'platform' ? PlannedPage : undefined)
  const goPage = (p: string) => show(role, role === 'platform' ? PLATFORM_ALIAS[p] ?? p : p)
  const email = session.user.email ?? ''

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
      <nav className="side" aria-label="Menu chính">
        <div className="sidebrand">
          <img src={logoWhite} alt="KDI education" />
          <b>{role === 'platform' ? 'Hệ thống quản lý vận hành' : ROLE_LABEL[role]}</b>
        </div>
        {role !== 'department' && role !== 'platform' && <label className="yearpick">
          <span>Năm học · học kỳ</span>
          <select value={yrs.year?.id ?? ''} onChange={e => e.target.value === '__manage' ? (role === 'school_admin' ? show(role, 'Năm học & học kỳ') : null) : yrs.select(e.target.value)}
            aria-label="Chọn năm học và học kỳ">
            {yrs.years.length === 0 && <option value="">Chưa có năm học</option>}
            {yrs.years.map(y => <option key={y.id} value={y.id}>{yearLabel(y)}{y.is_current ? ' (hiện tại)' : ''}</option>)}
            {role === 'school_admin' && access.canView('periods') && <option value="__manage">Quản lý năm học…</option>}
          </select>
        </label>}
        {role !== 'department' && role !== 'platform' && yrs.year && !yrs.year.is_current && <p className="yearwarn">Đang xem học kỳ không phải hiện tại</p>}
        {blocks.map(b => {
          // Một nhóm thường, hoặc một phân hệ (cấp 1) chứa các nhóm con (cấp 2)
          const head = (key: string, title: string, items: string[], sub = false) => {
            const shut = closed.has(key)
            return (
              <button className={'grouphead' + (sub ? ' subhead' : '') + (shut ? ' shut' : '')} onClick={() => toggleGroup(key)} aria-expanded={!shut}
                aria-controls={'grp-' + key.replace(/[^\p{L}\p{N}]+/gu, '-')}>
                {!sub && <NavIcon title={title} />}<span>{title}
                  {items.length > 0 && items.every(i => locked.has(i)) && <small className="locknote">Chưa có trong gói</small>}</span>
                {shut && items.includes(page) && <i className="dot" aria-label="Đang mở trang trong nhóm này" />}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
            )
          }
          const list = (key: string, items: string[]) => (
            <div id={'grp-' + key.replace(/[^\p{L}\p{N}]+/gu, '-')} hidden={closed.has(key)}>
              {items.map(i => <button key={i} className={(i === page ? 'on' : '') + (locked.has(i) ? ' locked' : '')} onClick={() => show(role, i)}
                title={locked.has(i) ? 'Chưa có trong gói dịch vụ của đơn vị' : undefined}>
                {labelOf(role, i)}{role === 'platform' && !PLATFORM_LIVE.has(i) && i !== 'Sơ đồ hệ thống' && <small className="navtag">Khung</small>}
                {locked.has(i) && <svg className="navlock" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Chưa có trong gói"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
              </button>)}
            </div>
          )
          if (!b.section) {
            const key = role + ':' + b.groups[0].title
            return <div key={key} className="navgroup">{head(key, b.groups[0].title, b.groups[0].items)}{list(key, b.groups[0].items)}</div>
          }
          const key = role + '§' + b.section
          const all = b.groups.flatMap(g => g.items)
          return (
            <div key={key} className="navgroup">
              {head(key, b.section, all)}
              <div id={'grp-' + key.replace(/[^\p{L}\p{N}]+/gu, '-')} hidden={closed.has(key)} className="navsub">
                {b.groups.map(g => {
                  const k = role + ':' + g.title
                  return <div key={k}>{head(k, g.title, g.items, true)}{list(k, g.items)}</div>
                })}
              </div>
            </div>
          )
        })}
        
      </nav>
      <div className="content">
        <header className="top">
          <button className="toggle" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Hiện menu' : 'Ẩn menu'} aria-expanded={!collapsed}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
          </button>
          <img src={logo} alt="KDI education" />
          <span className="title">{role === 'platform' ? 'Hệ thống quản lý vận hành' : 'Hệ thống Quản trị STEM'}</span>
          <MenuSearch entries={groups.flatMap(g => g.items.map(item => ({ item, label: labelOf(role, item), group: g.section ? `${g.section} › ${g.title}` : g.title })))} onGo={i => show(role, i)} />
          <div className="user">
            <Bell open={openFrom} portals={views} orgId={access.profile.org_id} />
            <UserMenu name={access.profile.full_name} email={email}
              roleLabel={access.roles.map(r => r.name).join(', ') || ROLE_LABEL[role]}
              orgs={access.orgs} views={views.map(v => ({ key: v, label: ROLE_LABEL[v] }))} view={role} onView={k => changeRole(k as RoleKey)}
              acting={access.isAdmin && role === 'teacher' ? { label: 'Xem với tư cách giáo viên', value: teacherId ?? '', options: teachers.map(t => ({ id: t.id, label: t.full_name })), onChange: setActingTeacher }
                : access.isAdmin && role === 'student' ? { label: 'Xem với tư cách học sinh', value: studentId ?? '', options: students.map(s => ({ id: s.id, label: `${s.classes?.name ?? ''} · ${s.full_name}` })), onChange: setActingStudent }
                : null}
              onPassword={() => setChangingPw(true)} onSignOut={() => supabase.auth.signOut()} />
          </div>
        </header>
        <main className="main">
          <h1>{labelOf(role, page)}</h1>
          {locked.has(page) ? <LockedModule name={labelOf(role, page)} phase={PHASE_OF[ENT_MODULE_OF[page]] ?? null} entitlement={access.entitlement} go={goPage} />
            : Page ? <Suspense fallback={<p className="sub">Đang tải…</p>}><Page key={page + (yrs.year?.id ?? '') + (studentId ?? '')} teacherId={teacherId} studentId={studentId} orgId={access.profile.org_id} userName={access.profile.full_name} go={goPage} name={page}
            year={yrs.year} years={yrs.years} reloadYears={yrs.reload} selectYear={yrs.select} /></Suspense> : <p className="sub">Màn hình này sẽ được xây dựng ở bước tiếp theo.</p>}
        </main>
      </div>
    </div>
  )
}

