import clsx from 'clsx'
import type { ReactNode } from 'react'

type GlassCardVariant = 'default' | 'feature' | 'pricing'

interface GlassCardProps {
  children: ReactNode
  className?: string
  variant?: GlassCardVariant
}

const variantClass: Record<GlassCardVariant, string> = {
  default: 'marketing-card',
  feature: 'marketing-card-feature',
  pricing: 'marketing-card-pricing',
}

export function GlassCard({ children, className, variant = 'default' }: GlassCardProps) {
  return (
    <div className={clsx(variantClass[variant], className)}>
      {children}
    </div>
  )
}
