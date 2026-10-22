// Biểu tượng SVG nét mảnh dùng chung (thay cho emoji làm icon). Theo màu chữ, cỡ mặc định 16px.
const P: Record<string, string> = {
  hourglass: 'M6 2h12M6 22h12M7 2v4a5 5 0 0 0 10 0V2M7 22v-4a5 5 0 0 1 10 0v4',
  refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
  checkCircle: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  fileText: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  film: 'M3 3h18v18H3zM7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4M3 12h18',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M21 15l-5-5L5 21',
  clipboard: 'M9 2h6v4H9zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M8 12h8M8 16h5',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5',
  paperclip: 'M21.4 11 12.2 20.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  trophy: 'M6 9H4a2 2 0 0 1 0-4h2M18 9h2a2 2 0 0 0 0-4h-2M6 3h12v6a6 6 0 0 1-12 0zM12 15v4M8 22h8M9 19h6',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  lock: 'M5 11h14v11H5zM7 11V7a5 5 0 0 1 10 0v4',
  monitor: 'M2 3h20v14H2zM8 21h8M12 17v4',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z',
  package: 'M21 8l-9-5-9 5 9 5zM3 8v8l9 5 9-5V8M12 13v8',
  atom: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2M20.2 20.2c2-2-.4-7.6-5.4-12.6S4 .8 2 2.8s.4 7.6 5.4 12.6 10.8 6.8 12.8 4.8M15.6 15.6c5-5 7.4-10.6 5.4-12.6s-7.6.4-12.6 5.4S.8 19 2.8 21s7.6-.4 12.8-5.4',
  ruler: 'M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4zM7.5 10.5l2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2',
  gamepad: 'M6 12h4M8 10v4M15 13h.01M18 11h.01M17.3 5H6.7a4 4 0 0 0-4 3.6L2 15a3 3 0 0 0 5.4 2l1.1-1.5h7l1.1 1.5A3 3 0 0 0 22 15l-.7-6.4a4 4 0 0 0-4-3.6z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2',
  plug: 'M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z',
  scale: 'M12 3v18M7 21h10M3 7h18M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z',
  thermometer: 'M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z',
  puzzle: 'M19.4 14.5a2.5 2.5 0 1 0 0-5H18V6a2 2 0 0 0-2-2h-3.5v1.4a2.5 2.5 0 1 1-5 0V4H4v4h1.4a2.5 2.5 0 1 1 0 5H4v7h3.5v-1.4a2.5 2.5 0 1 1 5 0V20H16a2 2 0 0 0 2-2v-3.5z',
  folders: 'M20 17a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2zM2 9v10a2 2 0 0 0 2 2h12',
  steps: 'M4 20h4v-4h4v-4h4V8h4V4',
  pencil: 'M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  wheel: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 2v20M2 12h20M4.9 4.9l14.2 14.2M19.1 4.9 4.9 19.1',
  cards: 'M8 2h12v16H8zM4 6v16h12',
  microscope: 'M6 18h8M3 22h18M14 22a7 7 0 1 0 0-14h-1M9 14h2M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2zM12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3',
  bot: 'M4 8h16v12H4zM12 8V4M8 4h8M9 13v2M15 13v2M2 14h2M20 14h2',
  flask: 'M9 3h6M10 3v6L4 19a1 1 0 0 0 .9 1.5h14.2A1 1 0 0 0 20 19l-6-10V3',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  arrows: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4',
  dot: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
}
// Ký tự cũ (emoji) → tên biểu tượng, để dữ liệu cũ vẫn hiện đúng
const EMOJI: Record<string, string> = {
  '⏳': 'hourglass', '🔄': 'refresh', '📥': 'inbox', '✅': 'checkCircle', '📝': 'fileText', '👤': 'user', '👥': 'users', '🎬': 'film',
  '📄': 'file', '🔗': 'link', '🖼': 'image', '📘': 'book', '📗': 'book', '📎': 'paperclip', '⚠': 'alert', '🏆': 'trophy', '📷': 'camera',
  '👁': 'eye', '🔒': 'lock', '🖥': 'monitor', '⏸': 'pause', '🔧': 'wrench', '📦': 'package', '⚛': 'atom', '📏': 'ruler', '🎮': 'gamepad',
  '⏱': 'clock', '💡': 'bulb', '🔌': 'plug', '⚖': 'scale', '🌡': 'thermometer', '🧩': 'puzzle', '🗂': 'folders', '🪜': 'steps', '✏': 'pencil',
  '📋': 'clipboard', '⚙': 'settings', '⚑': 'flag', '🎡': 'wheel', '🃏': 'cards', '🔬': 'microscope', '🤖': 'bot', '🧪': 'flask', '💬': 'chat',
  '↕': 'arrows', '◉': 'dot',
}
export const iconName = (s: string) => P[s] ? s : EMOJI[s.replace('️', '')] ?? null

/** Biểu tượng theo tên (hoặc ký tự emoji cũ); không có trong bộ thì hiện nguyên ký tự. */
export function Icon({ n, size = 16, label, className }: { n: string; size?: number; label?: string; className?: string }) {
  const name = iconName(n)
  if (!name) return <span className={className} aria-hidden={label ? undefined : true} aria-label={label}>{n}</span>
  return (
    <svg className={'ico' + (className ? ' ' + className : '')} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={P[name]} />
    </svg>
  )
}
