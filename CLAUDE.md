# TScopier Development Notes

- Staging environment — no production secrets or infra credentials stored here.
- Single Netlify build serves both `tscopier.ai` (marketing) and `app.tscopier.ai` (product). Use `?site=marketing` or `VITE_DEV_SITE=marketing` for local marketing preview.
- Never run two replicas with the same Telegram session (one MTProto connection per auth key).
- Worker sharding: `WORKER_SHARD_ID` / `WORKER_SHARD_COUNT` must match across listener and trade workers.
- Two test frameworks coexist in src/: vitest and node:test. `npm test` auto-detects which.
- See `AGENTS.md` for full commands, architecture, and behavior rules.
