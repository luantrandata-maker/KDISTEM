import { useEffect, useState, lazy, Suspense, type ComponentType } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { useSettings, menuOf, orderItems } from './lib/settings'
import { CatalogLists, PageButtons, PageCtx } from './components/PageButtons'
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
import { mustChangePassword } from './lib/login'
import { useBranding, DEFAULT_TITLE } from './lib/branding'
import LegalGate from './components/LegalGate'
import Dashboard from './pages/Dashboard'
import Teachers from './pages/Teachers'
import MobileAppPage from './pages/MobileApp'
import OfflineBar from './components/OfflineBar'
import HelpWidget from './components/HelpWidget'
import TerminologyPage from './pages/platform/Terminology'
import AssistantPage, { PlatformAI } from './pages/ai'
import ElearningManage from './pages/elearning/Manage'
import QuestionBank from './pages/elearning/Bank'
import StudentElearning from './pages/elearning/Student'
import { saveQuizToBank } from './pages/elearning/common'
import { OrgScope, type ScopeKind } from './components/OrgScope'
import { SysWarranty, SysBuildings, SysTeachers, SysTeaching, SysStudents, SysGuardians, SysEduPlan, SysRegistrations, SysHomework, SysCurriculum, SysActivities, SysSchoolLessons, SysTrainingLessons } from './pages/platform/SystemViews'
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
import { SchoolProfile } from './pages/School'
import { TrainingPlans, TrainingSchedule, TrainingLessons, VirtualClass } from './pages/Training'
import { TeacherHome, TeacherSchedule, TeacherClasses, TeacherBooking } from './pages/TeacherPortal'
import { TeacherAssignments, TeacherGrading } from './pages/teacher/Assignments'
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
const DeptAlerts = lazy(() => import('./pages/department/Governance').then(m => ({ default: m.DeptAlerts })))
const DeptTargets = lazy(() => import('./pages/department/Governance').then(m => ({ default: m.DeptTargets })))
import { DeptReports } from './pages/department/Reports'
import { DeptAdmin } from './pages/department/Admin'
// Kho học liệu dùng chung (023)
const LibraryBrowse = lazy(() => import('./pages/library/Browse').then(m => ({ default: m.LibraryBrowse })))
const LibraryPrograms = lazy(() => import('./pages/library/Programs').then(m => ({ default: m.LibraryPrograms })))
// Học liệu theo video demo 23/10: quy trình 3 bước, chương trình → môn → bài học 5 thẻ
const LibraryPage = lazy(() => import('./pages/library/Page').then(m => ({ default: m.LibraryPage })))
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
const PlatformLegal = lazy(() => import('./pages/platform/Legal').then(m => ({ default: m.PlatformLegal })))
const ClassCompetencies = lazy(() => import('./pages/competency').then(m => ({ default: m.ClassCompetencies })))
const SurveyManager = lazy(() => import('./pages/surveys').then(m => ({ default: m.SurveyManager })))
const MySurveys = lazy(() => import('./pages/surveys').then(m => ({ default: m.MySurveys })))
const StudentMyCompetencies = lazy(() => import('./pages/competency').then(m => ({ default: m.StudentMyCompetencies })))
const TeacherCompetencyProfile = lazy(() => import('./pages/competency').then(m => ({ default: m.TeacherCompetencyProfile })))
const TrainingProgramsPage = lazy(() => import('./pages/training/Programs').then(m => ({ default: m.TrainingProgramsPage })))
const TrainingPlansPage = lazy(() => import('./pages/training/Plans').then(m => ({ default: m.TrainingPlansPage })))
const TrainingCalendarPage = lazy(() => import('./pages/training/Schedule').then(m => ({ default: m.TrainingCalendarPage })))
const TrainingResultsPage = lazy(() => import('./pages/training/Results').then(m => ({ default: m.TrainingResultsPage })))
const TrainingCertificatesPage = lazy(() => import('./pages/training/Certificates').then(m => ({ default: m.TrainingCertificatesPage })))
const CertTemplatesPage = lazy(() => import('./pages/training/Certificates').then(m => ({ default: m.CertTemplatesPage })))
const TeacherCertificates = lazy(() => import('./pages/training/Certificates').then(m => ({ default: m.TeacherCertificates })))
const CertVerify = lazy(() => import('./pages/training/Certificates').then(m => ({ default: m.CertVerify })))
const TeacherTrainingRegister = lazy(() => import('./pages/teacher/TrainingRegister').then(m => ({ default: m.TeacherTrainingRegister })))
const TrainersPage = lazy(() => import('./pages/training/Trainers').then(m => ({ default: m.TrainersPage })))
const TeacherTrainingLearn = lazy(() => import('./pages/teacher/TrainingLearn').then(m => ({ default: m.TeacherTrainingLearn })))
const SchoolTrainingAssigned = lazy(() => import('./pages/training/Plans').then(m => ({ default: m.SchoolTrainingAssigned })))
// Trường: kế hoạch được cấp trên giao (chọn GV, gửi duyệt) + kế hoạch riêng của trường
const SchoolTrainingPlans = (p: any) => <TabbedPages {...p} tabs={[['Được giao', SchoolTrainingAssigned], ['Kế hoạch của trường', TrainingPlans]]} />
const SchoolTeacherAssessments = lazy(() => import('./pages/competency').then(m => ({ default: m.SchoolTeacherAssessments })))
// Đợt 6 (088): đợt đánh giá, khoảng thiếu hụt, khung năng lực, giám sát tập huấn
const AssessmentRoundsPage = lazy(() => import('./pages/training/Competency').then(m => ({ default: m.AssessmentRoundsPage })))
const CompetencyGapsPage = lazy(() => import('./pages/training/Competency').then(m => ({ default: m.CompetencyGapsPage })))
const CompetencyFrameworkPage = lazy(() => import('./pages/training/Competency').then(m => ({ default: m.CompetencyFrameworkPage })))
const TrainingMonitorPage = lazy(() => import('./pages/training/Monitor').then(m => ({ default: m.TrainingMonitorPage })))
const AllTeacherAssessments = (p: any) => <SchoolTeacherAssessments {...p} orgId={null} readOnly />
const SchoolCompetencyTabs = (p: any) => <TabbedPages {...p} tabs={[['Đánh giá', SchoolTeacherAssessments], ['Đợt đánh giá', AssessmentRoundsPage], ['Khoảng thiếu hụt', CompetencyGapsPage]]} />
const AuthorityCompetencyTabs = (p: any) => <TabbedPages {...p} tabs={[['Kết quả đánh giá', AllTeacherAssessments], ['Đợt đánh giá', AssessmentRoundsPage], ['Khoảng thiếu hụt', CompetencyGapsPage]]} />
// Quản trị hệ thống thao tác thay đơn vị ngay trong trang (OrgScope): kind 'school' = chọn trường, 'unit' = KDI / Sở / Phòng
const scoped = (kind: ScopeKind, key: string, C: ComponentType<any>, extra: Record<string, unknown> = {}) => (p: any) =>
  <OrgScope kind={kind} storeKey={key}>{s => <C {...p} {...extra} orgId={s.orgId} scope={s.scope} />}</OrgScope>
