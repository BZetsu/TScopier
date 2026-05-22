export interface LandingFeatureTranslation {
  title: string
  description: string
}

export interface LandingStepTranslation {
  title: string
  description: string
}

export interface LandingReviewTranslation {
  quote: string
  author: string
}

export interface LandingPlanTeaserTranslation {
  name: string
  description: string
  priceLabel: string
  cta: string
}

export interface LandingTranslations {
  nav: {
    product: string
    features: string
    pricing: string
    signIn: string
    getStarted: string
    menuOpen: string
    menuClose: string
  }
  hero: {
    trustedBy: string
    avatarAlts: [string, string, string]
    headline: string
    headlineAccent: string
    subheadline: string
    primaryCta: string
    secondaryCta: string
    imageAlt: string
    previewUrl: string
  }
  whyChoose: {
    title: string
    subtitle: string
    items: LandingFeatureTranslation[]
  }
  features: {
    title: string
    subtitle: string
    items: LandingFeatureTranslation[]
  }
  steps: {
    title: string
    subtitle: string
    items: LandingStepTranslation[]
  }
  reviews: {
    title: string
    trustpilotLabel: string
    items: LandingReviewTranslation[]
  }
  pricing: {
    title: string
    subtitle: string
    perMonth: string
    popular: string
    viewPlans: string
    basic: LandingPlanTeaserTranslation
    advanced: LandingPlanTeaserTranslation
  }
  footer: {
    copyright: string
    docs: string
    status: string
    openApp: string
  }
}
