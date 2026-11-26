import { getSupabaseAnonKey, getSupabaseUrl } from '../env'

export async function callEdgeFunction<T>(
  functionName: string,
  options: {
    accessToken?: string
    body?: Record<string, unknown>
    method?: 'GET' | 'POST'
    timeoutMs?: number
  } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const baseUrl = getSupabaseUrl()
  const anonKey = getSupabaseAnonKey()
  if (!baseUrl || !anonKey) {
    throw new Error('Supabase URL or anon key is not configured')
  }

  const controller = new AbortController()
  const timeout = options.timeoutMs ?? 60_000
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${options.accessToken ?? anonKey}`,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    })
    const data = (await res.json().catch(() => ({}))) as T
    return { ok: res.ok, status: res.status, data }
  } finally {
    clearTimeout(timer)
  }
}
