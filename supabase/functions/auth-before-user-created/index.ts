import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Webhook } from "npm:standardwebhooks@1.0.0";
import { evaluateSignupEmail } from "../_shared/emailSignupPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, webhook-id, webhook-timestamp, webhook-signature",
};

function reject(message: string, httpCode = 400): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        http_code: httpCode,
      },
    }),
    {
      status: httpCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function allow(): Response {
  return new Response("{}", {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return reject("Method not allowed", 405);
  }

  const rawSecret = Deno.env.get("BEFORE_USER_CREATED_HOOK_SECRET")?.trim();
  if (!rawSecret) {
    console.error("[auth-before-user-created] BEFORE_USER_CREATED_HOOK_SECRET not set");
    return reject("Hook not configured", 500);
  }

  const secret = rawSecret.replace(/^v1,whsec_/, "");
  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);

  let event: { user?: { email?: string } }
  try {
    const wh = new Webhook(secret);
    event = wh.verify(payload, headers) as { user?: { email?: string } };
  } catch (err) {
    console.error("[auth-before-user-created] webhook verify failed:", err);
    return reject("Invalid hook signature", 401);
  }

  const email = event.user?.email
  const policy = evaluateSignupEmail(email)
  if (!policy.allowed) {
    console.warn("[auth-before-user-created] blocked signup:", email, policy.code);
    return reject(policy.reason, 400);
  }

  return allow();
});
