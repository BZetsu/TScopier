import { Link } from 'react-router-dom'
import { AuthBrandLogo } from '../../components/auth/AuthBrandLogo'
import { PricingSocialProof } from '../../components/marketing/pricing/PricingSocialProof'
import { PricingPlansSection } from '../../components/marketing/sections/PricingPlansSection'
import { PlanComparisonSection } from '../../components/marketing/sections/PlanComparisonSection'
import { PricingFaqSection } from '../../components/marketing/sections/PricingFaqSection'
import { PageShell } from '../../components/layout/PageShell'

export function AppPricingPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-neutral-50 dark:bg-neutral-950">
      <header className="sticky top-0 z-20 flex shrink-0 items-center justify-center border-b border-neutral-200/80 bg-neutral-50/95 px-6 py-4 backdrop-blur dark:border-neutral-800/80 dark:bg-neutral-950/95 pt-[calc(1rem+env(safe-area-inset-top,0px)+var(--app-banner-h,0px))]">
        <Link to="/" className="flex items-center" aria-label="TScopier">
          <AuthBrandLogo className="h-8 w-auto" />
        </Link>
      </header>

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
