/** Routes reachable in the app shell when the user has no active subscription. */
const EXACT_PATHS_WITHOUT_SUBSCRIPTION = new Set([
  '/pricing',
  '/billing',
  '/contact-support',
])

export function isRouteAllowedWithoutSubscription(pathname: string): boolean {
  return EXACT_PATHS_WITHOUT_SUBSCRIPTION.has(pathname)
}
