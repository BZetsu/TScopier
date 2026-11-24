/** NOWPayments invoice + IPN helpers for membership crypto (manual renew). */

export const NOWPAYMENTS_API_BASE = "https://api.nowpayments.io/v1";

export type NowPaymentsInvoiceResponse = {
  id?: string | number;
  invoice_id?: string | number;
  invoice_url?: string;
  order_id?: string;
  [key: string]: unknown;
};

export type NowPaymentsIpnPayload = {
  payment_status?: string;
  order_id?: string;
  invoice_id?: string | number;
  payment_id?: string | number;
  price_amount?: string | number;
  price_currency?: string;
  [key: string]: unknown;
};

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted;
  }
  return value;
}

/** Verify NOWPayments IPN signature (HMAC-SHA512 over key-sorted JSON). */
export async function verifyNowPaymentsIpnSignature(
  body: Record<string, unknown>,
  signatureHeader: string | null,
  ipnSecret: string,
): Promise<boolean> {
  const signature = String(signatureHeader ?? "").trim().toLowerCase();
  if (!signature || !ipnSecret) return false;

  const sorted = sortKeysDeep(body);
  const payload = JSON.stringify(sorted);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ipnSecret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const computed = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (computed.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export function isNowPaymentsPaidStatus(status: string | null | undefined): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "finished" || s === "confirmed";
}

export async function createNowPaymentsInvoice(params: {
  apiKey: string;
  priceAmountUsd: number;
  orderId: string;
  orderDescription: string;
  successUrl: string;
  cancelUrl: string;
  ipnCallbackUrl: string;
}): Promise<NowPaymentsInvoiceResponse> {
  const res = await fetch(`${NOWPAYMENTS_API_BASE}/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "Content-Type": "application/json",
    },
    // is_fixed_rate:false — fixed-rate pairs often raise network minimums above
    // Basic ($9.99), which surfaces as "amountTo is too small" on Tron/ETH.
    body: JSON.stringify({
      price_amount: Number(params.priceAmountUsd.toFixed(2)),
      price_currency: "usd",
      order_id: params.orderId,
      order_description: params.orderDescription,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      ipn_callback_url: params.ipnCallbackUrl,
      is_fixed_rate: false,
      is_fee_paid_by_user: false,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as NowPaymentsInvoiceResponse & {
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(
      data.message || data.error || `NOWPayments invoice failed (${res.status})`,
    );
  }
  if (!data.invoice_url) {
    throw new Error("NOWPayments invoice_url missing");
  }
  return data;
}

/** Fetch payment by id (confirm lag fallback). */
export async function getNowPaymentsPayment(
  apiKey: string,
  paymentId: string,
): Promise<NowPaymentsIpnPayload> {
  const res = await fetch(`${NOWPAYMENTS_API_BASE}/payment/${encodeURIComponent(paymentId)}`, {
    headers: { "x-api-key": apiKey },
  });
  const data = (await res.json().catch(() => ({}))) as NowPaymentsIpnPayload & {
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.message || `NOWPayments payment lookup failed (${res.status})`);
  }
  return data;
}
