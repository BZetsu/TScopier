/**
 * Opaque, user-scoped handles for broker accounts shown to the model.
 *
 * The handle lets the assistant select an account without exposing the
 * database ID or broker login. Resolution always remains scoped to the
 * authenticated user.
 */

const HANDLE_PREFIX = "broker_";
const HANDLE_HEX_LENGTH = 32;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Create a stable, non-reversible model-safe handle for one broker row. */
export async function createBrokerHandle(
  userId: string,
  brokerId: string,
): Promise<string> {
  const source = `unicopier:broker-handle:${userId}:${brokerId}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(source),
  );
  return `${HANDLE_PREFIX}${bytesToHex(new Uint8Array(digest)).slice(0, HANDLE_HEX_LENGTH)}`;
}

/** True when a value has the expected opaque-handle shape. */
export function isBrokerHandle(value: unknown): boolean {
  return new RegExp(`^${HANDLE_PREFIX}[0-9a-f]{${HANDLE_HEX_LENGTH}}$`).test(
    String(value ?? ""),
  );
}
