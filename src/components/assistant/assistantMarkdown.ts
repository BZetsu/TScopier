/**
 * Pure helpers behind `AssistantMessageContent`.
 *
 * Extracted so the list handling can be unit-tested without rendering React.
 * The bug they fix: a numbered answer rendered as "1. 1. 1." because the
 * cleanup step put a blank line before every step, which split one list into
 * three single-item lists, and each list restarted at 1.
 */

export function isBullet(line: string): boolean {
  return /^[-*•]\s+/.test(line)
}

export function isNumbered(line: string): boolean {
  return /^\d+[.)]\s+/.test(line)
}

export function isHeading(line: string): boolean {
  return /^#{1,4}\s+\S/.test(line)
}

export function parseHeading(line: string): { level: number; text: string } | null {
  const m = line.match(/^(#{1,4})\s+(.+)$/)
  if (!m) return null
  return { level: m[1].length, text: m[2].trim() }
}

/** Light cleanup when the model dumps numbered or bulleted steps on one line. */
export function normalizeChatMarkdown(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    // A single newline keeps the steps in one list. Two newlines separated them
    // into individual lists, and each one restarted at "1.".
    .replace(/([^\n])\s+(\d+\.\s+\*\*)/g, '$1\n$2')
    .replace(/([^\n])\s+(\d+\.\s+[A-Z])/g, '$1\n$2')
    .replace(/([.:])\s+-\s+/g, '$1\n- ')
    .replace(/([^\n])\s+(#{1,4}\s+)/g, '$1\n\n$2')
    .trim()
}

/**
 * Collect consecutive list items, ignoring blank lines the model puts between
 * steps. A blank line must not end the list, or the numbering restarts.
 */
export function collectList(
  lines: string[],
  start: number,
  isItem: (line: string) => boolean,
): { items: string[]; next: number } {
  const items: string[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]
    if (isItem(line)) {
      items.push(line)
      i += 1
      continue
    }
    if (!line.trim() && i + 1 < lines.length && isItem(lines[i + 1])) {
      i += 2
      items.push(lines[i - 1])
      continue
    }
    break
  }
  return { items, next: i }
}
