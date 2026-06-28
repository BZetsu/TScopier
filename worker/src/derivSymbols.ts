/**
 * Deriv synthetic-index registry and alias normalization.
 *
 * Deriv signals come in many forms — `V75`, `Vix75`, `VOL 75`, `R_75`,
 * `Volatility 75 Index`, `Boom 1000`, `Crash 500`, `Step Index`, `Jump 75`,
 * `Range Break 100`, `Bull/Bear Market`. This module maps all of them to a
 * canonical Deriv code (`R_75`, `1HZ75V`, `BOOM1000`, …) and resolves a
 * canonical code to whatever the broker's live `/Symbols` inventory calls it
 * (often the long display name `Volatility 75 Index`).
 *
 * Ambiguous aliases (e.g. `V75` with no tick marker) default to the standard
 * 2-second tick symbol (`R_75`); explicit `(1s)` / `1HZ` / `1s` markers map to
 * the 1-second variant (`1HZ75V`).
 *
 * Self-contained (no imports) so the file can be mirrored verbatim into
 * supabase/functions/_shared/derivSymbols.ts for the edge runtime.
 */

export type DerivSyntheticFamily =
  | 'volatility'
  | 'boom'
  | 'crash'
  | 'step'
  | 'jump'
  | 'range_break'
  | 'bull_bear'

/** Volatility levels Deriv publishes (2s `R_n` and/or 1s `1HZnV`). */
const VOLATILITY_LEVELS = new Set([10, 15, 25, 30, 50, 75, 90, 100, 150, 200, 250])
/** Jump index levels. */
const JUMP_LEVELS = new Set([10, 25, 50, 75, 100])
/** Boom / Crash spike intervals. */
const BOOM_CRASH_LEVELS = new Set([300, 500, 600, 900, 1000])
/** Range break intervals. */
const RANGE_BREAK_LEVELS = new Set([100, 200])

