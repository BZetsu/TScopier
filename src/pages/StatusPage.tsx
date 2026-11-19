import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { RefreshCw } from 'lucide-react'
import { AuthBrandLogo } from '../components/auth/AuthBrandLogo'
import { Button } from '../components/ui/Button'
import { useT } from '../context/LocaleContext'
import { interpolate } from '../i18n/interpolate'
import { fetchPublicStatus } from '../lib/fetchPublicStatus'
import type {
  PublicComponentStatus,
  PublicOverallStatus,
  PublicStatusPayload,
} from '../lib/publicStatusTypes'

const REFRESH_MS = 45_000

function overallTone(status: PublicOverallStatus): string {
  if (status === 'operational') return 'text-green-700 dark:text-green-400'
  if (status === 'degraded') return 'text-amber-800 dark:text-amber-300'
  return 'text-rose-800 dark:text-rose-300'
}

function overallWash(status: PublicOverallStatus): string {
  if (status === 'operational') {
    return 'border-green-200/80 bg-green-50/90 dark:border-green-900/40 dark:bg-green-950/35'
  }
  if (status === 'degraded') {
    return 'border-amber-200/80 bg-amber-50/90 dark:border-amber-900/40 dark:bg-amber-950/35'
  }
  return 'border-rose-200/80 bg-rose-50/90 dark:border-rose-900/40 dark:bg-rose-950/35'
}

function pillTone(status: PublicComponentStatus): string {
  if (status === 'operational') return 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300'
  if (status === 'degraded') return 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200'
  if (status === 'outage') return 'bg-rose-100 text-rose-900 dark:bg-rose-950/60 dark:text-rose-200'
  return 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
}

export function StatusPage() {
  const t = useT()
  const sp = t.statusPage
  const [payload, setPayload] = useState<PublicStatusPayload | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (opts?: { soft?: boolean }) => {
    if (opts?.soft) setRefreshing(true)
    else setLoading(true)
    try {
      const next = await fetchPublicStatus()
      setPayload(next)
      setError('')
    } catch {
      setError(sp.loadError)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [sp.loadError])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load({ soft: true }), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  const updatedLabel = payload
    ? interpolate(sp.updated, {
      time: new Date(payload.updated_at).toLocaleString(),
    })
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-linear-to-b from-neutral-50 via-white to-neutral-100 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900">
      <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between border-b border-neutral-200/55 bg-white/95 px-6 py-4 backdrop-blur-sm dark:border-neutral-800/50 dark:bg-neutral-950/95 pt-[calc(1rem+env(safe-area-inset-top,0px)+var(--app-banner-h,0px))]">
        <Link to="/" className="flex items-center gap-2" aria-label={sp.brand}>
          <AuthBrandLogo className="h-8 w-auto" />
          <span className="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            {sp.brand}
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            loading={refreshing}
            onClick={() => void load({ soft: true })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {refreshing ? sp.refreshing : sp.refresh}
          </Button>
          <Link
            to="/dashboard"
            className="text-sm font-medium text-neutral-900 hover:text-neutral-700 dark:text-neutral-50 dark:hover:text-neutral-200"
          >
            {sp.backHome}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-6 py-10 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400">
          {sp.brand}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-950 dark:text-neutral-50 sm:text-4xl">
          {sp.title}
        </h1>
        <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">{sp.subtitle}</p>

        {loading && !payload ? (
          <div className="mt-10 space-y-3" aria-busy>
            <div className="h-16 animate-pulse rounded-xl bg-neutral-200/70 dark:bg-neutral-800" />
            <div className="h-40 animate-pulse rounded-xl bg-neutral-200/70 dark:bg-neutral-800" />
          </div>
        ) : null}

        {error && !payload ? (
          <div className="mt-10 space-y-4">
            <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
            <Button size="sm" onClick={() => void load()}>{sp.retry}</Button>
          </div>
        ) : null}

        {payload ? (
          <>
            <div className={clsx('mt-8 rounded-xl border px-5 py-4', overallWash(payload.overall))}>
              <p className={clsx('text-lg font-semibold tracking-tight', overallTone(payload.overall))}>
                {sp.overall[payload.overall]}
              </p>
              {updatedLabel ? (
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{updatedLabel}</p>
              ) : null}
            </div>

            <section className="mt-10" aria-labelledby="status-components-heading">
              <h2
                id="status-components-heading"
                className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {sp.componentsHeading}
              </h2>
              <ul className="mt-3 divide-y divide-neutral-200/80 border-y border-neutral-200/80 dark:divide-neutral-800 dark:border-neutral-800">
                {payload.components.map(component => (
                  <li
                    key={component.id}
                    className="flex items-center justify-between gap-3 py-3.5"
                  >
                    <span className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                      {component.name}
                    </span>
                    <span
                      className={clsx(
                        'shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold',
                        pillTone(component.status),
                      )}
                    >
                      {sp.componentStatus[component.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mt-10" aria-labelledby="status-incidents-heading">
              <h2
                id="status-incidents-heading"
                className="text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
              >
                {sp.incidentsHeading}
              </h2>
              {payload.incidents.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">{sp.noIncidents}</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {payload.incidents.map(incident => (
                    <li
                      key={incident.id}
                      className="border-b border-neutral-200/80 pb-3 dark:border-neutral-800"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                          {incident.title}
                        </span>
                        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                          {sp.incidentActive}
                        </span>
                        <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                          {incident.impact === 'major' ? sp.impactMajor : sp.impactMinor}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        {new Date(incident.started_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="mt-12 text-sm text-neutral-600 dark:text-neutral-400">
              <Link
                to="/contact-support"
                className="font-medium text-green-700 underline-offset-2 hover:underline dark:text-green-400"
              >
                {sp.contactSupport}
              </Link>
            </p>
          </>
        ) : null}
      </main>
    </div>
  )
}