const PH1_TABS = {
  assess: scoped('school', 'school', SchoolTeacherAssessments), rounds: scoped('unit', 'unit', AssessmentRoundsPage, { only: true }), gaps: scoped('school', 'school', CompetencyGapsPage, { only: true }),
  plans: scoped('unit', 'unit', TrainingPlansPage), cal: scoped('unit', 'unit', TrainingCalendarPage), trainers: scoped('unit', 'unit', TrainersPage), school: scoped('school', 'school', SchoolTrainingAssigned),
  lessons: scoped('any', 'any', TrainingLessons), virtual: scoped('any', 'any', VirtualClass),
}
const PlatformCompetencyTabs = (p: any) => <TabbedPages {...p} tabs={[['Đánh giá theo trường', PH1_TABS.assess], ['Toàn hệ thống', AllTeacherAssessments],
  ['Đợt đánh giá', PH1_TABS.rounds], ['Khoảng thiếu hụt', PH1_TABS.gaps], ['Khung năng lực', CompetencyFrameworkPage]]} />
const PlatformSupport = lazy(() => import('./pages/support/Support').then(m => ({ default: m.PlatformSupport })))
// Đợt 2 (025): triển khai khách hàng, danh mục gói, đơn đặt gói, thông báo hàng loạt, tích hợp
const PlatformRollout = lazy(() => import('./pages/platform/Rollout').then(m => ({ default: m.PlatformRollout })))
const CurriculumBooks = lazy(() => import('./pages/curriculum').then(m => ({ default: m.CurriculumBooks })))
const CurriculumProgress = lazy(() => import('./pages/curriculum').then(m => ({ default: m.CurriculumProgress })))
const YearPlan = lazy(() => import('./pages/curriculumPlan').then(m => ({ default: m.YearPlan })))
const Allocation = lazy(() => import('./pages/curriculumPlan').then(m => ({ default: m.Allocation })))
const Schedule = lazy(() => import('./pages/curriculumPlan').then(m => ({ default: m.Schedule })))
const AssignPrograms = lazy(() => import('./pages/curriculumPlan').then(m => ({ default: m.AssignPrograms })))
const ClassCoverage = lazy(() => import('./pages/curriculumPlan').then(m => ({ default: m.ClassCoverage })))
const DistTiersCatalog = lazy(() => import('./pages/dist/Tiers').then(m => ({ default: m.DistTiersCatalog })))
const DistPage = lazy(() => import('./pages/dist/Plans').then(m => ({ default: m.DistPage })))
const PlanVsActual = lazy(() => import('./pages/curriculumPlan').then(m => ({ default: m.PlanVsActual })))
// Chương trình giáo dục chuẩn: phiên bản, cấu trúc, yêu cầu cần đạt, duyệt / ban hành, gán cho trường (058)
const EduPrograms = lazy(() => import('./pages/eduPrograms').then(m => ({ default: m.EduPrograms })))
const eduPrograms = (mode: 'school' | 'authority' | 'platform') => (p: any) => <EduPrograms {...p} mode={mode} />
const EduProgramsPlatform = eduPrograms('platform')
// Danh mục môn học, gắn môn cho học phần (064)
const SubjectsCatalog = lazy(() => import('./pages/subjects').then(m => ({ default: m.SubjectsCatalog })))
const subjectsTab = (mode: 'school' | 'authority' | 'platform') => (p: any) => <SubjectsCatalog {...p} mode={mode} />
const SubjectsPlatform = subjectsTab('platform')
const eduProgramTabs = (mode: 'school' | 'authority') => {
  const tabs: [string, any][] = [['Chương trình giáo dục', eduPrograms(mode)], ['Môn học', subjectsTab(mode)]]
  return (p: any) => <TabbedPages {...p} tabs={tabs} />
}
// Danh mục loại chương trình (CT1–CT5 và loại thêm sau): tên, mô tả, môn học, cấp học (062, 064)
const EduLevelsCatalog = lazy(() => import('./pages/eduLevels').then(m => ({ default: m.EduLevelsCatalog })))
const StemTracksCatalog = lazy(() => import('./pages/stemTracks').then(m => ({ default: m.StemTracksCatalog })))
const ProgramCatalogs = (p: any) => <TabbedPages {...p} tabs={[['Nhóm chương trình', StemTracksCatalog], ['Cấp học & khối', EduLevelsCatalog], ['Mức độ phân phối', DistTiersCatalog]]} />
const ProgressPlatform = (q: any) => <CurriculumProgress {...q} mode="platform" />
// Định mức vật tư theo bài / chủ đề, danh mục vật tư, dự trù, đề xuất điều chỉnh (059)
const MaterialNorms = lazy(() => import('./pages/materialNorms').then(m => ({ default: m.MaterialNorms })))
// Soạn giáo án theo mẫu, tiến trình dạy học, duyệt / xuất bản / phiên bản (060)
const TeacherLessonStudio = lazy(() => import('./pages/lessons/Studio').then(m => ({ default: m.TeacherLessonStudio })))
const SchoolLessons = lazy(() => import('./pages/lessons/Admin').then(m => ({ default: m.SchoolLessons })))
const DeptLessons = lazy(() => import('./pages/lessons/Admin').then(m => ({ default: m.DeptLessons })))
const PlatformLessonTemplates = lazy(() => import('./pages/lessons/Admin').then(m => ({ default: m.PlatformLessonTemplates })))
// Theo video demo Phân hệ 2 (23/10): Phân phối chương trình là một trang riêng (hướng dẫn 3 bước, số liệu, 3 tab).
// Theo dõi thực hiện và các màn PPCT cũ chuyển sang menu "Theo dõi Chương trình/Môn học".
const PlatformDistPage = (p: any) => <DistPage {...p} />
// Phân phối chương trình theo tiết + tiến độ (057): cùng một màn cho trường / GV, Sở (soạn mẫu ban hành), KDI (mẫu dùng chung)
const ppctTabs = (mode: 'school' | 'authority' | 'platform', extra: [string, ComponentType<any>][] = []) => {
  const tabs: [string, ComponentType<any>][] = [
    [mode === 'school' ? 'Kế hoạch năm' : 'Tổng quan theo khối', (q: any) => <YearPlan {...q} mode={mode} />],
    [mode === 'platform' ? 'Mẫu PPCT của KDI' : mode === 'authority' ? 'PPCT & mẫu ban hành' : 'Phân phối chương trình', (q: any) => <CurriculumBooks {...q} mode={mode} />],
    ['Phân bổ tiết', (q: any) => <Allocation {...q} mode={mode} />],
    ['Lịch dự kiến', (q: any) => <Schedule {...q} mode={mode} />],
    mode === 'school' ? ['Lớp × môn', (q: any) => <ClassCoverage {...q} />] : ['Gán cho trường', (q: any) => <AssignPrograms {...q} mode={mode} />],
    [mode === 'school' ? 'Tiến độ dạy' : 'Tiến độ các trường', (q: any) => <><PlanVsActual {...q} mode={mode} /><CurriculumProgress {...q} mode={mode} /></>],
    ...extra,
  ]
  return (p: any) => <TabbedPages {...p} tabs={tabs} />
}
// Theo dõi Chương trình/Môn học (cổng KDI)
const PlatformProgramTrack = (p: any) => <TabbedPages {...p} tabs={[['Chương trình CT1–CT5', DeptPrograms], ['Môn học STEM', DeptSubjects],
  ['Tiến độ & yêu cầu cần đạt', ProgressPlatform], ['Kế hoạch so với thực tế', (q: any) => <PlanVsActual {...q} mode="platform" />], ['PPCT các trường', SysCurriculum]]} />
