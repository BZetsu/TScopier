# MTAPI bridge VPS — server details and stall diagnosis (2026-11-25)

Operational reference for the MTAPI bridge host: what the server is, how it is
accessed, what runs on it, and what the 2026-11-25 investigation found about the
recurring bridge stalls. `docs/mtapi-hosting.md` remains the setup and
architecture guide; this file records the live server facts and the diagnosis.

## 1. Server identity

| Field | Value |
|---|---|
| Provider | Contabo |
| Hostname | `vmi3597525` |
| Public IP | `13.140.44.122` (IPv6 `2605:a144:2359:7525::1`) |
| OS | Ubuntu 24.04.5 LTS, kernel 6.8.0-149-generic |
| Access | `ssh root@13.140.44.122` — **password login** (both local ed25519 keys are rejected: `Permission denied (publickey,password)`) |
| Uptime at last check | 11 days (boot ~2026-11-13); server clock observed as **CET (UTC+1)** — convert carefully against UTC incident times |
| Disk | 95.8 GB total, ~8% used |
| Memory | 7.9 GB total, no swap configured |
| Last login before this investigation | 2026-11-20 from `102.88.168.140` |
| Pending | 14 updates (3 security), and **`*** System restart required ***`** — a reboot has been pending since at least 2026-11-19 |

Credentials are not stored in this repository (see `docs/mtapi-credentials.md`).

## 2. What runs on it

`docker ps -a` (2026-11-25):

| Container | Image | Created | Status | Ports |
|---|---|---|---|---|
| **`mtapi`** | `timurila/mt5rest` | 6 days ago (2026-11-19T10:16:15Z) | Up 6 days | `127.0.0.1:8080->80/tcp` (MT5 bridge) |
| `mt4rest` | `timurila/mt4rest` | 7 weeks ago | Up 11 days | `127.0.0.1:8081->80/tcp` (MT4 bridge) |

- The MT5 bridge container is named **`mtapi`**, not `mt5rest` — earlier command
  suggestions that used `mt5rest` as the container name fail with `no such object`.
- `docker inspect mtapi` → `restarts=0 oom=false exit=0` — the container has **not
  crashed or been OOM-killed**; it stays alive and stalls instead.
- Both containers run the `/mtapi-redactor/entry…` entrypoint (the log-redacting
  wrapper described in `docs/mtapi-credentials.md`).
- nginx runs **on the host** (not in a container): `/health` is proxied to the
  container, other paths require the API-key/internal-token auth map.

## 3. Resource state (measured 2026-11-25 19:45 CET, i.e. 18:45 UTC)

```
docker stats --no-stream
  mtapi     CPU 203.71%   MEM 4.863GiB / 7.755GiB (62.71%)   PIDS 210
  mt4rest   CPU  30.98%   MEM 375.4MiB / 7.755GiB (4.73%)    PIDS 50

free -m   → 5996 MB used of 7941 MB, 1612 MB free, swap 0
uptime    → load average: 7.85, 8.27, 7.81
```

Observations:

- The `mtapi` container alone holds **~2 cores busy continuously (203%)** and
  **4.9 GB of the 7.9 GB host memory**, with 210 processes/threads.
- **Host load average ~8** is high for this box; memory leaves only ~1.9 GB
  available and **no swap exists**, so a memory spike has no headroom.
- This is a snapshot, not a trend — the decisive measurement is `docker stats`
  **during** a stall (see §6).

## 4. Health-probe evidence (live measurement)

An external probe (every 5 s from this machine, `curl -m 12` on
`https://mtapi.tscopier.ai:9443/health`) recorded on 2026-11-25:

- Normal: **200 in 0.8–1.4 s** (already slow for a health check; the worker's
  probe timeout is 5 s — `BRIDGE_PROBE_TIMEOUT_MS`, default 5000).
- Occasional single samples above the timeout (one 5.73 s reading).
- **18:31:56–18:36:41 UTC — a full stall caught live:** every sample timed out
  at 12 s (`000`), with one `502` at 10.6 s and one `200` at 8.0 s; recovery at
  18:39. This window matches alert `bridge_down` created 18:35:03 (152 s down),
  resolved 18:36:03.
- Two further bridge-down events after the afternoon investigation:
  **17:49 (152 s, resolved 17:52)** and **18:35 (152 s, resolved 18:36)** — the
  flapping continues into the evening, so the cause is still active.

Direct test from the VPS, bypassing nginx (`curl http://127.0.0.1:8080/health`):

```
000 12.00s   ← three straight timeouts
000 12.00s
000 12.00s
200 10.79s   ← eventually answers, very slow
200  1.47s   ← then back to normal
```

