# Memory Optimization on the 4 GB VPS

**Status:** 🟢 Deployed (`bf5a347`, 2026-08-05) · **Host:** `seo.ludekkvapil.cz` (185.8.165.241)

Why this document exists: the question "what happens if five people crawl a site at the same time —
will the VPS run out of memory?" turned out to have a reassuring answer for the wrong reason. The
concurrency cap held, but every mechanism that was supposed to _bound_ memory was either absent or
misconfigured in production. This records the analysis, what is deployed now, and what to reach for
next if it turns out not to be enough.

---

## Environment

|                   |                                                                     |
| ----------------- | ------------------------------------------------------------------- |
| Host              | 4 GB LXC container, 8 vCPU, **no swap**                             |
| Free RAM          | ~1.7 GB (other containers hold ~2.4 GB)                             |
| Largest neighbour | `creativekris-mysql` ≈ 590 MB — the OOM killer's most likely victim |
| Docker            | Compose v2.37.0, cgroup v2 → `deploy.resources.limits` is honoured  |

No swap is the reason memory pressure here is not a slowdown but an instant kill. It cannot be fixed
from inside the guest: adding swap to an LXC container requires the hosting provider.

---

## What was wrong (state before 2026-08-05)

Commit `95a1489` _"perf(seo-tools): optimize memory usage for 4GB VPS"_ (2026-07-26) had already
added the right fixes — but it was **never pushed to origin and never deployed**. Production ran
`7c32cb8`, an ancestor of it. The consequences:

**1. No container memory limit at all.** `docker inspect seo-tools-mcp` reported `Memory: 0`. The
`deploy:` block existed only in an unpushed local working copy.

**2. `NODE_OPTIONS=--max_old_space_size=30000`** — a 30 GB heap ceiling on a 4 GB box. This does not
come from this project's Dockerfile; it is **baked into the base image**
`apify/actor-node-playwright-chrome:20-1.60.0`. Every crawl child process inherited it, because
`spawnCrawl()` in `src/mcp-server.ts` passes `{ ...process.env }`. Node therefore had no reason to
apply GC pressure before the host ran out of RAM, and the decision fell to the kernel OOM killer —
which selects by RSS, i.e. a neighbouring MySQL rather than the crawler that caused the problem.

**3. `htmlContent: true` and `images: true`** in `config/crawler.yml` — roughly 330 MB per crawl of
extraction the SEO reports do not use.

**4. Crawlee's autoscaler was the only thing actually protecting the box**, and it was working with
a wrong number. It sizes its budget from host RAM (25 % of 4 GB = 1024 MB) and **each crawl process
does that independently, with no knowledge of a sibling crawl**. With two concurrent crawls allowed,
that is 2 GB of assumed budget. During a single-page crawl it already logged:

```
WARN PlaywrightCrawler:AutoscaledPool:Snapshotter:
     Memory is critically overloaded. Using 1056 MB of 1024 MB (103%). Consider increasing available memory.
```

### What was _not_ wrong

Worth stating explicitly, because it shaped the fix:

- **No memory leak.** Sampled across a 21-page crawl and again across a 10-minute unlimited crawl,
  usage is flat — it plateaus within seconds and stays there.
- **The concurrency cap works.** `SEO_MAX_CONCURRENT_CRAWLS` (default 2) is enforced in both
  `handleCrawl()` and `POST /api/crawl`; the third concurrent request gets
  `Too many crawls in progress, try again later`. Five simultaneous users therefore produce two
  crawls and three rejections, never five crawls.
- Further dampeners already in place: same-domain requests attach to the running job instead of
  starting a second crawl, reports are cached once per domain per day, unauthenticated crawls are
  capped at 50 pages, and a 15-minute wall-clock timeout kills runaway jobs.

---

## What is deployed now

| Setting                     | Before                       | Now                             | Where                                              |
| --------------------------- | ---------------------------- | ------------------------------- | -------------------------------------------------- |
| Container limit             | none                         | **1.5 GiB**                     | `docker-compose.yml` (`deploy.resources.limits`)   |
| Reservation                 | none                         | 512 MiB                         | same                                               |
| `NODE_OPTIONS`              | `30000` (from base image)    | **`--max-old-space-size=1024`** | compose `environment` overrides image ENV          |
| `CRAWLEE_MEMORY_MBYTES`     | unset (assumed 1024/process) | **512**                         | compose `environment`, inherited by crawl children |
| `SEO_MAX_CONCURRENT_CRAWLS` | implicit default             | **2, pinned**                   | `.env` on the VPS                                  |
| `htmlContent` / `images`    | `true` / `true`              | **`false` / `false`**           | `config/crawler.yml`                               |
| `config/`                   | copied into image            | **bind-mounted read-only**      | `docker-compose.yml`                               |

