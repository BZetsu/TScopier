import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildAuthEmailHtml } from "../_shared/authEmailLayout.ts";
import { resolveEmailLogoUrl } from "../_shared/brandEmailAssets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

/** Minimum seconds between verification emails for the same address. */
const RESEND_COOLDOWN_SECONDS = 60;
/** Max verification emails per address per rolling hour. */
const RESEND_MAX_PER_HOUR = 5;

function json(
  body: Record<string, unknown>,
  status: number,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const resendFrom = "TScopier <verification@tscopier.ai>";

    if (!resendApiKey) {
      return json(
        { error: "RESEND_API_KEY not configured on the server" },
        500,
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({})) as {
      confirmUrl?: string;
      redirectTo?: string;
      email?: string;
    };

    const redirectTo =
      body.redirectTo ||
      body.confirmUrl ||
      `${req.headers.get("origin") ?? "http://localhost:5173"}/dashboard`;

    let targetEmail: string | undefined;
    let firstName = "there";

    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(
        token,
      );
      if (!authError && user?.email) {
        targetEmail = user.email;
        firstName = (user.user_metadata?.first_name as string) || firstName;
      }
    }

    if (!targetEmail && typeof body.email === "string") {
      const normalized = body.email.trim().toLowerCase();
      if (normalized.includes("@")) {
        targetEmail = normalized;
      }
    }

    if (!targetEmail) {
      return json({ error: "Missing email" }, 400);
    }

    const normalizedEmail = targetEmail.trim().toLowerCase();

    const { data: claimData, error: claimError } = await supabase.rpc(
      "claim_verification_email_send",
      {
        p_email: normalizedEmail,
        p_cooldown_seconds: RESEND_COOLDOWN_SECONDS,
        p_max_per_hour: RESEND_MAX_PER_HOUR,
      },
    );

    if (claimError) {
      console.error("[send-verification-email] claim error:", claimError);
      return json(
        { error: "Could not rate-limit verification email", details: claimError.message },
        500,
      );
    }

    const claim = (claimData ?? {}) as {
      ok?: boolean;
      error?: string;
      retry_after_seconds?: number;
      cooldown_seconds?: number;
    };

    if (!claim.ok) {
      const retryAfter = Math.max(1, Number(claim.retry_after_seconds ?? RESEND_COOLDOWN_SECONDS));
      const code = claim.error === "rate_limited" ? "rate_limited" : "cooldown";
      return json(
        {
          error: code,
          code,
          retry_after_seconds: retryAfter,
          message:
            code === "rate_limited"
              ? "Too many verification emails. Try again later."
              : "Please wait before requesting another verification email.",
        },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    if (firstName === "there") {
      const { data: listed } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 50,
      });
      const match = listed?.users?.find(
        (u) => u.email?.toLowerCase() === normalizedEmail,
      );
      if (match?.user_metadata?.first_name) {
        firstName = String(match.user_metadata.first_name);
      }
    }

    // Prefer a signup confirmation link. Fall back to magiclink when the user
    // is already auth-confirmed (e.g. Confirm email disabled / auto-confirm).
    let confirmUrl: string | undefined;
    let linkErrorMessage: string | undefined;

    const signupLink = await supabase.auth.admin.generateLink({
      type: "signup",
      email: normalizedEmail,
      options: { redirectTo },
    });
    if (signupLink.data?.properties?.action_link) {
      confirmUrl = signupLink.data.properties.action_link;
    } else {
      linkErrorMessage = signupLink.error?.message;
      const magicLink = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: normalizedEmail,
        options: { redirectTo },
      });
      if (magicLink.data?.properties?.action_link) {
        confirmUrl = magicLink.data.properties.action_link;
      } else {
        linkErrorMessage =
          magicLink.error?.message ?? linkErrorMessage ?? "no action_link returned";
      }
    }

    if (!confirmUrl) {
      return json(
        {
          error: "Could not create verification link",
          details: linkErrorMessage ?? "no action_link returned",
        },
        500,
      );
    }
    const logoUrl = resolveEmailLogoUrl({
      supabaseUrl,
      appUrl: Deno.env.get("VITE_APP_URL"),
      variant: "light",
      explicitUrl: Deno.env.get("EMAIL_LOGO_URL"),
    });

    const html = buildAuthEmailHtml({
      title: "Confirm your account",
      greeting: `Hello ${firstName},`,
      bodyHtml: `<p style="margin:0;">Thank you for signing up for TScopier. Click the button below to confirm your email and activate your account.</p>`,
      buttonLabel: "Confirm account",
      buttonUrl: confirmUrl,
      logoUrl,
    });

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom,
        to: [normalizedEmail],
        subject: "Confirm your TScopier account",
        html,
      }),
    });

    if (!resendRes.ok) {
      const resendError = await resendRes.text();
      console.error("[send-verification-email] Resend error:", resendError);
      return json(
        {
          error: "Failed to send email via Resend",
          details: resendError,
          hint:
            "Verify RESEND_API_KEY and that tscopier.ai is verified in Resend for verification@tscopier.ai.",
        },
        502,
      );
    }

    const resendData = await resendRes.json();

    return json({
      success: true,
      id: resendData.id,
      cooldown_seconds: claim.cooldown_seconds ?? RESEND_COOLDOWN_SECONDS,
    }, 200);
  } catch (err) {
    console.error("[send-verification-email]", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
    );
  }
});
