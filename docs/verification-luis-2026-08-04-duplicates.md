# Luis ESp — Confirmed Duplicated Trades (August 4, 2026)

**User:** Luis ESp — `dd18ad68-cab1-4d02-8bd8-6d975db5f959`
**Complaint:** "my **single trades** are being duplicated" — one trade signal opening as many identical copies
**Purpose:** verify each group below against the app / broker statements.
**How to verify:** each group = ONE Telegram signal that should have opened ONE trade, but opened N. Every copy has its own broker ticket (distinct `metaapi_order_id`).

All times are UTC.

## What does "Duplicates: 34" mean?

A Telegram signal = **1 instruction** = should open its planned trades **once**.

- **"Duplicates: 34"** = that ONE signal's plan ran **twice**. The account is set to multi/range, so the plan itself is 17 orders (tp1…tp17) — but the SAME 17-order plan was executed again (17 + 17 = 34). You will see every planned trade twice in the app.
- **"Duplicates: 3"** = that ONE signal's plan ran **three times**. Here the plan was a single 0.41-lot order — but it was sent 3 times (3 identical orders instead of 1).

The number is just **how many copies were created from that single signal**. Running the plan once is normal — running it again is the duplication.

---

## 1. August 4, 2026
**Time:** 11:52:43 UTC
**Signal:** `906a4b64-aae8-4dcc-a72c-42c29df42b99`
**Channel:** 44Fx (channel lost in DB)
**Signal message:** "Gold Sell Now!"
**Trade style:** Multi (account "MT5 Demo for 1 Chanel")
**Duplicates:** 34 — **CONFIRMED**
**Proof of duplication:** the 34 broker order comments are `TScopier:44Fx:906a4b64:tp1 … tp17` followed by the **exact same sequence again** (`tp1 … tp17`) — the identical 17-order plan was executed **twice**. 34 distinct broker tickets, one order every ~0.37s, all with identical lot 0.03 / SL 4093 / TP 4073.
**What happened in the channel:** the channel posted "Gold Sell Now!" once (msg #17284) and edited it 2 seconds later (11:52:40, per Telegram's edit date). The system then re-checked the message at +10s and +30s (settle poll), found the text had changed from what it stored, and treated it as a new dispatch each time:
```
11:52:38  message posted → dispatch #1 → 17 orders (tp1…tp17)
11:52:40  channel edits the message (real edit date)
11:52:49  settle poll (+10s): message text changed
11:52:52  revision applied → dispatch #2 → 17 more orders (tp1…tp17) = 34 total
11:53:09  settle poll (+30s): changed again
11:53:12  revision applied but DEDUPED (only 1 dispatch slipped through)
```
Samples:
- XAUUSD | 11:52:43.274 | `c9c8b8f8-af0f-41c7-b9b2-51e9dc3b262b`
- XAUUSD | 11:52:43.650 | `5e002914-af86-41b7-bd40-8debe9682831`
- XAUUSD | 11:52:44.024 | `1907e9cf-fee3-468f-adb3-b7f2defd87f9`
- XAUUSD | 11:52:44.393 | `7a856b23-f9d7-4b4b-b80f-910a09de5fb0`

## 2. August 4, 2026
**Time:** 13:41:33 UTC
**Signal:** `ead1ebb8-9709-4136-98ab-5a22963eebfd`
**Channel:** 44's Club
**Signal message:** "Gold Buy Now!"
**Trade style:** Multi/range account ("FTMO USD 100K fonded") — BUT the 3 orders are the SAME single-entry plan executed 3 times (identical lot 0.41, SL 4077, TP 4097, comment `TScopier:44sClub:ead1ebb8` with NO `:tpN` layer suffix — a real range plan would vary lots/prices per layer)
**Duplicates:** 3 — **CONFIRMED** — ✅ **now closed** (all 3 closed together 2026-08-05 00:19:33 UTC, ~10h40m after opening)
**Proof of duplication:** the account's own execution log shows THREE separate successful `order_send` actions for this ONE signal within 24 seconds — same volume 0.41, same comment, same SL/TP, 3 distinct broker tickets (281762049, 281762205, 281762266). One signal → three identical sends.
**What happened in the channel:** the channel posted "Gold Buy Now!" once (msg #14238). The settle poll at +10s found the text changed (order #2), and the channel also **live-edited** the message 21 seconds after posting (13:41:51, per Telegram's own edit date) — the edit triggered order #3:
```
13:41:30  message posted          → order #1 (13:41:33, ticket 281762049)
13:41:43  settle poll (+10s): message text changed
13:41:47  revision applied        → order #2 (13:41:49, ticket 281762205)
13:41:51  channel EDITS the message (live edit, real edit date)
13:41:56  revision applied        → order #3 (13:41:57, ticket 281762266)
13:42:06  settle poll (+30s) revision → DEDUPED (no 4th order)
```
Samples:
- XAUUSD | 13:41:33.340 | `71e597de-7f1a-46f1-8d5e-c657ada0bb83`
- XAUUSD | 13:41:48.983 | `b4bb3612-a80d-42ef-bf3f-52e1093571da`
- XAUUSD | 13:41:56.916 | `7b5c69ee-308a-4aa2-b701-f84bfa16fbb4`

---

## Summary (Aug 4) — 2 confirmed groups, 37 duplicate trades

| # | Time (UTC) | Channel | Signal message | Trade style | Duplicates | Status |
|---|---|---|---|---|---|---|
| 1 | 11:52:43 | 44Fx | Gold Sell Now! | Multi (same 17-order plan ×2) | 34 | closed |
| 2 | 13:41:33 | 44's Club | Gold Buy Now! | Multi account, same entry plan ×3 (no layer suffix) | 3 | **closed** (Aug 5 00:19:33) |