**Conclusion:** the stall is **inside the `mtapi` container**, not nginx and not
the network. nginx stays responsive during a stall (its `/Ping` auth check
answers 403 instantly — that is what the worker probe reports as
`/Ping HTTP_403`), while the proxied `/health` hangs until the container
recovers. This differs from the 2026-10-08 outage, which produced fast 502s.

## 5. Container log findings (`docker logs mtapi`)

- The stall window `--since 2026-11-25T14:20Z --until 14:36Z` produced **no log
  output at all** — the container goes silent while stalled rather than crash-
  looping (consistent with a blocked/starved process, not an exception storm).
- Day-wide error grep shows three recurring, **non-fatal** classes (each logged
  as a per-request `ExceptionResult`, service keeps running):
  1. `Service started without MongoDB.ConnectByToken env var` — the
     `ConnectByToken` endpoint always fails; sessions connect through other
     paths, but this produces constant error noise and failed connect attempts.
  2. `FB80 /fb80/fc: server status 1001` and
     `TimeoutException: … fb80 handshake … stuck 1741 ms` — MT5 **broker-server
     connections failing or slow** (e.g. `194.164.177.150:443`,
     `37.27.63.91:443`, `57.128.141.140:443`). Reconnect attempts are CPU-heavy
     and appear in bursts.
  3. `You triyng to make http request, but not websocket` — clients (our worker
     or edge) polling `OnOrderUpdate` event URLs over HTTP instead of WebSocket;
     harmless per request but noisy at volume.

None of these logs is a smoking gun on its own; they show a service under
constant reconnect/error load while consuming ~2 cores.

## 6. Root cause (established 2026-11-25 evening)

**What the stalls are:**

1. The stalls are **container-side stalls of `mtapi`** — nginx, network and
   the worker are healthy during them (§4).
2. The container does not restart or OOM; it becomes unresponsive for 1–9
   minutes, then recovers (§2, §4).
3. The stall windows line up exactly with every `OrderSend timed out` cluster
   on 2026-11-25 (11:03–14:35 UTC and 17:49, 18:35), affecting 13 users and
   100 timeout rows that day — see
   `docs/scratchpads/scratchpad-order-timeouts-alwaysluv-2026-11-25.md`.

**What causes them — the full-history read storm:**

