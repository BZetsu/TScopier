/*
  # range_pending_legs — retain fired/expired rows

  Worker and edge sweep now UPDATE status to `fired` / `expired` instead of
  DELETE so basket SL/TP refresh can see which ladder rungs were already consumed
  and avoid re-inserting them (duplicate market fires).

  Reverses the one-time purge in 20260515120000_delete_range_pending_terminal_rows.sql
  for new events only; historical rows deleted by that migration are not restored.
*/

comment on table public.range_pending_legs is
  'Virtual range ladder. Terminal rows (fired, expired, cancelled, failed) are retained for audit and merge refresh deduplication.';
