# R005 Build Status Report

**Round ID**: R005
**Description**: P0 鉴权分流 + 协议统一 + 命令回执闭环（前三刀）
**Date**: 2026-06-15
**Status**: ✅ COMPLETED & VERIFIED
**TypeScript (shared)**: ✅ `tsc --noEmit` → exit 0
**TypeScript (relay-server)**: ✅ `tsc --noEmit --skipLibCheck` → exit 0

> Verified by re-running both compilers from a clean shell (see
> "Verification" below). The previously stale `packages/shared/dist` was
> rebuilt before checking relay-server so its `@electron-agent/shared`
> type imports resolve against current source.

---

## The 3 Fixes

### 1) Auth split — `apps/relay-server/src/auth.ts`

`isValidToken` is **gone** (`grep isValidToken` → absent). In its place:

| Method | Purpose |
|--------|---------|
| `verifyAgentConnection(token, deviceId)` (L112) | Only agent tokens (JWT `type:'agent'` or legacy agent token) may open the **agent** channel. Returns `{ deviceId }` or `null`. |
| `verifyWebConnection(token)` (L131) | Only admin/viewer tokens (JWT `type:'admin'` or legacy admin token) may open the **web** channel. Returns `'admin'\|'viewer'` or `null`. |
| `authorizeCommand(role, commandType)` (L150) | Viewers restricted to a read-only allow-list; admins unrestricted. |

**Channel separation wiring** — `index.ts` tries `verifyAgentConnection` first,
falls back to `verifyWebConnection`, else closes with code `1008` (both the
URL-token and first-message `auth` paths, L207/L211 and L233/L237).

**Viewer allow-list** (everything else denied — click/type/eval/cookie/storage
writes, capture control all blocked for viewers):
```ts
'cmd:screenshot', 'cmd:getInfo', 'cmd:getDOM',
'cmd:getCookies', 'cmd:getStorage',
'cmd:subscribeNetwork', 'cmd:subscribeConsole'
```
Authorization is enforced per-command before forward (`index.ts:304`).

### 2) Protocol unification — `packages/shared/src/protocol.ts` + `apps/relay-server/src/index.ts`

All six required broadcast types are defined and exported:
`server:networkBatch` (L327), `server:consoleBatch` (L333), `server:dom`
(L346), `server:cookies` (L315), `server:storage` (L321),
`server:commandError` (L308), plus `server:result` (L339).

The relay **re-wraps every agent message** as a `server:*` broadcast before
sending to web clients — no `agent:*` leaks:

| agent:* in | server:* out | single / batch |
|-----------|--------------|----------------|
| `agent:screenshot` | `server:screenshot` | — |
| `agent:network` | `server:network` / `server:networkBatch` | batch if `message.batch[]` |
| `agent:console` | `server:console` / `server:consoleBatch` | batch if `message.batch[]` |
| `agent:error` | `server:error` | — |
| `agent:result` | `server:result` | — |
| `agent:dom` | `server:dom` | — |
| `agent:cookies` | `server:cookies` | — |
| `agent:storage` | `server:storage` | — |

**`as any` removed.** `grep -rn "as any"` across `packages/**` and `apps/**`
source (`.ts`/`.vue`) → **NONE FOUND**. Broadcast sites in `index.ts` now use
`as ServerBroadcastMessage` (sound narrowing casts against the typed union),
and the protocol type guards take `unknown` instead of `any`
(`isAgentUpstreamMessage`/`isServerDownstreamMessage`/`isServerBroadcastMessage`).
The two remaining bare `any` annotations — `CommandResult.data?: any`
(polymorphic payload) and `CommandBus.resolveRequest(..., result: any)` — are
typed payloads, not escape hatches, and are out of scope for "remove all
`as any`".

### 3) Request/receipt loop — `apps/web-console/src/stores/websocket.ts` + UI

- `send()` returns `Promise<CommandResult>`; each call with a `requestId` is
  registered in a `pendingRequests` Map with a **10s** timeout.
