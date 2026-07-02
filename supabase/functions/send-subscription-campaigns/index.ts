import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { createHmac } from "node:crypto";
import {
  buildCampaignEmailHtml,
  recipientFirstName,
} from "../_shared/campaignEmailLayout.ts";
import { resolveEmailLogoUrl } from "../_shared/brandEmailAssets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const APP_URL = (Deno.env.get("VITE_APP_URL") || "https://app.tscopier.ai").replace(/\/$/, "");
const LOGO_URL = resolveEmailLogoUrl({
  supabaseUrl: SUPABASE_URL,
  appUrl: APP_URL,
  variant: "dark",
  explicitUrl: Deno.env.get("EMAIL_LOGO_URL"),
});
const RESEND_FROM = Deno.env.get("RESEND_CAMPAIGN_FROM") || "TScopier <noreply@tscopier.com>";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function generateUnsubscribeToken(userId: string): string {
  const hmac = createHmac("sha256", SUPABASE_SERVICE_ROLE_KEY);
  hmac.update(userId);
  return hmac.digest("hex");
}

function getUnsubscribeUrl(userId: string): string {
  const token = generateUnsubscribeToken(userId);
  return `${SUPABASE_URL}/functions/v1/email-unsubscribe?uid=${userId}&token=${token}`;
}

interface EmailRecipient {
  user_id: string;
  email: string;
  display_name: string | null;
  first_name: string | null;
}

function buildNoSubscriptionEmail(
  recipient: EmailRecipient,
  unsubscribeUrl: string,
): string {
  const name = recipientFirstName(recipient);
  const pricingUrl = `${APP_URL}/pricing`;
  const dashboardUrl = `${APP_URL}/dashboard`;

  return buildCampaignEmailHtml({
    appUrl: APP_URL,
    logoUrl: LOGO_URL,
    preheader: "Activate a plan to start copying Telegram signals to your broker automatically.",
    eyebrow: "Subscription required",
    title: "Your copier is ready — activate a plan to go live",
    greeting: name,
    bodyHtml: `
      <p style="margin:0 0 16px 0;">You created your TScopier account and finished onboarding, but <strong style="color:#0f172a;">live signal copying is still off</strong> because there is no active subscription on your account.</p>
      <p style="margin:0 0 16px 0;">Without a plan, new Telegram signals from your channels are <strong style="color:#0f172a;">not sent to your broker</strong>. Your dashboard, broker links, and channel setup remain saved — you only need a subscription to turn execution back on.</p>
      <p style="margin:0;">Choose <strong>Advanced</strong> for the full copier (unlimited channels, range trading, unlimited backtests) with a <strong>10-day free trial</strong> for first-time subscribers, or <strong>Basic</strong> to get started with one account and essential copy features.</p>
    `,
    featureList: [
      "24/7 automated copying from your Telegram signal channels",
      "Connect MT4/MT5 brokers — no VPS or Expert Advisor required",
      "Real-time execution logs and trade history in your dashboard",
      "Channel-specific risk settings, lot sizing, and SL/TP handling",
      "Economic calendar and news filters on supported plans",
    ],
    infoBox: {
      title: "Quick start (about 10 minutes)",
      bodyHtml: `
        <ol style="margin:8px 0 0 0;padding-left:20px;">
          <li style="margin-bottom:6px;">Pick a plan on the pricing page and complete checkout.</li>
          <li style="margin-bottom:6px;">Connect your trading account under <strong>Broker accounts</strong>.</li>
          <li style="margin-bottom:6px;">Link the Telegram channels you want to copy.</li>
          <li style="margin-bottom:0;">Leave the copier running — we handle listener, parsing, and execution.</li>
        </ol>
      `,
    },
    primaryCta: {
      label: "View plans & subscribe",
      url: pricingUrl,
    },
    secondaryCta: {
      label: "Open your dashboard",
      url: dashboardUrl,
    },
    closingHtml: `Questions about which plan fits your setup? Reply to this email or use in-app <strong>Help &amp; Support</strong> — we're happy to help you get your first signals copying.`,
    unsubscribeUrl,
  });
}

