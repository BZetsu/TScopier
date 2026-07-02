/**
 * Map AI training output into channel_keywords management fields.
 * Keep in sync with supabase/functions/_shared/trainingManagementKeywords.ts
 */

export type ManagementKeywordGroups = {
  close_all: string[]
  close_partial: string[]
  close_half: string[]
  break_even: string[]
  modify_sl: string[]
  modify_tp: string[]
  close_worse_entries: string[]
}

export function emptyManagementGroups(): ManagementKeywordGroups {
  return {
    close_all: [],
    close_partial: [],
    close_half: [],
    break_even: [],
    modify_sl: [],
    modify_tp: [],
    close_worse_entries: [],
  }
}

function cleanTokens(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(
    raw.map((v) => String(v ?? '').trim()).filter(Boolean),
  ))
}

export function normalizeManagementGroups(raw: unknown): ManagementKeywordGroups {
  const src = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    close_all: filterManagementGroupList(cleanTokens(src.close_all)),
    close_partial: filterManagementGroupList(cleanTokens(src.close_partial)),
    close_half: filterManagementGroupList(cleanTokens(src.close_half)),
    break_even: filterManagementGroupList(cleanTokens(src.break_even)),
    modify_sl: filterManagementGroupList(cleanTokens(src.modify_sl)),
    modify_tp: filterManagementGroupList(cleanTokens(src.modify_tp)),
    close_worse_entries: filterManagementGroupList(cleanTokens(src.close_worse_entries)),
  }
}

export function flattenManagementGroups(groups: ManagementKeywordGroups): string[] {
  return Array.from(new Set(Object.values(groups).flat()))
}

