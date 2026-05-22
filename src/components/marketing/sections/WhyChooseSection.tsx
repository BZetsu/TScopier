import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  BarChart3,
  Clock,
  Cloud,
  Layers,
  Link2,
  MessageCircle,
  Settings,
  Zap,
} from 'lucide-react'
import { useT } from '../../../context/LocaleContext'
import type { LandingBentoCard, LandingBentoIcon } from '../../../i18n/locales/landing/types'

const ICONS: Record<LandingBentoIcon, LucideIcon> = {
  zap: Zap,
  cloud: Cloud,
  link: Link2,
  clock: Clock,
  activity: Activity,
  chart: BarChart3,
  layers: Layers,
  settings: Settings,
  messages: MessageCircle,
}

function metricClass(card: LandingBentoCard, featured: boolean): string {
  if (featured) {
    if (card.metricVariant === 'amber') return 'text-amber-300'
    return 'text-white'
  }
  if (card.metricVariant === 'teal') return 'text-teal-700 dark:text-teal-400'
  return 'text-neutral-800 dark:text-neutral-100'
}

function BentoCard({ card }: { card: LandingBentoCard }) {
  const featured = card.layout === 'featured'
  const Icon = ICONS[card.icon]

  return (
    <article
      className={clsx(
        'marketing-bento-card',
        card.layout === 'tall' && 'marketing-bento-card--tall',
        card.layout === 'short' && 'marketing-bento-card--short',
        featured && 'marketing-bento-card--featured',
      )}
    >
      <p
        className={clsx(
          'relative z-10 text-xs font-semibold tracking-tight',
          featured ? 'text-teal-100' : 'text-neutral-700 dark:text-neutral-300',
        )}
      >
        {card.label}
      </p>
      <p
        className={clsx(
          'relative z-10 mt-3 text-2xl font-bold leading-none tracking-tight sm:text-3xl lg:text-[1.75rem]',
          metricClass(card, featured),
        )}
      >
        {card.metric}
      </p>
      <p
        className={clsx(
          'relative z-10 mt-2 max-w-[16rem] text-xs leading-relaxed sm:text-sm',
          featured ? 'text-teal-50/90' : 'text-neutral-600 dark:text-neutral-400',
        )}
      >
        {card.description}
      </p>
      <Icon
        className={clsx(
          'marketing-bento-watermark',
          featured ? 'text-white' : 'text-neutral-900 dark:text-white',
        )}
        strokeWidth={1.25}
        aria-hidden
      />
    </article>
  )
}

export function WhyChooseSection() {
  const l = useT().landing.whyChoose

  return (
    <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
          {l.eyebrow}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl lg:text-[2.5rem] lg:leading-tight">
          {l.title}
        </h2>
      </div>

      <div className="marketing-bento-grid mt-10 sm:mt-12">
        {l.cards.map((card) => (
          <BentoCard key={card.label} card={card} />
        ))}
      </div>
    </section>
  )
}
