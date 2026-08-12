/** Cloudflare Turnstile site key (empty = captcha disabled for local dev). */
export function turnstileSiteKey(): string {
  return String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()
}

export function isTurnstileEnabled(): boolean {
  return turnstileSiteKey().length > 0
}
