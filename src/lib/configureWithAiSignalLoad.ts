import { supabase } from './supabase'
import { callTelegramAuth } from './telegramAuthApi'
import { fetchChannelSignalExamples } from './channelSignalExamples'
import {
  buildTradingViewAlertTemplates,
  normalizeTradingViewAlertConfig,
} from './tradingViewAlertTemplate'
import type { SignalSourceKind } from './signalSourceMark'
import { normalizeSignalSourceKind } from './signalSourceMark'
import type { ConfigureWithAiSignalExample } from './configureWithAiClient'
import {
  classifyConfigureSignalLabel,
  inferConfigureSignalIntent,
  signalFormatFingerprint,
  type ConfigureSignalSampleLabel,
} from './configureWithAiSignalFormat'

const LOOKBACK_DAYS = 30
/** Distinct formats only — enough context, not a dump of every signal. */
const MAX_SAMPLES = 8

function labelFromParsed(
  raw: string,
  parsed: unknown,
  isModification: boolean | null | undefined,
): ConfigureSignalSampleLabel {
  if (isModification) return 'update'
  const j = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  const action = String(j?.action ?? '').toLowerCase()
  if (
    action === 'modify' ||
    action === 'close' ||
    action === 'breakeven' ||
    action === 'partial_profit' ||
    action === 'partial_breakeven' ||
    action === 'partial_close'
  ) {
    return 'update'
  }
  if (action === 'buy' || action === 'sell') return 'entry'
  // Fall back to raw-text classification (Telegram history / thin parsed_data)
  return classifyConfigureSignalLabel(raw)
}

function intentFromParsed(
  raw: string,
  parsed: unknown,
  label: ConfigureSignalSampleLabel,
): Record<string, unknown> {
  const j = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  if (!j) return inferConfigureSignalIntent(raw, label)

  const action = String(j.action ?? '').toLowerCase()
  const sideRaw = String(j.side ?? j.action ?? '').toUpperCase()
  const side = sideRaw === 'BUY' || sideRaw === 'SELL' ? sideRaw : null
  const entryRaw = j.entry ?? j.entries
  const entry = Array.isArray(entryRaw)
    ? entryRaw.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
    : typeof entryRaw === 'number' && Number.isFinite(entryRaw)
      ? [entryRaw]
      : []
  const tpRaw = j.tp ?? j.tps
  const tp = Array.isArray(tpRaw)
    ? tpRaw.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
    : []
  const slN = typeof j.sl === 'number' ? j.sl : Number(j.sl)

  let kind: string = 'ignore'
  if (action === 'buy' || action === 'sell') kind = 'entry'
  else if (action === 'modify') kind = 'modify'
  else if (action === 'close') kind = 'close'
  else if (action === 'breakeven' || action === 'partial_breakeven') kind = 'breakeven'
  else if (action === 'partial_profit' || action === 'partial_close') kind = 'partial_close'
  else if (label === 'update' || label === 'entry') {
    return inferConfigureSignalIntent(raw, label)
  }

  return {
    kind,
    side,
    symbol: typeof j.symbol === 'string' ? j.symbol : null,
    entry,
    sl: Number.isFinite(slN) && slN > 0 ? slN : null,
    tp,
    open_tp: j.open_tp === true,
  }
}

/** Keep one sample per distinct signal *format* (prices scrubbed), not every duplicate. */
function dedupeSamples(rows: ConfigureWithAiSignalExample[]): ConfigureWithAiSignalExample[] {
  const seen = new Set<string>()
  const out: ConfigureWithAiSignalExample[] = []
  for (const row of rows) {
    const raw = row.raw_message.trim()
    if (!raw) continue
    const key = signalFormatFingerprint({
      raw_message: raw,
      label: row.label,
      intent: row.intent,
    })
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
    if (out.length >= MAX_SAMPLES) break
  }
  return out
}

/** Recent ingested signals for any linked channel (Telegram / Discord / WhatsApp / TV). */
export async function fetchRecentChannelSignals(
  channelId: string,
  limit = MAX_SAMPLES,
): Promise<ConfigureWithAiSignalExample[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('signals')
    .select('raw_message, parsed_data, is_modification, created_at')
    .eq('channel_id', channelId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 2, 40))
  if (error) throw new Error(error.message)

  const mapped: ConfigureWithAiSignalExample[] = []
  for (const row of data ?? []) {
    const raw = String(row.raw_message ?? '').trim()
    if (!raw) continue
    const label = labelFromParsed(raw, row.parsed_data, row.is_modification)
    if (label === 'ignore') continue
    mapped.push({
      raw_message: raw.slice(0, 4000),
      label,
      intent: intentFromParsed(raw, row.parsed_data, label),
    })
  }
  return diversifySamples(dedupeSamples(mapped), limit)
}

