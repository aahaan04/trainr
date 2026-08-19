# Deploying Trainr to Vercel + Supabase

Why hosted: Vercel issues a real, publicly-trusted certificate. That removes the
entire `mkcert` / root-CA / Certificate Trust Settings dance from
[DEV_SETUP.md](DEV_SETUP.md), so `getUserMedia` works on an iPad or iPhone by just
opening a link.

**What Supabase is used for: signaling only.** No auth, no tables, no cloud sync.
IndexedDB remains the source of truth and the app keeps working offline at a field
with no signal. The only thing that ever crosses the network is WebRTC negotiation
and, during a live paired session, ball centroid coordinates.

> **Decisions you must make yourself** are marked **DECISION**. **Anything costing
> money** is marked **PAID**. Nothing below assumes either on your behalf.

---

## 1. Supabase

### 1.1 Create the project

1. Sign up at [supabase.com](https://supabase.com) and create a new project. The
   **free tier is sufficient** — Realtime broadcast and presence are included, and
   this app uses no database, storage, or auth.
2. Pick a region near you. Realtime latency affects how long pairing takes to
   negotiate; it does **not** affect clock-sync accuracy, because sync runs over the
   direct WebRTC data channel, not through Supabase.
3. Wait for provisioning (~2 minutes).

### 1.2 Find the URL and anon key

**Project Settings → API**:

- **Project URL** → `VITE_SUPABASE_URL`, e.g. `https://abcdefgh.supabase.co`
- **Project API keys → `anon` `public`** → `VITE_SUPABASE_ANON_KEY`

> The anon key is **public by design**. It ships in the JavaScript bundle and anyone
> can read it. That is how Supabase is meant to be used from a browser. It is not a
> secret and it does not need protecting. What constrains it is the authorization
> policy below.
>
> Do **not** use the `service_role` key. It bypasses all policies and must never
> reach a browser.

### 1.3 Enable Realtime

Realtime is enabled by default on new projects. Confirm under **Database →
Replication**, or simply run the verification in §5 — if pairing connects, Realtime
works.

This app uses **broadcast** and **presence** only. It does not use Postgres change
subscriptions, so no table needs replication enabled.

### 1.4 Channel authorization policy

**DECISION: this is optional, and defense in depth rather than the primary control.**

By default an anon client may use any Realtime channel. The pairing code is the real
gate: channels are named `pair:CODE`, and without a live code there is nothing to
join. A policy cannot prevent someone who knows a live code from joining it.

What a policy does buy you is preventing channel *enumeration* and confining the anon
role to this app's namespaces. To apply it, run this in **SQL Editor**:

```sql
-- Realtime authorization is enforced on realtime.messages.
alter table realtime.messages enable row level security;

-- Anon may use broadcast and presence, but only on this app's namespaces:
--   pair:CODE  WebRTC signaling
--   logs:CODE  device log relay
create policy "trainr namespaces only"
on realtime.messages
for select
to anon
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and (
    realtime.topic() like 'pair:%'
    or realtime.topic() like 'logs:%'
  )
);

create policy "trainr namespaces only, write"
on realtime.messages
for insert
to anon
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and (
    realtime.topic() like 'pair:%'
    or realtime.topic() like 'logs:%'
  )
);
```

If pairing stops working right after you apply this, the policy is the cause — drop
both policies to confirm before debugging anything else.

**Rate limits** live under **Project Settings → API → Realtime**. The defaults are
far above what this app needs (a pairing handshake is a handful of messages; the log
relay is bounded by how much the app logs). Lower them if you are worried about
abuse; the client requests `eventsPerSecond: 40`.

### 1.5 Rotating the anon key

**Project Settings → API → `anon` key → Rotate.** Then update
`VITE_SUPABASE_ANON_KEY` in Vercel and redeploy. Old bundles cached on devices will
keep presenting the old key and will fail to connect until reloaded — which is the
intended effect of a rotation.

---

## 2. Vercel

### 2.1 DECISION: how to get the code there

**This directory is not a git repository.** Vercel's normal flow imports one, so pick:

**Option A — GitHub (recommended).** Gives preview deploys per push and a history.

```bash
git init
git add .
git commit -m "Initial commit"
```

Then create a repo on GitHub and push. **Check what you are committing first** —
`.gitignore` already excludes `certs/` (which holds a private key) and `.env*.local`.

**Option B — Vercel CLI, no git.** Simpler, but no previews and no history.

```bash
npm i -g vercel
vercel
```

Either way, **you** decide whether this code goes to a third-party host. I have not
done it for you.

### 2.2 Import and configure

On [vercel.com](https://vercel.com) → **Add New → Project** → import the repo.

Vercel reads [`vercel.json`](../vercel.json), so the build settings are already
correct. Confirm they show:

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Node.js Version | 20.x |

`vercel.json` also sets, and these matter:

- **`Permissions-Policy: camera=(self), microphone=(), geolocation=()`** — without
  `camera=(self)` the deployed origin cannot open a camera at all.
- **SPA rewrite** so `/#/diagnostics` and friends survive a refresh, with
  `/mediapipe/`, `/models/`, `/assets/` and `/fonts/` excluded so real files are not
  swallowed by the fallback.
- **Immutable caching** on hashed assets; **`must-revalidate`** on `index.html` and
  `sw.js` so a redeploy is picked up.
- **Correct MIME types** — `application/wasm` for the MediaPipe binary. A wrong type
  here makes `WebAssembly.instantiateStreaming` fail with a message that does not
  mention MIME types.

> **No `Cross-Origin-Embedder-Policy` is set, deliberately.** The bundled MediaPipe
> is the **single-threaded** build — verified against the asset itself: zero
> `Atomics`, zero `SharedArrayBuffer`, no `.worker.js`, no atomic opcodes in the
> wasm. It does not need `SharedArrayBuffer`, so cross-origin isolation would buy
> nothing while breaking every cross-origin asset lacking CORP headers. If you ever
> swap in the threaded build, you must add both COOP and COEP and re-check every
> asset.

### 2.3 Environment variables

**Settings → Environment Variables.** Set each for **Production**, **Preview** and
**Development** unless noted.

See §3 for what each one means.

---

## 3. Environment variable reference

| Variable | Purpose | Example | Public? |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL for Realtime signaling. | `https://abcdefgh.supabase.co` | **Yes** — ships in the bundle. |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key. | `eyJhbGciOi...` | **Yes, by design.** Not a secret. Constrained by the §1.4 policy. |
| `VITE_ACCESS_PASSPHRASE` | Shared passphrase for the access gate. Unset ⇒ gate open. | `bullpen2026` | **Yes** — see the warning below. |
| `VITE_SIGNALING_TRANSPORT` | `supabase` or `local`. Omit to use the default: Supabase in production, local in dev. | `supabase` | Yes. |

> **Every `VITE_`-prefixed variable is embedded in the client bundle.** That is how
> Vite works. None of these carries a secret that matters: the anon key is public by
> design, and the passphrase is obscurity rather than security — see
> [ACCESS.md](ACCESS.md). **Never** put the Supabase `service_role` key, or any
> real credential, behind a `VITE_` prefix.

For local development, put the same values in `.env.local` (gitignored).

---

## 4. First deploy

1. Push, or run `vercel --prod`.
2. Watch the build log. It runs `tsc --noEmit` before `vite build`, so a type error
   fails the deploy rather than shipping.
3. Open the deployment URL. Expect: the access gate (if
   `VITE_ACCESS_PASSPHRASE` is set), then the home screen.
4. Confirm you are on the build you think you are: **DevTools → Application →
   Service Workers**, or check that a change you just made is visible. If not, see
   the stale-service-worker entry in §8.

### What the first load actually costs

| | Size |
| --- | --- |
| Precached app shell (JS, CSS, fonts, icons) | **~1.5 MB** |
| MediaPipe wasm + pose model, **on demand** | 17 MB |
| eruda debug console, **on demand** | 0.5 MB |

The 17 MB of MediaPipe assets are **deliberately not precached** — precaching them
made a cold visit download ~19 MB before the app was usable, which over cellular is
minutes of blank screen. They are fetched the first time **automatic** strike-zone
detection is used, and cached permanently thereafter.

**The consequence, stated plainly:** on a fresh device that has never used automatic
zone detection, that feature needs a network connection the first time. Everything
else — capture, tracking, the call, manual and height-based zone entry, all stats —
works offline from the first load.

---

## 5. Post-deploy verification checklist

Run on **laptop**, **iPad** and **iPhone**. Anything not ticked is unverified, and
should be recorded as unverified rather than assumed.

**Per device:**

- [ ] Loads over HTTPS with no certificate warning, no cert steps needed
- [ ] Access gate accepts the passphrase and does not re-prompt after reload
- [ ] Camera permission prompt appears; access granted
- [ ] `/#/diagnostics` runs to completion and exports JSON
- [ ] Record from the export: **granted vs requested** resolution and frame rate,
      whether the constraint ladder stepped down, whether manual exposure was
      offered *and* actually applied, and `requestVideoFrameCallback` support
- [ ] PWA installs to the home screen
- [ ] Airplane mode → cold start from the home screen icon still loads the app

**Across devices:**

- [ ] `/#/logs` in **Stream** mode on the phone, **Watch** mode on the laptop, same
      code → "Send a test error" appears on the laptop with a readable stack
- [ ] Pairing completes laptop ↔ iPad
- [ ] Pairing completes laptop ↔ iPhone
- [ ] **Record the ICE candidate type for each pairing** (`direct-local`,
      `direct-nat`, or `relayed`). There is no TURN server, so a `relayed` result
      should be impossible — if you see one, something is wrong with the assumption,
      not with the reporting
- [ ] Record achieved clock sync, on home wifi and on a phone hotspot
- [ ] Redeploy, then reload each device → new build is served, not a stale one

---

## 6. Sharing the link

Send the deployment URL and the passphrase. They will see the full app.

**What they can see:** the app, their own pitch data on their own device, the
diagnostics and log screens.

**What they cannot see:** your pitch data. Nothing syncs. Every device's IndexedDB is
its own, and there is no server-side store of anything.

**What they could do:** read the passphrase and the Supabase anon key out of the
bundle, and join a pairing channel if they knew a live code. See
[ACCESS.md](ACCESS.md) for exactly what the gate is and is not.

---

## 7. The local HTTPS fallback

[DEV_SETUP.md](DEV_SETUP.md) still works and is still maintained. Prefer it when:

- **Measuring pairing or clock sync on a LAN with no internet.** A field with no
  signal cannot reach Supabase to negotiate at all.
- **Iterating on the vision pipeline**, where a deploy per change is too slow.
- **You need the local relay's behaviour specifically** — set
  `VITE_SIGNALING_TRANSPORT=local`.

Prefer the deployed build when testing on iOS, since it needs no certificate steps.

---

## 8. Troubleshooting

**Camera blocked / `NotAllowedError` on the deployed site**
Check `Permissions-Policy` is present on the response (DevTools → Network → the
document → Response Headers). Without `camera=(self)` the browser refuses before the
prompt appears. On iOS, also check Settings → Safari → Camera is not set to Deny,
and that no other tab holds the camera — iOS grants it to one consumer at a time.

**Realtime not connecting / pairing hangs with no error**
1. Confirm `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set **for the
   environment you deployed** — a variable set only for Preview is absent in
   Production. The app reports this: it says the transport is unusable rather than
   silently falling back to the local relay, which does not exist on Vercel.
2. If you applied the §1.4 policy, drop it and retry. A policy that does not match
   the topic pattern rejects every message.
3. Check `/#/logs` on the device for a channel error.

**Service worker serving a stale build**
`vercel.json` sets `must-revalidate` on `sw.js` and `index.html`, and the build sets
`cleanupOutdatedCaches`, `skipWaiting` and `clientsClaim`, so this should self-heal
on second load. To force it: DevTools → Application → Service Workers →
**Unregister**, then hard reload. On iOS: Settings → Safari → Advanced → Website
Data → remove the site, or delete and re-add the home-screen icon.

**MediaPipe assets 404**
Confirm `dist/mediapipe/wasm/` and `dist/models/` exist after the build — they are
copied from `public/`. Then confirm the SPA rewrite is not swallowing them: the
rewrite in `vercel.json` excludes those prefixes, and requesting the `.wasm`
directly should return `application/wasm`, not `text/html`. Getting HTML back means
the rewrite pattern was edited incorrectly.

**Cross-origin isolation breaking an asset**
If you add COOP/COEP headers, every cross-origin resource needs
`Cross-Origin-Resource-Policy`. As shipped this app needs neither header — see the
note in §2.2. If something breaks right after adding them, remove them first and
confirm before investigating anything else.

**Build fails on `tsc --noEmit`**
Intentional: `npm run build` typechecks first so a type error cannot reach
production. Reproduce locally with `npm run typecheck`.

---

## Known-unverified

Recorded here rather than left implied:

- **The Supabase transport has not been exercised against a live channel.**
  `src/net/__tests__/supabaseTransport.live.test.ts` drives the real handshake, but
  skips loudly without `SUPABASE_URL` / `SUPABASE_ANON_KEY`. Run it once you have
  credentials:
  ```bash
  SUPABASE_URL=... SUPABASE_ANON_KEY=... npx vitest run src/net/__tests__/supabaseTransport.live.test.ts
  ```
  Until it passes, pairing over Supabase is unproven. Every other test in `src/net`
  uses an injected fake socket and cannot detect a wire-level fault — that is exactly
  how a `ws://` mixed-content bug previously reached a state where all tests passed
  and pairing was broken on every device.
- **ICE candidate classification is fixture-tested only.** The parsing is covered,
  but no real `RTCStatsReport` from Chrome or Safari has been inspected.
- **Everything camera-dependent remains unverified on hardware.** That is what §5
  exists to close.
