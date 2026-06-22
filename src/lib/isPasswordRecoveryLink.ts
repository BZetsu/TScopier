/** True when the current URL looks like a Supabase password-recovery redirect. */
export function isPasswordRecoveryLink(): boolean {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (hash.get('type') === 'recovery') return true

  const query = new URLSearchParams(window.location.search)
  if (query.get('type') === 'recovery') return true
  if (query.get('token_hash')) return true

  return false
}
