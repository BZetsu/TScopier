import {
  BarChart3,
  Calendar,
  Filter,
  Layers,
  LineChart,
  Radio,
} from 'lucide-react'
import { GlassCard } from '../GlassCard'
import { useT } from '../../../context/LocaleContext'

const ICONS = [Radio, Layers, LineChart, Filter, Calendar, BarChart3] as const

export function FeaturesSection() {
  const l = useT().landing.features

  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-28 px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-4xl">
          {l.title}
        </h2>
        <p className="mt-4 text-neutral-600 dark:text-neutral-400">{l.subtitle}</p>
      </div>
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {l.items.map((item, i) => {
          const Icon = ICONS[i] ?? Radio
          return (
            <GlassCard key={item.title} variant="feature">
              <div className="mb-4 inline-flex rounded-xl bg-primary-500/10 p-2.5 text-primary-600 dark:text-primary-400">
                <Icon className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                {item.description}
              </p>
            </GlassCard>
          )
        })}
      </div>
    </section>
  )
}
