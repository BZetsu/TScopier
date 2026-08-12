/** Routes reachable in the app shell when the user has no active subscription. */
const EXACT_PATHS_WITHOUT_SUBSCRIPTION = new Set([
  '/pricing',
  '/billing',
  '/contact-support',
  '/dashboard',
])

export function isRouteAllowedWithoutSubscription(pathname: string): boolean {
  if (EXACT_PATHS_WITHOUT_SUBSCRIPTION.has(pathname)) return true
  if (pathname.startsWith('/dashboard/broker/')) return true
  return false
}
