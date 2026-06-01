import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { MarketingLayout } from '../../components/marketing/MarketingLayout'
import { HeroSection } from '../../components/marketing/sections/HeroSection'
import { WhyChooseSection } from '../../components/marketing/sections/WhyChooseSection'
import { ComparisonSection } from '../../components/marketing/sections/ComparisonSection'
import { FeaturesSection } from '../../components/marketing/sections/FeaturesSection'
import { StepsSection } from '../../components/marketing/sections/StepsSection'
import { FaqSection } from '../../components/marketing/sections/FaqSection'
import { ReviewsSection } from '../../components/marketing/sections/ReviewsSection'
import { PricingTeaserSection } from '../../components/marketing/sections/PricingTeaserSection'
import { captureReferralFromUrl } from '../../lib/referralCapture'
import { trackMarketingEvent } from '../../lib/analytics'

const GTM_ID = 'G-6TQBY0FKX3'
const GTM_SCRIPT_URL = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`

export function LandingPage() {
  const location = useLocation()

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src^="${GTM_SCRIPT_URL}"]`,
    )
    if (existingScript) return

    window.dataLayer = window.dataLayer ?? []
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' })

    const script = document.createElement('script')
    script.async = true
    script.src = GTM_SCRIPT_URL
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    const ref = captureReferralFromUrl(location.search)
    trackMarketingEvent('landing_page_view', {
      referral_in_url: ref != null,
    })
  }, [location.search])

  return (
    <MarketingLayout>
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
          title="google-tag-manager"
        />
      </noscript>
      <HeroSection />
      <WhyChooseSection />
      <FeaturesSection />
      <ComparisonSection />
      <PricingTeaserSection />
      <StepsSection />
      <FaqSection />
      <ReviewsSection />
    </MarketingLayout>
  )
}
