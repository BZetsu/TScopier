import { useEffect, useRef, useState } from 'react'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export interface ParsedMarketingStatValue {
  target: number
  unit: '' | 'K' | 'M'
  plus: string
  rest: string
}

/** Parses values like `30K+ Users`, `150K+`, `500K+`. */
export function parseMarketingStatValue(value: string): ParsedMarketingStatValue | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(K|M)?(\+?)(.*)$/)
  if (!match) return null
  return {
    target: Number(match[1]),
    unit: (match[2] as 'K' | 'M' | undefined) ?? '',
    plus: match[3] ?? '',
    rest: match[4] ?? '',
  }
}

export function formatMarketingStatValue(
  amount: number,
  { unit, plus, rest }: Pick<ParsedMarketingStatValue, 'unit' | 'plus' | 'rest'>,
): string {
  const rounded = unit === '' ? Math.round(amount) : Math.round(amount)
  return `${rounded}${unit}${plus}${rest}`
}

export function useInViewOnce(threshold = 0.25): {
  ref: React.RefObject<HTMLDivElement | null>
  inView: boolean
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node || inView) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setInView(true)
        observer.disconnect()
      },
      { threshold },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [inView, threshold])

  return { ref, inView }
}

export function useCountUp(target: number, active: boolean, durationMs = 1800): number {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!active) return

    if (prefersReducedMotion()) {
      setValue(target)
      return
    }

    let frame = 0
    const start = performance.now()

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1)
      const eased = 1 - (1 - progress) ** 3
      setValue(target * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else setValue(target)
    }

    setValue(0)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, durationMs, target])

  return value
}
