// Bấm tiêu đề cột để sắp xếp bảng (Phân hệ 1 và 2: .main[data-ph="1"|"2"]). Bấm lần 1: tăng dần, lần 2: giảm dần, lần 3: bỏ sắp xếp.
// Chỉ áp cho bảng đơn giản: một hàng tiêu đề, một tbody, mỗi dòng đủ số ô (không gộp ô / dòng nhóm) để không làm rối bảng có nhóm.
// Sắp xếp ngay trên DOM; khi React vẽ lại dòng (thêm, bớt, đổi dữ liệu) thì tự sắp lại theo cột đang chọn.
const SCOPE = '.main:is([data-ph="1"],[data-ph="2"])'
const TABLES = 'table:not(.tkb,.yearplan,.sched,.pltkb,.weektkb)'
const SKIP = 'a, button, input, select, textarea, label, summary, [role="button"]'

type St = { col: number; dir: 1 | -1; obs: MutationObserver; seq: WeakMap<Element, number>; n: number }
const state = new WeakMap<HTMLTableElement, St>()

function headCells(t: HTMLTableElement) { return t.tHead?.rows.length === 1 ? Array.from(t.tHead.rows[0].cells) : null }
function simple(t: HTMLTableElement, cols: number) {
  if (t.tBodies.length !== 1) return false
  const rows = Array.from(t.tBodies[0].rows)
  return rows.length > 1 && rows.every(r => r.cells.length === cols && Array.from(r.cells).every(c => c.colSpan === 1 && c.rowSpan === 1))
}
// Giá trị so sánh: số (kiểu Việt Nam 1.234,5 · 80%), ngày dd/mm/yyyy, còn lại so chữ
function keyOf(c: HTMLTableCellElement | undefined): number | string | null {
  if (!c) return null
  const f = c.querySelector<HTMLInputElement | HTMLSelectElement>('input:not([type=checkbox]), select')
  const raw = (f ? (f instanceof HTMLSelectElement ? f.selectedOptions[0]?.text ?? '' : f.value) : c.innerText).trim()
  if (!raw || raw === '—' || raw === '-' || raw === '…') return null
  const d = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (d) { const y = +d[3] < 100 ? 2000 + +d[3] : +d[3]; const tm = raw.match(/(\d{1,2}):(\d{2})/); return y * 1e8 + +d[2] * 1e6 + +d[1] * 1e4 + (tm ? +tm[1] * 100 + +tm[2] : 0) }
  const n = raw.match(/^[^\d-]{0,3}(-?[\d.]*\d(?:,\d+)?)\s*(%|[^\d\s]{0,6})?$/)
  if (n) { const v = Number(n[1].replace(/\./g, '').replace(',', '.')); if (Number.isFinite(v)) return v }
  return raw.toLocaleLowerCase('vi')
}
function apply(t: HTMLTableElement, s: St) {
  const body = t.tBodies[0]; if (!body) return
  s.obs.disconnect()
  const rows = Array.from(body.rows)
  rows.forEach(r => { if (!s.seq.has(r)) s.seq.set(r, s.n++) })
  const k = new Map(rows.map(r => [r, keyOf(r.cells[s.col])]))
  rows.sort((a, b) => {
    const x = k.get(a)!, y = k.get(b)!
    if (s.dir && (x !== null || y !== null)) {
      if (x === null) return 1
      if (y === null) return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'vi', { numeric: true })
      if (c) return c * s.dir
    }
    return s.seq.get(a)! - s.seq.get(b)!
  })
  if (rows.some((r, i) => body.rows[i] !== r)) rows.forEach(r => body.appendChild(r))
  s.obs.observe(body, { childList: true, subtree: true, characterData: true })
}

export function installTableSort() {
  document.addEventListener('click', e => {
    if (e.button !== 0) return
    const el = e.target as Element | null
    if (!el || el.closest(SKIP)) return
    const th = el.closest('thead th') as HTMLTableCellElement | null
    const t = th?.closest('table') as HTMLTableElement | null
    if (!th || !t || !t.matches(TABLES) || !t.closest(SCOPE)) return
    const cells = headCells(t); if (!cells || !th.innerText.trim()) return
    const col = cells.indexOf(th); if (col < 0 || !simple(t, cells.length)) return
    let s = state.get(t)
    if (!s) {
      const seq = new WeakMap<Element, number>(); Array.from(t.tBodies[0].rows).forEach((r, i) => seq.set(r, i))
      s = { col, dir: 1, seq, n: t.tBodies[0].rows.length, obs: new MutationObserver(() => { const cur = state.get(t); if (cur && cur.dir && t.isConnected && simple(t, cells.length)) requestAnimationFrame(() => apply(t, cur)) }) }
      state.set(t, s)
    } else if (s.col === col) s.dir = s.dir === 1 ? -1 : (0 as 1)
    else { s.col = col; s.dir = 1 }
    cells.forEach(c => { c.classList.remove('sort-asc', 'sort-desc'); c.removeAttribute('aria-sort') })
    if (s.dir) { th.classList.add(s.dir === 1 ? 'sort-asc' : 'sort-desc'); th.setAttribute('aria-sort', s.dir === 1 ? 'ascending' : 'descending') }
    apply(t, s)
    if (!s.dir) s.obs.disconnect()
  })
}
