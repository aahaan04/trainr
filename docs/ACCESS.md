# Access gate

Task 4 of the deployment session. This document is the honesty statement the
implementation is required to carry: what the gate is, what it is not, and why
that's an acceptable trade for this app.

## What this is not

**The passphrase gate is obscurity, not security.** `VITE_ACCESS_PASSPHRASE` is a
build-time Vite env var, which means it is baked into the static JS bundle shipped
to every browser that loads the site. Anyone who opens the browser's dev tools,
views source, or reads the network tab can find it in plain text in seconds. The
comparison in `src/access/gate.ts` avoids an early-exit string compare, but that
buys essentially nothing here — the "attacker" already has the full source of the
comparison function sitting in the same bundle. Do not describe this gate, in
code comments, commit messages, or conversation, as "securing" or "protecting"
anything. It restricts nothing from anyone who is even mildly curious. What it
does is keep the app from being the first result someone stumbles into if the
URL leaks or gets crawled, and it stops a stray link from being usable by someone
it wasn't sent to.

## Why that's proportionate here

This is not a rationalization after the fact — it follows from what the app
actually does over the network, laid out in `docs/DEPLOYMENT_AUDIT.md`:

- **No pitch data ever leaves the device.** IndexedDB (`src/storage/db.ts`) is the
  source of truth for every session, pitch, and clip. There is no cloud sync, no
  backend database, and no user accounts anywhere in this app.
- **The only things that cross the network are (1) ball centroid coordinates**
  streamed during a live pairing session between the capture device and the
  viewing device, over WebRTC signaling (`src/net/`) — x/y/timestamp triples for
  a ball in flight, not anything personally identifying — **and (2), only when
  the developer deliberately opens the `/logs` debug screen, one device's
  console output** (log lines, thrown errors with stack traces, and telemetry
  such as frame timings) relayed to a second device for on-field debugging
  (`src/debug/logRelay.ts`). Both ride Supabase Realtime broadcast, on separate
  channel namespaces — see the policy below.
- **The audience is the developer plus a handful of people they send the link
  to** — coaches, players, whoever's on the field that day. It is not a
  multi-tenant product with data to protect between users.

Given that shape, a client-side passphrase is the right amount of effort: it
stops idle discovery without pretending to be an auth system for an app that has
no accounts, no server-held data, and nothing worth a real attacker's time.

## What the gate actually does

- Compares an entered passphrase against `import.meta.env.VITE_ACCESS_PASSPHRASE`
  (`src/access/gate.ts` → `passphraseMatches`).
- **If the env var is unset or blank, the gate is OPEN** — `isGateEnabled()`
  returns `false` and the app loads with no prompt. This is required so a missing
  var never blocks local development. When open this way, the UI never stays
  silent about it: `GateStatusBadge` (`src/screens/Gate/GateStatusBadge.tsx`)
  shows a persistent "Access gate disabled — VITE_ACCESS_PASSPHRASE is not set"
  pill in the corner of every screen except `/live`, specifically so an
  unprotected production deploy is a visible fact, not a silent one.
- On a correct entry, `src/access/useAccessGate.ts` writes
  `localStorage['trainr:access-unlocked'] = '1'` so the device doesn't get
  re-prompted on every load — this matters on a tripod-mounted iPad that's
  reloaded often. The same badge location becomes a "Sign out" button once
  unlocked, which clears that flag and re-locks the device.
- Gates the whole app shell, including every debug route. `AccessGate` wraps the
  router in `src/App.tsx` before any route is matched, so nothing downstream —
  `/diagnostics`, `/logs`, or a future debug route — needs its own gating logic;
  it's the same bundle behind the same door, not route-by-route special-casing.
  Two debug routes exist as of this task: `/diagnostics`
  (`src/screens/Diagnostics/`, the device capability probe — per
  `docs/DEPLOYMENT_AUDIT.md`'s correction to the brief this was already a normal
  route in the production bundle, not dev-only) and `/logs`
  (`src/screens/Logs/LogsScreen.tsx`, the log relay described above). There is
  still no `/selftest` route (`find src -iname '*selftest*'` returns nothing) —
  if one is added later, wrapping the router in `AccessGate` means it is covered
  automatically, with no change needed here.

## The other public secret: the Supabase anon key

`VITE_SUPABASE_ANON_KEY` (used by `src/net/supabaseTransport.ts` for the
production WebRTC signaling transport) has the exact same shape of exposure as
the passphrase, for a different reason: **Supabase's anon key is public by
design.** It identifies the project and the `anon` role to Supabase; it is meant
to ship in client bundles, and revoking that fact is not the fix. The fix is
restricting what the `anon` role is *allowed to do* once Supabase has it — that's
what Row Level Security / Realtime Authorization policies are for.

### Defense in depth: a Realtime authorization policy

Two channel namespaces exist in this codebase, both under `src/net/` and
`src/debug/`. Pairing channels are named `pair:CODE` —
`channelNameForCode()` in `src/net/transport.ts`:

```ts
export function channelNameForCode(code: string): string {
  return `pair:${code.trim().toUpperCase()}`;
}
```

