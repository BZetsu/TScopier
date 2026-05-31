import { useEffect, useMemo, useState } from 'react'
import { Copy, DollarSign, Link2, Users, Wallet } from 'lucide-react'
import { PageShell } from '../../components/layout/PageShell'
import { PageHeader } from '../../components/layout/PageHeader'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Alert } from '../../components/ui/Alert'
import { useAuth } from '../../context/AuthContext'
import { useT } from '../../context/LocaleContext'
import {
  centsToMoney,
  fetchAffiliateProfile,
  startAffiliateConnectOnboarding,
  updateAffiliatePayoutEmail,
  type AffiliateProfileResponse,
} from '../../lib/affiliateApi'

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card padding="md">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </p>
      <p className="mt-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-50">{value}</p>
    </Card>
  )
}

export function AffiliateProgramPage() {
  const t = useT()
  const at = t.affiliate
  const { session } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [connectLoading, setConnectLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [data, setData] = useState<AffiliateProfileResponse | null>(null)
  const [payoutEmail, setPayoutEmail] = useState('')

  const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'
  const currency = 'USD'

  const refresh = async () => {
    if (!session?.access_token) return
    setLoading(true)
    setError('')
    try {
      const next = await fetchAffiliateProfile(session.access_token)
      setData(next)
      setPayoutEmail(next.profile.payout_email ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load affiliate profile')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token])

  const stats = useMemo(() => {
    const s = data?.stats
    if (!s) {
      return {
        totalEarned: '$0.00',
        pending: '$0.00',
        paidOut: '$0.00',
        activeReferrals: '0',
      }
    }
    return {
      totalEarned: centsToMoney(s.total_earned_cents, currency, locale),
      pending: centsToMoney(s.pending_cents, currency, locale),
      paidOut: centsToMoney(s.paid_cents, currency, locale),
      activeReferrals: String(s.active_referrals),
    }
  }, [data?.stats, currency, locale])

  const copyText = async (kind: 'code' | 'link', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // no-op
    }
  }

  const savePayout = async () => {
    if (!session?.access_token) return
    setSaving(true)
    setError('')
    try {
      await updateAffiliatePayoutEmail(session.access_token, payoutEmail)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save payout email')
    } finally {
      setSaving(false)
    }
  }

  const connectStripeAccount = async () => {
    if (!session?.access_token) return
    setConnectLoading(true)
    setError('')
    try {
      const url = await startAffiliateConnectOnboarding(session.access_token)
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Stripe Connect onboarding')
      setConnectLoading(false)
    }
  }

  return (
    <PageShell>
      <PageHeader
        title={at.title}
        subtitle={at.subtitle}
        actions={(
          <Button variant="secondary" onClick={() => void refresh()} loading={loading}>
            {at.refresh}
          </Button>
        )}
      />

      <div className="mt-6 space-y-6">
        {error ? <Alert variant="error">{error}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title={at.totalEarned} value={stats.totalEarned} />
          <StatCard title={at.pendingPayout} value={stats.pending} />
          <StatCard title={at.paidOut} value={stats.paidOut} />
          <StatCard title={at.activeReferrals} value={stats.activeReferrals} />
        </div>

        <Card padding="lg" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                <Wallet className="h-4 w-4 text-teal-600" />
                {at.yourReferralCode}
              </div>
              <p className="text-xl font-semibold tracking-wide text-neutral-900 dark:text-neutral-50">
                {data?.profile.referral_code ?? '—'}
              </p>
              <Button
                variant="ghost"
                className="mt-2 gap-2"
                disabled={!data?.profile.referral_code}
                onClick={() => data?.profile.referral_code && void copyText('code', data.profile.referral_code)}
              >
                <Copy className="h-4 w-4" />
                {copied === 'code' ? at.copied : at.copyCode}
              </Button>
            </div>

            <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                <Link2 className="h-4 w-4 text-teal-600" />
                {at.yourReferralLink}
              </div>
              <p className="break-all text-sm text-neutral-700 dark:text-neutral-300">
                {data?.referral_link ?? '—'}
              </p>
              <Button
                variant="ghost"
                className="mt-2 gap-2"
                disabled={!data?.referral_link}
                onClick={() => data?.referral_link && void copyText('link', data.referral_link)}
              >
                <Copy className="h-4 w-4" />
                {copied === 'link' ? at.copied : at.copyLink}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{at.payoutEmail}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input
                label=""
                type="email"
                value={payoutEmail}
                onChange={(e) => setPayoutEmail(e.target.value)}
                placeholder="you@paypal.com"
                className="min-w-[18rem] flex-1"
              />
              <Button onClick={() => void savePayout()} loading={saving}>{at.savePayoutEmail}</Button>
            </div>
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{at.payoutEmailHint}</p>
          </div>

          <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
            <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Stripe Connect</p>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {data?.profile.stripe_connect_account_id
                ? 'Connected for automated payouts.'
                : 'Connect a Stripe account to receive automated affiliate transfers.'}
            </p>
            <div className="mt-3">
              <Button
                variant={data?.profile.stripe_connect_account_id ? 'secondary' : 'primary'}
                onClick={() => void connectStripeAccount()}
                loading={connectLoading}
              >
                {data?.profile.stripe_connect_account_id ? 'Reconnect Stripe account' : 'Connect Stripe account'}
              </Button>
            </div>
          </div>
        </Card>

        <Card padding="none" className="overflow-hidden">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{at.referrals}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-5 py-3">User</th>
                  <th className="px-5 py-3">{at.source}</th>
                  <th className="px-5 py-3">{at.date}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.referrals ?? []).slice(0, 20).map((row) => (
                  <tr key={row.referred_user_id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-5 py-3">{row.referred_user_name}</td>
                    <td className="px-5 py-3">{row.attribution_source}</td>
                    <td className="px-5 py-3">{new Date(row.created_at).toLocaleDateString(locale)}</td>
                  </tr>
                ))}
                {(data?.referrals.length ?? 0) === 0 ? (
                  <tr>
                    <td className="px-5 py-5 text-neutral-500 dark:text-neutral-400" colSpan={3}>
                      {at.noReferrals}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card padding="none" className="overflow-hidden">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{at.commissions}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
                <tr>
                  <th className="px-5 py-3">{at.invoice}</th>
                  <th className="px-5 py-3">{at.gross}</th>
                  <th className="px-5 py-3">{at.commission}</th>
                  <th className="px-5 py-3">{at.status}</th>
                  <th className="px-5 py-3">{at.date}</th>
                </tr>
              </thead>
              <tbody>
                {(data?.commissions ?? []).slice(0, 30).map((row) => (
                  <tr key={row.id} className="border-t border-neutral-200 dark:border-neutral-800">
                    <td className="px-5 py-3 font-mono text-xs">{row.stripe_invoice_id}</td>
                    <td className="px-5 py-3">{centsToMoney(row.invoice_amount_cents, row.currency.toUpperCase(), locale)}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1">
                        <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                        {centsToMoney(row.commission_cents, row.currency.toUpperCase(), locale)}
                      </span>
                    </td>
                    <td className="px-5 py-3">{row.status}</td>
                    <td className="px-5 py-3">{new Date(row.created_at).toLocaleDateString(locale)}</td>
                  </tr>
                ))}
                {(data?.commissions.length ?? 0) === 0 ? (
                  <tr>
                    <td className="px-5 py-5 text-neutral-500 dark:text-neutral-400" colSpan={5}>
                      {at.noCommissions}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card padding="lg">
          <div className="flex items-start gap-3">
            <Users className="mt-0.5 h-5 w-5 text-teal-600" />
            <div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{at.howItWorks}</h3>
              <ul className="mt-2 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
                <li>{at.stepShare}</li>
                <li>{at.stepSubscribe}</li>
                <li>{at.stepEarn}</li>
              </ul>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-50">{at.policyTitle}</h3>
          <ul className="mt-2 space-y-1 text-sm text-neutral-600 dark:text-neutral-400">
            <li>{at.policyLifetime}</li>
            <li>{at.policyFirstTouch}</li>
            <li>{at.policySelfReferral}</li>
            <li>{at.policyRefunds}</li>
            <li>{at.policyMinimumPayout}</li>
          </ul>
        </Card>
      </div>
    </PageShell>
  )
}

