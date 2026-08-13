/**
 * Prompt-injection guard + input sanitization for the in-app AI assistant.
 *
 * Threat model:
 * - User messages (or pasted content) trying to override the assistant's
 *   instructions, extract the system prompt, impersonate roles, or smuggle
 *   instructions inside encoded/markup payloads.
 * - Tool arguments polluted with oversized or control-character payloads.
 *
 * Design: refuse-then-allow. Detection is conservative and pattern-based,
 * scanning the SANITIZED text. When flagged, the caller refuses the whole turn
 * with a generic message — the specific matched reason is never returned to
 * the user (that would teach attackers how to evade).
 *
 * This module is pure TS (no Deno/OpenAI/Supabase imports) so it can be
 * unit-tested with `deno test` and linted independently.
 */

export const ASSISTANT_MAX_MESSAGE_CHARS = 8000
export const ASSISTANT_MAX_TOOL_ARG_CHARS = 2000
export const ASSISTANT_MAX_TOOL_ARGS = 32
export const ASSISTANT_MAX_TOOL_ARRAY_ITEMS = 50
export const ASSISTANT_MAX_TOOL_DEPTH = 4

// Control chars are the point of this sanitizer — must be matched, not avoided.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const ZERO_WIDTH_CHARS = /[\u200b-\u200f\u2060\u2066-\u2069\ufeff]/g

/** Strip control/zero-width chars and clip length. Preserves text fidelity. */
export function sanitizeAssistantText(
  raw: string | null | undefined,
  maxChars: number = ASSISTANT_MAX_MESSAGE_CHARS,
): string {
  return String(raw ?? "")
    .replace(CONTROL_CHARS, "")
    .replace(ZERO_WIDTH_CHARS, "")
    .slice(0, maxChars)
}

/** Lowercase + whitespace-collapsed copy used for detection only. */
function normalizeForDetection(text: string): string {
  return text.replace(/\s+/g, " ").toLowerCase()
}

const DECODE_CACHE = new Map<string, string>()
function tryDecodeBase64(blob: string): string | null {
  const hit = DECODE_CACHE.get(blob)
  if (hit !== undefined) return hit === "" ? null : hit
  let decoded: string | null = null
  try {
    const bytes = atob(blob.replace(/\s/g, ""))
    // Only treat printable-ASCII payloads as decodable text.
    if (/^[\x20-\x7e]*$/.test(bytes)) decoded = bytes
  } catch {
    decoded = null
  }
  DECODE_CACHE.set(blob, decoded ?? "")
  return decoded
}

/**
 * Detect classic prompt-injection / system-prompt-extraction attempts.
 * Returns a short internal reason code when flagged, or null when clean.
 */
export function detectPromptInjection(raw: string): string | null {
  const sanitized = sanitizeAssistantText(raw, ASSISTANT_MAX_MESSAGE_CHARS)
  const text = normalizeForDetection(sanitized)
  if (!text) return null

  // 1. Instruction override: "ignore all previous instructions", "forget the
  //    system prompt", "don't follow the above rules", "bypass your rules".
  // 1. Instruction override: "ignore all previous instructions", "forget the
  //    system prompt", "don't follow the above rules", "bypass your guidelines".
  //    A negative lookahead keeps legit copier talk clean ("ignore your stop
  //    loss instructions" = a user talking about their own trade levels).
  const override = /(?:ignore|forget|override|disregard|bypass|skip|stop (?:following|obeying)|don'?t (?:follow|obey|read)|do not (?:follow|obey|read))[^.!?\n]{0,60}\b(?:previous|prior|above|all|earlier|system|initial|your|the (?:above|previous))(?![\s\S]{0,60}\b(?:stop loss|take profit|take-profit|entry|exit|levels?|settings?|config|price|zone|signal|pips?|lots?)\b)[^.!?\n]{0,20}\b(?:instructions?|prompts?|rules?|messages?|guidelines?|directions?)/i
  if (override.test(text)) return "instruction_override"

  // 2. System-prompt extraction: "repeat the system prompt", "print your
  //    instructions", "what is your system prompt", "leak your prompt".
  //    ("what is a system prompt?" — a general question — stays allowed.)
  const extraction = /(?:print|reveal|repeat|show|share|output|leak|expose|disclose|echo|copy|paste|dump|tell (?:me|us))[^.!?\n]{0,50}\b(?:system prompt|your instructions?|your prompt|system message|initial prompt|your rules|your guidelines?)|what (?:is|are|'s|s)[^.!?\n]{0,30}\b(?:your|the)[^.!?\n]{0,15}\b(?:system prompt|system message|initial prompt|instructions?|rules?)/i
  if (extraction.test(text)) return "system_prompt_extraction"

  // 3. Role impersonation / jailbreak keywords.
  const jailbreak = /\b(?:jailbreak|developer mode|god mode|do anything now|unfiltered mode|unrestricted mode|dan mode)\b/i
  if (jailbreak.test(text)) return "jailbreak"

  // 4. Hidden markup smuggling: HTML comments or markdown code fences carrying
  //    instruction keywords.
  const hiddenInstruction = /<!--[^]{0,400}?(?:instructions?|prompts?|system prompt|rules?)[^]{0,400}?-->|```[^`]{0,600}?(?:ignore|override|forget)[^`]{0,600}?```/i
  if (hiddenInstruction.test(text)) return "hidden_instruction"

  // 5. Encoded payloads: long base64 blobs that decode to instruction-speak.
  //    Base64 is case-sensitive, so scan the ORIGINAL sanitized text, not the
  //    lowercased detection copy.
  const b64Blob = /[A-Za-z0-9+/]{60,}={0,2}/g
  for (const match of sanitized.match(b64Blob) ?? []) {
    const decoded = tryDecodeBase64(match)
    if (decoded && /(?:ignore|override|forget|system prompt|instructions?)/i.test(decoded)) {
      return "encoded_instruction"
    }
  }

  return null
}

export type GuardResult =
  | { ok: true; sanitized: string }
  | { ok: false; reason: string }

/** Sanitize a user message; refuse when it looks like an injection attempt. */
export function guardAssistantUserMessage(raw: string | null | undefined): GuardResult {
  const sanitized = sanitizeAssistantText(raw)
  const reason = detectPromptInjection(sanitized)
  if (reason) return { ok: false, reason }
  return { ok: true, sanitized }
}

/**
 * Recursively sanitize tool arguments: strip control chars, cap string
 * lengths, bound array sizes, cap key counts and nesting depth, and drop
 * non-JSON-safe values (functions, symbols, bigints).
 */
export function sanitizeToolArgs(
  value: unknown,
  depth = 0,
  budget = ASSISTANT_MAX_TOOL_ARGS,
): unknown {
  if (value == null) return value
  if (typeof value === "string") {
    return sanitizeAssistantText(value, ASSISTANT_MAX_TOOL_ARG_CHARS)
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value as number) || typeof value === "boolean" ? value : null
  }
  if (Array.isArray(value)) {
    if (depth >= ASSISTANT_MAX_TOOL_DEPTH) return []
    return value
      .slice(0, ASSISTANT_MAX_TOOL_ARRAY_ITEMS)
      .map((item) => sanitizeToolArgs(item, depth + 1, budget))
  }
  if (typeof value === "object") {
    if (depth >= ASSISTANT_MAX_TOOL_DEPTH) return {}
    const out: Record<string, unknown> = {}
    let keys = 0
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (keys >= budget) break
      out[sanitizeAssistantText(key, 128)] = sanitizeToolArgs(item, depth + 1, budget)
      keys++
    }
    return out
  }
  return null
}
