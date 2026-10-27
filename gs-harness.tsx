import { createRoot } from 'react-dom/client'
import './src/index.css'
import { PlanCal } from './src/pages/training/PlanCal'
import { SessCal, type Sess } from './src/pages/training/Schedule'
const t = new Date(), d = (n: number, h = 8) => { const x = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n, h); return x }
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
const plans: any[] = [['Đợt 1', -1, 12, 'published'], ['Tập huấn lần 1', -1, 5, 'published'], ['Tập huấn STEM cho trường mới', 2, 4, 'draft'], ['Đào tạo tinker', 6, 9, 'published'], ['Robotics nâng cao', 40, 60, 'archived']]
  .map(([name, a, b, st], i) => ({ id: 'p' + i, name, starts_on: ymd(d(a)), ends_on: ymd(d(b)), pub_status: st, plan_code: 'KHTH-00' + i }))
const titles = ['Buổi 1: Định hướng giáo dục STEM', 'Buổi 2: Thiết kế bài học', 'Buổi 3: Thực hành robot', 'Buổi 4: Đánh giá năng lực', 'Buổi 5: Tổng kết']
const sess: Sess[] = []
let k = 0
for (const [p, offs] of [['p0', [-20, -10, -1, 0, 0, 1, 3]], ['p1', [0, 0, 2, 5, 30]], ['p2', [-40, 4, 8, 60, 90]]] as [string, number[]][])
  for (const o of offs) { const s = d(o, 8 + (k % 3) * 3), e = new Date(+s + 2 * 3600e3); k++
    sess.push({ id: 's' + k, plan_id: p, unit_id: null, title: titles[k % 5], starts_at: s.toISOString(), ends_at: e.toISOString(), mode: k % 2 ? 'online' : 'offline', location: null, meeting_url: null, trainer: null, note: null, closed_at: o < -5 ? s.toISOString() : null }) }
const names: Record<string, string> = { p0: 'KHTH-001 · Đợt 1', p1: 'KHTH-002 · Tập huấn lần 1', p2: 'KHTH-003 · Đào tạo tinker' }
createRoot(document.getElementById('root')!).render(<div className="main" style={{ padding: 16, display: 'grid', gap: 24 }}>
  <div id="plan"><PlanCal plans={plans} onOpen={() => {}} label={p => p.plan_code} /></div>
  <div id="sess"><SessCal rows={sess} planName={id => names[id]} label={s => names[s.plan_id]} onOpen={() => {}} /></div>
</div>)
