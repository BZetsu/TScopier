/** Cloudflare Turnstile site key (empty = captcha disabled for local dev only). */
export function turnstileSiteKey(): string {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()
}

export function isTurnstileEnabled(): boolean {
  return turnstileSiteKey().length > 0
}

/**
 * In production builds, Turnstile must be configured. An empty site key means
 * the Netlify env var was missing at build time — captcha would otherwise be
 * silently skipped and bots could sign up with no challenge.
 */
export function isTurnstileMisconfigured(): boolean {
  return Boolean(import.meta.env.PROD) && !isTurnstileEnabled()
}
