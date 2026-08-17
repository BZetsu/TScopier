/**
 * Cloudflare Turnstile site key (public by design).
 * Prefer VITE_TURNSTILE_SITE_KEY; fall back to the project widget key so a
 * missing Netlify env at build time cannot disable captcha in production.
 */
const FALLBACK_TURNSTILE_SITE_KEY = '0x4AAAAAAENwYkTwFMwfAUdc'

export function turnstileSiteKey(): string {
  const fromEnv = String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()
  if (fromEnv) return fromEnv
  // Production must never ship without a site key (bots would skip the widget).
  if (import.meta.env.PROD) return FALLBACK_TURNSTILE_SITE_KEY
  return ''
}

export function isTurnstileEnabled(): boolean {
  return turnstileSiteKey().length > 0
}

/**
 * True only when we somehow still have no site key in a production build.
 * With FALLBACK_TURNSTILE_SITE_KEY this should stay false after the next deploy.
 */
export function isTurnstileMisconfigured(): boolean {
  return Boolean(import.meta.env.PROD) && !isTurnstileEnabled()
}
