/*
  # basket_sl_tp_targets — order by instruction time, not write time

  Bugfix: the store used "latest WRITE wins" (updated_at = now()). Signals are
  processed out of order (retries, reconcile jobs, multi-shard, 15 accounts), so
  an OLDER instruction reprocessed AFTER a newer one clobbered the target — e.g.
  "SL 4095" (param follow-up) overwriting a later "Adjust SL to 4090", producing
  a 4095<->4090 flip-flop.

  Fix: record instruction_at (the source signal's created_at, or the auto-BE
  time) and only overwrite when the incoming instruction is at-or-newer than the
  stored one. The conditional upsert is done atomically in a single statement so
  concurrent writers cannot race a stale value in.
*/

alter table public.basket_sl_tp_targets
  add column if not exists instruction_at timestamptz not null default now();

-- Backfill existing rows so the guard has a sane baseline.
update public.basket_sl_tp_targets
  set instruction_at = updated_at
  where instruction_at is null or instruction_at = created_at;

create or replace function public.upsert_basket_sl_tp_target(
  p_user_id uuid,
  p_broker_account_id uuid,
  p_anchor_signal_id uuid,
  p_channel_id uuid,
  p_symbol text,
  p_stoploss numeric,
  p_tp_levels numeric[],
  p_source text,
  p_instruction_at timestamptz
) returns void
language plpgsql
as $$
declare
  v_instr timestamptz := coalesce(p_instruction_at, now());
begin
  insert into public.basket_sl_tp_targets as t (
    user_id, broker_account_id, anchor_signal_id, channel_id, symbol,
    stoploss, tp_levels, source, instruction_at, updated_at
  ) values (
    p_user_id, p_broker_account_id, p_anchor_signal_id, p_channel_id, p_symbol,
    nullif(coalesce(p_stoploss, 0), 0),
    coalesce(p_tp_levels, '{}'),
    p_source, v_instr, now()
  )
  on conflict (broker_account_id, anchor_signal_id) do update set
    -- Merge: a side that is not supplied keeps its prior value (breakeven keeps
    -- the TP ladder; a TP-only adjust keeps the SL).
    stoploss = case when coalesce(p_stoploss, 0) > 0 then p_stoploss else t.stoploss end,
    tp_levels = case
      when p_tp_levels is not null and coalesce(array_length(p_tp_levels, 1), 0) > 0
      then p_tp_levels else t.tp_levels end,
    source = p_source,
    instruction_at = greatest(t.instruction_at, v_instr),
    updated_at = now()
  -- Refuse to apply an instruction older than the one already recorded.
  where v_instr >= t.instruction_at;
end;
$$;

grant execute on function public.upsert_basket_sl_tp_target(
  uuid, uuid, uuid, uuid, text, numeric, numeric[], text, timestamptz
) to authenticated, service_role;

comment on function public.upsert_basket_sl_tp_target is
  'Atomic latest-instruction-wins upsert for basket_sl_tp_targets (guards on instruction_at).';
