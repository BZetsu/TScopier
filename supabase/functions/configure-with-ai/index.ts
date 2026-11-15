/**
 * configure-with-ai — JWT-authenticated OpenAI expert for Configure Trading drafts.
 *
 * POST body:
 *   {
 *     messages: [{ role, content }],
 *     locale?: string,
 *     context: {
 *       broker_account_id, channel_id, channel_name?,
 *       manual_settings, plan_features?,
 *       signal_examples?: [{ raw_message, label?, intent? }],
 *       broker?: { balance?, equity?, currency?, label? }
 *     }
 *   }
 *
 * Response:
 *   {
 *     assistant_message,
 *     pending_settings_patch?: { settings, summary, rationale, warnings },
 *     error?
 *   }
 *
 * Never writes to the database — patches are applied client-side to the configure draft.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { assistantReplyLanguageAddon } from "../_shared/assistantKnowledge.ts";
import { CONFIGURE_WITH_AI_SYSTEM_PROMPT } from "../_shared/configureWithAiKnowledge.ts";
import {
  guardAssistantUserMessage,
  sanitizeAssistantText,
  sanitizeToolArgs,
} from "../_shared/assistantGuard.ts";
import {
  mergeManualSettings,
  sanitizeConfigureAiPatch,
  summarizeManualPatch,
} from "../_shared/assistantConfigTools.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("ASSISTANT_OPENAI_MODEL")?.trim() || "gpt-4o-mini";
const MAX_TOOL_ROUNDS = 4;

type ChatMessage = {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type PendingSettingsPatch = {
  settings: Record<string, unknown>;
  summary: string;
  rationale: string;
  warnings: string[];
};

type ConfigureContext = {
  broker_account_id?: string;
  channel_id?: string;
  channel_name?: string;
  /** telegram | discord | whatsapp | tradingview */
  source_kind?: string | null;
  manual_settings?: Record<string, unknown>;
  plan_features?: Record<string, boolean>;
  /** Plan numeric caps (e.g. Basic max TP rows = 3). */
  plan_limits?: { max_tp_rows?: number | null };
  /** Latest draft proposal still on the Apply card (not yet applied). */
  pending_settings_patch?: PendingSettingsPatch | null;
  signal_examples?: Array<{
    raw_message?: string;
    label?: string;
    intent?: Record<string, unknown>;
  }>;
  broker?: {
    balance?: number | null;
    equity?: number | null;
    currency?: string | null;
    label?: string | null;
  };
};

function bad(status: number, message: string) {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "analyze_signal_format",
      description:
        "Analyze signal examples/paste. Returns entry_mode (single_price | range_zone | mixed | unknown), multi-TP/SL patterns, zone width hints, and suggested settings. Always call before proposing when examples exist.",
      parameters: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            description: "Optional focus note from the conversation",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_settings",
      description:
        "Propose a manual_settings patch for the Configure form Apply card. Does NOT save to the database. Rationale MUST state (1) single_price vs range_zone and (2) how account size drove lot/risk. In chat, label trade_style multi as Trade Style: Range (never Multi); patch value stays \"multi\". When use_signal_entry_price is true and the signal lists two entry quotes, include signal_entry_prefer first_price|last_price (Entry price: First/Last Price). Do NOT invent Total Lot Size or 0.01-per-TP bullets — TP rows are percents; dynamic % sizes the whole basket.",
      parameters: {
        type: "object",
        properties: {
          settings: {
            type: "object",
            description: "Partial manual_settings keys to change",
          },
          summary: {
            type: "string",
            description: "Short human summary for the Apply card (one line)",
          },
          rationale: {
            type: "string",
            description:
              "Why these settings fit: must mention entry type (single price vs range/zone) and account-size basis",
          },
          entry_mode: {
            type: "string",
            enum: ["teaser_then_params", "single_price", "range_zone", "mixed", "unknown"],
            description:
              "Entry classification: teaser_then_params = bare buy/sell now then later SL/TP/params",
          },
          warnings: {
            type: "array",
            items: { type: "string" },
            description: "Plan limits or caveats (e.g. Advanced required for Range / Range Layering)",
          },
        },
        required: ["settings", "summary", "rationale", "entry_mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask one or more clarifying questions before proposing settings. Prefer this when risk or style is ambiguous.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: { type: "string" },
            description: "1–4 short questions",
          },
        },
        required: ["questions"],
        additionalProperties: false,
      },
    },
  },
] as const;

function compactIntent(intent: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!intent || typeof intent !== "object") return null;
  return {
    kind: intent.kind ?? null,
    side: intent.side ?? null,
    symbol: intent.symbol ?? null,
    entry: intent.entry ?? null,
    sl: intent.sl ?? null,
    tp: intent.tp ?? null,
    open_tp: intent.open_tp ?? null,
    sl_unit: intent.sl_unit ?? null,
    tp_unit: intent.tp_unit ?? null,
  };
}

/** Bare market teaser: "Gold buy now" with no entry/SL/TP body. */
function rawLooksLikeBareTeaser(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  const hasSideNow =
    /\b(buy|sell)\s+now\b/.test(lower) ||
    /\bnow\s+(buy|sell)\b/.test(lower) ||
    /\b(buy|sell)\s+market\b/.test(lower);
  if (!hasSideNow) return false;
  // Has structured params → not a bare teaser
  if (/\bsl\s*[:\-]/i.test(lower) || /\btp\s*[:\-]/i.test(lower)) return false;
  if (countTpsInRaw(t) > 0) return false;
  if (rawLooksLikeRangeZone(t)) return false;
  // Priced entry on same short message (e.g. "buy now @ 2650")
  if (/[@＠]\s*\d+(?:\.\d+)?/.test(t)) return false;
  if (/\b(buy|sell)\b[^0-9\n]{0,40}\d{3,}(?:\.\d+)?/.test(lower)) return false;
  return true;
}

/** Follow-up parameters: SL + TPs and/or entry band, often after a teaser. */
function rawLooksLikeParameterFollowUp(raw: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  const hasSl = /\bsl\s*[:\-]/i.test(lower) || /\bstop\s*loss\b/i.test(lower);
  const tpCount = countTpsInRaw(t);
  const hasOpenTp = /\btp\s*[:\-]?\s*open\b|\bopen\s*tp\b|\btp\s*open\b/i.test(lower);
  const hasEntryBand = rawLooksLikeRangeZone(t) ||
    /\d+(?:\.\d+)?\s*[-–—/]\s*\d+(?:\.\d+)?/.test(t);
  return (hasSl && (tpCount >= 1 || hasOpenTp)) || (hasEntryBand && hasSl && tpCount >= 1);
}

