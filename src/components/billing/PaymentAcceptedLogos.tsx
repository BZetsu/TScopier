import type { ReactNode } from 'react'
import clsx from 'clsx'

function LogoShell({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <span
      title={label}
      aria-label={label}
      className={clsx(
        'inline-flex h-9 items-center justify-center rounded-md border border-neutral-200/80 bg-white px-2.5 shadow-xs',
        'dark:border-neutral-700 dark:bg-neutral-900',
        className,
      )}
    >
      {children}
    </span>
  )
}

function VisaLogo() {
  return (
    <LogoShell label="Visa">
      <svg viewBox="0 0 48 16" className="h-3.5 w-11" aria-hidden>
        <text
          x="0"
          y="13"
          fill="#1A1F71"
          className="dark:fill-[#8090ff]"
          fontSize="14"
          fontFamily="Arial, Helvetica, sans-serif"
          fontWeight="700"
          letterSpacing="1"
          fontStyle="italic"
        >
          VISA
        </text>
      </svg>
    </LogoShell>
  )
}

function MastercardLogo() {
  return (
    <LogoShell label="Mastercard" className="gap-0 px-2">
      <svg viewBox="0 0 38 24" className="h-5 w-8" aria-hidden>
        <circle cx="14" cy="12" r="8" fill="#EB001B" />
        <circle cx="24" cy="12" r="8" fill="#F79E1B" />
        <path d="M19 6.3a8 8 0 0 1 0 11.4 8 8 0 0 1 0-11.4z" fill="#FF5F00" />
      </svg>
    </LogoShell>
  )
}

function AmexLogo() {
  return (
    <span
      title="American Express"
      aria-label="American Express"
      className="inline-flex h-9 items-center justify-center rounded-md border border-[#2E77BC] bg-[#2E77BC] px-2.5 shadow-xs"
    >
      <span className="text-[11px] font-bold tracking-[0.12em] text-white">AMEX</span>
    </span>
  )
}

function UsdcLogo() {
  return (
    <LogoShell label="USDC">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <circle cx="12" cy="12" r="11" fill="#2775CA" />
        <path
          fill="#fff"
          d="M12.15 5.4c-3.55 0-6.4 2.35-6.4 5.9 0 3.25 2.4 5.8 5.85 6.15v1.55h1.25v-1.55c3.35-.35 5.65-2.55 5.95-5.45h-1.6c-.3 2.1-2 3.65-4.35 3.95V9.55c2-.3 3.35-1.25 3.35-2.85 0-1.7-1.35-2.75-3.35-2.95V5.4zm1.25 8.4v-4c1.25.2 1.9.95 1.9 2 0 1.15-.75 1.85-1.9 2zm-1.25-8.05c2.75 0 4.75 1.6 4.75 4.1 0 2.4-1.85 4-4.15 4.3V6.9c-.1 0-.2-.05-.3-.05s-.2 0-.3.05v6.85c-2.3-.3-4.15-1.9-4.15-4.3 0-2.5 2-4.1 4.75-4.1z"
        />
      </svg>
      <span className="ml-1.5 text-[11px] font-semibold tracking-wide text-neutral-700 dark:text-neutral-200">
        USDC
      </span>
    </LogoShell>
  )
}

function UsdtLogo() {
  return (
    <LogoShell label="USDT">
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
        <circle cx="12" cy="12" r="11" fill="#26A17B" />
        <path
          fill="#fff"
          d="M13 11.45V9.5h3.05V7.35H7.95V9.5H11v1.95c-2.55.12-4.45.7-4.45 1.45s1.9 1.33 4.45 1.45v3.4h2v-3.4c2.55-.12 4.45-.7 4.45-1.45s-1.9-1.33-4.45-1.45zm0 2.35c-.35.02-.7.03-1.05.03s-.7-.01-1.05-.03v-.02c-2.1-.1-3.6-.48-3.6-.95s1.5-.85 3.6-.95v1.55c.35.02.7.03 1.05.03s.7-.01 1.05-.03V12c2.1.1 3.6.48 3.6.95s-1.5.85-3.6.95v-.1z"
        />
      </svg>
      <span className="ml-1.5 text-[11px] font-semibold tracking-wide text-neutral-700 dark:text-neutral-200">
        USDT
      </span>
    </LogoShell>
  )
}

export function PaymentAcceptedLogos({ label }: { label: string }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        {label}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <VisaLogo />
        <MastercardLogo />
        <AmexLogo />
        <UsdcLogo />
        <UsdtLogo />
      </div>
    </div>
  )
}
