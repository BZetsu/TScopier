function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function openAiMinGapMs(env: { get(name: string): string | undefined }): number {
  const explicit = Number(env.get("OPENAI_MIN_GAP_MS") ?? "")
  if (Number.isFinite(explicit) && explicit >= 1000) return explicit
  const rpm = Number(env.get("OPENAI_REQUESTS_PER_MINUTE") ?? "3")
  const n = Number.isFinite(rpm) && rpm > 0 ? rpm : 3
  return Math.ceil(60_000 / n) + 500
}

let chain: Promise<void> = Promise.resolve()
let lastAt = 0

/** Serialize OpenAI calls with a configurable minimum gap (default ~3/min). */
export async function acquireOpenAiSlot(env: { get(name: string): string | undefined }): Promise<void> {
  const gap = openAiMinGapMs(env)
  chain = chain.then(async () => {
    const wait = lastAt + gap - Date.now()
    if (wait > 0) await sleep(wait)
    lastAt = Date.now()
  })
  await chain
}

export function parseRetryAfterMs(message: string): number | null {
  const m = message.match(/retry after (\d+)\s*ms/i)
  if (m?.[1]) return Number(m[1])
  const s = message.match(/retry after (\d+)\s*s/i)
  if (s?.[1]) return Number(s[1]) * 1000
  return null
}