function rawHasOpenTp(raw: string): boolean {
  return /\btp\s*[:\-]?\s*open\b|\bopen\s*tp\b|\btp\s*open\b/i.test(String(raw ?? "").toLowerCase());
}

/** Raw-text heuristics when intent JSON is missing (pasted signals). */
function rawLooksLikeRangeZone(raw: string): boolean {
  const t = raw.toLowerCase();
  if (/\b(buy|sell)\s+zone\b/.test(t)) return true;
  if (/\bentry\s*(zone|range|area)\b/.test(t)) return true;
  if (/\b(zone|range)\s*:/.test(t)) return true;
  // "2650-2655" / "2650 – 2655" / "2650/2655" near entry language
  if (
    /\b(entry|buy|sell|limit)\b[^.\n]{0,40}\d+(?:\.\d+)?\s*[-–—/]\s*\d+(?:\.\d+)?/.test(t)
  ) {
    return true;
  }
  if (/\d+(?:\.\d+)?\s*[-–—/]\s*\d+(?:\.\d+)?[^.\n]{0,20}\b(entry|zone|range)\b/.test(t)) {
    return true;
  }
  return false;
}

function rawLooksLikeSinglePrice(raw: string): boolean {
  const t = raw.toLowerCase();
  if (rawLooksLikeRangeZone(raw)) return false;
  if (/\b(entry|enter|@|at)\s*:?\s*\d+(?:\.\d+)?\b/.test(t)) return true;
  if (/\b(buy|sell)\s+\w+\s+@?\s*\d+(?:\.\d+)?\b/.test(t)) return true;
  return false;
}

/** Two entry quotes on one line (First/Last Price), e.g. BUY NOW: (3879) 3878) or NOW 3879 / 3878. */
function rawLooksLikeDualEntryQuotes(raw: string): boolean {
  const t = String(raw ?? "").replace(/\s+/g, " ");
  if (
    /\b(?:now|instant|market|mkt)\s*:?\s*\(?\s*\d+(?:\.\d+)?\s*\)?\s+[\/(\-]?\s*\d+(?:\.\d+)?/i
      .test(t)
  ) {
    return true;
  }
  if (
    /\b(?:buy|sell|long|short)\s+(?:now|instant|market|mkt)?\s*:?\s*\(?\s*\d+(?:\.\d+)?\s*\)?\s*(?:\/|-|–)\s*\(?\s*\d+(?:\.\d+)?/i
      .test(t)
  ) {
    return true;
  }
  return false;
}

/** Count distinct TP tiers in raw signal text when intent.tp is missing/thin. */
function countTpsInRaw(raw: string): number {
  const text = String(raw ?? "");
  if (!text.trim()) return 0;
  const labeled = new Set<number>();
  // TP1 / TP 1 / TP¹ / Take Profit 2 / TP2:
  const labelRe =
    /\b(?:tp|take\s*profits?|targets?)\s*([1-9]|10|11|12|[¹²³⁴⁵⁶⁷⁸⁹])\b/gi;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text)) !== null) {
    const token = m[1];
    const map: Record<string, number> = {
      "¹": 1,
      "²": 2,
      "³": 3,
      "⁴": 4,
      "⁵": 5,
      "⁶": 6,
      "⁷": 7,
      "⁸": 8,
      "⁹": 9,
    };
    const n = map[token] ?? Number(token);
    if (Number.isFinite(n) && n >= 1 && n <= 12) labeled.add(n);
  }
  // Repeated "TP: 4062" lines (exclude "TP: open")
  const priceTpLines = text.match(/\btp\s*[:\-]?\s*\d+(?:\.\d+)?/gi) ?? [];
  const fromPriceLines = Math.min(12, priceTpLines.length);

  if (labeled.size > 0) return Math.max(Math.max(...labeled), fromPriceLines);

  if (fromPriceLines >= 1) return fromPriceLines;

  // "TP: 2650 / 2660 / 2670" or "Targets 1.1, 1.2, 1.3, 1.4"
  const listMatch = text.match(
    /\b(?:tps?|take\s*profits?|targets?)\s*[:\-–]?\s*([0-9][0-9./,\s]{3,80})/i,
  );
  if (listMatch) {
    const nums = listMatch[1]
      .split(/[/,\s]+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length >= 1) return Math.min(12, nums.length);
  }
  return 0;
}

