import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, requireAuthedAdmin } from "../_shared/adminAuth.ts";
import { isAdminAccessActive } from "../_shared/adminAccess.ts";
import { isSuspiciousSignupEmail } from "../_shared/emailSignupPolicy.ts";

function bad(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: corsHeaders });
}

// PostgREST builders are thenable rather than strictly Promise-typed, so this
// accepts PromiseLike — otherwise every `supabase.from(...)` call fails deno check.
async function optionalRows(
  query: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<unknown[]> {
  const { data, error } = await query;
  if (error) return [];
  return data ?? [];
}

/** Like optionalRows, but propagates the query error so a broken relation is
 * reported instead of silently rendering as an empty account. */
async function requiredRows(
  query: PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<Record<string, unknown>>;
}

/** Closed-trade profit in one currency. `net: null` means no closed trade in
 * this bucket ever recorded a profit, so the UI shows a dash rather than $0.00. */
interface ProfitBucket {
  currency: string | null;
  unlinked: boolean;
  closed_trades: number;
  net: number | null;
  recorded: number;
  unknown: number;
}

/**
 * Emails for a set of user ids.
 *
 * `listUsers` pages 1000 at a time and returns the newest first, so a single
 * page silently misses older accounts — which is exactly the churned cohort.
 * Walk pages until every requested id is found or a short page is reached.
 */
async function fetchAuthEmails(
  supabase: ReturnType<typeof adminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  const wanted = new Set(ids.filter(Boolean));
  const found = new Map<string, string>();
  if (wanted.size === 0) return found;

  for (let page = 1; page <= 10 && found.size < wanted.size; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) break;
    const users = data?.users ?? [];
    for (const u of users) {
      if (wanted.has(u.id)) found.set(u.id, u.email ?? "");
    }
    if (users.length < 1000) break;
  }
  return found;
}

/**
 * Closed-trade profit for a user, bucketed per currency.
 *
 * Two rules drive the shape of this:
 *  - Money is never summed across currencies (broker accounts, including demo
 *    ones, are denominated differently), so each currency gets its own row.
 *  - PostgREST caps a response at `db.max_rows` (1000 by default), so a single
 *    request would silently truncate. We page instead — and with keyset
 *    pagination on the uuid primary key, because offset paging over random uuids
 *    can double-count a boundary row when trades land mid-read.
 *
 * `capped` is true when the safety valve stopped the scan early, so the caller
 * can label the figures as a lower bound rather than presenting them as exact.
 */
