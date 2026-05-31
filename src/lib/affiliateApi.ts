export interface AffiliateReferralRow {
  referred_user_id: string
  referral_code: string
  attribution_source: 'signup_url' | 'signup_form' | 'onboarding' | 'admin'
  created_at: string
  referred_user_name: string
}

export interface AffiliateCommissionRow {
  id: string
  stripe_invoice_id: string
  invoice_amount_cents: number
  commission_rate: number
  commission_cents: number
  currency: string
  status: 'pending' | 'approved' | 'paid' | 'reversed'
  period_start: string | null
  period_end: string | null
  created_at: string
}

export interface AffiliateProfileResponse {
  profile: {
    user_id: string
    referral_code: string
    payout_email: string | null
    stripe_connect_account_id: string | null
    total_earned_cents: number
    total_paid_cents: number
    is_active: boolean
  }
  referral_link: string
  stats: {
    total_referrals: number
    active_referrals: number
    total_earned_cents: number
    pending_cents: number
    paid_cents: number
    reversed_cents: number
  }
  referrals: AffiliateReferralRow[]
  commissions: AffiliateCommissionRow[]
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

export async function fetchAffiliateProfile(accessToken: string): Promise<AffiliateProfileResponse> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-profile`
  const res = await fetch(apiUrl, {
    method: 'GET',
    headers: authHeaders(accessToken),
  })
  const data = (await res.json().catch(() => ({}))) as AffiliateProfileResponse & { error?: string }
  if (!res.ok) throw new Error(data.error || 'Failed to load affiliate profile')
  return data
}

export async function updateAffiliatePayoutEmail(
  accessToken: string,
  payoutEmail: string,
): Promise<void> {
  await updateAffiliateProfileSettings(accessToken, { payout_email: payoutEmail })
}

export async function updateAffiliateProfileSettings(
  accessToken: string,
  patch: { payout_email?: string; referral_code?: string },
): Promise<void> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-profile`
  const res = await fetch(apiUrl, {
    method: 'PATCH',
    headers: authHeaders(accessToken),
    body: JSON.stringify(patch),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data.error || 'Failed to save affiliate settings')
}

export async function startAffiliateConnectOnboarding(accessToken: string): Promise<string> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/affiliate-connect`
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      refresh_url: `${window.location.origin}/affiliate-program`,
      return_url: `${window.location.origin}/affiliate-program`,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !data.url) throw new Error(data.error || 'Failed to start Stripe Connect onboarding')
  return data.url
}

export function centsToMoney(cents: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100)
}

