export function telegramShutdownDrainMs(): number {
  return Math.max(
    0,
    Math.min(120_000, Number(process.env.TELEGRAM_SHUTDOWN_DRAIN_MS ?? 30_000)),
  )
}