async function sumClosedTradeProfit(
  supabase: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ buckets: ProfitBucket[]; capped: boolean }> {
  const pageSize = 1000;
  const maxPages = 20; // safety valve: 20k trades

  const accounts = await requiredRows(
    supabase.from("broker_accounts").select("id, last_currency").eq("user_id", userId),
  );
  const currencyOf = new Map<string, string | null>();
  for (const a of accounts) {
    currencyOf.set(String(a.id), a.last_currency ? String(a.last_currency) : null);
  }

  const buckets = new Map<string, ProfitBucket>();
  let lastId: string | null = null;
  let capped = false;

  for (let page = 0; page < maxPages; page++) {
    let query = supabase
      .from("trades")
      .select("id, profit, broker_account_id")
      .eq("user_id", userId)
      .not("closed_at", "is", null)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (lastId) query = query.gt("id", lastId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<{ id: string; profit: unknown; broker_account_id: string | null }>;
    for (const row of rows) {
      const linked = Boolean(row.broker_account_id);
      const currency = linked ? (currencyOf.get(String(row.broker_account_id)) ?? null) : null;
      const key = `${linked ? "linked" : "unlinked"}:${currency ?? ""}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { currency, unlinked: !linked, closed_trades: 0, net: null, recorded: 0, unknown: 0 };
        buckets.set(key, bucket);
      }
      bucket.closed_trades += 1;
      const n = row.profit == null ? NaN : Number(row.profit);
      if (Number.isFinite(n)) {
        bucket.net = (bucket.net ?? 0) + n;
        bucket.recorded += 1;
      } else {
        bucket.unknown += 1;
      }
    }

    if (rows.length < pageSize) break;
    lastId = rows[rows.length - 1].id;
    if (page === maxPages - 1) capped = true;
  }

  const out = [...buckets.values()].map((b) => ({
    ...b,
    net: b.recorded ? Math.round((b.net ?? 0) * 100) / 100 : null,
  }));
  out.sort((a, b) => String(a.currency ?? "~").localeCompare(String(b.currency ?? "~")));
  return { buckets: out, capped };
}

async function countRecentSignups(
  supabase: ReturnType<typeof adminClient>,
  sinceIso: string,
): Promise<{ total: number; suspicious: number }> {
  let total = 0;
  let suspicious = 0;
  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage });
    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const user of users) {
      const createdAt = user.created_at ? Date.parse(user.created_at) : 0;
      if (!createdAt || createdAt < Date.parse(sinceIso)) continue;
      total += 1;
      if (user.email && isSuspiciousSignupEmail(user.email)) {
        suspicious += 1;
      }
    }

    if (users.length < perPage) break;
    page += 1;
  }

  return { total, suspicious };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return bad(405, "Method not allowed");

  const supabase = adminClient();
  const adminCheck = await requireAuthedAdmin(req, supabase);
  if ("error" in adminCheck) return adminCheck.error;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "overview") {
    const { todayStart, tomorrowStart } = (() => {
      const now = new Date();
      const s = new Date(now);
      s.setHours(0, 0, 0, 0);
      const e = new Date(s);
      e.setDate(e.getDate() + 1);
      return { todayStart: s.toISOString(), tomorrowStart: e.toISOString() };
    })();

    const [
      usersRes,
      brokersRes,
      openTradesRes,
      closedTodayRes,
      channelsRes,
      subsRes,
      signupHour,
      signupDay,
    ] = await Promise.all([
      supabase.from("user_profiles").select("user_id", { count: "exact", head: true }),
      supabase.from("broker_accounts").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("trades").select("id", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("trades").select("id", { count: "exact", head: true })
        .eq("status", "closed")
        .gte("closed_at", todayStart)
        .lt("closed_at", tomorrowStart),
      supabase.from("telegram_channels").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
      countRecentSignups(supabase, new Date(Date.now() - 60 * 60 * 1000).toISOString()),
      countRecentSignups(supabase, todayStart),
    ]);

    return Response.json({
      stats: {
        total_users: usersRes.count ?? 0,
        active_brokers: brokersRes.count ?? 0,
        open_trades: openTradesRes.count ?? 0,
        closed_trades_today: closedTodayRes.count ?? 0,
        active_channels: channelsRes.count ?? 0,
        active_subscriptions: subsRes.count ?? 0,
        signups_last_hour: signupHour.total,
        suspicious_signups_last_hour: signupHour.suspicious,
        signups_today: signupDay.total,
        suspicious_signups_today: signupDay.suspicious,
      },
    }, { headers: corsHeaders });
  }

  if (action === "users_list") {
    const search = String(body.search ?? "").trim().toLowerCase();
    const rows = await optionalRows(
      supabase.from("user_profiles")
        .select("user_id,display_name,first_name,last_name,subscription_status,is_admin,admin_until,created_at,base_currency")
        .order("created_at", { ascending: false })
        .limit(200),
    ) as Array<Record<string, unknown>>;
    const userIds = rows.map((r) => String(r.user_id ?? "")).filter(Boolean);

    const brokers = userIds.length
      ? await optionalRows(
        supabase.from("broker_accounts")
          .select("user_id,last_balance,last_equity")
          .in("user_id", userIds),
      ) as Array<Record<string, unknown>>
      : [];

    const balanceByUser = new Map<string, number>();
    for (const broker of brokers) {
      const uid = String(broker.user_id ?? "");
      const bal = Number(broker.last_balance ?? broker.last_equity ?? 0);
      if (!uid || !Number.isFinite(bal)) continue;
      balanceByUser.set(uid, (balanceByUser.get(uid) ?? 0) + bal);
    }

    const emailByUser = new Map<string, string>();
    if (userIds.length > 0) {
      const wanted = new Set(userIds);
      let page = 1;
      const perPage = 1000;
      while (wanted.size > emailByUser.size && page <= 10) {
        const { data: authPage } = await supabase.auth.admin.listUsers({ page, perPage });
        const authUsers = authPage?.users ?? [];
        for (const authUser of authUsers) {
          if (wanted.has(authUser.id)) {
            emailByUser.set(authUser.id, authUser.email ?? "");
          }
        }
        if (authUsers.length < perPage) break;
        page += 1;
      }
    }

    const users = rows.map((r) => {
      const uid = String(r.user_id ?? "");
      const first = String(r.first_name ?? "").trim();
      const last = String(r.last_name ?? "").trim();
      const name = [first, last].filter(Boolean).join(" ")
        || String(r.display_name ?? "").trim()
        || "Unnamed user";
      return {
        user_id: uid,
        name,
        email: emailByUser.get(uid) ?? "",
        created_at: r.created_at,
        total_balance: balanceByUser.get(uid) ?? 0,
        base_currency: String(r.base_currency ?? "USD"),
        subscription_status: r.subscription_status ?? null,
        is_admin: r.is_admin === true,
        admin_until: r.admin_until ?? null,
        admin_active: isAdminAccessActive({
          is_admin: r.is_admin === true,
          admin_until: r.admin_until as string | null | undefined,
        }),
      };
    });

    const filtered = search
      ? users.filter((u) =>
        u.user_id.toLowerCase().includes(search) ||
        u.name.toLowerCase().includes(search) ||
        u.email.toLowerCase().includes(search)
      )
      : users;
    return Response.json({ users: filtered }, { headers: corsHeaders });
  }

  if (action === "user_360") {
    const userId = String(body.target_user_id ?? "").trim();
    if (!userId) return bad(400, "target_user_id is required");

    const [
      profileRes,
      brokersRes,
      channelsRes,
      tradesRes,
      subRes,
      backtests,
      copierLogs,
    ] = await Promise.all([
      supabase.from("user_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("broker_accounts").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("telegram_channels").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase.from("trades").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(200),
      supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
      optionalRows(
        supabase.from("backtest_runs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
      ),
      optionalRows(
        supabase.from("trade_execution_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
      ),
    ]);

    const trades = (tradesRes.data ?? []) as Array<Record<string, unknown>>;
    const totalBalance = (brokersRes.data ?? []).reduce((sum, b) => {
      const n = Number((b as Record<string, unknown>).last_balance ?? 0);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    const openPnl = trades.filter((t) => t.status === "open").reduce((sum, t) => {
      const n = Number(t.profit ?? 0);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tradesToday = trades.filter((t) => {
      const openedAt = new Date(String(t.opened_at ?? t.created_at ?? "")).getTime();
      return Number.isFinite(openedAt) && openedAt >= todayStart.getTime();
    });
    const todayProfit = tradesToday.reduce((sum, t) => sum + (Number(t.profit ?? 0) || 0), 0);

    return Response.json({
      profile: profileRes.data ?? null,
      subscription: subRes.data ?? null,
      stats: {
        total_balance: totalBalance,
        today_profit: todayProfit,
        trades_taken_today: tradesToday.length,
        open_pnl: openPnl,
        connected_accounts: brokersRes.data?.length ?? 0,
        telegram_channels: channelsRes.data?.length ?? 0,
      },
      brokers: brokersRes.data ?? [],
      channels: channelsRes.data ?? [],
      backtests,
      copier_logs: copierLogs,
    }, { headers: corsHeaders });
  }

  if (action === "user_trades") {
    const userId = String(body.target_user_id ?? "").trim();
    if (!userId) return bad(400, "target_user_id is required");
    const pageRaw = Number(body.page ?? 1);
    const pageSizeRaw = Number(body.page_size ?? 20);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
      ? Math.min(Math.floor(pageSizeRaw), 100)
      : 20;
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabase
      .from("trades")
      .select("id,symbol,status,profit,opened_at,created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) return bad(400, error.message);
    const total = count ?? 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

    return Response.json({
      trades: data ?? [],
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
    }, { headers: corsHeaders });
  }

  if (action === "trades_recent") {
    const trades = await optionalRows(
      supabase.from("trades").select("id,user_id,symbol,status,profit,created_at").order("created_at", { ascending: false }).limit(500),
    );
    return Response.json({ trades }, { headers: corsHeaders });
  }

  if (action === "channels_recent") {
    const channels = await optionalRows(
      supabase.from("telegram_channels").select("id,user_id,display_name,is_active").order("created_at", { ascending: false }).limit(300),
    );
    return Response.json({ channels }, { headers: corsHeaders });
  }

  if (action === "backtests_recent") {
    const backtests = await optionalRows(
      supabase.from("backtest_runs").select("id,user_id,status,created_at").order("created_at", { ascending: false }).limit(200),
    );
    return Response.json({ backtests }, { headers: corsHeaders });
  }

  if (action === "copier_logs_recent") {
    const logs = await optionalRows(
      supabase.from("trade_execution_logs")
        .select("id,user_id,channel_id,action,status,error_message,created_at")
        .order("created_at", { ascending: false })
        .limit(300),
    );
    return Response.json({ logs }, { headers: corsHeaders });
  }

  if (action === "affiliate_payouts_overview") {
    const status = String(body.status ?? "pending");
    const ledger = await optionalRows(
      supabase
        .from("commission_ledger")
        .select("*")
        .eq("status", status)
        .order("created_at", { ascending: true })
        .limit(500),
    ) as Array<Record<string, unknown>>;

    const affiliateIds = [...new Set(ledger.map((r) => String(r.affiliate_user_id ?? "")).filter(Boolean))];
    const referredIds = [...new Set(ledger.map((r) => String(r.referred_user_id ?? "")).filter(Boolean))];
    const allUserIds = [...new Set([...affiliateIds, ...referredIds])];

    const profiles = allUserIds.length > 0
      ? await optionalRows(
        supabase
          .from("user_profiles")
          .select("user_id,display_name,first_name,last_name")
          .in("user_id", allUserIds),
      ) as Array<Record<string, unknown>>
      : [];

    const profileName = new Map<string, string>();
    for (const p of profiles) {
      const id = String(p.user_id ?? "");
      if (!id) continue;
      const first = String(p.first_name ?? "").trim();
      const last = String(p.last_name ?? "").trim();
      const display = String(p.display_name ?? "").trim();
      const name = [first, last].filter(Boolean).join(" ").trim() || display || "User";
      profileName.set(id, name);
    }

    const payouts = ledger.map((row): Record<string, unknown> => ({
      ...row,
      affiliate_name: profileName.get(String(row.affiliate_user_id ?? "")) ?? "User",
      referred_name: profileName.get(String(row.referred_user_id ?? "")) ?? "User",
    }));
    const totalPendingCents = payouts.reduce((sum, row) => sum + (Number(row.commission_cents ?? 0) || 0), 0);

    return Response.json(
      {
        payouts,
        totals: {
          count: payouts.length,
          total_pending_cents: totalPendingCents,
        },
      },
      { headers: corsHeaders },
    );
  }

  if (action === "churned_users_list") {
    // requiredRows rather than optionalRows: a missing migration or a broken
    // RPC has to surface as an error, not render as "No churned users found."
    try {
      const rows = await requiredRows(supabase.rpc("get_churned_users"));
      const userIds = rows.map((r) => String(r.user_id ?? "")).filter(Boolean);
      const emailByUser = await fetchAuthEmails(supabase, userIds);

      const users = rows.map((row) => ({
        ...row,
        email: emailByUser.get(String(row.user_id ?? "")) ?? "",
      }));

      return Response.json({ users }, { headers: corsHeaders });
    } catch (e) {
      return Response.json(
        { users: [], error: e instanceof Error ? e.message : "failed to load churned users" },
        { status: 500, headers: corsHeaders },
      );
    }
  }

  if (action === "user_account_details") {
    const userId = String(body.user_id ?? "").trim();
    if (!userId) return bad(400, "user_id is required");

    try {
      const [
        profileRows, subRows, payRows, extRows, codeRows, auditRows,
        tradeCountRes, closedCountRes, oldestRows, newestRows, profit,
      ] = await Promise.all([
        requiredRows(supabase.from("user_profiles").select("*").eq("user_id", userId).limit(1)),
        requiredRows(
          supabase.from("subscriptions").select("*").eq("user_id", userId)
            .order("created_at", { ascending: false }).limit(10),
        ),
        requiredRows(
          supabase.from("invoice_payments").select("*").eq("user_id", userId)
            .order("created_at", { ascending: false }).limit(50),
        ),
        requiredRows(
          supabase.from("subscription_extensions").select("*").eq("user_id", userId)
            .order("granted_at", { ascending: false }).limit(50),
        ),
        requiredRows(
          supabase.from("subscription_recovery_codes")
            .select("id, code, days, used, used_at, expires_at, created_at, sent_at, sent_email")
            .eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
        ),
        requiredRows(
          supabase.from("admin_audit_logs")
            .select("id, action, entity_type, entity_id, reason, created_at, actor_user_id, request_payload")
            .eq("target_user_id", userId).order("created_at", { ascending: false }).limit(50),
        ),
        supabase.from("trades").select("id", { count: "exact", head: true }).eq("user_id", userId),
        supabase.from("trades").select("id", { count: "exact", head: true })
          .eq("user_id", userId).not("closed_at", "is", null),
        requiredRows(
          supabase.from("trades").select("opened_at").eq("user_id", userId)
            .order("opened_at", { ascending: true }).limit(1),
        ),
        requiredRows(
          supabase.from("trades").select("opened_at").eq("user_id", userId)
            .order("opened_at", { ascending: false }).limit(1),
        ),
        sumClosedTradeProfit(supabase, userId),
      ]);

      if (tradeCountRes.error) throw new Error(tradeCountRes.error.message);
      if (closedCountRes.error) throw new Error(closedCountRes.error.message);

      // user_profiles has no email column — the address lives in auth.
      const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(userId);
      if (authErr) throw new Error(authErr.message);

      const usage = {
        trades_total: tradeCountRes.count ?? 0,
        trades_closed: closedCountRes.count ?? 0,
        profit_by_currency: profit.buckets,
        profit_capped: profit.capped,
        first_trade_at: oldestRows[0]?.opened_at ?? null,
        last_trade_at: newestRows[0]?.opened_at ?? null,
      };

      return Response.json(
        {
          user_id: userId,
          email: authUser?.user?.email ?? null,
          profile: profileRows[0] ?? null,
          subscription: subRows[0] ?? null,
          subscriptions: subRows,
          payments: payRows,
          extensions: extRows,
          recovery_codes: codeRows,
          audit_logs: auditRows,
          usage,
        },
        { headers: corsHeaders },
      );
    } catch (e) {
      // A failed read is a server-side fault, not a bad request.
      return Response.json(
        { error: e instanceof Error ? e.message : "failed to load account details" },
        { status: 500, headers: corsHeaders },
      );
    }
  }

  if (action === "recovery_codes_list") {
    const rows = await optionalRows(
      supabase
        .from("subscription_recovery_codes")
        .select("id, user_id, code, days, used, used_at, expires_at, created_at, sent_at, sent_email, email_subject")
        .order("created_at", { ascending: false })
        .limit(500),
    ) as Array<Record<string, unknown>>;

    const userIds = [...new Set(rows.map((r) => String(r.user_id ?? "")).filter(Boolean))];
    const profiles = userIds.length > 0
      ? await optionalRows(
        supabase.from("user_profiles").select("user_id,display_name,first_name,last_name").in("user_id", userIds),
      ) as Array<Record<string, unknown>>
      : [];

    const profileName = new Map<string, string>();
    for (const p of profiles) {
      const id = String(p.user_id ?? "");
      if (!id) continue;
      const first = String(p.first_name ?? "").trim();
      const last = String(p.last_name ?? "").trim();
      const display = String(p.display_name ?? "").trim();
      profileName.set(id, [first, last].filter(Boolean).join(" ").trim() || display || "User");
    }

    const emailByUser = new Map<string, string>();
    try {
      const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of (authData?.users ?? [])) {
        if (userIds.includes(u.id)) emailByUser.set(u.id, u.email ?? "");
      }
    } catch { /* email lookup is best-effort */ }

    const codes = rows.map((row) => {
      const uid = String(row.user_id ?? "");
      return {
        ...row,
        user_name: profileName.get(uid) || "User",
        user_email: emailByUser.get(uid) || "",
        is_used: row.used === true,
        expired: row.expires_at ? new Date(String(row.expires_at)).getTime() <= Date.now() : false,
        sent: row.sent_at != null,
      };
    });

    return Response.json({ codes }, { headers: corsHeaders });
  }

  if (action === "recovery_audit_logs") {
    const rows = await optionalRows(
      supabase
        .from("admin_audit_logs")
        .select("id, actor_user_id, target_user_id, action, entity_type, entity_id, reason, request_payload, before_state, after_state, correlation_id, created_at")
        .in("action", ["generate_recovery_code", "bulk_generate_recovery_codes", "revoke_recovery_code", "revoke_all_recovery_codes", "send_recovery_emails"])
        .order("created_at", { ascending: false })
        .limit(500),
    ) as Array<Record<string, unknown>>;

    const actorIds = [...new Set(rows.map((r) => String(r.actor_user_id ?? "")).filter(Boolean))];
    const targetIds = [...new Set(rows.map((r) => String(r.target_user_id ?? "")).filter(Boolean))];
    const allUserIds = [...new Set([...actorIds, ...targetIds])];

    const profiles = allUserIds.length > 0
      ? await optionalRows(
        supabase.from("user_profiles").select("user_id,display_name,first_name,last_name").in("user_id", allUserIds),
      ) as Array<Record<string, unknown>>
      : [];

    const profileName = new Map<string, string>();
    for (const p of profiles) {
      const id = String(p.user_id ?? "");
      if (!id) continue;
      const first = String(p.first_name ?? "").trim();
      const last = String(p.last_name ?? "").trim();
      const display = String(p.display_name ?? "").trim();
      profileName.set(id, [first, last].filter(Boolean).join(" ").trim() || display || "User");
    }

    const emailByUser = new Map<string, string>();
    try {
      const { data: authData } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      for (const u of (authData?.users ?? [])) {
        if (allUserIds.includes(u.id)) emailByUser.set(u.id, u.email ?? "");
      }
    } catch { /* email lookup is best-effort */ }

    const logs = rows.map((row) => {
      const actorId = String(row.actor_user_id ?? "");
      const targetId = String(row.target_user_id ?? "");
      return {
        ...row,
        actor_name: profileName.get(actorId) || "User",
        actor_email: emailByUser.get(actorId) || "",
        target_name: targetId ? (profileName.get(targetId) || "User") : "",
        target_email: targetId ? (emailByUser.get(targetId) || "") : "",
        code: row.entity_id ?? "",
      };
    });

    return Response.json({ logs }, { headers: corsHeaders });
  }

  return bad(400, "Unknown action");
});