The limit is deliberately **1.5 GiB and not the 2.5 G originally proposed**: with only ~1.7 GB free,
a 2.5 G ceiling would never be reached — the host OOM killer fires first, which is precisely the
failure mode the limit is supposed to prevent. A cgroup limit is only protective if it sits _below_
free host memory.

`CRAWLEE_MEMORY_MBYTES=512` is chosen so that two concurrent crawls assume 1 GB combined, which fits
under the container limit. Crawlee throttles its own concurrency before the cgroup has to intervene.

### The `config/` bind-mount

`config/` is now mounted read-only into the `mcp` service. This is what makes the escalation options
below cheap: tuning `crawler.yml` needs only `docker compose restart mcp` instead of an image
rebuild, and `npm ci` + `tsc` on a 4 GB box with no swap is itself a memory risk.

Safe because `configService.loadConfig()` reads `process.cwd()/config/crawler.yml` and nothing
writes back into `config/` — the rate limiter persists to `./storage/rate-limiting/` instead.

---

## Measurements

All figures from the live VPS. "Visible" = `headless: false` via Xvfb, which is what the public
`POST /api/crawl` path uses; "headless" = the MCP `crawl` tool, which passes `--headless=true`.

| Scenario                                | Container peak             | Steady       | Host RAM cost   |
| --------------------------------------- | -------------------------- | ------------ | --------------- |
| Idle                                    | —                          | 19–24 MB     | —               |
| **Before:** 1 visible crawl, 21 pages   | ~1 GB RSS sum¹             | —            | **+270–330 MB** |
| **After:** 1 visible crawl, 8 pages     | **313 MB** (20 % of limit) | 274 MB       | +175 MB         |
| **After:** 2 concurrent headless crawls | **305 MB** (20 % of limit) | ~262 MB      | ~+260 MB        |
| **After:** 1 unlimited crawl, 10 min    | —                          | 278 MB, flat | —               |

¹ Sum of process RSS, which triple-counts Chromium's shared mappings; the host-RAM column is the
honest figure. Post-fix numbers are cgroup accounting from `docker stats`, which is exact.

Two concurrent crawls now cost less than one crawl did before the fix. Host available memory stayed
at ~1.4 GB throughout, and the crawler got noticeably faster (the old visible-mode path managed
about one page every 12 seconds).

**Worst case not directly measured:** two _visible_ crawls via the public endpoint. Extrapolating
from the single-crawl figure that is ~600 MB — roughly 40 % of the limit, still leaving >1 GB free.

### PDF report rendering (added 2026-08-16)

Report emails carry a PDF rendered from the `.md` (`src/services/reportPdfService.ts`), which means
a second, short-lived Chromium. Measured in the production base image under `--memory=1.5g`,
rendering the real 39-page ludekkvapil.cz report:

| Scenario                             | Container peak | Duration |
| ------------------------------------ | -------------- | -------- |
| Idle (nothing running)               | 1–7 MB         | —        |
| One PDF render, 39 pages, 356 kB out | **310 MB**     | ~0.6 s   |
| After the render returns             | 5 MB           | —        |

So a render costs about what a crawl does, but for well under a second rather than minutes, and the
memory is returned immediately when the browser closes. Two guards keep it bounded:

- **Renders are serialised to one at a time** (a module-level promise chain in
  `reportPdfService.ts`). Two audits finishing together queue rather than launching two browsers.
- **`SEO_PDF_TIMEOUT_MS`** (default 120 s) kills a stuck render, and the email then falls back to
  attaching the `.md` — a Chromium failure degrades the format, it does not lose the report.

Worst case is therefore 2 concurrent crawls (~610 MB) plus one render (~310 MB) ≈ 950 MB, still
inside the 1.5 G limit. The figures above come from `tsx`, which compiles TypeScript on the fly;
production runs the compiled `dist/`, so the real peak is somewhat lower.

Rendered PDFs are cached next to the `.md` and only re-rendered when the Markdown is newer, so a
same-day repeat request for a domain launches no browser at all. They land in
`storage/reports/<domain>/<date>/` and are covered by the existing `purge-old-data.ts` retention.

### Verification performed

- `docker inspect` → `Memory: 1610612736`, `Reservation: 536870912` (was `0 0`)
- Container env → `NODE_OPTIONS=--max-old-space-size=1024`, `CRAWLEE_MEMORY_MBYTES=512`,
  `SEO_MAX_CONCURRENT_CRAWLS=2`
