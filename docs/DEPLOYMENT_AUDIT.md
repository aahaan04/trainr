# Task 0 — Deployment audit

Everything in the tree that assumes a local LAN environment, and the decision for
each. Written **before** any code changed.

## Correction to the brief

The brief says "the log relay, `/diagnostics`, and `/selftest` were built dev-only
and verified absent from production builds."

**Only `/diagnostics` and the eruda dev console exist.** There is no log relay and
no `/selftest` route — `find src -iname '*selftest*' -o -iname '*relay*'` returns
nothing. `/diagnostics` is a normal route and is *already* in the production bundle;
it was never dev-gated. Only eruda (`src/devtools.ts`) is behind
`import.meta.env.DEV`.

So Task 2 is mostly **build**, not **un-gate**. Recorded here so the gap is not
mistaken for a regression later.

## Findings

| # | Item | Location | Hosted equivalent | Decision |
|---|---|---|---|---|
| 1 | Signaling URL + scheme derivation | `src/net/signaling.ts:44` `defaultSignalingUrl()` | none — derives host from `location`, port 8787 | Replace via `SignalingTransport` (Task 1). Keep local impl. |
| 2 | Node `wss://` relay | `server/signaling.mjs` | **none.** Vercel functions cannot hold a socket | Keep for local dev; Supabase Realtime in prod. |
| 3 | `rootCA.crt` route | `vite.config.ts` `devCertPlugin`, `apply: 'serve'` | not needed — Vercel issues a real cert | Leave dev-only. No prod equivalent required. |
| 4 | Dev COOP/COEP headers | `vite.config.ts:111` | no prod equivalent | See finding 8. Do **not** replicate. |
| 5 | eruda dev gating | `src/devtools.ts:28` | stripped from prod | Must work in prod behind the gate (Task 2). |
| 6 | Hardcoded `192.168.1.92` | `docs/DEV_SETUP.md`, `signaling.test.ts` | n/a | Docs + test fixtures only. No source references. Leave. |
| 7 | Secure-context check | `src/capture/getUserMedia.ts:20` | — | **Already correct.** Checks `window.isSecureContext` first, so Vercel HTTPS passes. No change. |
| 8 | MediaPipe threading | `public/mediapipe/wasm/` | — | **Single-threaded build, confirmed.** See below. |
| 9 | Not a git repository | repo root | — | **Blocks Vercel git import.** Human decision needed. |
| 10 | 19 MB `dist`, all precached | `vite.config.ts` workbox `globPatterns` | — | **Not tolerable on cellular.** Change caching strategy. |
| 11 | No `vercel.json` | — | — | Create: SPA rewrite, headers, `Permissions-Policy`. |
| 12 | No source maps in prod | build config | — | Enable (Task 2). |
| 13 | No error boundary / `unhandledrejection` reporting | — | — | Build (Task 2). |
| 14 | Supabase not installed | `package.json` | — | Add `@supabase/supabase-js`. |

## Finding 8 — cross-origin isolation is NOT needed, with evidence

The task said not to guess, so this was measured against the actual asset:

```
Atomics             0 occurrences
SharedArrayBuffer   0 occurrences
proxyWorker         0 occurrences
*.worker.js         absent (threaded MediaPipe builds ship one)
wasm atomic opcodes absent (no 0xFE prefix)
```

This is the **single-threaded** `vision_wasm_internal` build.

**Therefore production must NOT set `Cross-Origin-Embedder-Policy: require-corp`.**
Isolation would buy nothing and would break every cross-origin asset lacking CORP
headers. The dev server's existing COOP/COEP headers are harmless locally
(`credentialless` is permissive) but are not replicated in `vercel.json`.

## Finding 9 — deployment method needs a human decision

Vercel's normal flow imports a **git repository**. This directory is not one.
Two options, neither of which I should pick unilaterally since one publishes code
to a third party:

- `git init`, push to GitHub, import in Vercel. Gets preview deploys per push.
- `vercel --prod` from the CLI, no git. Simpler, no preview deploys, no history.

Flagged in `DEPLOYMENT.md` rather than assumed.

## Finding 10 — first load is 19 MB

| Asset | Size |
|---|---|
| `vision_wasm_internal.wasm` | 11.2 MB |
| `pose_landmarker_lite.task` | 5.6 MB |
| app JS | ~0.5 MB |

Workbox currently precaches `wasm` and `task`, so a cold visit downloads all of it
before the app is usable. On cellular that is minutes.

Both assets are only needed by **automatic** strike-zone detection, which is one
optional path in the setup wizard — manual zone entry needs neither. So they move
from precache to runtime cache: fetched on first use, cached thereafter, and still
available offline once fetched. Offline cold start of the **app** is preserved; what
degrades is automatic zone detection before its first use, which is stated in the
docs rather than hidden.
