/** Minimum length for new account passwords. */
export const MIN_PASSWORD_LENGTH = 6

export type PasswordPolicyFailure =
  | 'too_short'
  | 'missing_uppercase'
  | 'missing_lowercase'
  | 'missing_number'
  | 'missing_special'
  | 'common_password'

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; failures: PasswordPolicyFailure[] }

const COMMON_WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'letmein',
  'welcome',
  'admin123',
  'iloveyou',
])

export function evaluatePassword(password: string): PasswordPolicyResult {
  const failures: PasswordPolicyFailure[] = []

  if (password.length < MIN_PASSWORD_LENGTH) {
    failures.push('too_short')
  }
  if (!/[A-Z]/.test(password)) {
    failures.push('missing_uppercase')
  }
  if (!/[a-z]/.test(password)) {
    failures.push('missing_lowercase')
  }
  if (!/[0-9]/.test(password)) {
    failures.push('missing_number')
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    failures.push('missing_special')
  }
  if (COMMON_WEAK_PASSWORDS.has(password.trim().toLowerCase())) {
    failures.push('common_password')
  }

  if (failures.length === 0) {
    return { ok: true }
  }

  return { ok: false, failures }
}

export function isPasswordStrongEnough(password: string): boolean {
  return evaluatePassword(password).ok
}
