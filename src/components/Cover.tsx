import type { CSSProperties } from 'react'
import { TRACK_COLOR } from '../lib/stemTracks'

// Ảnh bìa bài giảng tự tạo: màu nền + hoa văn, vẽ bằng SVG ngay trên trình duyệt (không cần tải ảnh).
// Lưu trong nội dung bài giảng (lesson.cover = "gen:#0f3a76:mach"). Có ảnh thật (cover_url) thì ảnh thật được ưu tiên.

export const COVER_COLORS = ['#0f3a76', '#1f5bb8', '#0f766e', '#15803d', '#c2410c', '#b91c1c', '#6d28d9']
export const PATTERNS: [string, string][] = [['mach', 'Mạch'], ['mang', 'Mạng'], ['song', 'Sóng'], ['banve', 'Bản vẽ'], ['phantu', 'Phân tử'], ['quydao', 'Quỹ đạo']]

const HEX = /^#[0-9a-f]{6}$/i
export function parseCover(spec?: string | null): { color: string; pattern: string } | null {
  const m = /^gen:(#[0-9a-f]{6}):([a-z]+)$/i.exec(spec ?? '')
  return m && PATTERNS.some(p => p[0] === m[2]) ? { color: m[1], pattern: m[2] } : null
}
export const coverSpec = (color: string, pattern: string) => `gen:${HEX.test(color) ? color : COVER_COLORS[0]}:${pattern}`

// Hoa văn trên khung 320 × 180, nét trắng mờ
const ART: Record<string, string> = {
  mach: '<path d="M0 40h70l20 20h60M0 120h40l30-30h90l20 20h160M200 0v50l20 20v110M260 180v-50l30-30h30M120 180v-40l-20-20H60" /><circle cx="150" cy="60" r="5"/><circle cx="160" cy="90" r="5"/><circle cx="220" cy="70" r="5"/><circle cx="290" cy="100" r="5"/><circle cx="100" cy="120" r="5"/>',
  mang: '<path d="M30 30L110 70L200 30L290 80L230 150L120 140L30 30M110 70L120 140M200 30L230 150M110 70L230 150M290 80L200 30" /><circle cx="30" cy="30" r="6"/><circle cx="110" cy="70" r="6"/><circle cx="200" cy="30" r="6"/><circle cx="290" cy="80" r="6"/><circle cx="230" cy="150" r="6"/><circle cx="120" cy="140" r="6"/>',
  song: '<path d="M0 60q40-30 80 0t80 0 80 0 80 0M0 95q40-30 80 0t80 0 80 0 80 0M0 130q40-30 80 0t80 0 80 0 80 0" />',
  banve: '<path d="M0 30h320M0 60h320M0 90h320M0 120h320M0 150h320M40 0v180M80 0v180M120 0v180M160 0v180M200 0v180M240 0v180M280 0v180" opacity=".5"/><rect x="90" y="45" width="140" height="90"/><circle cx="160" cy="90" r="30"/><path d="M90 150h140M90 145v10M230 145v10"/>',
  phantu: '<path d="M90 90L150 55L210 90L210 130L150 160L90 130ZM150 55V20M210 90l40-20M90 90l-40-20M150 160v20"/><circle cx="150" cy="55" r="9"/><circle cx="210" cy="90" r="9"/><circle cx="210" cy="130" r="9"/><circle cx="150" cy="160" r="9"/><circle cx="90" cy="130" r="9"/><circle cx="90" cy="90" r="9"/>',
  quydao: '<ellipse cx="160" cy="90" rx="120" ry="40"/><ellipse cx="160" cy="90" rx="120" ry="40" transform="rotate(60 160 90)"/><ellipse cx="160" cy="90" rx="120" ry="40" transform="rotate(-60 160 90)"/><circle cx="160" cy="90" r="10"/>',
}
export function coverSvg(color: string, pattern: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><rect width="320" height="180" fill="${HEX.test(color) ? color : COVER_COLORS[0]}"/>`
    + `<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity=".28">${ART[pattern] ?? ART.mach}</g></svg>`
}
const svgUrl = (color: string, pattern: string) => `url("data:image/svg+xml,${encodeURIComponent(coverSvg(color, pattern))}")`

/** Nền ảnh bìa: ảnh thật → bìa tự tạo đã chọn → bìa mặc định theo màu nhóm chương trình. */
export function coverStyle(o: { cover_url?: string | null; lesson?: { cover?: string } | null; program?: string | null }, shade = false): CSSProperties {
  const g = parseCover(o.lesson?.cover)
  const img = o.cover_url ? `url("${o.cover_url}")` : g ? svgUrl(g.color, g.pattern) : svgUrl(TRACK_COLOR[o.program ?? ''] ?? COVER_COLORS[0], 'mach')
  return { backgroundImage: shade ? `linear-gradient(rgba(0,0,0,.05),rgba(0,0,0,.35)),${img}` : img, backgroundSize: 'cover', backgroundPosition: 'center' }
}

/** Chọn ảnh bìa tự tạo: 7 màu + màu tuỳ chọn, 6 hoa văn. */
export function CoverPicker({ value, onChange, program, disabled }: { value?: string; onChange: (spec: string) => void; program?: string | null; disabled?: boolean }) {
  const cur = parseCover(value) ?? { color: TRACK_COLOR[program ?? ''] ?? COVER_COLORS[0], pattern: 'mach' }
  return (
    <div className="coverpick">
      <div className="coverprev" style={{ backgroundImage: svgUrl(cur.color, cur.pattern) }} aria-hidden="true" />
      <div className="coveropts">
        <div className="coverrow" role="group" aria-label="Màu nền">
          {COVER_COLORS.map(c => <button key={c} type="button" disabled={disabled} className={'swatch' + (cur.color.toLowerCase() === c ? ' on' : '')} style={{ background: c }}
            aria-label={'Màu ' + c} aria-pressed={cur.color.toLowerCase() === c} onClick={() => onChange(coverSpec(c, cur.pattern))} />)}
          <label className="swatch custom" title="Màu tuỳ chọn"><input type="color" disabled={disabled} value={cur.color} onChange={e => onChange(coverSpec(e.target.value, cur.pattern))} aria-label="Màu tuỳ chọn" /></label>
        </div>
        <div className="coverrow" role="group" aria-label="Hoa văn">
          {PATTERNS.map(([k, l]) => <button key={k} type="button" disabled={disabled} className={'patbtn' + (cur.pattern === k ? ' on' : '')} aria-pressed={cur.pattern === k}
            onClick={() => onChange(coverSpec(cur.color, k))}><span style={{ backgroundImage: svgUrl(cur.color, k) }} aria-hidden="true" />{l}</button>)}
        </div>
      </div>
    </div>
  )
}