function modePositiveCount(counts: number[]): number {
  const freq = new Map<number, number>();
  for (const c of counts) {
    if (!Number.isFinite(c) || c < 1) continue;
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let best = 0;
  let bestN = 0;
  for (const [c, n] of freq) {
    // Prefer the most common count; on ties prefer the higher TP count (signal depth).
    if (n > bestN || (n === bestN && c > best)) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

function estimateZoneWidthFromEntries(entry: number[]): number | null {
  const nums = entry.filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length < 2) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const width = hi - lo;
  return width > 0 ? width : null;
}

function accountSizeSnapshot(broker: ConfigureContext["broker"]): {
  balance: number | null;
  equity: number | null;
  currency: string | null;
  sizing_basis: number | null;
  size_tier: "unknown" | "micro" | "small" | "medium" | "large";
  risk_hints: Record<string, unknown>;
} {
  const balance =
    broker?.balance != null && Number.isFinite(Number(broker.balance))
      ? Number(broker.balance)
      : null;
  const equity =
    broker?.equity != null && Number.isFinite(Number(broker.equity))
      ? Number(broker.equity)
      : null;
  const sizing =
    equity != null && equity > 0 ? equity : balance != null && balance > 0 ? balance : null;
  let size_tier: "unknown" | "micro" | "small" | "medium" | "large" = "unknown";
  if (sizing != null) {
    if (sizing < 200) size_tier = "micro";
    else if (sizing < 500) size_tier = "small";
    else if (sizing < 5000) size_tier = "medium";
    else size_tier = "large";
  }
  const risk_hints: Record<string, unknown> = {
    prefer_risk_mode:
      size_tier === "large" || size_tier === "medium"
        ? "dynamic_balance_percent_or_fixed"
        : "fixed_lot",
    suggested_fixed_lot:
      size_tier === "micro" || size_tier === "small"
        ? 0.01
        : size_tier === "medium"
          ? 0.02
          : size_tier === "large"
            ? null
            : 0.01,
    suggested_dynamic_balance_percent:
      size_tier === "medium" ? 1 : size_tier === "large" ? 1 : size_tier === "unknown" ? null : 0.5,
    note:
      "Scale down lots when proposing multi/range baskets. Ask user if sizing_basis is null.",
  };
  return {
    balance,
    equity,
    currency: broker?.currency != null ? String(broker.currency) : null,
    sizing_basis: sizing,
    size_tier,
    risk_hints,
  };
}

function analyzeSignalExamples(
  examples: ConfigureContext["signal_examples"],
  ctx: ConfigureContext,
  focus?: string,
): Record<string, unknown> {
  const rows = Array.isArray(examples) ? examples : [];
  const account = accountSizeSnapshot(ctx.broker);
  if (rows.length === 0) {
    return {
      ok: false,
      error:
        "No signal examples in context yet. You can still propose concrete settings the user asked for (breakeven, risk, style, etc.). Invite Load/Paste only when you need entry-format analysis.",
      entry_mode: "unknown",
      account,
      focus: focus ?? null,
    };
  }

  let entryCount = 0;
  let updateCount = 0;
  let ignoreCount = 0;
  let multiTp = 0;
  let singleTp = 0;
  let noTp = 0;
  let zoneEntry = 0;
  let singleEntry = 0;
  let rawZoneHits = 0;
  let rawSingleHits = 0;
  let bareTeaserHits = 0;
  let parameterFollowUpHits = 0;
  let openTpHits = 0;
  let dualEntryQuotes = 0;
  let hasSl = 0;
  let hasSide = 0;
  const zoneWidths: number[] = [];
  const tpCounts: number[] = [];
  const sampleTpLevels: number[][] = [];
  const symbols = new Set<string>();
  const kinds = new Map<string, number>();

  for (const row of rows) {
    const label = String(row.label ?? "").toLowerCase();
    if (label === "entry") entryCount++;
    else if (label === "update") updateCount++;
    else if (label === "ignore") ignoreCount++;

    const raw = String(row.raw_message ?? "");
    const bareTeaser = rawLooksLikeBareTeaser(raw);
    const paramFollowUp = rawLooksLikeParameterFollowUp(raw);
    if (bareTeaser) bareTeaserHits++;
    if (paramFollowUp) parameterFollowUpHits++;
    if (rawHasOpenTp(raw)) openTpHits++;
    if (rawLooksLikeRangeZone(raw)) rawZoneHits++;
    else if (rawLooksLikeSinglePrice(raw)) rawSingleHits++;
    const rawTpCount = countTpsInRaw(raw);

    const intent = row.intent && typeof row.intent === "object" ? row.intent : null;
    const intentEntry = Array.isArray(intent?.entry)
      ? (intent!.entry as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    if (rawLooksLikeDualEntryQuotes(raw) || intentEntry.length >= 2) {
      dualEntryQuotes++;
    }
    if (!intent) {
      if (rawTpCount >= 1 && (label === "entry" || label === "update" || label === "")) {
        tpCounts.push(rawTpCount);
        if (rawTpCount > 1) multiTp++;
        else singleTp++;
      } else if (bareTeaser) {
        noTp++;
      }
      continue;
    }
    const kind = String(intent.kind ?? "unknown").toLowerCase();
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (typeof intent.symbol === "string" && intent.symbol.trim()) {
      symbols.add(intent.symbol.trim().toUpperCase());
    }
    if (intent.side) hasSide++;
    if (intent.open_tp === true) openTpHits++;
    const tp = Array.isArray(intent.tp)
      ? intent.tp.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const tpLen = Math.max(tp.length, rawTpCount);
    if (tpLen > 1) {
      multiTp++;
      tpCounts.push(tpLen);
      if (sampleTpLevels.length < 5) {
        sampleTpLevels.push(
          (tp.length > 0 ? tp : []).slice(0, 12),
        );
      }
    } else if (tpLen === 1) {
      singleTp++;
      tpCounts.push(1);
      if (sampleTpLevels.length < 5 && tp.length) sampleTpLevels.push(tp);
    } else if (kind === "entry" || label === "entry" || bareTeaser) {
      noTp++;
    }
    const entry = Array.isArray(intent.entry)
      ? intent.entry.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];
    if (entry.length >= 2) {
      zoneEntry++;
      const width = estimateZoneWidthFromEntries(entry);
      if (width != null) zoneWidths.push(width);
    } else if (entry.length === 1) {
      singleEntry++;
    }
    if (intent.sl != null && Number(intent.sl) > 0) hasSl++;
  }

  const teaserThenParams =
    bareTeaserHits > 0 && (parameterFollowUpHits > 0 || updateCount > 0 || multiTp > 0);

  const zoneScore = zoneEntry + rawZoneHits;
  const singleScore = singleEntry + rawSingleHits;
  let entry_mode:
    | "teaser_then_params"
    | "single_price"
    | "range_zone"
    | "mixed"
    | "unknown" = "unknown";
  if (teaserThenParams) {
    entry_mode = "teaser_then_params";
  } else if (zoneScore > 0 && singleScore > 0 && Math.min(zoneScore, singleScore) >= 1) {
    entry_mode = zoneScore >= singleScore * 2
      ? "range_zone"
      : singleScore >= zoneScore * 2
        ? "single_price"
        : "mixed";
  } else if (zoneScore > 0) {
    entry_mode = "range_zone";
  } else if (singleScore > 0 || hasSide > 0) {
    entry_mode = "single_price";
  }

  const avgZoneWidth =
    zoneWidths.length > 0
      ? zoneWidths.reduce((a, b) => a + b, 0) / zoneWidths.length
      : null;

  // Most common TP depth in the samples — never fall back to product default of 3.
  // Finite TPs only (TP: open is a runner, not a ladder row).
  const signalTpCount = modePositiveCount(tpCounts);
  const maxObservedTp = tpCounts.length ? Math.max(...tpCounts) : 0;
  const suggestedTradeStyle =
    entry_mode === "range_zone" ||
      entry_mode === "teaser_then_params" ||
      signalTpCount > 1 ||
      multiTp > 0
      ? "multi"
      : "single";
  // Range Layering (range_trading) pairs with multi so legs can average as price moves against entry.
  // Distinct from Use Signal Entry Range (entry gate) — teasers keep that gate off.
  const suggestedRangeLayering = suggestedTradeStyle === "multi";
  const suggestedUseSignalEntryRange =
    entry_mode !== "teaser_then_params" &&
    (entry_mode === "range_zone" || entry_mode === "mixed");
  const suggestedUseSignalEntryPrice =
    entry_mode !== "teaser_then_params" &&
    (entry_mode === "single_price" ||
      (entry_mode === "mixed" && !suggestedUseSignalEntryRange));
  // Dual quotes + Use Signal Entry Price (not zone wait) → First/Last (default first).
  const suggestEntryPriceGate =
    suggestedUseSignalEntryPrice && !suggestedUseSignalEntryRange;
  const suggestedSignalEntryPrefer =
    suggestEntryPriceGate && dualEntryQuotes > 0 ? "first_price" : null;

  // Rough pip-ish distance for FX/gold when zone width looks like price points
  let suggestedRangeDistancePips: number | null = null;
  if (avgZoneWidth != null && avgZoneWidth > 0) {
    if (avgZoneWidth < 1) suggestedRangeDistancePips = Math.max(5, Math.round(avgZoneWidth * 10000));
    else if (avgZoneWidth < 50) suggestedRangeDistancePips = Math.max(10, Math.round(avgZoneWidth * 10));
    else suggestedRangeDistancePips = Math.max(20, Math.round(avgZoneWidth));
  } else if (suggestedRangeLayering) {
    // Default ladder span when samples lack a clear zone width (incl. bare teasers).
    suggestedRangeDistancePips = 30;
  }

  const maxTpRows =
    ctx.plan_limits?.max_tp_rows != null && Number.isFinite(Number(ctx.plan_limits.max_tp_rows))
      ? Math.max(1, Number(ctx.plan_limits.max_tp_rows))
      : null;
  const tpLadderCount = Math.min(12, signalTpCount);
  const suggestedTpLots =
    tpLadderCount >= 1 ? buildSuggestedTpLots(tpLadderCount) : null;
  const tpPlanWarning =
    maxTpRows != null && tpLadderCount > maxTpRows
      ? `Signals typically use ${tpLadderCount} TPs but this plan allows ${maxTpRows} TP rows on Save — propose the full signal ladder and warn; Advanced may be required to keep all levels.`
      : null;

  return {
    ok: true,
    entry_mode,
    example_count: rows.length,
    labels: { entry: entryCount, update: updateCount, ignore: ignoreCount },
    intent_kinds: Object.fromEntries(kinds),
    symbols: [...symbols].slice(0, 12),
    signals_with_side: hasSide,
    signals_with_sl: hasSl,
    multi_tp_examples: multiTp,
    single_tp_examples: singleTp,
    entry_examples_without_tp: noTp,
    signal_tp_count: signalTpCount || null,
    typical_tp_count: signalTpCount || null,
    max_observed_tp_count: maxObservedTp || null,
    sample_tp_levels: sampleTpLevels,
    tp_count_histogram: Object.fromEntries(
      [...new Set(tpCounts)].sort((a, b) => a - b).map((c) => [
        String(c),
        tpCounts.filter((x) => x === c).length,
      ]),
    ),
    zone_entry_examples: zoneEntry,
    single_entry_examples: singleEntry,
    dual_entry_quotes: dualEntryQuotes,
    raw_zone_hits: rawZoneHits,
    raw_single_hits: rawSingleHits,
    bare_teaser_examples: bareTeaserHits,
    parameter_follow_up_examples: parameterFollowUpHits,
    open_tp_examples: openTpHits,
    avg_zone_width_price: avgZoneWidth,
    plan_max_tp_rows: maxTpRows,
    account,
    suggested: {
      trade_style: suggestedTradeStyle,
      // Range Layering — enable with multi so the full range is used (legs add as price moves against).
      range_trading: suggestedRangeLayering,
      range_layering_type: suggestedRangeLayering ? "auto" : null,
      range_percent: suggestedRangeLayering ? 50 : null,
      use_signal_entry_range: suggestedUseSignalEntryRange,
      use_signal_entry_price: suggestEntryPriceGate,
      signal_entry_prefer: suggestedSignalEntryPrefer,
      signal_entry_pip_tolerance:
        suggestedUseSignalEntryRange || suggestEntryPriceGate ? 10 : null,
      range_distance_pips: suggestedRangeDistancePips,
      range_step_pips:
        suggestedRangeDistancePips == null
          ? null
          : Math.max(5, Math.round(suggestedRangeDistancePips / 3)),
      risk_mode: account.risk_hints.prefer_risk_mode,
      fixed_lot: account.risk_hints.suggested_fixed_lot,
      dynamic_balance_percent: account.risk_hints.suggested_dynamic_balance_percent,
      use_predefined_tp_pips:
        entry_mode === "teaser_then_params"
          ? false
          : signalTpCount === 0 && noTp > 0
            ? true
            : false,
      // Predefined SL overrides signal SL — off when follow-ups usually include SL.
      use_predefined_sl_pips:
        entry_mode === "teaser_then_params"
          ? false
          : hasSl === 0 && parameterFollowUpHits === 0 && noTp > 0
            ? true
            : false,
      add_new_trades_to_existing: entry_mode === "teaser_then_params" ? true : undefined,
      tp_lots: suggestedTpLots,
      tp_lots_must_match_signal_count: signalTpCount || null,
      notes:
        entry_mode === "teaser_then_params"
          ? "Bare buy/sell now opens at market; follow-up SL/TPs merge onto the basket. Keep use_signal_entry_price, use_signal_entry_range, and use_predefined_sl_pips OFF (predefined SL overrides signal SL — it does not wait for the follow-up). With multi, enable Range Layering (range_trading) so new legs add as price moves against entry. Finite TPs only in tp_lots; TP: open is a runner."
          : suggestedRangeLayering
            ? "With multi trade, enable Range Layering (range_trading) so the copier can add trades as the market moves against entry and use the full range — not only the first fill."
            : null,
    },
    sample_raw: rows.slice(0, 5).map((r) => ({
      label: r.label ?? null,
      raw_message: String(r.raw_message ?? "").slice(0, 500),
      intent: compactIntent(r.intent),
    })),
    focus: focus ?? null,
    hint:
      (entry_mode === "teaser_then_params"
        ? "entry_mode=teaser_then_params: MUST set use_signal_entry_price=false and use_signal_entry_range=false (bare 'buy now' would otherwise skip). Explain teaser opens at market and follow-up params attach SL/TPs. "
        : "") +
      "Honor entry_mode + account.size_tier. Take-Profit Levels (tp_lots) MUST use signal_tp_count finite TP rows — never default to product TP1–TP3; exclude TP: open from the ladder count. Prefer suggested.tp_lots. Keep use_predefined_tp_pips false when signals include TP prices. Confirm risk mode/percent — do NOT invent Total Lot Size or 0.01-per-TP lines. Single Entries open one broker trade per enabled TP % (no worker partial closes); omit single_tp_target. Warn if multi/range needs Advanced. If use_signal_entry_range:true, include signal_entry_pip_tolerance + miss-trade warning. If dual_entry_quotes>0 and use_signal_entry_price:true, set signal_entry_prefer (first_price|last_price; default first) and label Entry price: First/Last Price. Answer TP follow-ups directly. End interactively." +
      (tpPlanWarning ? ` ${tpPlanWarning}` : ""),
  };
}

function buildSuggestedTpLots(
  count: number,
): Array<{ label: string; lot: number; percent: number; enabled: boolean }> {
  const n = Math.min(12, Math.max(1, Math.floor(count)));
  const presets: Record<number, number[]> = {
    1: [100],
    2: [60, 40],
    3: [50, 30, 20],
    4: [40, 30, 20, 10],
    5: [30, 25, 20, 15, 10],
    6: [25, 20, 20, 15, 10, 10],
    7: [20, 18, 16, 14, 12, 10, 10],
    8: [18, 16, 14, 12, 12, 10, 9, 9],
  };
  let percents = presets[n] ? [...presets[n]] : null;
  if (!percents) {
    const base = Math.floor(100 / n);
    percents = Array.from({ length: n }, () => base);
  }
  const sum = percents.reduce((a, b) => a + b, 0);
  if (sum !== 100 && percents.length) percents[0] += 100 - sum;
  return percents.map((percent, i) => ({
    label: `TP${i + 1}`,
    lot: 0.01,
    percent,
    enabled: true,
  }));
}

function planWarningsForPatch(
  patch: Record<string, unknown>,
  planFeatures: Record<string, boolean> | undefined,
): string[] {
  const warnings: string[] = [];
  const features = planFeatures ?? {};
  if (patch.trade_style === "multi" && features.multi_trade_style === false) {
    warnings.push("Range trade style requires Advanced plan; Basic will keep Single after Save.");
  }
  if (patch.range_trading === true && features.range_trading === false) {
    warnings.push("Range Layering requires Advanced plan; it may be cleared on Save for Basic.");
  }
  const be = String(patch.move_sl_to_entry_after_mode ?? "none");
  if (be !== "none" && be !== "" && features.auto_management === false) {
    warnings.push("Breakeven / auto-management features require Advanced plan.");
  }
  if (patch.reverse_signal === true && features.reverse_signal === false) {
    warnings.push("Reverse signal requires Advanced plan.");
  }
  return warnings;
}

type ToolResult = {
  content: string;
  pendingSettingsPatch?: PendingSettingsPatch;
};

function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ConfigureContext,
): ToolResult {
  switch (name) {
    case "analyze_signal_format": {
      const focus = args.focus != null ? String(args.focus) : undefined;
      return {
        content: JSON.stringify(analyzeSignalExamples(ctx.signal_examples, ctx, focus)),
      };
    }
    case "ask_user": {
      const questions = Array.isArray(args.questions)
        ? args.questions.map((q) => String(q).trim()).filter(Boolean).slice(0, 4)
        : [];
      return {
        content: JSON.stringify({
          ok: true,
          questions,
          hint: "Ask these questions in your next reply; do not propose settings until answered unless the user insists.",
        }),
      };
    }
    case "propose_settings": {
      const patch = sanitizeConfigureAiPatch(args.settings);
      // Normalize legacy / mistaken BE keys to the product schema.
      if (patch.move_sl_to_entry_after_tp_index != null && patch.move_sl_to_entry_tp_index == null) {
        patch.move_sl_to_entry_tp_index = patch.move_sl_to_entry_after_tp_index;
      }
      if (patch.move_sl_to_entry_after_pips != null && patch.move_sl_to_entry_after_value == null) {
        patch.move_sl_to_entry_after_value = patch.move_sl_to_entry_after_pips;
      }
      delete patch.move_sl_to_entry_after_tp_index;
      delete patch.move_sl_to_entry_after_pips;
      if (Object.keys(patch).length === 0) {
        return {
          content: JSON.stringify({
            error: "No allowed settings keys in the patch. Use known manual_settings fields only.",
          }),
        };
      }
      const analysis = analyzeSignalExamples(ctx.signal_examples, ctx);
      const signalTpCount = Number(analysis.signal_tp_count ?? 0);
      const analyzedMode = String(analysis.entry_mode ?? "");
      // Take-Profit Levels must follow signal TP depth, not product default TP1–TP3.
      if (signalTpCount >= 1) {
        const existing = Array.isArray(patch.tp_lots) ? patch.tp_lots : null;
        if (!existing || existing.length !== signalTpCount) {
          patch.tp_lots = buildSuggestedTpLots(signalTpCount);
        }
        if (patch.use_predefined_tp_pips === true) {
          patch.use_predefined_tp_pips = false;
        }
      }
      // Teaser → params: never gate the bare "buy now" on signal entry price/range.
      // Predefined SL overrides signal SL — do not enable when follow-ups carry SL.
      // Range Layering (range_trading) may still be on with multi — it is not an entry gate.
      if (analyzedMode === "teaser_then_params" || String(args.entry_mode ?? "") === "teaser_then_params") {
        patch.use_signal_entry_price = false;
        patch.use_signal_entry_range = false;
        // Follow-up params usually include SL; predefined SL would override it.
        patch.use_predefined_sl_pips = false;
      }
      // Pip tolerance only applies when an entry gate is on — strip otherwise.
      const entryGateOn =
        patch.use_signal_entry_range === true || patch.use_signal_entry_price === true;
      if (!entryGateOn && "signal_entry_pip_tolerance" in patch) {
        delete patch.signal_entry_pip_tolerance;
      }
      // First/Last entry prefer only applies with Use Signal Entry Price.
      const dualQuotes = Number(analysis.dual_entry_quotes ?? 0);
      if (patch.use_signal_entry_price !== true && "signal_entry_prefer" in patch) {
        delete patch.signal_entry_prefer;
      } else if (patch.use_signal_entry_price === true) {
        if ("signal_entry_prefer" in patch || dualQuotes > 0) {
          patch.signal_entry_prefer =
            String(patch.signal_entry_prefer ?? "first_price").toLowerCase() === "last_price"
              ? "last_price"
              : "first_price";
        }
      }
      // Multi → Range Layering: fill the range by adding legs as price moves against entry.
      const suggested = (analysis.suggested ?? {}) as Record<string, unknown>;
      const styleIsMulti =
        String(patch.trade_style ?? "").toLowerCase() === "multi" ||
        (patch.trade_style == null &&
          String(suggested.trade_style ?? "").toLowerCase() === "multi");
      if (styleIsMulti && patch.range_trading !== false) {
        patch.trade_style = "multi";
        if (patch.range_trading !== true) {
          patch.range_trading = true;
        }
        if (patch.range_layering_type == null) {
          patch.range_layering_type =
            suggested.range_layering_type === "pending_order" ? "auto" : "auto";
        }
        if (patch.range_percent == null && suggested.range_percent != null) {
          patch.range_percent = suggested.range_percent;
        } else if (patch.range_percent == null) {
          patch.range_percent = 50;
        }
        if (patch.range_distance_pips == null && suggested.range_distance_pips != null) {
          patch.range_distance_pips = suggested.range_distance_pips;
        } else if (patch.range_distance_pips == null) {
          patch.range_distance_pips = 30;
        }
        if (patch.range_step_pips == null && suggested.range_step_pips != null) {
          patch.range_step_pips = suggested.range_step_pips;
        } else if (patch.range_step_pips == null) {
          const dist = Number(patch.range_distance_pips);
          patch.range_step_pips = Number.isFinite(dist)
            ? Math.max(5, Math.round(dist / 3))
            : 10;
        }
      }
      const current =
        ctx.manual_settings && typeof ctx.manual_settings === "object"
          ? ctx.manual_settings
          : {};
      const mergedPreview = mergeManualSettings(current, patch);
      const summary =
        String(args.summary ?? "").trim() || summarizeManualPatch(patch);
      const rationale = String(args.rationale ?? "").trim();
      const entryMode = String(args.entry_mode ?? "unknown");
      const account = accountSizeSnapshot(ctx.broker);
      const modelWarnings = Array.isArray(args.warnings)
        ? args.warnings.map((w) => String(w).trim()).filter(Boolean)
        : [];
      const softWarnings: string[] = [];
      if (!rationale) {
        softWarnings.push("Add a rationale that cites entry type and account size.");
      }
      if (account.size_tier === "unknown") {
        softWarnings.push(
          "Account balance/equity missing — confirm account size with the user before they Apply.",
        );
      }
      if (
        entryMode === "range_zone" &&
        patch.use_signal_entry_range !== true &&
        analyzedMode !== "teaser_then_params"
      ) {
        softWarnings.push(
          "Signals look like a range/zone but Use Signal Entry Range is off — confirm whether entries should wait for the zone.",
        );
      }
      if (entryMode === "single_price" && patch.use_signal_entry_range === true) {
        softWarnings.push(
          "Signals look single-price but Use Signal Entry Range is on — confirm with the user.",
        );
      }
      if (styleIsMulti && patch.range_trading === true) {
        softWarnings.push(
          "Range Layering is on with Range trade style: reserved layers can add as price moves against entry so the full range is used (not only the first fill).",
        );
      } else if (styleIsMulti && patch.range_trading === false) {
        softWarnings.push(
          "Range trade style without Range Layering — only the initial split opens; no averaging-down legs as price moves against entry.",
        );
      }
      if (signalTpCount >= 1 && Array.isArray(patch.tp_lots)) {
        softWarnings.push(
          `Take-Profit Levels set to ${patch.tp_lots.length} rows to match signal TPs (not the default TP1–TP3).`,
        );
        const maxTp =
          ctx.plan_limits?.max_tp_rows != null
            ? Number(ctx.plan_limits.max_tp_rows)
            : null;
        if (maxTp != null && patch.tp_lots.length > maxTp) {
          softWarnings.push(
            `This plan allows ${maxTp} TP rows on Save; Advanced may be required to keep all ${patch.tp_lots.length} signal TPs.`,
          );
        }
      }
      if (analyzedMode === "teaser_then_params") {
        softWarnings.push(
          "Teaser format: Use Signal Entry Price and Use Signal Entry Range are off so bare “buy now” can open at market; follow-up SL/TPs attach to the open basket. Predefined SL is off because it overrides signal SL (it does not wait for the follow-up). Range Layering may still be on with Range trade style (it is not an entry gate).",
        );
      }
      if (patch.use_signal_entry_range === true) {
        const tol = Number(patch.signal_entry_pip_tolerance);
        if (!Number.isFinite(tol) || tol < 0) {
          softWarnings.push(
            "Use Signal Entry Range is on but signal_entry_pip_tolerance is missing — recommend a pip tolerance (e.g. 10) and warn that trades can be missed if price is too far from the entry zone.",
          );
        } else {
          softWarnings.push(
            `With Use Signal Entry Range + ${tol} pip tolerance: trades can be missed/skipped if live price is already outside the signal entry zone ± tolerance.`,
          );
        }
      } else if (
        patch.use_signal_entry_price !== true &&
        patch.signal_entry_pip_tolerance != null
      ) {
        softWarnings.push(
          "Signal Entry Pip Tolerance was removed — it is invalid when Use Signal Entry Range and Use Signal Entry Price are both off.",
        );
        delete patch.signal_entry_pip_tolerance;
      }
      if (patch.use_signal_entry_price === true && dualQuotes > 0) {
        const prefer =
          String(patch.signal_entry_prefer ?? "first_price") === "last_price"
            ? "Last Price"
            : "First Price";
        softWarnings.push(
          `Signals list two entry prices — Entry price is set to ${prefer} (as written). Confirm First Price vs Last Price if that is not what you want.`,
        );
      }
      const warnings = [
        ...modelWarnings,
        ...softWarnings,
        ...planWarningsForPatch(patch, ctx.plan_features),
      ];
      const pending: PendingSettingsPatch = {
        settings: patch,
        summary,
        rationale:
          rationale ||
          `Entry mode: ${entryMode}. Account tier: ${account.size_tier}.`,
        warnings: [...new Set(warnings)].slice(0, 8),
      };
      return {
        content: JSON.stringify({
          ok: true,
          pending: true,
          summary,
          rationale: pending.rationale,
          entry_mode: entryMode,
          account_size_tier: account.size_tier,
          warnings: pending.warnings,
          patched_keys: Object.keys(patch),
          preview_trade_style: mergedPreview.trade_style,
          preview_fixed_lot: mergedPreview.fixed_lot,
          preview_risk_mode: mergedPreview.risk_mode,
          hint:
            "A Propose card is shown in the UI. Tell the user briefly what you propose (entry type + account sizing) and that they can Apply to the form (Save still required).",
        }),
        pendingSettingsPatch: pending,
      };
    }
    default:
      return { content: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}

function buildContextSystemBlock(ctx: ConfigureContext): string {
  const examples = Array.isArray(ctx.signal_examples) ? ctx.signal_examples : [];
  const compactExamples = examples.slice(0, 12).map((e) => ({
    label: e.label ?? null,
    raw_message: String(e.raw_message ?? "").slice(0, 600),
    intent: compactIntent(e.intent),
  }));
  const account = accountSizeSnapshot(ctx.broker);
  const pending = ctx.pending_settings_patch;
  const pendingCompact =
    pending && pending.settings && typeof pending.settings === "object"
      ? {
          summary: String(pending.summary ?? "").slice(0, 300),
          rationale: String(pending.rationale ?? "").slice(0, 600),
          warnings: Array.isArray(pending.warnings)
            ? pending.warnings.map((w) => String(w)).slice(0, 6)
            : [],
          settings: pending.settings,
        }
      : null;
  const payload = {
    broker_account_id: ctx.broker_account_id ?? null,
    channel_id: ctx.channel_id ?? null,
    channel_name: ctx.channel_name ?? null,
    source_kind: ctx.source_kind ?? null,
    broker: ctx.broker ?? null,
    account_size: account,
    plan_features: ctx.plan_features ?? {},
    plan_limits: ctx.plan_limits ?? {},
    manual_settings: ctx.manual_settings ?? {},
    pending_settings_patch: pendingCompact,
    signal_examples: compactExamples,
    signal_example_count: examples.length,
    instructions: [
      "Signal samples are optional for narrow edits. Concrete user requests (breakeven, trailing, lot/risk, style, etc.) → propose_settings immediately; never refuse only because signal_example_count is 0.",
      "If signal_example_count > 0 OR the user asks to analyze/propose from signals: the samples ARE the input — never say they provided no input. Call analyze_signal_format then propose_settings in this turn.",
      "Break even at TP N → move_sl_to_entry_after_mode=tp_hit + move_sl_to_entry_tp_index=N.",
      "When samples exist, classify single_price vs range_zone / teaser_then_params before a full package. When absent, still apply the asked settings.",
      "Size lots/risk from account_size.sizing_basis / size_tier when the request needs sizing; ask if unknown.",
      "Full-package rationales cite entry type + account size when known; single-setting patches may cite the user request instead.",
      "Never invent a Total Lot Size or 0.01-per-TP bullet. TP rows are percent shares only; dynamic_balance_percent sizes the whole basket (balance×pct/100/1000), not 0.01 per TP.",
      "Take-Profit Levels (tp_lots) must match the signal TP count from samples — never default to product TP1–TP3 when signals use another N. Keep use_predefined_tp_pips false when signals include TP prices.",
      "If samples show bare 'buy/sell now' then a later parameters message (teaser_then_params): keep use_signal_entry_price, use_signal_entry_range, and use_predefined_sl_pips false. Predefined SL overrides signal SL — it does not wait for a later SL.",
      "Cover TPs in proposals when samples have targets; answer 'What about TPs?' (and similar) directly from signal_examples + pending_settings_patch — never claim a misunderstanding.",
      "If use_signal_entry_range is true: also set signal_entry_pip_tolerance and warn about missing trades when price is outside the zone ± tolerance. If both use_signal_entry_range and use_signal_entry_price are false: omit signal_entry_pip_tolerance entirely (do not list it in Proposed Settings).",
      "If use_signal_entry_price is true and samples show two entry quotes (dual_entry_quotes): set signal_entry_prefer to first_price or last_price (default first). In chat say Entry price: First Price / Last Price. Omit signal_entry_prefer when Use Signal Entry Price is off.",
      "If use_signal_entry_price is true and samples show two entry quotes (dual_entry_quotes): set signal_entry_prefer to first_price or last_price (default first). In chat say Entry price: First Price / Last Price. Omit signal_entry_prefer when Use Signal Entry Price is off.",
      "End proposal replies interactively: ask whether to proceed with these settings, or if they have something else in mind.",
    ],
  };
  return `## Live configure context (trusted snapshot)\n\`\`\`json\n${JSON.stringify(payload).slice(0, 24_000)}\n\`\`\``;
}

async function openaiChat(
  messages: ChatMessage[],
  toolChoice: "auto" | { type: "function"; function: { name: string } } = "auto",
) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.35,
      messages,
      tools: TOOL_DEFS,
      tool_choice: toolChoice,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && data.error?.message
        ? String(data.error.message)
        : `OpenAI HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as { choices?: Array<{ message?: ChatMessage }> };
}

function messageLooksLikeProposal(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) return false;
  if (/\bpropose[ds]?\s+settings\b|\brecommended\s+settings\b|\bproposed\s+configuration\b/.test(t)) {
    return true;
  }
  if (
    /\bwould you like to proceed\b|\bapply\s+(?:these\s+)?settings\b|\bprepare(?:d)?\s+these\s+settings\b|\bsomething else in mind\b/
      .test(t)
  ) {
    return true;
  }
  const settingHits = [
    /\brisk\s*mode\b/,
    /\btrade\s*style\b/,
    /\buse\s+signal\s+entry\b/,
    /\btake-?profit\b|\btp\d?\b/,
    /\bdynamic[_\s-]?balance\b/,
    /\bfixed[_\s-]?lot\b/,
    /\badd\s+new\s+trades\s+to\s+existing\b/,
  ].filter((re) => re.test(t)).length;
  return settingHits >= 2;
}

/** Model sometimes ignores loaded samples and claims the user sent nothing. */
function messageLooksLikeNoInputStall(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) return true;
  return (
    /didn'?t provide|did not provide|no (?:additional )?input|provide any (?:additional )?input|no signal examples|share (?:a couple of )?sample|could you please share/.test(
      t,
    )
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return bad(405, "Method not allowed");
  if (!OPENAI_API_KEY) return bad(503, "OPENAI_API_KEY is not configured");

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return bad(401, "Unauthorized");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData.user) return bad(401, "Unauthorized");

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const uiLocale = typeof body.locale === "string" ? body.locale : undefined;
  const ctx = (body.context && typeof body.context === "object"
    ? body.context
    : {}) as ConfigureContext;

  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        CONFIGURE_WITH_AI_SYSTEM_PROMPT +
        assistantReplyLanguageAddon(uiLocale) +
        "\n\n" +
        buildContextSystemBlock(ctx),
    },
    ...incoming
      .filter(
        (m: { role?: string; content?: unknown }) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
      .slice(-20)
      .map((m: { role: string; content: string }) => ({
        role: m.role,
        content: String(m.content).slice(0, 8000),
      })),
  ];

  let newestUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      newestUserIndex = i;
      break;
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user" || typeof msg.content !== "string") continue;
    const guarded = guardAssistantUserMessage(msg.content);
    if (!guarded.ok) {
      if (i === newestUserIndex) {
        return Response.json(
          {
            assistant_message:
              "I can't help with that. I'm here to configure trading settings for this channel.",
            pending_settings_patch: null,
          },
          { headers: corsHeaders },
        );
      }
      messages.splice(i, 1);
      continue;
    }
    msg.content = sanitizeAssistantText(guarded.text);
  }

  let pendingSettingsPatch: PendingSettingsPatch | null = null;
  let finalMessage = "";

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const data = await openaiChat(messages);
      const msg = data.choices?.[0]?.message;
      if (!msg) break;

      const toolCalls = msg.tool_calls ?? [];
      if (!toolCalls.length) {
        finalMessage = typeof msg.content === "string" ? msg.content.trim() : "";
        break;
      }

      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const name = call.function?.name ?? "";
        const args = sanitizeToolArgs(parseArgs(call.function?.arguments ?? "{}"));
        const result = executeTool(name, args, ctx);
        if (result.pendingSettingsPatch) {
          pendingSettingsPatch = result.pendingSettingsPatch;
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.content.slice(0, 8000),
        });
      }
    }

    if (!finalMessage) {
      const data = await openaiChat(messages);
      const msg = data.choices?.[0]?.message;
      finalMessage = typeof msg?.content === "string" ? msg.content.trim() : "";
    }

    const hasExamples =
      Array.isArray(ctx.signal_examples) && ctx.signal_examples.length > 0;
    const hasPriorPending =
      ctx.pending_settings_patch?.settings &&
      typeof ctx.pending_settings_patch.settings === "object" &&
      Object.keys(ctx.pending_settings_patch.settings).length > 0;

    // Samples loaded but model stalled with "no input" — force analyze + propose.
    if (
      hasExamples &&
      !pendingSettingsPatch &&
      !hasPriorPending &&
      messageLooksLikeNoInputStall(finalMessage)
    ) {
      messages.push({
        role: "assistant",
        content: finalMessage || "Waiting for analysis.",
      });
      messages.push({
        role: "user",
        content:
          "Signal examples ARE already in context (signal_example_count > 0). Call analyze_signal_format now, then propose_settings with a full draft. Do not ask for samples again.",
      });
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const data = await openaiChat(messages);
        const msg = data.choices?.[0]?.message;
        if (!msg) break;
        const toolCalls = msg.tool_calls ?? [];
        if (!toolCalls.length) {
          const text = typeof msg.content === "string" ? msg.content.trim() : "";
          if (text) finalMessage = text;
          break;
        }
        messages.push({
          role: "assistant",
          content: msg.content ?? null,
          tool_calls: toolCalls,
        });
        for (const call of toolCalls) {
          const name = call.function?.name ?? "";
          const args = sanitizeToolArgs(parseArgs(call.function?.arguments ?? "{}"));
          const result = executeTool(name, args, ctx);
          if (result.pendingSettingsPatch) {
            pendingSettingsPatch = result.pendingSettingsPatch;
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result.content.slice(0, 8000),
          });
        }
      }
      if (!pendingSettingsPatch) {
        const forced = await openaiChat(messages, {
          type: "function",
          function: { name: "propose_settings" },
        });
        const forcedMsg = forced.choices?.[0]?.message;
        const forcedCalls = forcedMsg?.tool_calls ?? [];
        if (forcedCalls.length) {
          messages.push({
            role: "assistant",
            content: forcedMsg?.content ?? null,
            tool_calls: forcedCalls,
          });
          for (const call of forcedCalls) {
            const name = call.function?.name ?? "";
            const args = sanitizeToolArgs(parseArgs(call.function?.arguments ?? "{}"));
            const result = executeTool(name, args, ctx);
            if (result.pendingSettingsPatch) {
              pendingSettingsPatch = result.pendingSettingsPatch;
            }
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: result.content.slice(0, 8000),
            });
          }
          const after = await openaiChat(messages);
          const afterText =
            typeof after.choices?.[0]?.message?.content === "string"
              ? after.choices[0].message!.content!.trim()
              : "";
          if (afterText) finalMessage = afterText;
        }
      }
    }

    // Model often describes settings in prose without calling propose_settings — force it
    // so the UI can show Apply pills under that reply.
    if (
      !pendingSettingsPatch &&
      !hasPriorPending &&
      messageLooksLikeProposal(finalMessage)
    ) {
      const proposalProse = finalMessage;
      messages.push({
        role: "assistant",
        content: proposalProse,
      });
      messages.push({
        role: "user",
        content:
          "Please call propose_settings now with the exact settings you just recommended so the UI can show Apply settings / Something else pills. Do not rewrite the proposal in chat.",
      });
      const forced = await openaiChat(messages, {
        type: "function",
        function: { name: "propose_settings" },
      });
      const forcedMsg = forced.choices?.[0]?.message;
      const forcedCalls = forcedMsg?.tool_calls ?? [];
      if (forcedCalls.length) {
        messages.push({
          role: "assistant",
          content: forcedMsg?.content ?? null,
          tool_calls: forcedCalls,
        });
        for (const call of forcedCalls) {
          const name = call.function?.name ?? "";
          const args = sanitizeToolArgs(parseArgs(call.function?.arguments ?? "{}"));
          const result = executeTool(name, args, ctx);
          if (result.pendingSettingsPatch) {
            pendingSettingsPatch = result.pendingSettingsPatch;
          }
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result.content.slice(0, 8000),
          });
        }
        // Keep the original prose proposal; pills attach under it in the UI.
        finalMessage = proposalProse;
      }
    }

    // Reuse prior pending patch from the client when this turn only chatted.
    if (
      !pendingSettingsPatch &&
      hasPriorPending &&
      ctx.pending_settings_patch
    ) {
      pendingSettingsPatch = {
        settings: sanitizeConfigureAiPatch(ctx.pending_settings_patch.settings),
        summary: String(ctx.pending_settings_patch.summary ?? "Settings"),
        rationale: String(ctx.pending_settings_patch.rationale ?? ""),
        warnings: Array.isArray(ctx.pending_settings_patch.warnings)
          ? ctx.pending_settings_patch.warnings.map((w) => String(w))
          : [],
      };
      if (!Object.keys(pendingSettingsPatch.settings).length) {
        pendingSettingsPatch = null;
      }
    }
  } catch (e) {
    return bad(502, e instanceof Error ? e.message : "Configure AI failed");
  }

  if (!finalMessage) {
    finalMessage = pendingSettingsPatch
      ? "I prepared a settings proposal — tap Apply settings below when you’re ready (Save in Configure Trading still required)."
      : "How would you like to configure this channel?";
  }

  return Response.json(
    {
      assistant_message: finalMessage.slice(0, 8000),
      pending_settings_patch: pendingSettingsPatch,
      chat_actions: pendingSettingsPatch
        ? [
            { id: "apply_settings", label: "Apply settings" },
            { id: "something_else", label: "Something else" },
          ]
        : [],
    },
    { headers: corsHeaders },
  );
});
