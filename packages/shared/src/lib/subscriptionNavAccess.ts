const EXACT_PATHS_WITHOUT_SUBSCRIPTION = new Set([
  '/channels',
  '/billing',
  '/affiliate-program',
  '/contact-support',
  '/pricing',
])

export function isRouteAllowedWithoutSubscription(pathname: string): boolean {
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return true
  return EXACT_PATHS_WITHOUT_SUBSCRIPTION.has(pathname)
}

/** Mobile tab routes allowed without active subscription. */
export function isMobileRouteAllowedWithoutSubscription(route: string): boolean {
  const allowed = new Set(['dashboard', 'settings', 'billing', 'copier-status'])
  return allowed.has(route.replace(/^\//, ''))
}
