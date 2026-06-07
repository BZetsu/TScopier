import { PricingPlansSection } from '../../components/marketing/sections/PricingPlansSection'
import { PlanComparisonSection } from '../../components/marketing/sections/PlanComparisonSection'
import { PricingFaqSection } from '../../components/marketing/sections/PricingFaqSection'
import { PageShell } from '../../components/layout/PageShell'

export function AppPricingPage() {
  return (
    <PageShell maxWidth="xl" spacing="none">
      <PricingPlansSection variant="app" />
      <PlanComparisonSection variant="app" />
      <PricingFaqSection variant="app" />
    </PageShell>
  )
}