4. nginx access log for the whole day (00:06–20:41 local, +0100):
   **1,522,435 GETs total**. Endpoint mix: AccountSummary 465k, OpenedOrders
   353k, CheckConnect 272k (the worker's ~13 req/s polling floor),
   **OrderHistory 156k (MT5 140k + MT4 16k)**.
5. OrderHistory is **96% launched by our Supabase edge** (`Deno/2.1.4` user
   agent, AWS egress IPs) in response to browser clients — Trades page,
   dashboard, cashflow sync, baseline inference. Each read fans out **~218
   parallel 45-day chunks** (`buildHistoryChunks`, from
   `BROKER_FULL_HISTORY_FROM_DATE = 2000-01-01`) via
   `Promise.allSettled(chunks.map(...))` with **no concurrency bound**
   (`supabase/functions/_shared/fxsocketTrades.ts`).
6. **Quality of those reads today: 37% failed** — 100,218 × 200;
   **34,767 × 429** (our own nginx rate limit); **22,806 × 504** (container
   wedged); 1,169 × 499 (client gave up). Failures raise the frontend's
   degraded flag, and a degraded feed **forces a full-history read on every
   refresh** (`src/hooks/useTradesData.ts`) — the failures manufacture more
   of the traffic that caused them (amplification loop).
7. **Volume correlates with stalls:** night hours (02:00–04:00 local) 425–831
   OrderHistory/hour → no stalls. Business hours ramp to **20,330/hour (19:00
   peak)** → stalls every 20–90 minutes. Per-minute counts show each stall as
   a **dip** (requests queueing) followed by a **burst** (retry flood on
   recovery — 900/min at 19:37 local after the 18:31–18:36 UTC stall).

**What the stalls are NOT (live watcher capture, `/tmp/bridge-watch.log`):**

8. The watcher (5 s cadence: docker stats + local `/health` + kernel PSI)
   caught two stalls live (19:03:51–19:04:29 and 19:13:55–19:15:49 UTC).
   During the 12-second `/health` timeouts:
   - **CPU was low, not pegged** — 31–88%, as low as **4.7%** while `/health`
     still timed out. (A 204% sample at 19:03:45, when `/health` answered in
     8 ms, shows the storm's CPU bursts — but the hang itself happens with
     the CPU idle.)
   - **Memory flat** at 4.35 GiB throughout; host memory PSI = 0.
   - **Thread count churned hard**: container PIDS swung 125 → 377 → 125
     across the stall window.
9. Conclusion: the container is **blocked / queueing internally, not
   resource-exhausted** — requests (including `/health`) are waiting behind
   hundreds of concurrent history reads against the single MT5 terminal,
   which walks them serially. The exact internal lock cannot be seen from
   outside the vendor image, but the trigger (unbounded parallel fan-out) and
   the fix (bound the concurrency) are the same either way.
10. **A bigger VPS would not fix this** — more CPU does not unclog a queue.
    The fix is on our side: stop sending the stampede.

**Load sources, ranked (whole-day nginx log):**

| Source | Volume | Notes |
|---|---|---|
| Worker polling (AccountSummary/OpenedOrders/CheckConnect/quotes) | ~1.09M/day (~72%) | steady ~13 req/s floor, paced by the `931347e9` pacer (in prod) |
| **Edge OrderHistory full reads** | 156k/day, 37% failing | **the stall trigger** — unbounded 218-chunk fan-out |
| `ConnectByToken` | 10,636/day, **100% failing** | bridge lacks `MongoDB.ConnectByToken` env var; pure waste + exception load, forces heavier `ConnectEx` reconnects |

**Prior fixes already in production** (do not re-do): `3568bd34` (Trades page
full read once/day + incremental between) and the `931347e9` worker pacer.
They cut the worst of the 2026-11-13 storm but four paths still do full
`2000-01-01 → now` reads with the unbounded fan-out: cashflow sync (every
6 h/account), baseline inference, the degraded-feed force-full loop, and CSV
export.

**Still to capture (optional):** session-id distribution across the storm —
the access log is query-string-redacted by design, so use container logs:
`docker logs --since 6h mtapi 2>&1 | grep 'OrderHistory?from' | grep -o
'id=[a-f0-9-]*' | sort | uniq -c | sort -rn | head -10` (note: container log
volume may have rolled past 6 h already — try `--since 24h` if empty).

## 7. Commands to capture the next stall

Run on the VPS. The stalls recur every 20–90 minutes, so keep these ready.

**Continuous sampler (run in its own terminal, leave it running):**
```bash
while true; do
  echo "=== $(date -u +%H:%M:%SZ) ==="
  docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} MEM={{.MemUsage}} PIDS={{.PIDs}}'
  curl -s -o /dev/null -w 'local_health %{http_code} %{time_total}s\n' -m 12 http://127.0.0.1:8080/health
  sleep 5
done | tee /tmp/bridge-stall-watch.log
```

**Host CPU offenders during a stall (host has `top`, container has no `ps`):**
```bash
top -bn1 | head -25
```

**Inside the container without `ps` (it is not installed):**
```bash
docker exec mtapi cat /proc/1/status | grep -E 'Threads|VmRSS|State'
docker exec mtapi sh -c 'for p in /proc/[0-9]*; do echo "$p $(cat $p/comm 2>/dev/null)"; done | head -30'
```

**OOM / kernel kills:**
```bash
dmesg -T | grep -i -E 'oom|killed process' | tail -20
```

**Broker-connect burst check (correlate with stall times):**
```bash
docker logs --since 30m mtapi 2>&1 | grep -c 'fb80'
docker logs --since 30m mtapi 2>&1 | grep -c 'ConnectByToken'
```

**nginx confirmation (host log):**
```bash
tail -50 /var/log/nginx/mtapi-error.log
grep health /var/log/nginx/mtapi-access.log | tail -30   # watch $request_time spikes
```

**Correlating times:** the server clock is CET (UTC+1) while alerts and worker
logs are UTC — add one hour when comparing, or use `date -u` in the sampler
above (it already prints UTC).

## 8. Follow-ups

1. Capture a stall with the §7 sampler and record the result here — that closes
   the open question in §6.
2. The pending **server reboot** (§1) and 14 pending updates should be scheduled
   for a quiet market window; note the bridge will be down during it.
3. ~~Fix the missing `MongoDB.ConnectByToken` env var~~ — **scheduled: Saturday
   2026-11-29**, see §9. Still open: review `MTAPI_GLOBAL_ORDER_CONCURRENCY` /
   `MT_SEND_OP_CONCURRENCY` against the 826 attempts/day load.
4. alwaysluv-specific cleanup is tracked in
   `docs/scratchpads/scratchpad-order-timeouts-alwaysluv-2026-11-25.md`
   (12 stale pendings, account 34250909 resting limit, production missing the
   timeout broker-check fix `c3ad1d29`).

## 9. MongoDB attachment — runbook (scheduled Saturday 2026-11-29)

**Why:** the bridge runs without its MongoDB session registry, so
`ConnectByToken` fails on every call (10,636/day, 100% failing — §6) and every
session recovery falls through to a full password re-authentication
(`ConnectEx`). Attaching MongoDB enables token-based session recovery and makes
future bridge restarts survivable. Setup on the VPS is **already done** — the
`mtapi-mongo` container is running, internal-only (no host port), on the
`mtapi-net` network. What remains is attaching it to the bridge, which requires
restarting the bridge and therefore dropping all live sessions — hence a
scheduled window, not an ad-hoc change.

**Prerequisites (already complete unless noted):**

| Item | State |
|---|---|
| `mtapi-net` Docker network | created 2026-11-25 |
| `mtapi-mongo` container (`mongo:7`, volume `mtapi-mongo-data`) | running, healthy |
| MongoDB credentials | root user `mtapi`; password is in the container env — read it back with `docker inspect mtapi-mongo --format '{{range .Config.Env}}{{println .}}{{end}}' \| grep MONGO_INITDB_ROOT_PASSWORD` — **never written into this repository** |
| Exact env var name the bridge expects | **outstanding** — confirm before the window (see Step 1) |
| Maintenance banner | runbook §2 of `docs/mtapi-paid-container-cutover-runbook.md` |
| Install script on the VPS | `deploy/mtapi-log-redactor/install.sh` (scp to the VPS if not present) |

**Step 1 — confirm the env var name (before Saturday).** Our runbook says
`MongoDB=...`; the bridge's own error says *"Service started without
MongoDB.ConnectByToken env var"* — let the image answer:

```bash
docker exec mtapi sh -c 'grep -rao "MongoDB[A-Za-z._]*" /app 2>/dev/null | sort -u | head'
```

If this returns nothing (`sh` not in the image), ask the vendor — a wrong name
fails safe: the container starts, the error keeps appearing, set the right name
and re-run.

**Step 2 — get the current image name:**

```bash
docker inspect mtapi --format '{{.Config.Image}}'
```

**Step 3 — attach in the quiet window.** Maintenance banner on first (runbook
§2), then from the machine that holds the install script:

```bash
VPS_IP=13.140.44.122
scp deploy/mtapi-log-redactor/install.sh root@${VPS_IP}:/tmp/mtapi-redactor/
```

On the VPS:

```bash
cd /tmp/mtapi-redactor
MONGO_PW="$(docker inspect mtapi-mongo --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^MONGO_INITDB_ROOT_PASSWORD=//p')"
IMAGE=<image from Step 2> \
EXTRA_ENV='MongoDB=mongodb://mtapi:'"${MONGO_PW}"'@mtapi-mongo:27017/mtapi' \
NETWORK=mtapi-net bash install.sh
```

The install script preserves the container's existing environment (other keys
accumulate, none are replaced), keeps the port bound to `127.0.0.1:8080`, and
refuses to report success if the container restarts unexpectedly. The password
is read from the running container at execution time, so no secret ever appears
in this file, the shell history of a shared session, or the repository.