function PlatformEduProgramsPage(p: any) {
  const [track, setTrack] = useState(false)
  return <>
    <div className="pagecorner">
      <button className={track ? '' : 'primary'} onClick={() => setTrack(!track)}>{track ? '← Chương trình giáo dục' : 'Theo dõi Chương trình/Môn học'}</button>
    </div>
    {track ? <><h2 className="pagesub">Theo dõi Chương trình/Môn học</h2><PlatformProgramTrack {...p} /></>
      : <TabbedPages {...p} tabs={[['Chương trình giáo dục', EduProgramsPlatform], ['Môn học', SubjectsPlatform], ['Danh mục', ProgramCatalogs]]} />}
  </>
}
const PLATFORM_LESSON_TABS: [string, ComponentType<any>][] = [
  ['Bài giảng KDI', (p: any) => <LibraryManage {...p} only="lesson" />], ['Kho hoạt động', SysActivities],
  ['Bài giảng các trường', SysSchoolLessons], ['Mẫu giáo án', PlatformLessonTemplates]]
const PlatformLessonsPage = (p: any) => <TabbedPages {...p} tabs={PLATFORM_LESSON_TABS} />
const PlatformCatalog = lazy(() => import('./pages/platform/Catalog').then(m => ({ default: m.PlatformCatalog })))
const PlatformOrders = lazy(() => import('./pages/platform/Catalog').then(m => ({ default: m.PlatformOrders })))
const PlatformBroadcast = lazy(() => import('./pages/platform/Broadcast').then(m => ({ default: m.PlatformBroadcast })))
const PlatformIntegrations = lazy(() => import('./pages/platform/Integrations').then(m => ({ default: m.PlatformIntegrations })))
// S3 (029): phòng STEM & lịch phòng, thiết bị toàn hệ thống
const RoomsOverview = lazy(() => import('./pages/platform/Resources').then(m => ({ default: m.RoomsOverview })))
const ModuleUsage = lazy(() => import('./pages/platform/Modules').then(m => ({ default: m.ModuleUsage })))
const DefaultPermissions = lazy(() => import('./pages/platform/Modules').then(m => ({ default: m.DefaultPermissions })))
const PlatformSchools = lazy(() => import('./pages/platform/Schools').then(m => ({ default: m.PlatformSchools })))
const BrandingPage = lazy(() => import('./pages/branding').then(m => ({ default: m.BrandingPage })))
const ParentP = (n: string) => lazy(() => import('./pages/parent').then(m => ({ default: (m as any)[n] })))
const GuardiansPage = lazy(() => import('./pages/Guardians'))
const PARENT: PageMap = {
  'Ứng dụng di động': MobileAppPage,
  'Tổng quan': ParentP('ParentHome'), 'Lịch học': ParentP('ParentSchedule'), 'Chuyên cần của con': ParentP('ParentAttendance'),
  'Bài tập & điểm': ParentP('ParentAssignments'), 'Năng lực của con': ParentP('ParentCompetency'), 'Cài đặt & đồng ý': ParentP('ParentSettings'),
  'Khảo sát': lazy(() => import('./pages/surveys').then(m => ({ default: m.MySurveys }))),
  'Sự kiện': lazy(() => import('./pages/events').then(m => ({ default: m.MyEvents }))),
  'Dự án STEM': lazy(() => import('./pages/contest/Projects').then(m => ({ default: m.ParentProjects }))),
}
const StemIndexPage = lazy(() => import('./pages/department/StemIndex').then(m => ({ default: m.StemIndexPage })))
const IndexConfigPage = lazy(() => import('./pages/department/StemIndex').then(m => ({ default: m.IndexConfigPage })))
const ComparePage = lazy(() => import('./pages/department/StemIndex').then(m => ({ default: m.ComparePage })))
const EventManager = lazy(() => import('./pages/events').then(m => ({ default: m.EventManager })))
const MyEvents = lazy(() => import('./pages/events').then(m => ({ default: m.MyEvents })))
const ProjectsPage = lazy(() => import('./pages/contest/Projects').then(m => ({ default: m.ProjectsPage })))
const CompetitionsPage = lazy(() => import('./pages/contest/Competitions').then(m => ({ default: m.CompetitionsPage })))
const JudgingPage = lazy(() => import('./pages/contest/Judging').then(m => ({ default: m.JudgingPage })))
const JUDGE: PageMap = { 'Chấm thi': JudgingPage }
const DataExportPage = lazy(() => import('./pages/dataexport').then(m => ({ default: m.DataExportPage })))
const PlatformRevenue = lazy(() => import('./pages/platform/Revenue').then(m => ({ default: m.PlatformRevenue })))
const SupplyRequestsPage = lazy(() => import('./pages/stockflow').then(m => ({ default: m.SupplyRequestsPage })))
const TransfersPage = lazy(() => import('./pages/stockflow').then(m => ({ default: m.TransfersPage })))
const SuppliesPage = lazy(() => import('./pages/inventory').then(m => ({ default: m.SuppliesPage })))
const StocktakePage = lazy(() => import('./pages/inventory').then(m => ({ default: m.StocktakePage })))
const EquipmentOverview = lazy(() => import('./pages/platform/Resources').then(m => ({ default: m.EquipmentOverview })))
const CustomerSupport = lazy(() => import('./pages/support/Support').then(m => ({ default: m.CustomerSupport })))

