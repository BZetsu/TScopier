const DEFAULT_APP_ORIGIN = 'https://app.tscopier.ai'
const DEFAULT_MARKETING_ORIGIN = 'https://tscopier.ai'

function trimOrigin(raw: string | undefined, fallback: string): string {
  const v = raw?.trim()
  if (!v) return fallback
  return v.replace(/\/+$/, '')
}

export const APP_ORIGIN = trimOrigin(
  import.meta.env.VITE_APP_URL as string | undefined,
  DEFAULT_APP_ORIGIN,
)

export const MARKETING_ORIGIN = trimOrigin(
  import.meta.env.VITE_MARKETING_URL as string | undefined,
  DEFAULT_MARKETING_ORIGIN,
)

function normalizePath(path: string): string {
  if (!path || path === '/') return '/'
  return path.startsWith('/') ? path : `/${path}`
}

export function joinOrigin(origin: string, path: string): string {
  const p = normalizePath(path)
  return p === '/' ? origin : `${origin}${p}`
}

export function appUrl(path = '/'): string {
  return joinOrigin(APP_ORIGIN, path)
}

export function marketingUrl(path = '/'): string {
  return joinOrigin(MARKETING_ORIGIN, path)
}

function isLocalDevHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')
}

function devSiteOverride(): 'app' | 'marketing' | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const q = params.get('site')
  if (q === 'marketing' || q === 'app') return q
  const env = (import.meta.env.VITE_DEV_SITE as string | undefined)?.trim().toLowerCase()
  if (env === 'marketing' || env === 'app') return env
  return null
}

function isMarketingHost(hostname: string): boolean {
  if (hostname === 'tscopier.ai' || hostname === 'www.tscopier.ai') return true
  if (hostname.endsWith('.netlify.app')) return true
  return false
}

/** True when the product app (dashboard, auth, pricing) should mount. */
export function isAppHost(hostname = window.location.hostname): boolean {
  const override = devSiteOverride()
  if (override) return override === 'app'

  if (hostname === 'app.tscopier.ai') return true
  if (isMarketingHost(hostname)) return false
  if (isLocalDevHost(hostname)) return true
  if (hostname.startsWith('app.')) return true
  // Same Netlify deploy serves both hosts — unknown host defaults to marketing.
  return false
}
