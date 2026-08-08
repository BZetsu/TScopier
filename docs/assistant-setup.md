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
- Chat history is kept in `sessionStorage` (last 20 turns per user); phone numbers are redacted
- **Telegram link (phone + OTP)** and **broker connect** run in-chat via secure cards — passwords/OTP never go through OpenAI
- **Configuration**: the assistant can resolve brokers by MT login (e.g. `928883`), write lot/multi/range settings via `update_channel_config` (Confirm card), then offer `save_preset`
- Mutations (pause/resume, config, apply/save preset) show a Confirm card, then call `{ execute: { tool, args } }`

## Manual checks

1. Open assistant from the header; ask “Is my Telegram linked?”
2. Ask to link Telegram → phone card → OTP → linked
3. Ask to connect MT5 with a login → secure password card → connected
4. Ask “configure broker 928883 on channel X with lot 0.02 multi 5%” → Confirm → settings saved → offer save preset
5. Ask to pause the copier → Confirm → header pause state updates
6. Attach or paste a screenshot and ask what it shows