const GeneralSettings = lazy(() => import('./pages/settings/General').then(m => ({ default: m.GeneralSettings })))
type PageMap = Record<string, ComponentType<any>>
const SCHOOL: PageMap = {
  'Dự án STEM': ProjectsPage,
  'Cuộc thi': CompetitionsPage,
  'Sự kiện': EventManager,
  'Đánh giá năng lực GV': SchoolCompetencyTabs,
  'Giám sát tập huấn': TrainingMonitorPage,
  'Khảo sát': SurveyManager,
  'Năng lực học sinh': ClassCompetencies,
  'Dashboard Trường': Dashboard,
  'Giáo viên': Teachers,
  'Lớp học': Classes,
  'Quản lý Phòng STEM': Rooms,
  'Quản lý Thiết bị': Equipment,
  'Vật tư tiêu hao': SuppliesPage,
  'Đề xuất mua vật tư': SupplyRequestsPage,
  'Vận chuyển vật tư': TransfersPage,
  'Kiểm kê': StocktakePage,
  'Bảo hành thiết bị': Warranty,
  'Phân công giảng dạy': Assignments,
  'Thời khóa biểu': Timetable,
  'Duyệt đăng ký dạy STEM': Registrations,
  'Học sinh': Students,
  'Phụ huynh': GuardiansPage,
  'Tòa nhà & Tầng': Buildings,
  'Cấu hình tiết học': Periods,
  'Vai trò và phân quyền': Roles,
  'Tài khoản': Accounts,
  'Gói STEM': Packages,
  'Kế hoạch GD toàn trường': EduPlan,
  'Phân công GV dạy STEM': StemAssign,
  'Phân phối chương trình': ppctTabs('school'),
  'Chương trình giáo dục': eduProgramTabs('school'),
  'Hồ sơ Trường học': SchoolProfile,
  'Kế hoạch tập huấn': SchoolTrainingPlans,
  'Lịch tập huấn': TrainingSchedule,
  'Bài giảng': TrainingLessons,
  'Lớp học ảo': VirtualClass,
  'Chứng chỉ': TrainingCertificatesPage,
  'Đánh giá kết quả tập huấn': TrainingResultsPage,
  'Năm học & học kỳ': Years,
  'Thiết lập chung': GeneralSettings,
  'Hộp phê duyệt': ApprovalInbox,
  'Quy trình phê duyệt': ApprovalWorkflows,
  'Đề xuất mua gói': PackageOrders,
  'Kho học liệu dùng chung': LibraryBrowse,
  'Phát hành học liệu': LibraryManage,
  'Định mức vật tư': MaterialNorms,
  'Giáo án & bài giảng': SchoolLessons,
  'Hỗ trợ từ KDI': CustomerSupport,
  'Ứng dụng di động': MobileAppPage,
  'Trợ lý AI': (p: any) => <AssistantPage {...p} onSaveQuiz={(i: any, m: any) => saveQuizToBank(p.orgId, i, m)} />,
  'E-learning & luyện thi': ElearningManage,
  'Ngân hàng câu hỏi': QuestionBank,
  'Buổi dạy & điểm danh': SchoolSessions,
  'Dashboard điểm danh': AttendanceDashboard,
  'Sao lưu & xuất dữ liệu': DataExportPage,
  'Giao diện & thương hiệu': BrandingPage,
  'Ngày nghỉ & lễ': Holidays,
}
const TEACHER: PageMap = {
  'Phân phối chương trình': ppctTabs('school'),
  'Chương trình giáo dục': eduProgramTabs('school'),
  'Ứng dụng di động': MobileAppPage,
  'Trợ lý AI': (p: any) => <AssistantPage {...p} onSaveQuiz={(i: any, m: any) => saveQuizToBank(p.orgId, i, m)} />,
  'E-learning & luyện thi': ElearningManage,
  'Ngân hàng câu hỏi': QuestionBank,
  'Dự án STEM': ProjectsPage,
  'Cuộc thi': CompetitionsPage,
  'Chấm thi': JudgingPage,
  'Sự kiện': MyEvents,
  'Tổng quan': TeacherHome,
  'Kế hoạch giáo dục': TeacherSchedule,
  'Lớp giảng dạy': TeacherClasses,
  'Điểm danh': TeacherAttendance,
  'Đặt phòng STEM': TeacherBooking,
  'Bài tập': TeacherAssignments,
  'Chấm bài': TeacherGrading,
  'Năng lực học sinh': ClassCompetencies,
  'Hồ sơ năng lực': TeacherCompetencyProfile,
  'Khảo sát': MySurveys,
  'Giáo dục STEM': TeacherClassroom,
  'Soạn bài giảng': TeacherLessonStudio,
  'Hộp phê duyệt': ApprovalInbox,
  'Thư viện STEM': (p: any) => <TabbedPages {...p} tabs={[['Theo chương trình', LibraryPrograms], ['Kho học liệu', LibraryBrowse]]} />,
  'Định mức vật tư': MaterialNorms,
  'Lịch tập huấn': TeacherTrainingSchedule,
  'Đăng ký tập huấn': TeacherTrainingRegister,
  'Chứng chỉ tập huấn': TeacherCertificates,
  'Bài giảng tập huấn': (p: any) => <TabbedPages {...p} tabs={[['Khoá tập huấn của tôi', TeacherTrainingLearn], ['Bài giảng của trường', TeacherTrainingLessons]]} />,
  'Hỗ trợ từ KDI': CustomerSupport,
  'Kho hoạt động & Bài giảng': TeacherActivities,
  'Học trước & tự học': TeacherSelfStudy,
}
const STUDENT: PageMap = {
  'E-learning & luyện thi': StudentElearning,
  'Dự án STEM': ProjectsPage,
  'Sự kiện': MyEvents,
  'Tổng quan': StudentHome,
  'Năng lực của em': StudentMyCompetencies,
  'Khảo sát': MySurveys,
  'Bài tập': StudentAssignments,
  'Lịch học': StudentSchedule,
  'Giáo dục STEM': StudentClassroom,
  'Chủ đề': StudentTopics,
  'Học trước & tự học': StudentSelfStudy,
  'Chuyên cần': StudentAttendance,
}
const DEPARTMENT: PageMap = {
  'Phân phối chương trình': ppctTabs('authority'),
  'Chương trình giáo dục': eduProgramTabs('authority'),
  'Trợ lý AI': (p: any) => <AssistantPage {...p} onSaveQuiz={(i: any, m: any) => saveQuizToBank(p.orgId, i, m)} />,
  'E-learning & luyện thi': ElearningManage,
  'Ngân hàng câu hỏi': QuestionBank,
  'Dự án STEM': (p: any) => <ProjectsPage {...p} readOnly />,
  'Cuộc thi': CompetitionsPage,
  'Chấm thi': JudgingPage,
  'Sự kiện': EventManager,
  'Chỉ số STEM': StemIndexPage,
  'So sánh trường / địa bàn': ComparePage,
  'Bộ chỉ số': IndexConfigPage,
  'Dashboard toàn Sở': DeptDashboard,
  'KPI & Xếp hạng Xã/Phường': DeptWardKpi,
  'Cảnh báo & trường cần chú ý': DeptAlerts,
  'Giao chỉ tiêu': DeptTargets,
  'Khảo sát': SurveyManager,
  'Danh sách Trường': DeptSchools,
  'Dashboard điểm danh': AttendanceDashboard,
  'Chương trình CT1–CT5': DeptPrograms,
  'Theo dõi Môn học STEM': DeptSubjects,
  'Giám sát Tập huấn GV': (p: any) => <TabbedPages {...p} tabs={[['Theo kế hoạch', TrainingMonitorPage], ['Tổng quan theo trường', DeptTrainingMonitor]]} />,
  'Đánh giá năng lực nhà giáo': AuthorityCompetencyTabs,
  'Kế hoạch tập huấn': (p: any) => <TabbedPages {...p} tabs={[['Kế hoạch', TrainingPlansPage], ['Giảng viên', TrainersPage]]} />,
  'Lịch tập huấn': TrainingCalendarPage,
  'Đánh giá kết quả tập huấn': TrainingResultsPage,
  'Chứng chỉ tập huấn': TrainingCertificatesPage,
  'Hiệu quả Phòng STEM': DeptRoomEffect,
  'Phòng STEM & lịch phòng': RoomsOverview,
  'Thiết bị & kho': EquipmentOverview,
  'Sao lưu & xuất dữ liệu': DataExportPage,
  'Giao diện & thương hiệu': BrandingPage,
  'Ngày nghỉ & lễ': Holidays,
  'Báo cáo Bộ GD&ĐT': DeptReports,
  'Điều hành & Cấu hình': DeptAdmin,
  'Hộp phê duyệt': ApprovalInbox,
  'Quy trình phê duyệt': ApprovalWorkflows,
  'Phát hành học liệu': LibraryManage,
  'Kho học liệu dùng chung': LibraryBrowse,
  'Định mức vật tư': MaterialNorms,
  'Giáo án & bài giảng': DeptLessons,
  'Hỗ trợ từ KDI': CustomerSupport,
}
// Cổng Quản trị nền tảng: chỉ nối các trang đọc được dữ liệu toàn hệ thống (trang nền tảng, trang cấp Sở, học liệu, phê duyệt, tập huấn).
// Mục menu không có ở đây hiện khung giao diện (PlannedPage); build xong phân hệ nào thì thêm trang vào đây.
const PLATFORM: PageMap = {
  'Dự án STEM': (p: any) => <ProjectsPage {...p} readOnly />,
  'Cuộc thi STEM': (p: any) => <CompetitionsPage {...p} platform />,
  'Chấm thi': JudgingPage,
  'Sự kiện': EventManager,
  'Chỉ số STEM (STEM Index)': (p: any) => <StemIndexPage {...p} platform />,
  'Điều hành toàn tỉnh': (p: any) => <StemIndexPage {...p} platform groupBy="department" />,
  'So sánh trường / địa bàn': ComparePage,
  'Bộ chỉ số': (p: any) => <IndexConfigPage {...p} platform />,
  'Dashboard tổng hợp': DeptDashboard,
  'Nghiệm thu & doanh thu': PlatformRevenue,
  'Sao lưu & xuất dữ liệu': (p: any) => <DataExportPage {...p} platform />,
  'Giao diện & thương hiệu': (p: any) => <BrandingPage {...p} platform />,
  'Tổng quan hệ thống': PlatformOverview,
  'Thiết lập chung': (p: any) => <GeneralSettings {...p} platform />,
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
  'Điều khoản & dữ liệu cá nhân': PlatformLegal,
  'Đánh giá năng lực nhà giáo': PlatformCompetencyTabs,
  'Đánh giá năng lực người học': ClassCompetencies,
  'Khảo sát': SurveyManager,
  'Vấn đề & phản hồi': PlatformSupport,
  'Thông tin khách hàng': PlatformCustomers,
  'Gói dịch vụ & hợp đồng': PlatformContracts,
  'Triển khai khách hàng': PlatformRollout,
  'Đơn đặt gói STEM': (p: any) => <TabbedPages {...p} tabs={[['Đơn đặt gói', PlatformOrders], ['Gói STEM của KDI', PlatformCatalog]]} />,
  'Tích hợp & dữ liệu': PlatformIntegrations,
  // 1. Đào tạo & đánh giá năng lực nhà giáo — làm lại theo khuôn Phân hệ 2 (kế hoạch: Chương trình → Kế hoạch & lịch → … → Giám sát)
  'Chương trình tập huấn': TrainingProgramsPage,
  'Kế hoạch & lịch tập huấn': (p: any) => <TabbedPages {...p} tabs={[['Kế hoạch', PH1_TABS.plans], ['Lịch', PH1_TABS.cal], ['Giảng viên', PH1_TABS.trainers], ['Trường thực hiện', PH1_TABS.school]]} />,
  'Giám sát tập huấn nhà giáo': (p: any) => <TabbedPages {...p} tabs={[['Theo kế hoạch', TrainingMonitorPage], ['Tổng quan theo trường', DeptTrainingMonitor]]} />,
  'Đánh giá kết quả tập huấn': TrainingResultsPage,
  // 2. Chương trình & học liệu
  // Theo file thiết kế Phân hệ 2: 2 tab chính; danh mục nhóm chương trình, cấp học gom vào tab "Danh mục"
  // Tạm thời: "Theo dõi Chương trình/Môn học" mở bằng nút góc trên phải của trang này (không còn là mục menu riêng)
  'Chương trình giáo dục': PlatformEduProgramsPage,
  'Học liệu': LibraryPage,
  'Theo dõi chương trình CT1–CT5 (Môn học)': PlatformProgramTrack,
  // 3. Vật tư, thiết bị dạy & học
  'Thiết bị & vật tư': EquipmentOverview,
  'Kho & tồn kho': SuppliesPage,
  'Mua hàng & đề xuất vật tư': SupplyRequestsPage,
  'Vận chuyển vật tư': TransfersPage,
  'Cấp phát & bàn giao': (p: any) => <SuppliesPage {...p} initialTab="moves" />,
  'Kiểm kê': StocktakePage,
  'Phòng STEM & lịch phòng': RoomsOverview,
  'Hiệu quả sử dụng phòng STEM': DeptRoomEffect,
  // 4. Vận hành giảng dạy & đánh giá người học
  'Thời khóa biểu & xếp lịch': TimetableOverview,
  'Buổi dạy & điểm danh': AttendanceDashboard,
  // 5. Hệ thống quản lý vận hành
  'Báo cáo vận hành': DeptDashboard,
  'KPI & xếp hạng': DeptWardKpi,
  'Báo cáo cấp trên (Bộ GD&ĐT)': DeptReports,
  'Cảnh báo & trường cần chú ý': DeptAlerts,
  'Giao chỉ tiêu': DeptTargets,
  'Điều hành & cấu hình (Sở)': DeptAdmin,
  // 5.5–5.6: tên theo file rà soát, dùng lại màn chung
  'Tổ chức & phân quyền': (p: any) => <TabbedPages {...p} tabs={[['Cây tổ chức', PlatformOrgs], ['Người dùng & vai trò', PlatformUsers], ['Lời mời', PlatformInvites]]} />,
  'Nhật ký hoạt động': PlatformAudit,
  'Lộ trình triển khai': PlatformRollout,
  'Cấu hình chung (kỳ học...)': DeptAdmin,
  'Thuật ngữ chuẩn': TerminologyPage,
  'Ứng dụng di động & ngoại tuyến': MobileAppPage,
  'Trợ lý AI': PlatformAI,
  'E-learning & luyện thi': ElearningManage,
  // Màn xem toàn hệ thống (gom dữ liệu mọi trường, lọc theo Sở / trường) — pages/platform/SystemViews.tsx
  'Bảo hành & bảo trì thiết bị': SysWarranty,
  'Tòa nhà, tầng & tiết học': SysBuildings,
  'Nhà giáo & trợ giảng': SysTeachers,
  'Phân công giảng dạy': SysTeaching,
  'Người học': SysStudents,
  'Công cụ người học & phụ huynh': SysGuardians,
  'Kế hoạch giáo dục toàn trường': SysEduPlan,
  'Duyệt đăng ký dạy STEM': SysRegistrations,
  'Bài tập & chấm bài': SysHomework,
  'Phân phối chương trình': PlatformDistPage,
  'Soạn bài giảng & kho hoạt động': PlatformLessonsPage,
  'Bài giảng tập huấn & lớp học ảo': (p: any) => <TabbedPages {...p} tabs={[['Bài giảng', PH1_TABS.lessons], ['Lớp học ảo', PH1_TABS.virtual], ['Toàn hệ thống', SysTrainingLessons]]} />,
  'Chứng chỉ tập huấn': (p: any) => <TabbedPages {...p} tabs={[['Chứng chỉ', TrainingCertificatesPage], ['Mẫu chứng chỉ', CertTemplatesPage]]} />,
}
const PLATFORM_LIVE = new Set(Object.keys(PLATFORM))
PLATFORM['Sơ đồ hệ thống'] = (p: any) => <SystemMap {...p} live={PLATFORM_LIVE} />
PLATFORM['Phân hệ & mức sử dụng'] = (p: any) => <ModuleUsage {...p} live={PLATFORM_LIVE} />
PLATFORM_LIVE.add('Phân hệ & mức sử dụng')
// Tên trang cũ (liên kết nội bộ của trang Sở) → tên trong menu Quản trị nền tảng
const PLATFORM_ALIAS: Record<string, string> = {
  'KPI & Xếp hạng Xã/Phường': 'KPI & xếp hạng', 'Thiết bị & kho': 'Thiết bị & vật tư', 'Hiệu quả Phòng STEM': 'Hiệu quả sử dụng phòng STEM',
  'Dashboard điểm danh': 'Buổi dạy & điểm danh', 'Thời khoá biểu & xếp lịch': 'Thời khóa biểu & xếp lịch',
  'Đánh giá năng lực giáo viên': 'Đánh giá năng lực nhà giáo', 'Kế hoạch tập huấn': 'Kế hoạch & lịch tập huấn', 'Lịch tập huấn': 'Kế hoạch & lịch tập huấn',
}
export const PAGES: Partial<Record<RoleKey, PageMap>> = { school_admin: SCHOOL, teacher: TEACHER, student: STUDENT, department: DEPARTMENT, platform: PLATFORM, parent: PARENT, judge: JUDGE }
// Khi dev: mục menu không có trang (thường do sửa chuỗi mã trong NAV thay vì thêm LABEL — xem lib/nav.ts)
if (import.meta.env.DEV) (Object.keys(PAGES) as RoleKey[]).filter(r => r !== 'platform').forEach(r =>
  NAV[r].flatMap(g => g.items).filter(i => !PAGES[r]![i]).forEach(i => console.warn(`[menu] ${r}: "${i}" không có trang`)))

