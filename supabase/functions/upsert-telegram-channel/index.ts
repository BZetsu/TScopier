import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertTelegramChannelLimit,
  loadUserSubscription,
} from "../_shared/subscriptionAccess.ts";
import {
  isNumericTelegramChatId,
  normalizeTelegramChatId,
} from "../_shared/telegramChannelIdentity.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

type ChannelUpsertInput = {
  channel_id?: string;
  channel_username?: string;
  display_name?: string;
  is_active?: boolean;
  lot_size_override?: number | null;
  pip_tolerance_override?: number | null;
};

function bad(status: number, msg: string, code?: string) {
  return Response.json(
    { error: msg, ...(code ? { code } : {}) },
    { status, headers: corsHeaders },
  );
}

function canonicalChatId(raw: string): string {
  return isNumericTelegramChatId(raw) ? normalizeTelegramChatId(raw) : raw.trim();
}

async function resolveSignalChannelId(
  supabase: ReturnType<typeof createClient>,
  input: { telegramChatId: string; channelUsername: string; displayName: string },
): Promise<{ signalChannelId: string | null; error: string | null }> {
  const telegramChatId = canonicalChatId(input.telegramChatId);
  if (!telegramChatId || !isNumericTelegramChatId(telegramChatId)) {
    return { signalChannelId: null, error: null };
  }

  const { data, error } = await supabase
    .from("signal_channels")
    .upsert(
      {
        telegram_chat_id: telegramChatId,
        channel_username: input.channelUsername.replace(/^@/, "").toLowerCase(),
        display_name: input.displayName.trim() || telegramChatId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "telegram_chat_id" },
    )
    .select("id")
    .single();

  if (error) return { signalChannelId: null, error: error.message };
  return { signalChannelId: (data as { id: string }).id, error: null };
}

function planLimitMessage(message: string): string {
  const idx = message.indexOf(": ");
  if (idx > 0 && /^(channel_limit|subscription_required|broker_account_limit)\b/.test(message)) {
    return message.slice(idx + 2);
  }
  return message;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!token) return bad(401, "Unauthorized");
    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData.user) return bad(401, "Unauthorized");
    const userId = authData.user.id;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const rawList = Array.isArray(body.channels)
      ? body.channels as ChannelUpsertInput[]
      : body.channel && typeof body.channel === "object"
      ? [body.channel as ChannelUpsertInput]
      : [];

    if (rawList.length === 0) {
      return bad(400, "channels required");
    }
    if (rawList.length > 50) {
      return bad(400, "Too many channels in one request");
    }

    const prepared: Array<{
      channelId: string;
      username: string;
      displayName: string;
      isActive: boolean;
      lotSizeOverride?: number | null;
      pipToleranceOverride?: number | null;
      existingId: string | null;
      existingActive: boolean;
    }> = [];

    for (const item of rawList) {
      const channelIdRaw = String(item.channel_id ?? "").trim();
      const username = String(item.channel_username ?? "").replace(/^@/, "").trim();
      const displayName = String(item.display_name ?? "").trim();
      if (!displayName) return bad(400, "display_name required");
      if (!channelIdRaw && !username) {
        return bad(400, "channel_id or channel_username required");
      }
      const channelId = channelIdRaw || username;
      const { data: existing } = await supabase
        .from("telegram_channels")
        .select("id, is_active")
        .eq("user_id", userId)
        .eq("channel_id", channelId)
        .maybeSingle();

      prepared.push({
        channelId,
        username,
        displayName,
        isActive: item.is_active !== false,
        lotSizeOverride: item.lot_size_override,
        pipToleranceOverride: item.pip_tolerance_override,
        existingId: existing?.id ?? null,
        existingActive: existing?.is_active === true,
      });
    }

    const slotsNeeded = prepared.reduce((n, row) => {
      if (!row.isActive) return n;
      if (row.existingActive) return n;
      return n + 1;
    }, 0);

    if (slotsNeeded > 0) {
      const sub = await loadUserSubscription(supabase, userId);
      const denied = await assertTelegramChannelLimit(supabase, userId, sub, {
        slotsNeeded,
      });
      if (denied) {
        const payload = await denied.json().catch(() => ({
          error: "Telegram channel limit reached",
          code: "channel_limit",
        })) as { error?: string; code?: string };
        return bad(
          denied.status,
          payload.error ?? "Telegram channel limit reached",
          payload.code,
        );
      }
    }

    const upserted: unknown[] = [];
    for (const row of prepared) {
      const resolved = await resolveSignalChannelId(supabase, {
        telegramChatId: row.channelId,
        channelUsername: row.username,
        displayName: row.displayName,
      });
      if (resolved.error) return bad(500, resolved.error);

      const payload: Record<string, unknown> = {
        user_id: userId,
        channel_id: row.channelId,
        channel_username: row.username,
        display_name: row.displayName,
        is_active: row.isActive,
        updated_at: new Date().toISOString(),
      };
      if (resolved.signalChannelId) payload.signal_channel_id = resolved.signalChannelId;
      if (row.lotSizeOverride !== undefined) payload.lot_size_override = row.lotSizeOverride;
      if (row.pipToleranceOverride !== undefined) {
        payload.pip_tolerance_override = row.pipToleranceOverride;
      }

      const { data, error } = await supabase
        .from("telegram_channels")
        .upsert(payload, { onConflict: "user_id,channel_id" })
        .select("*")
        .single();

      if (error) {
        const msg = planLimitMessage(error.message);
        const code = /channel_limit/i.test(error.message)
          ? "channel_limit"
          : /subscription_required/i.test(error.message)
          ? "subscription_required"
          : undefined;
        return bad(code ? 403 : 500, msg, code);
      }
      upserted.push(data);
    }

    return Response.json(
      { ok: true, channels: upserted },
      { headers: corsHeaders },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return bad(500, msg);
  }
});
