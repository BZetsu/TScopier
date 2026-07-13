/** Build labeled few-shot examples for channel_signal_examples (edge training). */
import { coerceTradeIntent } from './coerceTradeIntent.ts'
import type { TradeIntent, TradeIntentKind } from './tradeIntent.ts'
import { parsedDataToTradeIntent } from './parsedDataToTradeIntent.ts'
import {
  looksLikeCasualNonTradeMessage,
  looksLikeProfitResultCommentary,
} from '../signalCommentaryGuard.ts'

export type ChannelExampleLabel = 'entry' | 'update' | 'ignore'

export type LabeledChannelExample = {
  raw_message: string
  label: ChannelExampleLabel
  intent: TradeIntent
}

type ParsedLike = {
  action?: unknown
  symbol?: unknown
  entry_price?: unknown
  entry_zone_low?: unknown
  entry_zone_high?: unknown
  sl?: unknown
  tp?: unknown
  confidence?: unknown
}

export function tradeIntentKindToExampleLabel(kind: TradeIntentKind): ChannelExampleLabel {
  if (kind === 'entry') return 'entry'
  if (kind === 'modify' || kind === 'close' || kind === 'breakeven' || kind === 'partial_close') {
    return 'update'
  }
  return 'ignore'
}

function parsedActionToExampleLabel(parsed: ParsedLike): ChannelExampleLabel {
  const action = String(parsed?.action ?? '').toLowerCase()
  if (action === 'buy' || action === 'sell') return 'entry'
  if (['modify', 'close', 'breakeven', 'partial_profit', 'close_worse_entries', 'partial_breakeven'].includes(action)) {
    return 'update'
  }
  return 'ignore'
}

function looksLikeTpHitOrStatusCommentary(message: string): boolean {
  const text = String(message ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return true
  if (/\b(?:tp\s*\d*|take\s*profit\s*\d*|target\s*\d*)\s*(?:hit|reached|done|secured|smashed|achieved|✅|✔️)/i.test(text)) {
    return true
  }
  if (/\b(?:hit|reached)\s+(?:tp\s*\d*|target\s*\d*)/i.test(text)) return true
  if (/\b(?:running|floating|in)\s*[+]?\s*\d+(?:\.\d+)?\s*(?:pips?|points?|pts)\b/i.test(text)
    && !/\b(?:sl|tp|stop\s*loss|take\s*profit|entry)\s*[:=]/i.test(text)) {
    return true
  }
  if (looksLikeProfitResultCommentary(text)) return true
  return false
}

function shouldSkipMessageForExamples(raw: string): boolean {
  if (!raw || raw.length < 12) return true
  if (looksLikeCasualNonTradeMessage(raw)) return true
  if (looksLikeTpHitOrStatusCommentary(raw)) return true
  return false
}

/** Deterministic fallback from worker/edge parsed_data. */
export function buildChannelExampleRowsFromParsed(
  rows: Array<{ raw_message: string; parsed_data: unknown }>,
  limit = 12,
): LabeledChannelExample[] {
  const out: LabeledChannelExample[] = []
  const seen = new Set<string>()
  let entryCount = 0
  let updateCount = 0
  const maxPerKind = Math.max(4, Math.ceil(limit / 2))

  for (const row of rows) {
    const raw = String(row.raw_message ?? '').trim()
    if (shouldSkipMessageForExamples(raw)) continue
    const hash = raw.slice(0, 96)
    if (seen.has(hash)) continue

    const parsed = row.parsed_data && typeof row.parsed_data === 'object'
      ? row.parsed_data as ParsedLike
      : null
    if (!parsed) continue

    const label = parsedActionToExampleLabel(parsed)
    if (label === 'ignore') continue
    if (label === 'entry' && entryCount >= maxPerKind) continue
    if (label === 'update' && updateCount >= maxPerKind) continue

    seen.add(hash)
    const intent = parsedDataToTradeIntent(parsed)
    if (tradeIntentKindToExampleLabel(intent.kind) === 'ignore') continue

    out.push({ raw_message: raw, label, intent })
    if (label === 'entry') entryCount += 1
    else updateCount += 1
    if (out.length >= limit) break
  }
  return out
}

const EXAMPLE_CLASSIFY_PROMPT = `You classify Telegram trading-channel messages for copier few-shot training.
Return strict JSON only:
{
  "examples": [
    {
      "message_index": number,
      "label": "entry" | "update" | "ignore",
      "intent": {
        "kind": "entry"|"modify"|"close"|"breakeven"|"partial_close"|"ignore"|"commentary",
        "side": "BUY"|"SELL"|null,
        "symbol": string|null,
        "entry": number[],
        "sl": number|null,
        "tp": number[],
        "sl_unit": "price"|"pips",
        "tp_unit": "price"|"pips",
        "confidence": number,
        "detected_language": string
      }
    }
  ]
}

Label rules:
- entry: NEW trade to open (buy/sell/long/short in any language — e.g. ACHETER, Venda, بيع, 売り). Include structured entries with prices/zones/SL/TP when present.
- update: manage an EXISTING trade — modify SL/TP, move stop, breakeven, partial close, close all, close half. NOT a new entry.
- ignore: commentary, TP-hit announcements, profit brags, news, disclaimers, emoji-only hype, lesson/recap posts, "running +pips" status with no new instruction.

Intent rules:
- Extract trading intent only; never translate literally.
- Map GOLD/OR/XAU → XAUUSD, etc.
- Never invent prices absent from the message.
- TP-hit / "target reached" → label ignore, kind commentary.
- Classify every message_index provided; use label ignore for non-actionable lines.`

async function classifyMessageBatch(
  messages: string[],
  apiKey: string,
): Promise<LabeledChannelExample[]> {
  const indexed = messages.map((raw_message, message_index) => ({ message_index, raw_message }))
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: EXAMPLE_CLASSIFY_PROMPT },
        { role: 'user', content: JSON.stringify({ messages: indexed }) },
      ],
    }),
  })
  if (!res.ok) return []

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ''
  let parsed: { examples?: unknown[] } = {}
  try {
    parsed = JSON.parse(content)
  } catch {
    return []
  }

  const out: LabeledChannelExample[] = []
  for (const item of parsed.examples ?? []) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const idx = typeof row.message_index === 'number' ? row.message_index : Number(row.message_index)
    if (!Number.isInteger(idx) || idx < 0 || idx >= messages.length) continue
    const raw_message = messages[idx]!.trim()
    if (!raw_message || shouldSkipMessageForExamples(raw_message)) continue

    const intent = coerceTradeIntent(row.intent ?? row)
    let label = String(row.label ?? '').toLowerCase()
    if (label !== 'entry' && label !== 'update') {
      label = tradeIntentKindToExampleLabel(intent.kind)
    } else if (label === 'entry' && intent.kind !== 'entry') {
      label = tradeIntentKindToExampleLabel(intent.kind)
    } else if (label === 'update' && intent.kind === 'entry') {
      label = 'entry'
    }
    if (label !== 'entry' && label !== 'update') continue
    if (intent.kind === 'commentary' || intent.kind === 'ignore') continue

    out.push({ raw_message, label, intent })
  }
  return out
}

