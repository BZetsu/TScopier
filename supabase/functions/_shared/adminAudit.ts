import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type AdminAuditEntry = {
  actor_user_id: string;
  target_user_id?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  reason?: string | null;
  request_payload?: Record<string, unknown> | null;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  correlation_id?: string | null;
};

export async function writeAdminAudit(
  supabase: SupabaseClient,
  entry: AdminAuditEntry,
): Promise<void> {
  const { error } = await supabase.from("admin_audit_logs").insert({
    actor_user_id: entry.actor_user_id,
    target_user_id: entry.target_user_id ?? null,
    action: entry.action,
    entity_type: entry.entity_type ?? null,
    entity_id: entry.entity_id ?? null,
    reason: entry.reason ?? null,
    request_payload: entry.request_payload ?? null,
    before_state: entry.before_state ?? null,
    after_state: entry.after_state ?? null,
    correlation_id: entry.correlation_id ?? null,
  });
  if (error) {
    console.warn("[admin-audit] failed:", error.message);
  }
}