async function backfillTelegramHistory(channelId: string): Promise<ConfigureWithAiSignalExample[]> {
  const token = (await supabase.auth.getSession()).data.session?.access_token
  if (!token) throw new Error('Not signed in')

  const url = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/telegram-auth`
  const { ok, data } = await callTelegramAuth<{
    error?: unknown
    message?: unknown
    messages?: string[]
  }>(url, token, 'backfill_channel_history', {
    channel_row_id: channelId,
    days: LOOKBACK_DAYS,
    for_training: true,
  })
  if (!ok || data.error) {
    const msg =
      typeof data.error === 'string'
        ? data.error
        : typeof data.message === 'string'
          ? data.message
          : 'Failed to import channel history'
    throw new Error(msg)
  }
  const messages = Array.isArray(data.messages)
    ? data.messages.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
    : []
  const mapped: ConfigureWithAiSignalExample[] = []
  for (const message of messages) {
    const raw = message.trim()
    if (!raw) continue
    const label = classifyConfigureSignalLabel(raw)
    if (label === 'ignore') continue
    mapped.push({
      raw_message: raw.slice(0, 4000),
      label,
      intent: inferConfigureSignalIntent(raw, label),
    })
  }
  return diversifySamples(dedupeSamples(mapped), MAX_SAMPLES)
}

/**
 * Prefer a mix of entry + update (modify/close) formats so Configure with AI
 * sees management instructions, not only entries.
 */
function diversifySamples(
  rows: ConfigureWithAiSignalExample[],
  limit = MAX_SAMPLES,
): ConfigureWithAiSignalExample[] {
  if (rows.length <= limit) return rows
  const entries = rows.filter(r => r.label === 'entry')
  const updates = rows.filter(r => r.label === 'update')
  const other = rows.filter(r => r.label !== 'entry' && r.label !== 'update')
  const out: ConfigureWithAiSignalExample[] = []
  const takeUpdates = Math.min(updates.length, Math.max(2, Math.floor(limit / 2)))
  const takeEntries = Math.min(entries.length, limit - takeUpdates)
  out.push(...entries.slice(0, takeEntries), ...updates.slice(0, takeUpdates))
  for (const row of other) {
    if (out.length >= limit) break
    out.push(row)
  }
  // Fill remaining slots from whichever pool still has items
  for (const row of [...entries.slice(takeEntries), ...updates.slice(takeUpdates)]) {
    if (out.length >= limit) break
    out.push(row)
  }
  return out.slice(0, limit)
}

async function fetchSavedExamples(channelId: string): Promise<ConfigureWithAiSignalExample[]> {
  const rows = await fetchChannelSignalExamples(channelId)
  return dedupeSamples(
    rows
      .map(r => ({
        raw_message: String(r.raw_message ?? '').trim(),
        label: r.label,
        intent: r.intent as unknown as Record<string, unknown>,
      }))
      .filter(r => r.raw_message.length > 0),
  )
}

/** Load TradingView alert JSON templates (+ recent live alerts if any). */
export async function loadTradingViewJsonFormat(
  channelId: string,
): Promise<ConfigureWithAiSignalExample[]> {
  const { data: webhook, error } = await supabase
    .from('tradingview_webhooks')
    .select('alert_config')
    .eq('channel_id', channelId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  const config = normalizeTradingViewAlertConfig(webhook?.alert_config)
  const templates = buildTradingViewAlertTemplates(config)
  const fromTemplates: ConfigureWithAiSignalExample[] = []
  if (templates.strategy) {
    fromTemplates.push({ raw_message: templates.strategy.trim(), label: 'entry' })
  }
  if (templates.buy) {
    fromTemplates.push({ raw_message: templates.buy.trim(), label: 'entry' })
  }
  if (templates.sell) {
    fromTemplates.push({ raw_message: templates.sell.trim(), label: 'entry' })
  }

  let fromSignals: ConfigureWithAiSignalExample[] = []
  try {
    fromSignals = await fetchRecentChannelSignals(channelId, 8)
  } catch {
    fromSignals = []
  }

  // Prefer real delivered alerts first, then configured JSON templates.
  return dedupeSamples([...fromSignals, ...fromTemplates])
}

/**
 * Load signal samples for Configure with AI.
 * - Telegram: live history backfill when possible, then signals + saved examples
 * - Discord / WhatsApp: recent signals (+ saved examples fallback)
 * - TradingView: alert JSON format (+ recent alerts)
 */
export async function loadConfigureWithAiSamples(params: {
  channelId: string
  sourceKind?: string | null
}): Promise<{
  samples: ConfigureWithAiSignalExample[]
  sourceKind: SignalSourceKind
  source: 'channel' | 'tradingview_json' | 'examples' | 'empty'
}> {
  const sourceKind = normalizeSignalSourceKind(params.sourceKind) ?? 'telegram'
  const channelId = params.channelId

  if (sourceKind === 'tradingview') {
    const samples = await loadTradingViewJsonFormat(channelId)
    return {
      samples,
      sourceKind,
      source: samples.length ? 'tradingview_json' : 'empty',
    }
  }

  const collected: ConfigureWithAiSignalExample[] = []

  if (sourceKind === 'telegram') {
    try {
      const backfilled = await backfillTelegramHistory(channelId)
      collected.push(...backfilled)
    } catch (err) {
      console.warn('[configure-with-ai] telegram history backfill failed:', err)
    }
  }

  try {
    const recent = await fetchRecentChannelSignals(channelId)
    collected.push(...recent)
  } catch (err) {
    console.warn('[configure-with-ai] signals fetch failed:', err)
  }

  // Prefer distinct formats from live channel traffic; only fill gaps from saved examples.
  let samples = dedupeSamples(collected)
  if (samples.length < 2) {
    try {
      const saved = await fetchSavedExamples(channelId)
      samples = dedupeSamples([...samples, ...saved])
    } catch (err) {
      console.warn('[configure-with-ai] examples fetch failed:', err)
    }
  }

  return {
    samples,
    sourceKind,
    source: samples.length ? 'channel' : 'empty',
  }
}