Log-relay channels are named `logs:CODE` — `channelNameForLogs()` in
`src/debug/logRelay.ts`:

```ts
export function channelNameForLogs(sessionCode: string): string {
  return `logs:${sessionCode.trim().toUpperCase()}`;
}
```

Without a policy, any holder of the anon key (i.e. anyone with the deployed
bundle) can broadcast on or listen to *any* Realtime channel in the project, not
just this app's own ones. The policy below scopes the anon role to exactly what
this app uses — broadcast and presence — and only on topics under the `pair:`
or `logs:` prefixes. **A policy scoped to `pair:%` alone would silently break
the log relay** — get the prefix list from `channelNameForCode` /
`channelNameForLogs` above rather than assuming pairing is the only namespace,
since a future debug feature may add a third one. Run this in the Supabase SQL
editor for the project used in production:

```sql
-- Restrict the anon role to broadcast + presence on this app's own channel
-- namespaces only (pairing and the log relay). Realtime authorization policies
-- live on realtime.messages; `realtime.topic()` is the channel name the client
-- passed to `.channel(...)`.
create policy "anon can use this app's channel namespaces only"
on realtime.messages
for select
to anon
using (
  (realtime.topic() like 'pair:%' or realtime.topic() like 'logs:%')
  and extension in ('broadcast', 'presence')
);

create policy "anon can broadcast/track presence in this app's namespaces only"
on realtime.messages
for insert
to anon
with check (
  (realtime.topic() like 'pair:%' or realtime.topic() like 'logs:%')
  and extension in ('broadcast', 'presence')
);
```

Notes:

- Realtime Authorization must be enabled for the project (Supabase dashboard →
  Project Settings → API → Realtime, or per-table if the project predates the
  default-on rollout) before `realtime.messages` policies take effect at all.
- Also set a reasonable **Realtime rate limit** (dashboard → Realtime settings —
  messages per second and max concurrent connections) so a leaked anon key can't
  be used to flood the project's Realtime quota, separately from the channel
  scoping above.
- **The channel code is the primary control here, not this policy** — for both
  pairing and the log relay. The policy only stops the anon key from being used
  *outside* the app's namespaces; it cannot stop someone who has a live,
  currently-open code (pairing or log-relay) from joining that specific
  channel, because the app's own design lets anyone with the code join. That's
  the actual security boundary in both flows (a short-lived, operator-shared
  code), and this SQL policy is a backstop around it, not a replacement for it.

## Key rotation

### Rotating the Supabase anon key

Supabase dashboard → Project Settings → API → under "Project API keys", rotate
(or regenerate) the anon key. Update `VITE_SUPABASE_ANON_KEY` in the Vercel
project's environment variables and redeploy. The old key stops working
immediately on rotation — there is no grace period — so this briefly interrupts
live pairing for anyone mid-session; do it between sessions, not during one.

### Rotating the access passphrase

1. Change `VITE_ACCESS_PASSPHRASE` in the Vercel project's environment
   variables.
2. Redeploy (env var changes don't take effect until the next build — Vite bakes
   it in at build time, it isn't read at runtime).

**Already-signed-in devices are not affected by this.** They keep their
`localStorage['trainr:access-unlocked']` flag from the old passphrase and will
not be re-prompted — the gate only checks that flag, not the passphrase's
current value, once a device has it set. This is deliberate (it's what makes
"don't re-prompt the tripod iPad every load" work) but it means rotating the
passphrase does not, by itself, lock anyone out who's already in.

To force re-entry on a specific device: open the browser's dev tools on that
device → Application/Storage → Local Storage → delete the
`trainr:access-unlocked` key (or clear site data entirely), then reload. There
is no remote/centralized way to invalidate other devices' flags — there is no
backend to hold that state — so this is a per-device, physical-access action.
If that's not acceptable for a given situation, the real control is not
rotating the passphrase; it's rotating the Supabase anon key and/or redeploying
to a new URL, since those actually cut off access rather than relying on
whoever's using the old passphrase to not have it anymore.

## Verification notes

- `src/access/__tests__/gate.test.ts` covers the pure functions
  (`isGateEnabled`, `passphraseMatches`, and the `readUnlockFlag` /
  `writeUnlockFlag` / `clearUnlockFlag` persistence helpers) against an in-memory
  fake storage, and runs under Node — no jsdom involved.
- The React wiring (`useAccessGate.ts`), the passphrase entry screen
  (`GateScreen.tsx`), the status badge (`GateStatusBadge.tsx`), and the actual
  `localStorage` behavior in a real browser are **not exercised by any automated
  test in this task** — there is no jsdom/browser test environment configured
  for this project (`vitest.config.ts` uses `environment: 'node'`), and no
  browser or device was used to click through the flow. `npx tsc --noEmit` and
  `npx vite build` confirm the components compile and bundle, not that the
  prompt-and-unlock flow behaves correctly in a real browser. That gap should be
  closed by hand-testing in an actual browser (enter the passphrase, confirm
  reload doesn't re-prompt, confirm sign-out re-prompts) before relying on this
  for a real deploy.
