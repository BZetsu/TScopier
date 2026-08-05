/** Returns true when `channel_id` looks like a Telegram numeric chat id. */
export function isNumericTelegramChatId(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim();
  if (!value) return false;
  return /^-?\d+$/.test(value);
}

/** Normalize to canonical `-100…` Telegram channel chat id. */
export function normalizeTelegramChatId(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value || !isNumericTelegramChatId(value)) return value;
  if (value.startsWith("-100")) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  const abs = String(Math.abs(Math.trunc(n)));
  return `-100${abs}`;
}
