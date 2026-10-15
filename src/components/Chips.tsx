import { PROG } from '../lib/programs'
export function ProgChips({ programs }: { programs: string | null | undefined }) {
  return <>{(programs ?? '').split(',').map(s => s.trim()).filter(Boolean).map(p => (
    <span key={p} className="progchip" style={{ background: PROG[p]?.bg, color: PROG[p]?.fg }}>{p}</span>
  ))}</>
}