**Step 4 — verify immediately after:**

```bash
docker logs mtapi 2>&1 | grep -i connectbytoken   # the MongoDB errors must be gone
curl -s http://127.0.0.1:8080/health               # local 200
curl -s https://mtapi.tscopier.ai:9443/health      # through nginx, 200
docker inspect mtapi --format '{{json .HostConfig.PortBindings}}'   # 127.0.0.1 only
```

**Step 5 — verify on our side (within a day):** `ConnectByToken` rows in the
nginx access log start returning 200 instead of failing; `ConnectEx` volume
drops sharply (recovery stops doing full password re-authentication); the
worker log no longer prints
`bridge has no MongoDB session registry — ConnectByToken disabled`.

**Step 6 — after attachment:** the standing **"never restart `mtapi`"** rule is
lifted (restarts become survivable) and the pending VPS reboot (§8.2) can be
scheduled. Note: the worker-side skip flag from Fix 3 clears on worker restart;
with the per-host TTL fix it also self-clears within an hour of the bridge
recovering — no worker restart strictly required.

**Rollback:** re-run `install.sh` without `EXTRA_ENV` (the script's documented
`EXTRA_ENV=` empty form removes the key). Sessions drop either way; accounts
reconnect from their stored encrypted passwords with auto-reconnect enabled.
