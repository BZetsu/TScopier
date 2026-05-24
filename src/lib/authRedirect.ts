/** OAuth / password-recovery redirect target on the current app origin. */
export function authRedirectUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${normalized}`
}
