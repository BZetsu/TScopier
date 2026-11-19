/**
 * Sanitized platform status for the public /status page.
 * Never include probe detail, worker IDs, user counts, or raw rule codes in output.
 */

export type PublicComponentStatus = 'operational' | 'degraded' | 'outage' | 'unknown'
export type PublicOverallStatus = 'operational' | 'degraded' | 'outage'
export type PublicIncidentImpact = 'minor' | 'major'

export type ProbeRow = {
  target: string
  state: string
  updated_at: string | null
}

export type FiringAlertRow = {
  id: string
  rule_code: string
  severity: string
  created_at: string
}

export type PublicComponent = {
  id: string
  name: string
  status: PublicComponentStatus
}

export type PublicIncident = {
  id: string
  title: string
  impact: PublicIncidentImpact
  started_at: string
  status: 'active'
}

export type PublicStatusPayload = {
  updated_at: string
  overall: PublicOverallStatus
  components: PublicComponent[]
  incidents: PublicIncident[]
}

/** Allowlisted probe targets that may influence public components. */
export const PUBLIC_PROBE_TARGETS = [
  'worker_trade',
  'bridge_mt4',
  'bridge_mt5',
  'openai_api',
  'alert_evaluator',
] as const

/** Default probe interval is ~60s; treat 3× as stale. */
export const PROBE_STALE_MS = 3 * 60_000

/** Customer-safe titles for known alert rule codes. Unknown codes are omitted. */
export const PUBLIC_INCIDENT_TITLES: Record<string, string> = {
  bridge_down: 'Broker bridge disruption',
  probe_stale: 'Monitoring delayed',
  mtapi_accounts_error: 'Broker connection issues',
  mtapi_connect_errors: 'Broker login issues',
  mtapi_reconnect_storm: 'Unstable broker connections',
  workers_offline: 'Telegram signal listener disruption',
  trade_workers_offline: 'Trade execution disruption',
  queue_stuck: 'Trade processing delays',
  executions_failing: 'Elevated trade execution failures',
  dead_letters_high: 'Elevated failed message backlog',
  telegram_gap: 'Some Telegram accounts not receiving signals',
  openai_credits_exhausted: 'Signal AI parsing limited',
  openai_key_invalid: 'Signal AI parsing limited',
}

const COMPONENT_CATALOG: { id: string; name: string }[] = [
  { id: 'web', name: 'Web app' },
  { id: 'api', name: 'API / database' },
  { id: 'telegram_listener', name: 'Telegram signal listener' },
  { id: 'trade_workers', name: 'Trade execution' },
  { id: 'broker_bridge', name: 'Broker bridge' },
  { id: 'signal_ai', name: 'Signal AI parsing' },
]

export function probeEffectiveState(
  row: ProbeRow | undefined,
  nowMs: number,
  staleMs = PROBE_STALE_MS,
): PublicComponentStatus {
  if (!row) return 'unknown'
  const updatedMs = row.updated_at ? new Date(row.updated_at).getTime() : NaN
  if (!Number.isFinite(updatedMs) || nowMs - updatedMs > staleMs) return 'unknown'
  if (row.state === 'up') return 'operational'
  if (row.state === 'down') return 'outage'
  return 'unknown'
}

function worse(a: PublicComponentStatus, b: PublicComponentStatus): PublicComponentStatus {
  const rank: Record<PublicComponentStatus, number> = {
    operational: 0,
    unknown: 1,
    degraded: 2,
    outage: 3,
  }
  return rank[a] >= rank[b] ? a : b
}

export function buildPublicIncidents(rows: FiringAlertRow[]): PublicIncident[] {
  const out: PublicIncident[] = []
  for (const row of rows) {
    const title = PUBLIC_INCIDENT_TITLES[row.rule_code]
    if (!title) continue
    const impact: PublicIncidentImpact =
      row.severity === 'critical' ? 'major' : 'minor'
    out.push({
      id: row.id,
      title,
      impact,
      started_at: row.created_at,
      status: 'active',
    })
  }
  return out.sort((a, b) => b.started_at.localeCompare(a.started_at))
}

export function buildPublicStatus(input: {
  probes: ProbeRow[]
  firingAlerts: FiringAlertRow[]
  apiOk: boolean
  nowMs?: number
}): PublicStatusPayload {
  const nowMs = input.nowMs ?? Date.now()
  const byTarget = new Map(input.probes.map(p => [p.target, p]))
  const firingCodes = new Set(input.firingAlerts.map(a => a.rule_code))

  const tradeProbe = probeEffectiveState(byTarget.get('worker_trade'), nowMs)
  const bridgeMt4 = probeEffectiveState(byTarget.get('bridge_mt4'), nowMs)
  const bridgeMt5 = probeEffectiveState(byTarget.get('bridge_mt5'), nowMs)
  const openai = probeEffectiveState(byTarget.get('openai_api'), nowMs)

  let telegram: PublicComponentStatus = 'operational'
  if (firingCodes.has('workers_offline') || firingCodes.has('telegram_gap')) {
    telegram = firingCodes.has('workers_offline') ? 'outage' : 'degraded'
  }

  let trade: PublicComponentStatus = tradeProbe
  if (firingCodes.has('trade_workers_offline') || firingCodes.has('queue_stuck')) {
    trade = worse(trade, firingCodes.has('trade_workers_offline') ? 'outage' : 'degraded')
  }
  if (firingCodes.has('executions_failing')) {
    trade = worse(trade, 'degraded')
  }

  let bridge: PublicComponentStatus = worse(bridgeMt4, bridgeMt5)
  if (
    firingCodes.has('bridge_down')
    || firingCodes.has('mtapi_accounts_error')
    || firingCodes.has('mtapi_connect_errors')
    || firingCodes.has('mtapi_reconnect_storm')
  ) {
    bridge = worse(
      bridge,
      firingCodes.has('bridge_down') ? 'outage' : 'degraded',
    )
  }

  let signalAi: PublicComponentStatus = openai
  if (firingCodes.has('openai_credits_exhausted') || firingCodes.has('openai_key_invalid')) {
    signalAi = worse(signalAi, 'degraded')
  }

  const statusById: Record<string, PublicComponentStatus> = {
    web: 'operational',
    api: input.apiOk ? 'operational' : 'outage',
    telegram_listener: telegram,
    trade_workers: trade,
    broker_bridge: bridge,
    signal_ai: signalAi,
  }

  const components: PublicComponent[] = COMPONENT_CATALOG.map(c => ({
    id: c.id,
    name: c.name,
    status: statusById[c.id] ?? 'unknown',
  }))

  const incidents = buildPublicIncidents(input.firingAlerts)

  let overall: PublicOverallStatus = 'operational'
  if (components.some(c => c.status === 'outage') || incidents.some(i => i.impact === 'major')) {
    overall = 'outage'
  } else if (
    components.some(c => c.status === 'degraded' || c.status === 'unknown')
    || incidents.length > 0
  ) {
    overall = 'degraded'
  }

  return {
    updated_at: new Date(nowMs).toISOString(),
    overall,
    components,
    incidents,
  }
}