function matchNum(u: string, re: RegExp): number | null {
  const m = u.match(re)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** True when the text explicitly asks for the 1-second tick variant. */
function wantsOneSecond(u: string): boolean {
  return /\b1HZ\d{1,3}V\b/.test(u)
    || /\(\s*1\s*S\s*\)/.test(u)
    || /\b1\s*S\b/.test(u)
    || /\b1\s*SEC(?:OND)?\b/.test(u)
}

/**
 * Parse free-form channel text (or a single token) into a canonical Deriv
 * synthetic code, or null when the text is not a recognized synthetic.
 */
export function normalizeDerivAlias(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const u = String(raw).toUpperCase()
  if (!u.trim()) return null

  // Bull / Bear market indices.
  if (/\bRDBULL\b/.test(u) || /\bBULL\s*MARKET\b/.test(u)) return 'RDBULL'
  if (/\bRDBEAR\b/.test(u) || /\bBEAR\s*MARKET\b/.test(u)) return 'RDBEAR'

  // Step indices (STPRNG / STPRNG2 / STPRNG5; Step 100/200/500).
  let m = u.match(/\bSTPRNG\s*([25])?\b/)
  if (m) return m[1] === '2' ? 'STPRNG2' : m[1] === '5' ? 'STPRNG5' : 'STPRNG'
  m = u.match(/\bSTEP\s*(\d{3})\b/)
  if (m) return m[1] === '200' ? 'STPRNG2' : m[1] === '500' ? 'STPRNG5' : 'STPRNG'
  if (/\bSTEP(?:\s*INDEX)?\b/.test(u)) return 'STPRNG'

  // Range break indices.
  {
    const n = matchNum(u, /\bRB[_\s]?(\d{2,3})\b/) ?? matchNum(u, /\bRANGE\s*BREAK\s*(\d{2,3})\b/)
    if (n != null && RANGE_BREAK_LEVELS.has(n)) return `RB_${n}`
  }

  // Boom / Crash.
  {
    const n = matchNum(u, /\bBOOM\s*(\d{3,4})\b/)
    if (n != null && BOOM_CRASH_LEVELS.has(n)) return `BOOM${n}`
  }
  {
    const n = matchNum(u, /\bCRASH\s*(\d{3,4})\b/)
    if (n != null && BOOM_CRASH_LEVELS.has(n)) return `CRASH${n}`
  }

  // Jump.
  {
    const n = matchNum(u, /\bJD\s*(\d{2,3})\b/) ?? matchNum(u, /\bJUMP\s*(\d{2,3})\b/)
    if (n != null && JUMP_LEVELS.has(n)) return `JD${n}`
  }

  // Volatility (the most common, and most alias-heavy family).
  const volNum =
    matchNum(u, /\b1HZ(\d{1,3})V\b/)
    ?? matchNum(u, /\bR_?(\d{1,3})\b/)
    ?? matchNum(u, /\bVIX\s*(\d{1,3})\b/)
    ?? matchNum(u, /\bVOLATILITY\s*(\d{1,3})\b/)
    ?? matchNum(u, /\bVOL\s*(\d{1,3})\b/)
    ?? matchNum(u, /\bV(\d{2,3})\b/)
  if (volNum != null && VOLATILITY_LEVELS.has(volNum)) {
    return wantsOneSecond(u) ? `1HZ${volNum}V` : `R_${volNum}`
  }

  return null
}

const CANONICAL_RE =
  /^(R_\d{1,3}|1HZ\d{1,3}V|BOOM\d{3,4}|CRASH\d{3,4}|STPRNG[25]?|JD\d{2,3}|RB_\d{2,3}|RDBULL|RDBEAR)$/

/** True when the symbol is already a canonical Deriv synthetic code. */
export function isDerivSyntheticSymbol(symbol: string | null | undefined): boolean {
  return CANONICAL_RE.test(String(symbol ?? '').toUpperCase().trim())
}

/** Family of a canonical Deriv code, or null when not a synthetic. */
export function derivSyntheticFamily(canonical: string): DerivSyntheticFamily | null {
  const s = String(canonical ?? '').toUpperCase().trim()
  if (/^R_\d{1,3}$/.test(s) || /^1HZ\d{1,3}V$/.test(s)) return 'volatility'
  if (/^BOOM\d{3,4}$/.test(s)) return 'boom'
  if (/^CRASH\d{3,4}$/.test(s)) return 'crash'
  if (/^STPRNG[25]?$/.test(s)) return 'step'
  if (/^JD\d{2,3}$/.test(s)) return 'jump'
  if (/^RB_\d{2,3}$/.test(s)) return 'range_break'
  if (s === 'RDBULL' || s === 'RDBEAR') return 'bull_bear'
  return null
}

/** Strip everything but A-Z and 0-9 for tolerant inventory matching. */
function normForMatch(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Candidate human/broker names a canonical code may appear as in the broker's
 * `/Symbols` inventory (both Deriv short codes and DMT5 display names).
 */
export function derivDisplayCandidates(canonical: string): string[] {
  const s = String(canonical ?? '').toUpperCase().trim()
  const fam = derivSyntheticFamily(s)
  if (!fam) return []

  if (fam === 'volatility') {
    const oneSec = s.startsWith('1HZ')
    const n = oneSec ? s.replace(/^1HZ/, '').replace(/V$/, '') : s.replace(/^R_/, '')
    return oneSec
      ? [s, `Volatility ${n} (1s) Index`, `Volatility ${n} 1s Index`, `Volatility ${n} (1s)`]
      : [s, `R_${n}`, `Volatility ${n} Index`, `Volatility ${n}`]
  }
  if (fam === 'boom') {
    const n = s.replace(/^BOOM/, '')
    return [s, `Boom ${n} Index`, `Boom ${n}`]
  }
  if (fam === 'crash') {
    const n = s.replace(/^CRASH/, '')
    return [s, `Crash ${n} Index`, `Crash ${n}`]
  }
  if (fam === 'step') {
    if (s === 'STPRNG2') return [s, 'Step 200 Index', 'Step 200']
    if (s === 'STPRNG5') return [s, 'Step 500 Index', 'Step 500']
    return [s, 'Step Index', 'Step 100 Index', 'Step 100']
  }
  if (fam === 'jump') {
    const n = s.replace(/^JD/, '')
    return [s, `Jump ${n} Index`, `Jump ${n}`]
  }
  if (fam === 'range_break') {
    const n = s.replace(/^RB_/, '')
    return [s, `Range Break ${n} Index`, `Range Break ${n}`]
  }
  // bull_bear
  if (s === 'RDBULL') return [s, 'Bull Market Index', 'Bull Market']
  return [s, 'Bear Market Index', 'Bear Market']
}

/**
 * Resolve a canonical Deriv code to the broker's exact `/Symbols` string.
 * Matches Deriv short codes and DMT5 display names tolerantly (ignoring case,
 * spaces and punctuation). Returns null when the broker does not list it.
 */
export function resolveDerivCanonicalToBrokerSymbol(
  canonical: string,
  inventory: readonly string[],
): string | null {
  if (!isDerivSyntheticSymbol(canonical) || !inventory || inventory.length === 0) return null
  const wanted = new Set(derivDisplayCandidates(canonical).map(normForMatch))
  if (wanted.size === 0) return null

  // 1) Exact (normalized) match against any known display form.
  for (const inv of inventory) {
    if (wanted.has(normForMatch(inv))) return inv
  }

  // 2) Fuzzy: a candidate is a prefix of the inventory name (handles trailing
  //    "Index", broker suffixes, etc.) — e.g. "VOLATILITY75" ⊂ "VOLATILITY75INDEX".
  const sorted = [...wanted].sort((a, b) => b.length - a.length)
  for (const inv of inventory) {
    const ni = normForMatch(inv)
    for (const w of sorted) {
      if (w.length >= 4 && (ni === w || ni.startsWith(w) || ni.includes(w))) return inv
    }
  }

  return null
}

/** Representative list of canonical Deriv synthetic codes (for UI / tests). */
export function listDerivCanonicalSymbols(): string[] {
  const out: string[] = []
  for (const n of VOLATILITY_LEVELS) {
    out.push(`R_${n}`)
    out.push(`1HZ${n}V`)
  }
  for (const n of BOOM_CRASH_LEVELS) {
    out.push(`BOOM${n}`)
    out.push(`CRASH${n}`)
  }
  out.push('STPRNG', 'STPRNG2', 'STPRNG5')
  for (const n of JUMP_LEVELS) out.push(`JD${n}`)
  for (const n of RANGE_BREAK_LEVELS) out.push(`RB_${n}`)
  out.push('RDBULL', 'RDBEAR')
  return out
}
