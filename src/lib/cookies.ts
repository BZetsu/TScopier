export interface CookieWriteOptions {
  maxAgeSeconds?: number
  path?: string
  sameSite?: 'Lax' | 'Strict' | 'None'
  secure?: boolean
}

function encode(v: string): string {
  return encodeURIComponent(v)
}

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const target = `${encode(name)}=`
  const parts = document.cookie.split(';')
  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part.startsWith(target)) continue
    return decodeURIComponent(part.slice(target.length))
  }
  return null
}

export function setCookie(name: string, value: string, options: CookieWriteOptions = {}): void {
  if (typeof document === 'undefined') return
  const pieces = [`${encode(name)}=${encode(value)}`]
  pieces.push(`Path=${options.path ?? '/'}`)
  pieces.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  if (options.maxAgeSeconds != null) pieces.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`)
  if (options.secure ?? (typeof window !== 'undefined' && window.location.protocol === 'https:')) {
    pieces.push('Secure')
  }
  document.cookie = pieces.join('; ')
}

export function removeCookie(name: string, path = '/'): void {
  setCookie(name, '', {
    maxAgeSeconds: 0,
    path,
  })
}

