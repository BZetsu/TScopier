import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, requireAuthedAdmin } from "../_shared/adminAuth.ts";
import { writeAdminAudit } from "../_shared/adminAudit.ts";
import { isSuspiciousSignupEmail } from "../_shared/emailSignupPolicy.ts";
import { buildCampaignEmailHtml, escapeHtml } from "../_shared/campaignEmailLayout.ts";
import { fetchAuthEmails } from "../_shared/authEmailLookup.ts";
import { resolveEmailLogoUrl } from "../_shared/brandEmailAssets.ts";
import { getEmailUnsubscribeUrl } from "../_shared/subscriptionCampaignEmails.ts";

function bad(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

function requireReason(body: Record<string, unknown>): string | null {
  const reason = String(body.reason ?? "").trim();
  return reason.length > 0 ? reason : null;
}

/**
 * Read `expires_in_days` from a create/generate request.
 *
 * Contract: an integer 1–365 is a redemption window starting at creation;
 * 0 means the code never expires; an absent, null or empty value means the
 * product default of 30 days. Anything else is rejected rather than coerced,
 * so malformed input can never silently select "never expires".
 */
function readExpiryDays(body: Record<string, unknown>): { days: number | null } | { error: string } {
  const raw = body.expires_in_days;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    return { days: 30 };
  }

  const n = typeof raw === "number"
    ? raw
    : typeof raw === "string" && /^\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : NaN;

  if (n === 0) return { days: null };
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    return { error: "expires_in_days must be 0 (never) or an integer between 1 and 365" };
  }
  return { days: n };
}

