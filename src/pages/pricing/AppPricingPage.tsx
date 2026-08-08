import { PricingSocialProof } from '../../components/marketing/pricing/PricingSocialProof'
import { PricingPlansSection } from '../../components/marketing/sections/PricingPlansSection'
import { PlanComparisonSection } from '../../components/marketing/sections/PlanComparisonSection'
import { PricingFaqSection } from '../../components/marketing/sections/PricingFaqSection'
import { PageShell } from '../../components/layout/PageShell'

export function AppPricingPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-neutral-50 dark:bg-neutral-950">
      <PageShell maxWidth="xl" spacing="none" className="pb-16">
        <PricingSocialProof variant="app">
          <PricingPlansSection variant="app" />
          <PlanComparisonSection variant="app" />
          <PricingFaqSection variant="app" />
        </PricingSocialProof>
      </PageShell>
    </div>
  )
}