function buildTrialExpiredEmail(
  recipient: EmailRecipient,
  unsubscribeUrl: string,
): string {
  const name = recipientFirstName(recipient);
  const pricingUrl = `${APP_URL}/pricing`;
  const billingUrl = `${APP_URL}/billing`;

  return buildCampaignEmailHtml({
    appUrl: APP_URL,
    logoUrl: LOGO_URL,
    preheader: "Your free trial has ended. Subscribe to resume automated trade copying.",
    eyebrow: "Trial ended",
    title: "Subscribe to keep copying signals",
    greeting: name,
    bodyHtml: `
      <p style="margin:0 0 16px 0;">Your <strong style="color:#0f172a;">10-day Advanced trial has ended</strong>. Automated trade copying is now <strong style="color:#0f172a;">paused</strong> on your account until you subscribe to a paid plan.</p>
      <p style="margin:0 0 16px 0;">Nothing you configured is lost: your <strong>broker connections</strong>, <strong>Telegram channels</strong>, copier settings, and channel risk parameters are still saved and ready to use the moment you reactivate.</p>
      <p style="margin:0;">Subscribe to <strong>Advanced</strong> to restore unlimited channels, range trading, and advanced copier tools, or choose <strong>Basic</strong> if you only need a single account with core copy features. Because you already used your trial, checkout starts billing immediately — there is no second free trial.</p>
    `,
    featureList: [
      "Resume instant execution when new signals arrive in Telegram",
      "Keep using your existing broker and channel configuration",
      "Manage billing, invoices, and plan changes anytime",
      "Upgrade or add extra broker slots on Advanced as you scale",
    ],
    infoBox: {
      title: "What happens while you're unsubscribed",
      bodyHtml: `
        <ul style="margin:8px 0 0 0;padding-left:18px;">
          <li style="margin-bottom:6px;">New entry and management signals are <strong>not</strong> sent to your broker.</li>
          <li style="margin-bottom:6px;">Open trades on your broker are <strong>not</strong> closed automatically by TScopier.</li>
          <li style="margin-bottom:0;">You can still sign in, review settings, and subscribe when you're ready.</li>
        </ul>
      `,
    },
    primaryCta: {
      label: "Purchase subscription",
      url: pricingUrl,
    },
    secondaryCta: {
      label: "Review billing & invoices",
      url: billingUrl,
    },
    closingHtml: `Need help choosing a plan or updating payment details? Reply to this email or visit <strong>Billing</strong> in the app. We'd love to have you back copying with TScopier.`,
    unsubscribeUrl,
  });
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.error("[send-subscription-campaigns] RESEND_API_KEY missing");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error("[send-subscription-campaigns] Resend error:", await res.text());
    }
    return res.ok;
  } catch (err) {
    console.error("[send-subscription-campaigns] send failed:", err);
    return false;
  }
}

async function processNoSubscriptionNudge(): Promise<number> {
  const { data: eligibleUsers, error } = await supabase.rpc(
    "get_no_subscription_nudge_recipients",
  );

  if (error) {
    console.error("[send-subscription-campaigns] nudge rpc:", error.message);
    return 0;
  }
  if (!eligibleUsers?.length) return 0;

  let sent = 0;
  for (const user of eligibleUsers as EmailRecipient[]) {
    const unsubscribeUrl = getUnsubscribeUrl(user.user_id);
    const html = buildNoSubscriptionEmail(user, unsubscribeUrl);
    const success = await sendEmail(
      user.email,
      "Activate TScopier — start copying Telegram signals to your broker",
      html,
    );

    if (success) {
      await supabase.from("email_campaign_log").insert({
        user_id: user.user_id,
        campaign_type: "no_subscription_nudge",
        email_address: user.email,
      });
      sent++;
    }
  }

  return sent;
}

async function processTrialExpired(): Promise<number> {
  const { data: eligibleUsers, error } = await supabase.rpc(
    "get_trial_expired_recipients",
  );

  if (error) {
    console.error("[send-subscription-campaigns] trial_expired rpc:", error.message);
    return 0;
  }
  if (!eligibleUsers?.length) return 0;

  let sent = 0;
  for (const user of eligibleUsers as EmailRecipient[]) {
    const unsubscribeUrl = getUnsubscribeUrl(user.user_id);
    const html = buildTrialExpiredEmail(user, unsubscribeUrl);
    const success = await sendEmail(
      user.email,
      "Your TScopier trial ended — subscribe to resume copying",
      html,
    );

    if (success) {
      await supabase.from("email_campaign_log").insert({
        user_id: user.user_id,
        campaign_type: "trial_expired",
        email_address: user.email,
      });
      sent++;
    }
  }

  return sent;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const nudgeSent = await processNoSubscriptionNudge();
    const trialSent = await processTrialExpired();

    return new Response(
      JSON.stringify({
        success: true,
        no_subscription_nudge_sent: nudgeSent,
        trial_expired_sent: trialSent,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