// Trang tra cứu chứng chỉ công khai (QR trên chứng chỉ): /?cc=<mã>, không cần đăng nhập
export default function App() {
  const cc = new URLSearchParams(location.search).get('cc')
  if (cc) return <Suspense fallback={null}><CertVerify token={cc} /></Suspense>
  return <AppMain />
}

function AppMain() {
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
  // Quên mật khẩu; hoặc tài khoản mã lần đầu đăng nhập / vừa được trường đặt lại mật khẩu (bắt buộc đổi)
  if (recovery || mustChangePassword(session.user.user_metadata)) return <SetPassword forced={!recovery} onDone={() => setRecovery(false)} />
  return <MfaGate key={session.user.id}><LegalGate><Shell session={session} /></LegalGate></MfaGate>
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
  const settings = useSettings(access.profile?.org_id ?? null)

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

  const brand = useBranding(access.profile?.org_id, !!role && role !== 'platform')

  if (access.loading) return null
  if (changingPw) return <SetPassword onDone={() => setChangingPw(false)} />
  if (access.profile?.locked_at) {
    return (
      <div className="login"><form onSubmit={e => e.preventDefault()}>
        <img src={logo} alt="KDI education" /><h1>Tài khoản đã bị khoá</h1>
        <p>Tài khoản <b>{(session.user.user_metadata?.login as string | undefined) ?? session.user.email}</b> đã bị khoá{access.profile.locked_reason ? `: ${access.profile.locked_reason}` : ''}. Liên hệ KDI Education để được hỗ trợ.</p>
        <button type="button" onClick={() => supabase.auth.signOut()}>Đăng xuất</button>
      </form></div>
    )
  }
  if (!access.profile?.org_id || views.length === 0) {
    return (
      <div className="login"><form onSubmit={e => e.preventDefault()}>
        <img src={logo} alt="KDI education" /><h1>Đang chờ cấp quyền</h1>
        <p>Tài khoản <b>{(session.user.user_metadata?.login as string | undefined) ?? session.user.email}</b> chưa được gán vào trường hoặc chưa có vai trò. Hãy nhờ quản trị trường gán trong mục Tài khoản.</p>
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
  // Thiết lập chung › Tên & menu: tên, thứ tự, ẩn/hiện (KDI mặc định, trường tự chỉnh); "Thiết lập chung" không ẩn được
  const menu = menuOf(settings, role)
  const lab = (i: string) => menu.labels[i] || labelOf(role, i)
  const groups = NAV[role]
    .map(g => ({ ...g, label: menu.groups[g.title] || g.title,
      items: orderItems(g.items, menu.order[g.title]).filter(i => roleOk(i) && (inPlan(i) || locked.has(i)) && (i === 'Thiết lập chung' || !menu.hidden.includes(i))) }))
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
  // Tài khoản mã: hiện tên đăng nhập thay cho email nội bộ
  const email = (session.user.user_metadata?.login as string | undefined) ?? session.user.email ?? ''

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
      <nav className="side" aria-label="Menu chính">
        <div className="sidebrand">
          {brand?.logo_dark ? <img src={brand.logo_dark} alt={brand.display_name ?? 'Logo'} /> : brand?.logo ? <img src={brand.logo} alt={brand.display_name ?? 'Logo'} className="onchip" /> : <img src={logoWhite} alt="KDI education" />}
          <b>{role === 'platform' ? 'Hệ thống quản lý vận hành' : ROLE_LABEL[role]}</b>
        </div>
        {role !== 'department' && role !== 'platform' && role !== 'parent' && <label className="yearpick">
          <span>Năm học · học kỳ</span>
          <select value={yrs.year?.id ?? ''} onChange={e => e.target.value === '__manage' ? (role === 'school_admin' ? show(role, 'Năm học & học kỳ') : null) : yrs.select(e.target.value)}
            aria-label="Chọn năm học và học kỳ">
            {yrs.years.length === 0 && <option value="">Chưa có năm học</option>}
            {yrs.years.map(y => <option key={y.id} value={y.id}>{yearLabel(y)}{y.is_current ? ' (hiện tại)' : ''}</option>)}
            {role === 'school_admin' && access.canView('periods') && <option value="__manage">Quản lý năm học…</option>}
          </select>
        </label>}
        {role !== 'department' && role !== 'platform' && role !== 'parent' && yrs.year && !yrs.year.is_current && <p className="yearwarn">Đang xem học kỳ không phải hiện tại</p>}
        {blocks.map(b => {
          // Một nhóm thường, hoặc một phân hệ (cấp 1) chứa các nhóm con (cấp 2)
          const head = (key: string, title: string, items: string[], sub = false, label = title) => {
            const shut = closed.has(key)
            return (
              <button className={'grouphead' + (sub ? ' subhead' : '') + (shut ? ' shut' : '')} onClick={() => toggleGroup(key)} aria-expanded={!shut}
                aria-controls={'grp-' + key.replace(/[^\p{L}\p{N}]+/gu, '-')}>
                {!sub && <NavIcon title={title} />}<span>{label}
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
                {lab(i)}{role === 'platform' && !PLATFORM_LIVE.has(i) && i !== 'Sơ đồ hệ thống' && <small className="navtag">Khung</small>}
                {locked.has(i) && <svg className="navlock" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Chưa có trong gói"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>}
              </button>)}
            </div>
          )
          if (!b.section) {
            const key = role + ':' + b.groups[0].title
            return <div key={key} className="navgroup">{head(key, b.groups[0].title, b.groups[0].items, false, b.groups[0].label)}{list(key, b.groups[0].items)}</div>
          }
          const key = role + '§' + b.section
          const all = b.groups.flatMap(g => g.items)
          return (
            <div key={key} className="navgroup">
              {head(key, b.section, all)}
              <div id={'grp-' + key.replace(/[^\p{L}\p{N}]+/gu, '-')} hidden={closed.has(key)} className="navsub">
                {b.groups.map(g => {
                  const k = role + ':' + g.title
                  return <div key={k}>{head(k, g.title, g.items, true, g.label)}{list(k, g.items)}</div>
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
          <img src={brand?.logo ?? logo} alt={brand?.display_name ?? 'KDI education'} />
          <span className="title">{role === 'platform' ? 'Hệ thống quản lý vận hành' : brand?.display_name ?? DEFAULT_TITLE}</span>
          <MenuSearch entries={groups.flatMap(g => g.items.map(item => ({ item, label: lab(item), group: g.section ? `${g.section} › ${g.label}` : g.label })))} onGo={i => show(role, i)} />
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
        <main className="main"><PageCtx.Provider value={page}><CatalogLists />
          <div className="pagehead"><h1>{lab(page)}</h1><PageButtons page={page} title={lab(page)} go={goPage} /></div>
          {locked.has(page) ? <LockedModule name={lab(page)} phase={PHASE_OF[ENT_MODULE_OF[page]] ?? null} entitlement={access.entitlement} go={goPage} />
            : Page ? <Suspense fallback={<p className="sub">Đang tải…</p>}><Page key={page + (yrs.year?.id ?? '') + (studentId ?? '')} teacherId={teacherId} studentId={studentId} orgId={access.profile.org_id} userName={access.profile.full_name} go={goPage} name={page}
            year={yrs.year} years={yrs.years} reloadYears={yrs.reload} selectYear={yrs.select} /></Suspense> : <p className="sub">Màn hình này sẽ được xây dựng ở bước tiếp theo.</p>}
        </PageCtx.Provider></main>
        <OfflineBar go={() => show(role, role === 'platform' ? 'Ứng dụng di động & ngoại tuyến' : 'Ứng dụng di động')} />
        <HelpWidget role={role} page={lab(page)} brand={{ name: brand?.display_name ?? null, support: brand?.support_text ?? null }} go={groups.some(g => g.items.includes('Hỗ trợ từ KDI')) ? (p: string) => show(role, p) : undefined}
          menu={groups.flatMap(g => g.items.map(i => `${g.section ? g.section + ' › ' : ''}${g.label} › ${lab(i)}`))} />
      </div>
    </div>
  )
}

