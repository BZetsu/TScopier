import type { LandingTranslations } from './types'

export const landingEn: LandingTranslations = {
  nav: {
    product: 'Product',
    features: 'Features',
    pricing: 'Pricing',
    signIn: 'Sign in',
    getStarted: 'Get started',
    menuOpen: 'Open menu',
    menuClose: 'Close menu',
  },
  hero: {
    trustedBy: 'Trusted by 30,000+ Traders from 156 Countries',
    avatarAlts: ['TSCopier trader', 'TSCopier trader', 'TSCopier trader'],
    headline: 'Ultra-Fast Telegram Signal Copier',
    headlineAccent: 'Powered by AI.',
    subheadline:
      'Connect your MT4/MT5 account, pick signal channels, and let TSCopier execute entries, layering, and management — with full control over risk and filters.',
    primaryCta: 'Get started free',
    secondaryCta: 'Sign in',
    imageAlt:
      'TSCopier dashboard with balance, daily profit, trade outcomes, and account growth charts',
    previewUrl: 'app.tscopier.ai/dashboard',
  },
  whyChoose: {
    title: 'Why Choose TSCopier?',
    subtitle:
      'Three reasons traders move off manual copying and local EAs—and stay on a cloud copier built for speed.',
    items: [
      {
        title: 'Fast Execution',
        description:
          'Signals are parsed and routed to your broker in seconds, not minutes. Our cloud worker uses a low-latency pipeline so entries, modifications, and closes from Telegram reach MT4/MT5 while price is still relevant—plus copier logs show exactly when each action ran.',
      },
      {
        title: 'No Download Needed',
        description:
          'TSCopier is 100% cloud-based. No EA to install, no VPS to rent, and no terminal scripts to update after every build. Sign in from any browser, connect your account, and manage channels from one dashboard—your settings sync automatically.',
      },
      {
        title: 'Setup in 2 Minutes',
        description:
          'Create your account, link Telegram, and connect MT4 or MT5 with guided steps. Most traders are ready to copy their first channel in about two minutes—no wiring experts, compile errors, or weekend VPS setup.',
      },
    ],
  },
  features: {
    title: 'Built for serious signal copying',
    subtitle: 'Everything you need to automate Telegram trades without giving up control.',
    items: [
      {
        title: 'MT4 & MT5',
        description: 'Link demo or live accounts and copy to the broker you already use.',
      },
      {
        title: 'Multi-trade & range layering',
        description: 'Split lots across TPs, stack pending range legs, and close worse entries first.',
      },
      {
        title: 'Signal backtesting',
        description: 'Replay channel history against your manual settings before going live.',
      },
      {
        title: 'Channel keyword filters',
        description: 'Allow or ignore close, break-even, SL/TP adjust, and other instruction types per channel.',
      },
      {
        title: 'News & calendar',
        description: 'Built-in market news and economic calendar with optional news-trading blackout.',
      },
      {
        title: 'Copier logs & latency',
        description: 'Transparent execution logs so you can see exactly what the worker did and when.',
      },
    ],
  },
  steps: {
    title: 'How it works',
    subtitle: 'From Telegram channel to broker fill in three steps.',
    items: [
      {
        title: 'Connect Telegram',
        description: 'Link the channels you trust. Only checked channels feed your broker.',
      },
      {
        title: 'Configure your broker',
        description: 'Set lot size, TPs, range layering, filters, and auto-management per account.',
      },
      {
        title: 'Copy signals',
        description: 'TSCopier parses, plans, and sends orders — you monitor from the dashboard.',
      },
    ],
  },
  reviews: {
    title: 'Trusted by traders',
    trustpilotLabel: 'Trustpilot',
    items: [
      {
        quote:
          'TSCopier cut my manual copying time to almost zero. Signals land on my MT5 account within seconds.',
        author: 'Rob Flemming',
      },
      {
        quote:
          'Clean dashboard, reliable parsing, and the copier logs make debugging easy.',
        author: 'Sarah Mitchell',
      },
      {
        quote:
          'The range and layer trading plus worse-entries closing — I copy signals with peace of mind.',
        author: 'Eloise Laurent',
      },
    ],
  },
  pricing: {
    title: 'Simple pricing',
    subtitle: 'Start with Basic or unlock advanced strategies on Advanced.',
    perMonth: '/mo',
    popular: 'Most popular',
    viewPlans: 'View all plans',
    basic: {
      name: 'Basic',
      description: 'One account, single-trade mode, backtests, and core filters.',
      priceLabel: '$9.99',
      cta: 'Start with Basic',
    },
    advanced: {
      name: 'Advanced',
      description: 'Multi accounts, range layering, auto-management, unlimited channels.',
      priceLabel: '$39.99',
      cta: 'Start 10-day trial',
    },
  },
  footer: {
    copyright: '© {year} Tartarix Inc.',
    docs: 'Documentation',
    status: 'Status',
    openApp: 'Open app',
  },
}
