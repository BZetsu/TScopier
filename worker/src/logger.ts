type Level = 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<Level, number> = { error: 0, warn: 1, info: 2 }
const CURRENT_LEVEL: Level = (process.env.LOGGER_LEVEL as Level) || 'info'

const hasSpace = (v: string) => /[\s"]/.test(v)
const quote = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return hasSpace(v) ? `"${v.replace(/"/g, '\\"')}"` : v
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function log(level: Level, tag: string, event: string, data?: Record<string, unknown>) {
  if (LOG_LEVELS[level] > LOG_LEVELS[CURRENT_LEVEL]) return
  const parts = [`[${tag}]`, `level=${level}`, `event=${event}`]
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue
      parts.push(`${k}=${quote(v)}`)
    }
  }
  const line = parts.join(' ')
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (tag: string, event: string, data?: Record<string, unknown>) => log('info', tag, event, data),
  warn: (tag: string, event: string, data?: Record<string, unknown>) => log('warn', tag, event, data),
  error: (tag: string, event: string, data?: Record<string, unknown>) => log('error', tag, event, data),
}
