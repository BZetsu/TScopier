import type { User } from '@supabase/supabase-js'

export function isOAuthUser(user: User | null | undefined): boolean {
  if (!user) return false
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? []
  if (providers.some(p => p !== 'email')) return true
  const provider = user.app_metadata?.provider as string | undefined
  return Boolean(provider && provider !== 'email')
}

export function isEmailVerified(
  user: User | null | undefined,
  emailVerifiedAt?: string | null,
): boolean {
  if (!user) return false
  if (isOAuthUser(user)) {
    return Boolean(user.email_confirmed_at)
  }
  return Boolean(emailVerifiedAt)
}

export function isUnconfirmedEmailAuthError(error: { message?: string; code?: string }): boolean {
  const code = (error.code ?? '').toLowerCase()
  const message = (error.message ?? '').toLowerCase()
  return (
    code === 'email_not_confirmed'
    || message.includes('email not confirmed')
    || message.includes('email not verified')
  )
}