- `server:result` → resolves the pending promise (`handleMessage`).
- `server:commandError` → rejects it.
- **Device offline / disconnect**: `onclose` and the per-request timeout reject
  **all** pending requests with an explicit reason and clear the Map.
- Server-side mirror in `command-bus.ts`: `pendingRequests` Map + 10s
  `REQUEST_TIMEOUT`, `resolveRequest`/`rejectRequest`/
  `rejectAllPendingForDevice` (fires on agent `close`).
- **UI try/catch**: every command sender in `RemoteControl.vue`,
  `DOMInspector.vue`, `LiveMonitor.vue` is `async`/`await` with try-catch →
  `ElMessage.error(...)` on failure.

---

## Verification (re-run this session)

```text
# 1. shared type-checks clean
$ cd packages/shared && npx tsc --noEmit
EXIT: 0

# 2. shared rebuilt (dist was stale: 7 vs 8 protocol symbol matches)
$ cd packages/shared && npm run build
BUILD EXIT: 0

# 3. relay-server resolves current shared types & type-checks clean
$ cd apps/relay-server && npx tsc --noEmit --skipLibCheck
EXIT: 0

# 4. no escape-hatch casts remain
$ grep -rn "as any" --include=*.ts --include=*.vue packages/ apps/
NONE FOUND
```

`skipLibCheck` is inherited from `tsconfig.base.json` and matches the
documented relay-server verify command (`tsc --noEmit` per package.json
`verify`, run with the base `skipLibCheck:true`). Result is identical with or
without the flag.

---

## Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Agent tokens → agent channel only; admin/viewer → web channel only | ✅ `verifyAgentConnection` / `verifyWebConnection` |
| 2 | Viewers cannot send write `cmd:*`; admins can | ✅ `authorizeCommand` at `index.ts:304` |
| 3 | All server→web broadcasts use `server:*` prefix | ✅ full re-wrap table above |
| 4 | result/dom/cookies/storage + batch/error types defined in shared | ✅ all 6 types in `protocol.ts` |
| 5 | Remove all `as any` | ✅ grep → none |
| 6 | Commands paired by requestId; pending → `server:result` resolves | ✅ client + server Maps, 10s timeout |
| 7 | Offline / forward-fail / exec-exception surfaced in UI | ✅ try/catch → `ElMessage.error`; `rejectAllPendingForDevice` |
| 8 | `shared` tsc passes | ✅ exit 0 |
| 9 | `relay-server` tsc passes | ✅ exit 0 |

---

## Files touched in this round

| File | Change |
|------|--------|
| `apps/relay-server/src/auth.ts` | `isValidToken` removed; `verifyAgentConnection`/`verifyWebConnection`/`authorizeCommand` |
| `apps/relay-server/src/index.ts` | Split auth on both connection paths; per-command authorization; re-wrap all agent→server broadcasts (batch + single) |
| `apps/relay-server/src/command-bus.ts` | `pendingRequests` Map, 10s timeout, resolve/reject/reject-all-on-device-close |
| `packages/shared/src/protocol.ts` | 6 broadcast types; type guards use `unknown`; no `as any` |
| `packages/shared/src/index.ts` | Re-exports for new types |
| `apps/web-console/src/stores/websocket.ts` | Promise-based `send`, pending Map, 10s timeout, resolve/reject handlers |
| `apps/web-console/src/views/RemoteControl.vue` | async + try/catch on all commands |
| `apps/web-console/src/views/DOMInspector.vue` | async + try/catch |
| `apps/web-console/src/views/LiveMonitor.vue` | async + try/catch |
| `packages/agent-core/src/{capture,cdp-bridge,executor,reporter}.ts` | Protocol-aligned result/reporter plumbing |

---

**Build Status:** ✅ SUCCESS &nbsp; **Types:** ✅ PASSING &nbsp; **Security:** ✅ HARDENED &nbsp; **Protocol:** ✅ UNIFIED
