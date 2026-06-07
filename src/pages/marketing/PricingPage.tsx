import { useEffect } from 'react'
import { MarketingLayout } from '../../components/marketing/MarketingLayout'
import { PricingPlansSection } from '../../components/marketing/sections/PricingPlansSection'
import { PlanComparisonSection } from '../../components/marketing/sections/PlanComparisonSection'
import { PricingFaqSection } from '../../components/marketing/sections/PricingFaqSection'
import { trackMarketingEvent } from '../../lib/analytics'

export function PricingPage() {
  useEffect(() => {
    trackMarketingEvent('pricing_page_view')
  }, [])

  return (
    <MarketingLayout>
      <PricingPlansSection />
      <PlanComparisonSection />
      <PricingFaqSection />
    </MarketingLayout>
  )
}
