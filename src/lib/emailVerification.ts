import type { User } from '@supabase/supabase-js'

/** True when Supabase has confirmed the user's email (OAuth IdPs set this on signup). */
export function isEmailVerified(user: User | null | undefined): boolean {
  return Boolean(user?.email_confirmed_at)
}

export function verifyEmailPath(email: string | null | undefined): string {
  const q = email?.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''
  return `/verify-email${q}`
}

/** Supabase may block sign-in or return a user without a confirmed email. */
export function isUnconfirmedEmailAuthError(error: { message?: string; code?: string }): boolean {
  const code = (error.code ?? '').toLowerCase()
  const message = (error.message ?? '').toLowerCase()
  return (
    code === 'email_not_confirmed'
    || message.includes('email not confirmed')
    || message.includes('email not verified')
  )
}
