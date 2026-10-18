import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Giao diện & thương hiệu theo khách hàng (migration 047)
export type Branding = {
  org_id?: string; source?: string; inherited?: boolean; self_edit?: boolean
  display_name: string | null; short_name: string | null; logo: string | null; logo_dark?: string | null
  primary_color: string | null; sidebar_color: string | null; accent_color: string | null
  login_message: string | null; support_text: string | null
}
export const DEFAULT_COLORS = { primary: '#1c63bb', sidebar: '#152e5d', accent: '#f2a53f' }
export const DEFAULT_TITLE = 'Hệ thống Quản trị STEM'

const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const toHex = (c: number[]) => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
// Pha với đen (t < 0) hoặc trắng (t > 0)
export const shade = (h: string, t: number) => toHex(hex(h).map(v => (t < 0 ? v * (1 + t) : v + (255 - v) * t)))
const lum = (h: string) => { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const VARS = ['--primary', '--primary-hover', '--navy', '--navy-2', '--orange']
export function applyBranding(b: Partial<Branding> | null) {
  const root = document.documentElement.style
  VARS.forEach(v => root.removeProperty(v))
  if (b?.primary_color) { root.setProperty('--primary', b.primary_color); root.setProperty('--primary-hover', shade(b.primary_color, -0.18)) }
  if (b?.sidebar_color) { root.setProperty('--navy', b.sidebar_color); root.setProperty('--navy-2', shade(b.sidebar_color, 0.12)) }
  if (b?.accent_color) root.setProperty('--orange', b.accent_color)
  document.title = b?.display_name || DEFAULT_TITLE
}

// Thương hiệu hiệu lực của đơn vị đang làm việc; cổng nền tảng (KDI) giữ giao diện gốc
export function useBranding(orgId: string | null | undefined, enabled: boolean) {
  const [b, setB] = useState<Branding | null>(null)
  useEffect(() => {
    let live = true
    if (!enabled || !orgId) { setB(null); applyBranding(null); return }
    const load = () => supabase.rpc('my_branding').then(({ data }) => { if (!live) return; setB((data as Branding) ?? null); applyBranding((data as Branding) ?? null) })
    load(); window.addEventListener('branding-changed', load)
    return () => { live = false; window.removeEventListener('branding-changed', load) }
  }, [orgId, enabled])
  return b
}

// Trang đăng nhập: theo tên miền đang mở
export function useLoginBranding() {
  const [b, setB] = useState<Branding | null>(null)
  useEffect(() => {
    supabase.rpc('login_branding', { p_host: location.hostname }).then(({ data }) => { if (data) { setB(data as Branding); applyBranding(data as Branding) } })
  }, [])
  return b
}

// Ảnh logo → PNG thu nhỏ (tối đa 360×120) dạng data URL
export function logoToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') {
      if (file.size > 200000) return reject(new Error('Tệp SVG quá lớn (tối đa 200 KB).'))
      const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); return
    }
    const img = new Image(), url = URL.createObjectURL(file)
    img.onload = () => {
      const k = Math.min(1, 360 / img.width, 120 / img.height), c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh.')) }
    img.src = url
  })
}