function balanceExamples(examples: LabeledChannelExample[], limit: number): LabeledChannelExample[] {
  const seen = new Set<string>()
  const entries: LabeledChannelExample[] = []
  const updates: LabeledChannelExample[] = []

  for (const ex of examples) {
    const key = ex.raw_message.slice(0, 96)
    if (seen.has(key)) continue
    seen.add(key)
    if (ex.label === 'entry') entries.push(ex)
    else if (ex.label === 'update') updates.push(ex)
  }

  const targetEach = Math.max(3, Math.floor(limit / 2))
  const merged: LabeledChannelExample[] = []
  for (let i = 0; i < Math.max(entries.length, updates.length) && merged.length < limit; i++) {
    if (i < entries.length && merged.length < limit) merged.push(entries[i]!)
    if (i < updates.length && merged.length < limit) merged.push(updates[i]!)
  }

  if (merged.length >= limit) return merged.slice(0, limit)

  for (const ex of [...entries, ...updates]) {
    if (merged.length >= limit) break
    const key = ex.raw_message.slice(0, 96)
    if (merged.some(m => m.raw_message.slice(0, 96) === key)) continue
    merged.push(ex)
  }
  return merged.slice(0, limit)
}

export async function buildChannelSignalExamples(
  rows: Array<{ raw_message: string; parsed_data: unknown }>,
  opts?: { openAiKey?: string; limit?: number },
): Promise<LabeledChannelExample[]> {
  const limit = opts?.limit ?? 12
  const uniqueMessages: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const raw = String(row.raw_message ?? '').trim()
    if (!raw || raw.length < 12 || shouldSkipMessageForExamples(raw)) continue
    const key = raw.slice(0, 96)
    if (seen.has(key)) continue
    seen.add(key)
    uniqueMessages.push(raw)
    if (uniqueMessages.length >= 80) break
  }

  if (opts?.openAiKey && uniqueMessages.length > 0) {
    const batchSize = 25
    const aiExamples: LabeledChannelExample[] = []
    for (let i = 0; i < uniqueMessages.length && aiExamples.length < limit * 2; i += batchSize) {
      const batch = uniqueMessages.slice(i, i + batchSize)
      const classified = await classifyMessageBatch(batch, opts.openAiKey)
      aiExamples.push(...classified)
    }
    const balanced = balanceExamples(aiExamples, limit)
    if (balanced.length > 0) return balanced
  }

  return buildChannelExampleRowsFromParsed(rows, limit)
}

// Back-compat alias used by analyze-channel-profile
export function buildChannelExampleRows(
  rows: Array<{ raw_message: string; parsed_data: unknown }>,
  limit = 12,
): LabeledChannelExample[] {
  return buildChannelExampleRowsFromParsed(rows, limit)
}
