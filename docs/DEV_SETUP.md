# Dev setup: HTTPS, iPad access, and on-device debugging

`getUserMedia` requires a secure context. `localhost` counts as one; a LAN IP does
not. iOS Safari grants no exception for a private-range address, so **the iPad
cannot open a camera until the dev server speaks HTTPS with a certificate the iPad
trusts.** Everything below exists to get to that point.

Tested on: Windows 11 laptop (`192.168.1.92`), Node 18.16, Vite 5.4.

---

## 1. Install mkcert and create the local CA

```bash
winget install FiloSottile.mkcert
```

Then, **in an elevated terminal** (right-click → Run as administrator):

```bash
mkcert -install
```

> **This step needs a UAC prompt and cannot be scripted.** Adding a root CA to the
> Windows trust store is a privileged operation by design. If you skip it, the iPad
> will still work (it trusts the CA separately, see step 3), but Chrome and Edge on
> the laptop will show a certificate warning on every load.

Verify it landed:

```bash
powershell -Command "Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Subject -like '*mkcert*' }"
```

## 2. Issue the server certificate

From the repo root, with your own LAN IP substituted:

```bash
mkcert -cert-file certs/dev-cert.pem -key-file certs/dev-key.pem 192.168.1.92 localhost 127.0.0.1 ::1
```

Find your LAN IP with:

```bash
powershell -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object IPAddress, InterfaceAlias"
```

`certs/` is gitignored. The private key must never be committed.

`vite.config.ts` picks the certificate up automatically. Without `certs/`, the dev
server falls back to plain HTTP and prints a warning — usable on the laptop via
`localhost`, useless for the iPad.

## 3. Trust the CA on the iPad

This is three separate steps, and iOS deliberately makes the last one manual.
Missing the third is the most common reason "I installed it and it still doesn't
work".

1. **Download.** On the iPad, open `https://<your-lan-ip>:5173/rootCA.crt`. Safari
   will warn that the certificate is untrusted — expected, since the CA is exactly
   what you are about to install. Tap **Show details → visit this website**. Safari
   prompts to allow a configuration profile download; allow it.
2. **Install.** Settings → General → VPN & Device Management → tap the downloaded
   profile → **Install** (top right), enter the passcode, **Install** again.
3. **Trust.** Settings → General → About → **Certificate Trust Settings** → enable
   the toggle next to `mkcert <user>@<host>`.

   Step 3 is separate from step 2 and is not optional. A profile installed but not
   enabled here produces exactly the same failure as no profile at all.

Then load `https://<your-lan-ip>:5173` on the iPad. The address bar should show no
warning. If it does, step 3 was missed or the certificate does not list this IP —
re-run step 2 with the correct address.

> **The certificate is pinned to an IP.** Change networks and the IP changes and the
> certificate stops matching. Re-run step 2 with the new address; the CA from step 1
> stays valid, so you do not need to redo the iPad trust dance.

## 4. Run the servers

Two processes, both needed for two-camera work:

```bash
npm run dev
```

```bash
npm run signal
```

The dev server prints the LAN URL and the CA download URL on startup.

**The signaling server also serves TLS**, reusing the same certificate. This is not
optional polish: a page served over `https://` cannot open a `ws://` socket, because
Safari and Chrome both block it as mixed content with no user override. The server
serves `wss://` whenever `certs/` exists, and the client derives its scheme from
`location.protocol` (`defaultSignalingUrl()` in `src/net/signaling.ts`).

Confirm reachability from both devices by opening `https://<lan-ip>:8787/` in a
browser — it should return `trainr signaling server ok`.

## 5. Debugging the iPad from Windows

**Safari Web Inspector requires macOS. It is not available here, and there is no
equivalent.** Be honest about the cost: no breakpoints, no step debugging, no
profiler, no proper network waterfall. This materially slows down diagnosing
anything on the iPad, and it is the single biggest tooling gap in this setup.

The options, worst to best for this project:

| Option | Verdict |
| --- | --- |
| Safari Web Inspector | Best by far. **Needs a Mac.** Unavailable. |
| `ios-webkit-debug-proxy` + RemoteDebug adapter | Bridges iOS WebKit to Chrome DevTools on Windows. Needs iTunes installed for the USB device drivers, is largely unmaintained, and breaks across iOS releases. Try it only if you need real breakpoints badly enough to fight it. |
| `weinre` | Long deprecated, does not understand modern JS. Do not bother. |
| **Eruda, in-page console** | **What this repo ships.** No infrastructure, works over the LAN, shows logs, errors, network and elements. |

### Using the on-device console

Append `?debug` to any URL on the iPad:

```
https://192.168.1.92:5173/?debug#/diagnostics
```

A floating button appears; tap it for a console, network log, element inspector and
resource view. The preference persists in `localStorage`, so a reload keeps it.
Disable with `?debug=0`.

It is **dev-only** — `src/devtools.ts` sits behind `import.meta.env.DEV`, so Rollup
drops it from production builds entirely (verified: `dist/` contains no eruda).

It is off by default even in dev, because its floating button overlaps the live
screen's tap targets.

### Getting numbers off the iPad

For anything you want to keep rather than read, use `/diagnostics` and its
**Download JSON** / **Copy JSON** buttons instead of the console. That is the
intended path for the capability probe, and it sidesteps the debugging gap.

---

## Troubleshooting

**"Camera not allowed" / `NotAllowedError` on the iPad**
Almost always a secure-context problem rather than a permissions one. Confirm the
address bar shows `https://` with no warning triangle. In iOS, a certificate the
user clicked through is *not* a secure context and `getUserMedia` will still refuse.

**Chrome on the laptop warns about the certificate**
Step 1 was skipped or the UAC prompt was declined. Re-run `mkcert -install` from an
elevated terminal.

**Pairing fails silently with no error**
Check the signaling scheme. An `https://` page and a `ws://` server produce a
mixed-content block that surfaces as a connection that never opens. `npm run signal`
prints the scheme it is serving on startup.

**iPad loads the page but the camera preview is black**
Check that another tab or app does not already hold the camera. iOS grants the
camera to one consumer at a time and does not always report the conflict.

**Vite is not reachable from the iPad at all**
Windows Firewall prompts once per network profile and defaults to blocking. Allow
Node on private networks, and confirm the laptop and iPad are on the same SSID —
guest networks and band-steering both isolate clients.