- `config/crawler.yml` visible inside the container through the bind-mount with both flags `false`
- Third concurrent crawl correctly rejected with `Too many crawls in progress, try again later`
- Report content intact — `title`, `seo.metaTags`, `aiMetadata.structuredData`, `links.internal` /
  `links.external`, `fullText` all present; `htmlContent` and `images` absent by design
- `OOMKilled: false`, `RestartCount: 0`

---

## ⚠️ Operational caveat: image is older than the source tree

The VPS was updated with `git pull` + `docker compose up -d mcp`, **without a rebuild** —
deliberately, to avoid running `npm ci` + `tsc` on a low-memory box. Compose `environment` overrides
the image's ENV and `config/` is now a bind-mount, so every change above took effect.

But `dist/` inside the running image was built **2026-07-22**, while the checked-out source is at
`bf5a347` (2026-08-04). Source-level commits pulled in the meantime are therefore **not active**,
including `58cd3b4` (HTTP Basic Auth support) and `f578509` (merge dated crawl folders before
reporting). A rebuild is required to activate those — ideally at a quiet moment, or on a machine
with more headroom followed by an image transfer.

---

## If this is not enough

Escalation ladder, cheapest and most reversible first. Steps 1–4 are configuration only and take
effect with a restart.

1. **`SEO_MAX_CONCURRENT_CRAWLS=1`** (`.env` + `docker compose up -d mcp`). Halves the worst case
   outright. Cost: a second concurrent user gets a 429 instead of a crawl.
2. **Lower `CRAWLEE_MEMORY_MBYTES` to 384 or 256.** Crawlee throttles its own page concurrency
   earlier. Cost: slower crawls, no functional change.
3. **Switch the public path to headless** — `headless: true` in `config/crawler.yml`, then
   `docker compose restart mcp`. Meaningfully cheaper and faster. Deferred so far because visible
   mode appears to be a deliberate choice for bot-detection avoidance; verify crawl success rates on
   protected sites before keeping it.
4. **`maxConcurrency: 1`** in `config/crawler.yml` — one page at a time within a single crawl,
   instead of two.
5. **Lower `SEO_PUBLIC_CRAWL_MAX_REQUESTS`** below 50 to shorten unauthenticated crawls.
6. **Trim extraction further** in `config/crawler.yml` (`fullText`, `pageMap`, `structuredData`) —
   diminishing returns, and each one costs report quality.
7. **Add swap.** The single highest-value change, and the only one that turns a hard kill into a
   slowdown. Requires the hosting provider: the VPS is an LXC guest and swap cannot be added from
   inside.
8. **Move the crawler off this box** — a dedicated worker VPS, or Apify for the crawl step. This is
   the structural fix; everything above is a way of fitting a browser-driven crawler into 4 GB
   shared with a dozen other containers.

### Diagnosing a recurrence

```bash
# Did the container itself get killed?
docker inspect seo-tools-mcp --format 'OOMKilled: {{.State.OOMKilled}} | Restarts: {{.RestartCount}}'

# Did the kernel kill something else on the host? (needs sudo — not available to the deploy user today)
sudo dmesg | grep -iE "out of memory|oom-kill"

# Live usage during a crawl
docker stats --no-stream seo-tools-mcp; free -m

# Per-job crawler output
curl -s -H "Authorization: Bearer $SEO_MCP_TOKEN" \
  http://127.0.0.1:3001/api/crawl/status/<job_id>
```

`OOMKilled: true` means the container hit its own 1.5 GiB limit — raise it only if the host has
room, otherwise go down the ladder above. If the container is fine but a _neighbour_ died, the limit
is too high for current host conditions and should come down.

---

## Related, deliberately out of scope

- **IP reputation.** The crawler rotates eight fake browser user agents, sends spoofed `Sec-Fetch-*`
  headers and runs with `--disable-blink-features=AutomationControlled` and
  `--disable-web-security`. To a WAF this is the fingerprint of a malicious bot, and the risk is
  that `185.8.165.241` gets challenged or blocked. This is a separate decision, not a memory issue.
  (It is _not_ an SEO penalty — crawling third-party sites cannot affect our own domain's ranking.
  Email is unaffected too: it is relayed via `mail.gigaserver.cz:465`, not sent from the VPS IP.)
- **Secret hygiene.** The SMTP password is present in plaintext in the environment of the
  `api-ludekkvapil-assistant-1` container. Worth rotating; see `docs/SECURITY-KEY-ROTATION.md`.