function expiryIso(days: number | null): string | null {
  return days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Days a user has already claimed against the 30-day extension cap.
 *
 * A redeemed code always counts — excluding it would let a user redeem,
 * generate, redeem forever. An unused code counts only while it can still be
 * redeemed, so an expired code releases its slot instead of locking a user out
 * of every future campaign.
 */
function countedGrantDays(
  rows: Array<{ days?: unknown; used?: unknown; expires_at?: unknown }>,
): number {
  const now = Date.now();
  return rows.reduce((sum, row) => {
    if (row.used !== true && row.expires_at && new Date(String(row.expires_at)).getTime() <= now) {
      return sum; // dead row: nothing granted, nothing reserved
    }
    return sum + Number(row.days ?? 0);
  }, 0);
}

async function snapshotById(
  supabase: ReturnType<typeof adminClient>,
  table: string,
  idColumn: string,
  idValue: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await supabase.from(table).select("*").eq(idColumn, idValue).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return bad(405, "Method not allowed");

  const supabase = adminClient();
  const adminCheck = await requireAuthedAdmin(req, supabase);
  if ("error" in adminCheck) return adminCheck.error;
  const adminUser = adminCheck.user;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "").trim();
  const correlationId = crypto.randomUUID();

  if (!action) return bad(400, "action is required");

  const requireReasonActions = new Set([
    "close_trade",
    "ban_user",
    "unban_user",
    "bulk_ban_spam_users",
    "force_disconnect_broker",
    "force_reconnect_broker",
    "toggle_channel",
    "toggle_broker",
    "override_broker_config",
    "set_admin_access",
    "acknowledge_alert",
    "update_alert_rule",
    "upsert_alert_recipient",
    "delete_alert_recipient",
    "grant_subscription_extension",
    "generate_recovery_code",
    "bulk_generate_recovery_codes",
    "send_recovery_emails",
    "revoke_recovery_code",
    "revoke_all_recovery_codes",
  ]);
  const reason = requireReasonActions.has(action) ? requireReason(body) : String(body.reason ?? "").trim() || null;
  if (requireReasonActions.has(action) && !reason) {
    return bad(400, "reason is required for this mutation");
  }

  if (action === "set_admin_access") {
    const userId = String(body.target_user_id ?? "").trim();
    if (!userId) return bad(400, "target_user_id is required");
    const grantAdmin = Boolean(body.is_admin);
    const before = await snapshotById(supabase, "user_profiles", "user_id", userId);

    let adminUntil: string | null = null;
    if (grantAdmin) {
      const rawUntil = body.admin_until;
      if (rawUntil === null || rawUntil === undefined || rawUntil === "") {
        adminUntil = null;
      } else {
        const parsed = new Date(String(rawUntil));
        if (Number.isNaN(parsed.getTime())) {
          return bad(400, "admin_until must be a valid ISO datetime");
        }
        if (parsed.getTime() <= Date.now()) {
          return bad(400, "admin_until must be in the future when granting admin access");
        }
        adminUntil = parsed.toISOString();
      }
    }

    const { data, error } = await supabase
      .from("user_profiles")
      .update({
        is_admin: grantAdmin,
        admin_until: grantAdmin ? adminUntil : null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!data) return bad(404, "User profile not found");

    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "user_profiles",
      entity_id: userId,
      reason,
      request_payload: {
        is_admin: grantAdmin,
        admin_until: grantAdmin ? adminUntil : null,
      },
      before_state: before,
      after_state: data as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, profile: data }, { headers: corsHeaders });
  }

  if (action === "grant_subscription_extension") {
    const userId = String(body.target_user_id ?? "").trim();
    if (!userId) return bad(400, "target_user_id is required");
    const days = Number(body.days);
    if (![3, 7, 14, 30].includes(days)) {
      return bad(400, "days must be one of 3, 7, 14 or 30");
    }

    const { data: existing, error: listErr } = await supabase
      .from("subscription_extensions")
      .select("days")
      .eq("user_id", userId);
    if (listErr) return bad(400, listErr.message);
    const alreadyGranted = (existing ?? []).reduce(
      (sum, row) => sum + Number(row.days ?? 0),
      0,
    );
    if (alreadyGranted + days > 30) {
      return bad(
        400,
        `extension cap reached: ${alreadyGranted} of 30 days already granted`,
      );
    }

    const { data: row, error } = await supabase
      .from("subscription_extensions")
      .insert({
        user_id: userId,
        days,
        reason,
        granted_by: adminUser.id,
      })
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!row) return bad(500, "extension not saved");

    // Resume a billing-driven pause right away; a pause the user set stays as it is.
    const { data: resumed } = await supabase
      .from("user_profiles")
      .update({
        copier_paused: false,
        copier_pause_reason: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("copier_paused", true)
      .in("copier_pause_reason", [
        "trial_expired",
        "subscription_ended",
        "payment_failed",
        "unknown",
      ])
      .select("user_id")
      .maybeSingle();

    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "subscription_extensions",
      entity_id: String(row.id),
      reason,
      request_payload: { days },
      after_state: row as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json(
      { ok: true, extension: row, copier_resumed: Boolean(resumed) },
      { headers: corsHeaders },
    );
  }

  if (action === "generate_recovery_code") {
    const targetUserId = String(body.target_user_id ?? "").trim();
    if (!targetUserId) return bad(400, "target_user_id is required");
    const days = Number(body.days ?? 14);
    if (!Number.isInteger(days) || days <= 0 || days > 30) {
      return bad(400, "days must be an integer between 1 and 30");
    }
    const expiry = readExpiryDays(body);
    if ("error" in expiry) return bad(400, expiry.error);
    const expiresAt = expiryIso(expiry.days);

    const { data: existingCodes, error: listErr } = await supabase
      .from("subscription_recovery_codes")
      .select("days, used, expires_at")
      .eq("user_id", targetUserId);
    if (listErr) return bad(400, listErr.message);
    const alreadyGranted = countedGrantDays(existingCodes ?? []);
    if (alreadyGranted + days > 30) {
      return bad(
        400,
        `extension cap reached: ${alreadyGranted} of 30 days already granted`,
      );
    }

    const { data: target } = await supabase.auth.admin.getUserById(targetUserId);
    if (!target?.user) return bad(404, "Target user not found");

    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code: string | null = null;
    for (let attempt = 0; attempt < 5 && !code; attempt++) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      let generated = "";
      for (const b of bytes) generated += chars[b % chars.length];
      const { error: insertErr } = await supabase
        .from("subscription_recovery_codes")
        .insert({ user_id: targetUserId, code: generated, days, expires_at: expiresAt })
        .select("*")
        .maybeSingle();
      if (insertErr) continue; // unique violation on code: regenerate
      code = generated;
    }
    if (!code) return bad(400, "failed to generate a unique code");

    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: targetUserId,
      action,
      entity_type: "subscription_recovery_codes",
      entity_id: code,
      reason: reason ?? null,
      request_payload: { days, expires_in_days: expiry.days },
      after_state: { user_id: targetUserId, days, expires_at: expiresAt },
      correlation_id: correlationId,
    });
    return Response.json(
      { ok: true, code, user_id: targetUserId, days, expires_at: expiresAt },
      { headers: corsHeaders },
    );
  }

  if (action === "bulk_generate_recovery_codes") {
    const userIds = Array.isArray(body.user_ids)
      ? body.user_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (userIds.length === 0) return bad(400, "user_ids is required");
    if (userIds.length > 200) {
      return bad(400, "user_ids must not exceed 200 per batch");
    }
    const days = Number(body.days ?? 14);
    if (!Number.isInteger(days) || days <= 0 || days > 30) {
      return bad(400, "days must be an integer between 1 and 30");
    }
    const expiry = readExpiryDays(body);
    if ("error" in expiry) return bad(400, expiry.error);
    const expiresAt = expiryIso(expiry.days);

    const results: Array<{ user_id: string; code?: string; error?: string }> = [];
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    for (const targetUserId of userIds) {
      const { data: target } = await supabase.auth.admin.getUserById(targetUserId);
      if (!target?.user) {
        results.push({ user_id: targetUserId, error: "user not found" });
        continue;
      }

      const { data: existingCodes, error: listErr } = await supabase
        .from("subscription_recovery_codes")
        .select("days, used, expires_at")
        .eq("user_id", targetUserId);
      if (listErr) {
        results.push({ user_id: targetUserId, error: listErr.message });
        continue;
      }
      const alreadyGranted = countedGrantDays(existingCodes ?? []);
      if (alreadyGranted + days > 30) {
        results.push({
          user_id: targetUserId,
          error: `extension cap reached: ${alreadyGranted} of 30 days already granted`,
        });
        continue;
      }

      let code: string | null = null;
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        let generated = "";
        for (const b of bytes) generated += chars[b % chars.length];
        const { error: insertErr } = await supabase
          .from("subscription_recovery_codes")
          .insert({ user_id: targetUserId, code: generated, days, expires_at: expiresAt })
          .select("*")
          .maybeSingle();
        if (insertErr) continue;
        code = generated;
      }
      if (!code) {
        results.push({ user_id: targetUserId, error: "failed to generate a unique code" });
        continue;
      }

      await writeAdminAudit(supabase, {
        actor_user_id: adminUser.id,
        target_user_id: targetUserId,
        action,
        entity_type: "subscription_recovery_codes",
        entity_id: code,
        reason: reason ?? null,
        request_payload: { days, bulk: true, expires_in_days: expiry.days },
        after_state: { user_id: targetUserId, code, days, expires_at: expiresAt },
        correlation_id: correlationId,
      });
      results.push({ user_id: targetUserId, code });
    }

    const created = results.filter((r) => r.code).length;
    return Response.json(
      { ok: true, created, results },
      { headers: corsHeaders },
    );
  }

  if (action === "send_recovery_emails") {
    const codeIds = Array.isArray(body.code_ids)
      ? body.code_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (codeIds.length === 0) return bad(400, "code_ids is required");
    if (codeIds.length > 200) {
      return bad(400, "code_ids must not exceed 200 per batch");
    }
    const subject = String(body.subject ?? "").trim();
    if (!subject) return bad(400, "subject is required");
    const heading = String(body.heading ?? subject).trim();
    const message = String(body.message ?? "").trim();
    if (!message) return bad(400, "message is required");
    const ctaLabel = String(body.cta_label ?? "Redeem your code").trim();
    const ctaUrl = String(body.cta_url ?? "").trim();
    const personalized = body.personalized !== false;

    const { data: rows, error: rowsErr } = await supabase
      .from("subscription_recovery_codes")
      .select("id, user_id, code, days, sent_at, used, expires_at")
      .in("id", codeIds);
    if (rowsErr) return bad(400, rowsErr.message);
    if (!rows || rows.length === 0) return bad(404, "no codes found");

    const userIds = [...new Set(rows.map((r) => String(r.user_id)).filter(Boolean))];
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("user_id, display_name, first_name")
      .in("user_id", userIds);
    // Paged lookup: a single listUsers page returns the newest 1000 accounts and
    // silently misses older ones — exactly the churned cohort we are emailing.
    const emailByUser = await fetchAuthEmails(supabase, userIds);
    const profileByUser = new Map<string, { display_name?: string | null; first_name?: string | null }>();
    for (const p of (profiles ?? [])) {
      profileByUser.set(String(p.user_id), p);
    }

    const appUrl = Deno.env.get("VITE_APP_URL") || "https://app.unicopier.com";
    const from = Deno.env.get("RESEND_CAMPAIGN_FROM") || "UniCopier <hello@unicopier.com>";
    const resendKey = Deno.env.get("RESEND_API_KEY");

    const results: Array<{ code_id: string; user_id: string; code: string; ok: boolean; error?: string; email?: string }> = [];
    const now = new Date().toISOString();

    for (const row of rows) {
      if (row.sent_at) {
        results.push({
          code_id: row.id,
          user_id: row.user_id,
          code: row.code,
          ok: false,
          error: "already sent",
        });
        continue;
      }
      if (row.used) {
        results.push({
          code_id: row.id,
          user_id: row.user_id,
          code: row.code,
          ok: false,
          error: "code already used",
        });
        continue;
      }
      // Never email a code that redemption would reject as expired.
      if (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) {
        results.push({
          code_id: row.id,
          user_id: row.user_id,
          code: row.code,
          ok: false,
          error: "code expired",
        });
        continue;
      }

      const userId = String(row.user_id);
      const email = emailByUser.get(userId) || "";
      if (!email) {
        results.push({ code_id: row.id, user_id: userId, code: row.code, ok: false, error: "no email on file" });
        continue;
      }

      const profile = profileByUser.get(userId) ?? {};
      const firstName = profile.first_name ?? profile.display_name ?? email.split("@")[0] ?? "there";
      const userName = profile.display_name ?? profile.first_name ?? email.split("@")[0] ?? "there";

      const render = (template: string): string => {
        // {{code}}, {{days}} and {{app_url}} are per-recipient data — always substituted,
        // otherwise an email could ship with a literal "{{code}}" placeholder.
        const base = template
          .replace(/\{\{code\}\}/g, row.code)
          .replace(/\{\{days\}\}/g, String(row.days))
          .replace(/\{\{app_url\}\}/g, appUrl);
        if (!personalized) {
          // Neutral wording instead of leaving literal {{first_name}} in a generic send.
          return base
            .replace(/\{\{user_name\}\}/g, "there")
            .replace(/\{\{first_name\}\}/g, "there")
            .replace(/\{\{user_email\}\}/g, "");
        }
        return base
          .replace(/\{\{user_name\}\}/g, userName)
          .replace(/\{\{first_name\}\}/g, firstName)
          .replace(/\{\{user_email\}\}/g, email);
      };

      const emailSubject = render(subject);
      const emailHeading = render(heading);
      const emailMessage = render(message);

      // Convert plain text message to HTML paragraphs (escape first, then add <br/>)
      const messageHtml = emailMessage
        .replace(/\r\n/g, "\n")
        .trim()
        .split(/\n{2,}/)
        .filter((b) => b.trim().length > 0)
        .map((block) => `<p style="margin:0 0 16px 0;">${escapeHtml(block).replace(/\n/g, "<br/>")}</p>`)
        .join("");

      const logoUrl = resolveEmailLogoUrl({
        supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
        appUrl,
        variant: "dark",
        explicitUrl: Deno.env.get("EMAIL_LOGO_URL"),
      });
      const unsubscribeUrl = getEmailUnsubscribeUrl(
        appUrl,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        userId,
      );

      const emailHtml = buildCampaignEmailHtml({
        appUrl,
        logoUrl,
        preheader: emailSubject,
        eyebrow: "Recovery Code",
        title: emailHeading,
        greeting: firstName,
        bodyHtml: messageHtml,
        primaryCta: {
          label: ctaLabel || "Redeem your code",
          // /billing renders the plans page (MembershipPage), which has no redeem
          // entry point; the redeem card lives on /membership (BillingPage).
          url: ctaUrl || `${appUrl}/membership`,
        },
        closingHtml: "If you did not request this, you can ignore this email.",
        unsubscribeUrl,
      });

      const sendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey ?? ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [email],
          subject: emailSubject,
          html: emailHtml,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const sendData = await sendRes.json().catch(() => ({})) as { id?: string; error?: string };

      if (!sendRes.ok) {
        results.push({
          code_id: row.id,
          user_id: userId,
          code: row.code,
          ok: false,
          error: sendData.error ?? `HTTP ${sendRes.status}`,
          email,
        });
        continue;
      }

      const { error: updErr } = await supabase
        .from("subscription_recovery_codes")
        .update({ sent_at: now, sent_email: email, email_subject: emailSubject })
        .eq("id", row.id);

      if (updErr) {
        // The email went out but the row still shows unsent — flag it so it is not resent.
        results.push({
          code_id: row.id,
          user_id: userId,
          code: row.code,
          ok: false,
          error: `Email sent but not recorded (${updErr.message}) — do not resend`,
          email,
        });
        continue;
      }

      results.push({
        code_id: row.id,
        user_id: userId,
        code: row.code,
        ok: true,
        email,
      });
    }

    const sent = results.filter((r) => r.ok).length;
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      action,
      entity_type: "subscription_recovery_codes",
      reason: reason ?? null,
      request_payload: { code_ids: codeIds, subject, personalized },
      after_state: { sent, total: results.length },
      correlation_id: correlationId,
    });
    return Response.json(
      { ok: true, sent, total: results.length, results },
      { headers: corsHeaders },
    );
  }

  if (action === "revoke_recovery_code") {
    const codeId = String(body.code_id ?? "").trim();
    if (!codeId) return bad(400, "code_id is required");

    const { data: existing, error: findErr } = await supabase
      .from("subscription_recovery_codes")
      .select("id, user_id, code, used, sent_at")
      .eq("id", codeId)
      .maybeSingle();
    if (findErr) return bad(400, findErr.message);
    if (!existing) return bad(404, "Code not found");
    if (existing.used) return bad(400, "Cannot revoke a code that has already been used");

    const { error: delErr } = await supabase
      .from("subscription_recovery_codes")
      .delete()
      .eq("id", codeId)
      .eq("used", false);
    if (delErr) return bad(400, delErr.message);

    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: existing.user_id,
      action,
      entity_type: "subscription_recovery_codes",
      entity_id: existing.code,
      reason: reason ?? null,
      request_payload: { code_id: codeId },
      before_state: existing as Record<string, unknown>,
      after_state: { deleted: true },
      correlation_id: correlationId,
    });

    return Response.json({ ok: true, deleted: true }, { headers: corsHeaders });
  }

  if (action === "revoke_all_recovery_codes") {
    // Redeemed codes are never deleted: they are the record that access was
    // granted. Everything else (unused, sent, expired) can be pulled at once.
    const { data: doomed, error: listErr } = await supabase
      .from("subscription_recovery_codes")
      .select("id")
      .eq("used", false);
    if (listErr) return bad(400, listErr.message);
    const count = (doomed ?? []).length;
    if (count === 0) return bad(404, "No unused codes to revoke");

    const { error: delErr } = await supabase
      .from("subscription_recovery_codes")
      .delete()
      .eq("used", false);
    if (delErr) return bad(400, delErr.message);

    // Counts only — no plaintext codes in the audit log.
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      action,
      entity_type: "subscription_recovery_codes",
      reason: reason ?? null,
      request_payload: { scope: "all_unused", deleted: count },
      before_state: { unused_count: count },
      after_state: { deleted: count },
      correlation_id: correlationId,
    });

    return Response.json({ ok: true, deleted: count }, { headers: corsHeaders });
  }

  if (action === "ban_user") {
    const userId = String(body.target_user_id ?? "").trim();
    if (!userId) return bad(400, "target_user_id is required");
    const durationHours = Number(body.duration_hours ?? 24 * 365);
    const bannedUntil = new Date(Date.now() + Math.max(1, durationHours) * 60 * 60 * 1000).toISOString();
    const { data: beforeAuth } = await supabase.auth.admin.getUserById(userId);
    const before = beforeAuth?.user ? { banned_until: beforeAuth.user.banned_until } : null;
    const { data: updated, error } = await supabase.auth.admin.updateUserById(userId, { ban_duration: `${durationHours}h` });
    if (error) return bad(400, error.message);
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "auth.users",
      entity_id: userId,
      reason,
      request_payload: { duration_hours: durationHours },
      before_state: before,
      after_state: {
        banned_until: updated.user?.banned_until ?? bannedUntil,
      },
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, banned_until: updated.user?.banned_until ?? bannedUntil }, { headers: corsHeaders });
  }

  if (action === "unban_user") {
    const userId = String(body.target_user_id ?? "").trim();
    if (!userId) return bad(400, "target_user_id is required");
    const { data: beforeAuth } = await supabase.auth.admin.getUserById(userId);
    const before = beforeAuth?.user ? { banned_until: beforeAuth.user.banned_until } : null;
    const { data: updated, error } = await supabase.auth.admin.updateUserById(userId, { ban_duration: "none" });
    if (error) return bad(400, error.message);
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "auth.users",
      entity_id: userId,
      reason,
      before_state: before,
      after_state: { banned_until: updated.user?.banned_until ?? null },
      correlation_id: correlationId,
    });
    return Response.json({ ok: true }, { headers: corsHeaders });
  }

  if (action === "bulk_ban_spam_users") {
    const dryRun = body.dry_run === true;
    const matched: Array<{ user_id: string; email: string }> = [];
    let page = 1;
    const perPage = 1000;

    while (page <= 20) {
      const { data } = await supabase.auth.admin.listUsers({ page, perPage });
      const users = data?.users ?? [];
      if (users.length === 0) break;

      for (const user of users) {
        const email = user.email ?? "";
        if (!email || !isSuspiciousSignupEmail(email)) continue;
        matched.push({ user_id: user.id, email });
      }

      if (users.length < perPage) break;
      page += 1;
    }

    if (dryRun) {
      return Response.json({
        ok: true,
        dry_run: true,
        matched_count: matched.length,
        matched,
      }, { headers: corsHeaders });
    }

    let bannedCount = 0;
    const failures: Array<{ user_id: string; error: string }> = [];
    for (const row of matched) {
      const { error } = await supabase.auth.admin.updateUserById(row.user_id, {
        ban_duration: "876000h",
      });
      if (error) {
        failures.push({ user_id: row.user_id, error: error.message });
        continue;
      }
      bannedCount += 1;
      await writeAdminAudit(supabase, {
        actor_user_id: adminUser.id,
        target_user_id: row.user_id,
        action: "ban_user",
        entity_type: "auth.users",
        entity_id: row.user_id,
        reason: reason ?? "bulk_ban_spam_users",
        request_payload: { email: row.email, bulk: true },
        before_state: null,
        after_state: { banned: true },
        correlation_id: correlationId,
      });
    }

    return Response.json({
      ok: true,
      matched_count: matched.length,
      banned_count: bannedCount,
      failures,
    }, { headers: corsHeaders });
  }

  if (action === "close_trade") {
    const userId = String(body.target_user_id ?? "").trim();
    const tradeId = String(body.trade_id ?? "").trim();
    if (!userId || !tradeId) return bad(400, "target_user_id and trade_id are required");
    const before = await snapshotById(supabase, "trades", "id", tradeId);
    const { data, error } = await supabase
      .from("trades")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
      })
      .eq("id", tradeId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!data) return bad(404, "Trade not found");
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "trades",
      entity_id: tradeId,
      reason,
      before_state: before,
      after_state: data as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, trade: data }, { headers: corsHeaders });
  }

  if (action === "force_disconnect_broker" || action === "force_reconnect_broker") {
    const userId = String(body.target_user_id ?? "").trim();
    const brokerId = String(body.broker_id ?? "").trim();
    if (!userId || !brokerId) return bad(400, "target_user_id and broker_id are required");
    const before = await snapshotById(supabase, "broker_accounts", "id", brokerId);
    const status = action === "force_disconnect_broker" ? "error" : "pending";
    const { data, error } = await supabase
      .from("broker_accounts")
      .update({
        connection_status: status,
        connection_error_kind: action === "force_disconnect_broker" ? "admin_forced_disconnect" : null,
        connection_error_message: action === "force_disconnect_broker" ? "Disconnected by admin" : null,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", brokerId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!data) return bad(404, "Broker not found");
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "broker_accounts",
      entity_id: brokerId,
      reason,
      before_state: before,
      after_state: data as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, broker: data }, { headers: corsHeaders });
  }

  if (action === "toggle_channel") {
    const userId = String(body.target_user_id ?? "").trim();
    const channelId = String(body.channel_id ?? "").trim();
    const isActive = Boolean(body.is_active);
    if (!userId || !channelId) return bad(400, "target_user_id and channel_id are required");
    const before = await snapshotById(supabase, "telegram_channels", "id", channelId);
    const { data, error } = await supabase
      .from("telegram_channels")
      .update({ is_active: isActive })
      .eq("id", channelId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!data) return bad(404, "Channel not found");
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "telegram_channels",
      entity_id: channelId,
      reason,
      before_state: before,
      after_state: data as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, channel: data }, { headers: corsHeaders });
  }

  if (action === "toggle_broker") {
    const userId = String(body.target_user_id ?? "").trim();
    const brokerId = String(body.broker_id ?? "").trim();
    const isActive = Boolean(body.is_active);
    if (!userId || !brokerId) return bad(400, "target_user_id and broker_id are required");
    const before = await snapshotById(supabase, "broker_accounts", "id", brokerId);
    const { data, error } = await supabase
      .from("broker_accounts")
      .update({ is_active: isActive })
      .eq("id", brokerId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!data) return bad(404, "Broker not found");
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "broker_accounts",
      entity_id: brokerId,
      reason,
      before_state: before,
      after_state: data as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, broker: data }, { headers: corsHeaders });
  }

  if (action === "override_broker_config") {
    const userId = String(body.target_user_id ?? "").trim();
    const brokerId = String(body.broker_id ?? "").trim();
    if (!userId || !brokerId) return bad(400, "target_user_id and broker_id are required");
    const patch = (body.patch && typeof body.patch === "object" && !Array.isArray(body.patch))
      ? body.patch as Record<string, unknown>
      : null;
    if (!patch) return bad(400, "patch object is required");
    const allowedKeys = new Set(["manual_settings", "ai_settings", "channel_trading_configs", "copier_mode", "signal_channel_ids"]);
    const payload: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(patch)) {
      if (allowedKeys.has(key)) payload[key] = val;
    }
    if (Object.keys(payload).length === 0) return bad(400, "No allowed fields in patch");
    const before = await snapshotById(supabase, "broker_accounts", "id", brokerId);
    const { data, error } = await supabase
      .from("broker_accounts")
      .update(payload)
      .eq("id", brokerId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!data) return bad(404, "Broker not found");
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: userId,
      action,
      entity_type: "broker_accounts",
      entity_id: brokerId,
      reason,
      request_payload: payload,
      before_state: before,
      after_state: data as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, broker: data }, { headers: corsHeaders });
  }

  if (action === "affiliate_mark_paid") {
    const ledgerIds = Array.isArray(body.ledger_ids)
      ? body.ledger_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (ledgerIds.length === 0) return bad(400, "ledger_ids is required");
    const periodLabel = String(body.period_label ?? "").trim() || new Date().toISOString().slice(0, 7);
    const notes = String(body.notes ?? "").trim() || null;

    const { data: rows, error: loadErr } = await supabase
      .from("commission_ledger")
      .select("*")
      .in("id", ledgerIds);
    if (loadErr) return bad(400, loadErr.message);
    const pendingRows = (rows ?? []).filter((r) =>
      r.status === "pending" || r.status === "approved"
    );
    if (pendingRows.length === 0) return bad(400, "No payable commission rows found");
    const totalCents = pendingRows.reduce((sum, row) => sum + (Number(row.commission_cents ?? 0) || 0), 0);

    const { data: batch, error: batchErr } = await supabase
      .from("payout_batches")
      .insert({
        period_label: periodLabel,
        total_cents: totalCents,
        status: "paid",
        paid_at: new Date().toISOString(),
        notes,
        created_by_admin: adminUser.id,
      })
      .select("*")
      .single();
    if (batchErr) return bad(400, batchErr.message);

    const { error: upErr } = await supabase
      .from("commission_ledger")
      .update({ status: "paid", payout_batch_id: batch.id })
      .in("id", pendingRows.map((r) => String(r.id)));
    if (upErr) return bad(400, upErr.message);

    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      target_user_id: null,
      action,
      entity_type: "commission_ledger",
      entity_id: String(batch.id),
      reason,
      request_payload: { ledger_ids: ledgerIds, period_label: periodLabel, notes },
      before_state: { count: pendingRows.length, total_cents: totalCents },
      after_state: { payout_batch_id: batch.id, status: "paid" },
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, payout_batch: batch }, { headers: corsHeaders });
  }

  if (action === "acknowledge_alert") {
    const eventId = String(body.alert_event_id ?? "").trim();
    if (!eventId) return bad(400, "alert_event_id is required");
    const before = await snapshotById(supabase, "alert_events", "id", eventId);
    if (!before) return bad(404, "Alert event not found");
    if (before.state !== "firing") return bad(409, "Only firing alerts can be acknowledged");
    const { data, error } = await supabase
      .from("alert_events")
      .update({
        state: "acknowledged",
        acknowledged_by: adminUser.id,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", eventId)
      .eq("state", "firing")
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!data) return bad(409, "Alert event changed state, reload and try again");
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      action,
      entity_type: "alert_events",
      entity_id: eventId,
      reason,
      before_state: before,
      after_state: data as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, alert_event: data }, { headers: corsHeaders });
  }

  if (action === "update_alert_rule") {
    const code = String(body.code ?? "").trim();
    if (!code) return bad(400, "code is required");
    const before = await snapshotById(supabase, "alert_rules", "code", code);
    if (!before) return bad(404, "Alert rule not found");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.name !== undefined) patch.name = String(body.name).trim().slice(0, 120);
    if (body.description !== undefined) patch.description = String(body.description).trim().slice(0, 600);
    if (body.severity !== undefined) {
      const severity = String(body.severity);
      if (!["info", "warning", "critical"].includes(severity)) return bad(400, "severity must be info, warning or critical");
      patch.severity = severity;
    }
    if (body.threshold !== undefined) {
      if (typeof body.threshold !== "object" || body.threshold === null || Array.isArray(body.threshold)) {
        return bad(400, "threshold must be an object");
      }
      patch.threshold = body.threshold;
    }
    if (body.window_minutes !== undefined) {
      const minutes = Number(body.window_minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return bad(400, "window_minutes must be 1..1440");
      patch.window_minutes = minutes;
    }
    if (body.cooldown_seconds !== undefined) {
      const seconds = Number(body.cooldown_seconds);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) return bad(400, "cooldown_seconds must be 0..86400");
      patch.cooldown_seconds = seconds;
    }

    const { data, error } = await supabase
      .from("alert_rules")
      .update(patch)
      .eq("code", code)
      .select("*")
      .maybeSingle();
    if (error) return bad(400, error.message);
    if (!data) return bad(404, "Alert rule not found");
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      action,
      entity_type: "alert_rules",
      entity_id: code,
      reason,
      before_state: before,
      after_state: data as Record<string, unknown>,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, rule: data }, { headers: corsHeaders });
  }

  if (action === "upsert_alert_recipient") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(400, "email is not valid");
    const minSeverity = String(body.min_severity ?? "warning");
    if (!["info", "warning", "critical"].includes(minSeverity)) return bad(400, "min_severity must be info, warning or critical");
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
    const before = await snapshotById(supabase, "alert_recipients", "email", email);
    const { data, error } = await supabase
      .from("alert_recipients")
      .upsert({ email, min_severity: minSeverity, enabled }, { onConflict: "email" })
      .select("*")
      .single();
    if (error) return bad(400, error.message);
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      action,
      entity_type: "alert_recipients",
      entity_id: String(data.id),
      reason,
      before_state: before as Record<string, unknown> | null,
      after_state: data as Record<string, unknown>,
      request_payload: { email, min_severity: minSeverity, enabled },
      correlation_id: correlationId,
    });
    return Response.json({ ok: true, recipient: data }, { headers: corsHeaders });
  }

  if (action === "delete_alert_recipient") {
    const id = String(body.recipient_id ?? "").trim();
    if (!id) return bad(400, "recipient_id is required");
    const before = await snapshotById(supabase, "alert_recipients", "id", id);
    if (!before) return bad(404, "Recipient not found");
    const { error } = await supabase.from("alert_recipients").delete().eq("id", id);
    if (error) return bad(400, error.message);
    await writeAdminAudit(supabase, {
      actor_user_id: adminUser.id,
      action,
      entity_type: "alert_recipients",
      entity_id: id,
      reason,
      before_state: before,
      correlation_id: correlationId,
    });
    return Response.json({ ok: true }, { headers: corsHeaders });
  }

  return bad(400, "Unknown action");
});