export function hasTrainedManagementGroups(groups: ManagementKeywordGroups): boolean {
  return flattenManagementGroups(groups).length > 0
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Entry footers / TP celebration lines must not become SL-modify channel keywords. */
export function isDisclaimerOrNoteCue(phrase: string): boolean {
  const cue = String(phrase ?? '').trim()
  if (!cue) return true
  const f = fold(cue)
  if (cue.length > 72 && !/\b(?:sl|stop|tp|modify|move|adjust|عدّل|وقف)\b/.test(f)) return true
  if (/\bmanage\s+your\s+risk\b/.test(f)) return true
  if (/\bwatch\s+closely\b/.test(f)) return true
  if (/\bnot\s+bound\s+to\s+hold\b/.test(f)) return true
  if (/\bonce\s+you.?re\s+satisfied\b/.test(f)) return true
  if (/اضبط\s+مخاطرتك\s+وراقب\s+الصفقة/.test(cue)) return true
  if (/\btp\s*\d?\s*:?\s*done\b/.test(f) && !/\b(?:modify|move|adjust|stop)\b/.test(f)) return true
  if (/\ball\s+targets\b/.test(f) && /\bachieved\b/.test(f)) return true
  if (/\block[- ]?profit\s+alert\b/.test(f)) return true
  return false
}

function filterManagementCue(phrase: string): boolean {
  return !isDisclaimerOrNoteCue(phrase)
}

function filterManagementGroupList(tokens: string[]): string[] {
  return tokens.filter(filterManagementCue)
}

/** Best-effort bucket when only a flat management_cues list exists (legacy training). */
export function bucketFlatManagementCues(cues: string[]): ManagementKeywordGroups {
  const groups = emptyManagementGroups()
  for (const raw of cues) {
    const cue = String(raw ?? '').trim()
    if (!cue) continue
    if (isDisclaimerOrNoteCue(cue)) continue
    const f = fold(cue)
    if (
      /\b(close\s+all|close\s+everything|flatten|exit\s+all)\b/.test(f)
      || (/\b(fermez|fermer)\b/.test(f) && /\btout\b/.test(f))
      || (/\bcerrar\b/.test(f) && /\btodo/.test(f))
      || (/\bzamknij\b/.test(f) && /\bwszyst/.test(f))
      || (/\b(закрой|закрыть)\b/.test(f) && /\b(все|всё)\b/.test(f))
      || (/\b(stang|stäng|sluit)\b/.test(f) && /\b(allt|alles|alle)\b/.test(f))
      || (/\b(fechar|chiudi)\b/.test(f) && /\b(tudo|tutto|tutte)\b/.test(f))
      || /\b全決済\b/.test(cue)
    ) {
      groups.close_all.push(cue)
    } else if (
      /\b(close\s+half|50%|half)\b/.test(f)
      || /\bmoiti/.test(f)
      || /\bmitad\b/.test(f)
      || /\bpołow/.test(f)
      || /\bполовин/.test(f)
    ) {
      groups.close_half.push(cue)
    } else if (
      /\bpartial\b/.test(f)
      || /\bpartiel/.test(f)
      || /\bparcial\b/.test(f)
      || /\bczęściow/.test(f)
      || /\bчастичн/.test(f)
      || (/\bsecure\b/.test(f) && /\bprofit/.test(f))
      || /\bsécuriser\b/.test(f) || /\bsecuriser\b/.test(f)
    ) {
      groups.close_partial.push(cue)
    } else if (
      /\b(breakeven|break even|point mort|equilibrio|bezubytok|безубыток)\b/.test(f)
      || (/\bsl\b/.test(f) && /\b(entry|entree|entrée|ingang|wejście|вход)\b/.test(f))
    ) {
      groups.break_even.push(cue)
    } else if (
      /\b(close\s+worse|cwe)\b/.test(f)
      || (/\b(pire|worse|peor)\b/.test(f) && /\b(entr|entry|ingang)\b/.test(f))
    ) {
      groups.close_worse_entries.push(cue)
    } else if (
      /\b(adjust|move|set|update|change|déplacer|deplacer|mover|ajustar|przenieś|przenies|переместить|установить)\b/.test(f)
      && /\b(sl|stop|risk|стоп)\b/.test(f)
    ) {
      groups.modify_sl.push(cue)
    } else if (
      /\b(adjust|move|set|update|change|mover|ajustar)\b/.test(f)
      && /\b(tp|take profit|target|objetivo|objectif)\b/.test(f)
    ) {
      groups.modify_tp.push(cue)
    } else if (/\b(close|cerrar|fermer|fermez|zamknij|закрыть|stäng|stang|sluit)\b/.test(f)) {
      groups.close_all.push(cue)
    } else {
      groups.modify_sl.push(cue)
    }
  }
  return groups
}

export function resolveManagementGroups(args: {
  management_keyword_groups?: unknown
  management_cues?: string[]
}): ManagementKeywordGroups {
  const explicit = normalizeManagementGroups(args.management_keyword_groups)
  if (hasTrainedManagementGroups(explicit)) return explicit
  const flat = cleanTokens(args.management_cues)
  if (flat.length) return bucketFlatManagementCues(flat)
  return emptyManagementGroups()
}

export function joinKeywordPipe(tokens: string[]): string {
  return Array.from(new Set(tokens.map((t) => t.trim()).filter(Boolean))).join('|')
}

export function mergeKeywordField(existing: string, trained: string[]): string {
  const base = String(existing ?? '').split('|').map((s) => s.trim()).filter(Boolean)
  if (!trained.length) return joinKeywordPipe(base)
  return joinKeywordPipe([...base, ...trained])
}

type KeywordUpdateFields = {
  close_full?: string
  close_half?: string
  close_partial?: string
  break_even?: string
  adjust_sl?: string
  set_sl?: string
  adjust_tp?: string
  set_tp?: string
  close_worse_entries?: string
}

type KeywordAdditionalFields = {
  close_all?: string
}

export function applyManagementGroupsToChannelKeywords(
  current: {
    update?: KeywordUpdateFields
    additional?: KeywordAdditionalFields
  },
  groups: ManagementKeywordGroups,
  opts?: { replace?: boolean },
): { update: KeywordUpdateFields; additional: KeywordAdditionalFields } {
  const replace = opts?.replace ?? false
  const update = current.update ?? {}
  const additional = current.additional ?? {}
  const merge = (existing: string | undefined, trained: string[]) => {
    if (!trained.length) return String(existing ?? '')
    if (replace) return joinKeywordPipe(trained)
    return mergeKeywordField(String(existing ?? ''), trained)
  }
  const closeAll = merge(additional.close_all, groups.close_all)
  const closeFull = merge(update.close_full, groups.close_all)
  return {
    update: {
      ...update,
      close_full: closeFull || String(update.close_full ?? ''),
      close_half: merge(update.close_half, groups.close_half),
      close_partial: merge(update.close_partial, groups.close_partial),
      break_even: merge(update.break_even, groups.break_even),
      adjust_sl: merge(update.adjust_sl, groups.modify_sl),
      set_sl: merge(update.set_sl, groups.modify_sl),
      adjust_tp: merge(update.adjust_tp, groups.modify_tp),
      set_tp: merge(update.set_tp, groups.modify_tp),
      close_worse_entries: merge(update.close_worse_entries, groups.close_worse_entries),
    },
    additional: {
      ...additional,
      close_all: closeAll || String(additional.close_all ?? ''),
    },
  }
}
