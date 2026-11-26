export interface RedeemRecoveryCodeResult {
  ok: boolean;
  days: number;
  extension?: { id: string; user_id: string; days: number; reason: string };
}

/**
 * Redeem a one-time recovery code for a usage extension.
 *
 * The code is tied to the signed-in user and can be used once. The edge function
 * verifies ownership, marks the code used, and inserts a subscription_extensions
 * grant of the code's own length (1-30 days) so every access check (guard, edge
 * functions, trade worker) treats that window as live access.
 */
export async function redeemRecoveryCode(
  accessToken: string,
  code: string,
): Promise<RedeemRecoveryCodeResult> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/redeem-recovery-code`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new Error(
      (data as { error?: string }).error || "Failed to redeem recovery code",
    );
  return data as unknown as RedeemRecoveryCodeResult;
}
