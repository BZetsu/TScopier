import { useEffect, useRef, useState } from 'react'
import type { LandingHeroLiveMoney } from '../../i18n/locales/landing/types'

export function formatHeroLiveMoney(amount: number, signed?: boolean): string {
  const formatted = Math.abs(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  if (signed) {
    const prefix = amount >= 0 ? '+' : '-'
    return `${prefix}$${formatted}`
  }
  return `$${formatted}`
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Slowly ticks a dollar amount upward (with occasional tiny pullbacks) to mimic live open P/L.
 */
export function useLiveMoneyTicker(config: LandingHeroLiveMoney): number {
  const [amount, setAmount] = useState(config.from)
  const amountRef = useRef(config.from)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setAmount(config.cap)
      amountRef.current = config.cap
      return
    }

    amountRef.current = config.from
    setAmount(config.from)

    let cancelled = false
    let timeoutId = 0

    const tick = () => {
      const current = amountRef.current
      let step = config.stepMin + Math.random() * (config.stepMax - config.stepMin)

      if (Math.random() < 0.1) {
        step = -step * (0.25 + Math.random() * 0.2)
      }

      let next = current + step

      if (next >= config.cap) {
        next = config.cap - Math.random() * (config.cap * 0.006)
      } else if (next < config.from * 0.985) {
        next = config.from + Math.random() * (config.stepMax * 2)
      }

      amountRef.current = next
      setAmount(next)
    }

    const loop = () => {
      if (cancelled) return
      tick()
      timeoutId = window.setTimeout(loop, 700 + Math.random() * 900)
    }

    timeoutId = window.setTimeout(loop, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [config.cap, config.from, config.stepMax, config.stepMin])

  return amount
}
