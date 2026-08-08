# In-app AI Assistant

The TScopier Assistant is a header chat panel that explains the product and performs user-scoped actions via OpenAI tool-calling.

## Edge function

- Function: `assistant-chat`
- Auth: user JWT (`verify_jwt = true`)
- Secret: `OPENAI_API_KEY` (same secret used by other AI edge functions)
- Optional: `ASSISTANT_OPENAI_MODEL` (default `gpt-4o-mini`)

### Deploy

```bash
supabase functions deploy assistant-chat --project-ref <staging-or-prod-ref> --use-api
```

Ensure `OPENAI_API_KEY` is set in the project’s Edge Function secrets.

## Client

- Header sparkles button opens [`AssistantPanel`](../src/components/assistant/AssistantPanel.tsx)
- Chat history is kept in `sessionStorage` (last 20 turns per user)
- Users can attach or paste up to 3 images per message (JPEG/PNG/WebP/GIF); the panel compresses them client-side and the edge function sends them as OpenAI vision parts
- Mutations (pause/resume, apply/save preset) show a Confirm card, then call `{ execute: { tool, args } }`
- Sensitive flows (Telegram link, broker connect) open existing app UI — credentials are never collected in chat

## Manual checks

1. Open assistant from the header; ask “Is my Telegram linked?”
2. Ask to pause the copier → Confirm → header pause state updates
3. Ask to connect MT5 → connect modal opens
4. Ask to apply a named preset → Confirm → config updates on that broker/channel
5. Attach or paste a screenshot and ask what it shows