import { useState } from 'react'
import { useSubscription } from '../../context/SubscriptionContext'
import { useT } from '../../context/LocaleContext'
import { UpgradePrompt } from './UpgradePrompt'
import { PastDueSubscriptionBanner } from './PastDueSubscriptionBanner'
import { RedeemCodeModal } from './RedeemCodeModal'

/** Top-of-dashboard banner when the user has no active subscription or is past due. */
export function SubscriptionBanner() {
  const t = useT()
  const pw = t.pricing.paywall
  const { loading, hasActiveSubscription, isPastDue, refresh } = useSubscription()
  const [redeemOpen, setRedeemOpen] = useState(false)

  if (loading) return null
  if (hasActiveSubscription) return null

  return (
    <>
      {isPastDue ? (
        <PastDueSubscriptionBanner className="mb-6" />
      ) : (
        <UpgradePrompt
          variant="banner"
          title={pw.noPlanTitle}
          reason={pw.noPlanReason}
          className="mb-6"
        />
      )}
      <p className="mb-6 text-center text-xs text-neutral-500 dark:text-neutral-400">
        Have a recovery code?{' '}
        <button
          type="button"
          onClick={() => setRedeemOpen(true)}
          className="underline text-green-600 dark:text-green-400 hover:text-green-500 dark:hover:text-green-300"
        >
          Redeem it for 14 days of access
        </button>
      </p>
      <RedeemCodeModal
        open={redeemOpen}
        onClose={() => setRedeemOpen(false)}
        onRedeemed={refresh}
      />
    </>
  )
}
