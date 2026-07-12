# seo-tools — Roadmap: Secure & Valuable Website SEO Analyzer

> Working checklist to evolve the existing crawler/audit engine into a hardened, scored,
> productizable SEO analyzer. Phases are ordered by dependency: security hardening first (the tool
> already crawls arbitrary third-party URLs in production via `/api/crawl`), then value-add analyzer
> upgrades, then the SaaS layer from `docs/business-plan.md`.

---

## Phase A — Security Hardening (close gaps in what already exists)

Everything below _extends or hardens_ existing protections in `src/mcp-server.ts` — it already has
real protections (Basic/Bearer auth via `crypto.timingSafeEqual`, SSRF protection via
`validateCrawlTarget()`, per-IP rate limiting, concurrency cap, path-traversal guard, CORS
allowlist). This phase closes the remaining gaps, not rebuilds any of that.

### A1. Domain ownership verification (critical gap — currently policy-only, not enforced)

- [x] Confirmed `ai/persona/permissions.md`'s domain-verification requirement is **not enforced in
      code** anywhere — it's an AI-agent policy instruction only. `POST /api/crawl` in
      `src/mcp-server.ts` accepts any SSRF-allowlisted URL from any anonymous IP.
- [x] Decided: **accept the risk** rather than build ownership verification for now (public endpoint
      = unverified + rate-limited + low page cap + wall-clock-capped only). Decision and rationale
      recorded in `docs/security.md`, with a revisit trigger for when to reconsider. See A3 for the
      caps that make this acceptable.
- [ ] If this decision changes: add a `verifications` store (domain → token/status) and a
      `verifyDomain()` check before `handleCrawl` / `/api/crawl` in `src/mcp-server.ts`; gate
      full-size crawls behind verified status, keep unverified crawls capped (ties to A3).

### A2. Public endpoint hardening in `src/mcp-server.ts`

- [x] `/api/crawl/report/:id` and `/api/crawl/status/:id` were unauthenticated with no rate limit on
      reads (only crawl-start was limited). Added a generic per-key sliding-window limiter
      (`isRateLimitedBucket()`) in `src/mcp-server.ts`, applied per-IP to both read endpoints via
      `SEO_CRAWL_READ_RATE_LIMIT` (default 120/hr, looser than crawl-start since polling is
      legitimate); a valid token bypasses it, matching the crawl-start pattern.
- [ ] The `jobs` Map (`activeCrawlCount()`) is still in-memory only — a server restart silently
      drops in-flight job state; add persistence or document the limitation.
- [x] `sendSeoEmail()` sent full report markdown to any address in the public POST body with only
      regex email-format validation. Added a per-recipient daily cap (`SEO_EMAIL_RATE_LIMIT`,
      default 5/day) via the same generic limiter, closing the open-spam-vector risk.
- [x] Static frontend server has a path-traversal guard (`safePath`) — added
      `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
      `Referrer-Policy:     no-referrer`, and a minimal `Content-Security-Policy` to all responses
      (static + JSON). A stricter `default-src 'self'` was intentionally deferred — see
      `docs/security.md`.

### A3. Crawl-size / resource-abuse limits (DoS via huge or pathological sites)

- [x] **Confirmed gap**: `maxRequestsPerCrawl` defaulted to `0` = unlimited
      (`src/services/config/configService.ts:71`, `src/services/config/apifyConfig.ts:78`), and
      `/api/crawl`'s `crawlArgs` never appended a `--max-requests` cap.
- [x] Added a `--max-requests=<N>` CLI flag to `src/main.ts` (mirrors the `--rate-limit=` idiom)
      that overrides `config.crawler.maxRequestsPerCrawl`. `POST /api/crawl` in `src/mcp-server.ts`
      now appends `--max-requests=<SEO_PUBLIC_CRAWL_MAX_REQUESTS>` (default 50) whenever the caller
      has no valid token; token-bearing callers are exempt. Configurable per tier once auth exists
      (Phase C).
- [x] Added a wall-clock timeout in `spawnCrawl()` (`src/mcp-server.ts`) that `SIGTERM`s the crawler
      child process after `SEO_CRAWL_TIMEOUT_MS` (default 15 min) — Crawlee has no native
      overall-crawl-duration hook, so this is enforced externally around the process.
- [ ] Verify `htmlContentService`/`main.ts` cap response body size read into memory per page
      (Crawlee/Playwright may already bound this — confirm, don't assume) and add an explicit
      max-content-length check if missing.
- [x] Confirmed the crawler now fetches/respects `robots.txt` disallow rules by default via
      `src/services/robotsService.ts` (`fetchRobotsRules`/`isAllowedByRobots`, wired into
      `src/main.ts`), gated by `CRAWLER_RESPECT_ROBOTS_TXT` / `--ignore-robots`.

### A4. Output sanitization for untrusted crawled content

- [x] Crawled URLs (the concrete injection surface — page `title` text is only measured, not
      embedded raw) flowed unescaped into Markdown reports (`scripts/seo-audit.ts`) as list items,
      `[url](url)` links, and backtick-wrapped table cells — a crafted URL could break out of
      Markdown syntax. Added `mdEscapeUrl()`/`mdLink()` helpers and applied them at every embed
      site; `mdLink()` also refuses to render non-http(s) schemes as clickable links. ASVS review
      (2026-07-12) flagged this as V1.2.1 FAIL; now closed for the Markdown-syntax angle. Full
      HTML/dashboard rendering (Phase C) will need a separate, stricter pass.
- [x] `getMarekSystemPrompt()` concatenates crawled report Markdown into an LLM system prompt — the
      URL-escaping above closes the Markdown-injection angle, but plain-English prompt-injection
      text embedded in page content (not a Markdown-syntax trick) isn't fully preventable by
      escaping alone. Added an explicit `<!-- BEGIN/END UNTRUSTED CRAWLED REPORT     DATA -->`
      delimiter around the report content in the prompt, giving the model a boundary to treat that
      section as data, not instructions — a mitigation, not a guarantee. Scoped as a known
      limitation beyond this point.

### A5. Secrets & config hygiene

- [ ] `.env` is correctly gitignored and untracked — add a pre-commit hook or CI check that fails if
      `.env`/credentials ever get staged; higher stakes once Stripe/OAuth secrets exist (Phase C).
- [ ] `SEO_MCP_TOKEN` is a single shared static secret compared via `crypto.timingSafeEqual` (good)
      — document a rotation procedure and add a test covering the "refuses to start in production
      without a token" fail-closed behavior (`mcp-server.ts:1079`).
- [ ] Confirm the internal mail API used by `sendSeoEmail()` isn't reachable/spoofable from outside;
      it's server-side only today — keep it that way, note as a boundary in docs.

### A6. GDPR / data-privacy posture (crawl data is stored, some about third parties)

- [x] Wrote and enforced a data-retention policy (90 days, all storage types) via new
      `scripts/purge-old-data.ts` (`npm run purge-old-data -- --days 90 [--domain X] [--dry-run]`) —
      deletes stale date-folders across
      `storage/{datasets,key_value_stores,request_queues,     logs,reports}/<domain>/<date>/` and
      prunes stale `crawl_alerts.jsonl` entries. Verified against a synthetic storage tree (old
      folders removed, recent kept, dry-run non-destructive). Full rationale in `docs/security.md`.
      **Not yet scheduled** — no cron/CI job runs it automatically yet; must be wired into
      deployment as a follow-up.
- [x] Documented what's persisted from public `/api/crawl` email submissions: in-memory only
      (`job.email`/`job.emails`, evicted after 24h via existing `JOB_TTL_MS` cleanup), never written
      to disk except indirectly (domain name + failure count, not email, in `crawl_alerts.jsonl` on
      3+ consecutive failures). No durable email store exists yet, so no data-subject-deletion path
      is needed yet — revisit at Phase C (persistent accounts).
- [x] Flagged tenant isolation as a hard Phase C prerequisite in `docs/security.md`: no multi-tenant
      storage exists today (all crawl data in one shared `storage/` tree), so any account/tenant
      model must design per-tenant storage scoping from day one, not retrofit it.

---

## Phase B — Core "Valuable" Analyzer Upgrades

Goal: match table-stakes categories from Screaming Frog / Sitebulb / Lighthouse / Ahrefs audits that
this project doesn't yet score, and give a single at-a-glance number.

### B1. Weighted SEO Score (0–100) — biggest "valuable at a glance" gap

- [ ] New module `scripts/seo-score.ts` (or extend `scripts/seo-audit.ts` directly) that consumes
      the same page data `seo-audit.ts` already loads and computes a weighted 0–100 score per domain
      (and optionally per page).
- [ ] Proposed category weights (sum to 100), grounded in what's already checked plus four
      industry-standard categories currently missing:

  | Category                                                       | Weight | Data source                              |
  | -------------------------------------------------------------- | ------ | ---------------------------------------- |
  | Indexability & crawlability (noindex, status codes, canonical) | 20     | `seo-audit.ts` `analyzePage()`           |
  | Meta/title/description quality                                 | 15     | `seo-audit.ts` title/description checks  |
  | Structured data coverage (JSON-LD vs. expected per page-type)  | 15     | `seo-audit.ts` page-type classification  |
  | Social/OG/Twitter card completeness                            | 5      | `seo-audit.ts` og:\*/twitter:card checks |
  | Content quality (thin-content ratio, word count)               | 10     | `seo-audit.ts` word-count bins           |
  | Internal linking health (orphan pages, link depth)             | 10     | `seo-audit.ts` internal link counts      |
  | Broken links / 404s                                            | 5      | `scripts/report-404s.ts`                 |
  | **[NEW] Page speed / Core Web Vitals**                         | 10     | not extracted today (see B2)             |
  | **[NEW] Mobile-friendliness / viewport**                       | 5      | not extracted today (see B3)             |
  | **[NEW] HTTPS & security headers**                             | 3      | not extracted today (see B4)             |
  | **[NEW] Sitemap & robots.txt validity**                        | 2      | discovery exists, no validation (see B5) |

- [ ] Score bands for the report header (90–100 Excellent / 70–89 Good / 50–69 Needs Work / <50
      Critical), rendered as a new §0 "Score" section prepended to `seo-audit.ts`'s Markdown output,
      next to the existing Executive Summary.
- [ ] Persist score history per domain/date alongside `storage/reports/<domain>/<date>/` so
      score-over-time becomes a trivial diff later (Phase C dashboard).

### B2. Page speed / Core Web Vitals extraction (new)

- [ ] Add `src/services/performanceService.ts` capturing Playwright navigation timing /
      `PerformanceObserver` metrics (LCP, CLS, TTFB) during the existing crawl pass in `src/main.ts`
      — reuse the already-open page context rather than a second pass.
- [ ] Alternative/complement: shell out to Lighthouse per page or per sample (homepage + top N pages
      by internal link count, since full Lighthouse per page is slow) — document the cost/accuracy
      tradeoff chosen.
- [ ] Store results in the per-page JSON schema (extend wherever `metaTagService.ts` /
      `htmlContentService.ts` write output) so `seo-audit.ts`/`seo-score.ts` can consume it.

### B3. Mobile-friendliness signal (cheap to add)

- [ ] Extend `src/services/metaTagService.ts` to explicitly flag `<meta name="viewport">`
      presence/correctness (likely already captured among the 80+ meta tags — confirm, then add the
      _judgment_ to `seo-audit.ts` `analyzePage()` and the B1 score).
- [ ] Optional: Playwright mobile-emulation render pass for a visual check — defer to Phase D unless
      cheap to bolt onto the existing crawl.

### B4. HTTPS & security headers signal (new)

- [ ] Extend response-header capture (already used for `status`/`headers` in `seo-audit.ts`) to
      explicitly check HSTS, `X-Content-Type-Options`, CSP presence, and flag mixed content
      (`http://` resources on an `https://` page) as issues + a score input.
- [ ] Flag any page served over plain `http://` when HTTPS is available as a Critical issue (not
      explicitly checked today).

### B5. Sitemap & robots.txt validity checks (extends existing discovery)

- [ ] `src/services/sitemapService.ts` already does XML+HTML sitemap _discovery_; add a _validation_
      pass: malformed XML, `<lastmod>` sanity, sitemap URLs returning non-200, orphaned sitemap
      entries — surface as a new report section and score input.
- [ ] Add a robots.txt fetch+parse check (ties to A3) reporting disallow rules, sitemap directives,
      and accidental blocking of important paths — new function in `sitemapService.ts` or a new
      `robotsService.ts`.

### B6. Competitive-parity gaps worth considering (evaluate, don't over-build)

- [ ] Duplicate content detection (title/description/H1 duplicates) — group by normalized value
      across existing per-page data, flag collisions in `seo-audit.ts`.
- [ ] Redirect chain analysis (3xx hop count/loops) — check whether Crawlee's response data already
      captures redirect chains; surface in `seo-audit.ts` if so, else scope as new.
- [ ] H1/heading hierarchy validation (multiple H1s, skipped levels) — `headingStructure` is already
      captured per page but unused in issue analysis; wire it into `analyzePage()`.
- [ ] Image alt-text coverage — confirm alt-text is captured in image metadata and add a coverage
      check to `seo-audit.ts` (not in the issue list today).

---

## Phase C — Productization (SaaS layer)

References the existing 4-phase roadmap in `docs/business-plan.md` §12 — not re-derived here, just
sequenced against the security/scoring prerequisites above.

- [ ] **Before business-plan Phase 1** (hosted crawl+auth+Stripe+free tier): complete Phase A (esp.
      A1 domain verification decision, A3 crawl-size caps, A6 tenant isolation design) — auth
      without tenant isolation and abuse caps just gives more people a bigger attack surface.
- [ ] **Before business-plan Phase 2** (dashboard/diffs/CSV export): complete B1 (scoring engine, so
      the dashboard has a headline metric) and A4 (output sanitization), since the dashboard is the
      first place crawled content gets rendered as HTML rather than Markdown.
- [ ] **Alongside business-plan Phase 2**: score-over-time trend/diff view is cheap once B1's
      persisted score history exists.
- [ ] **Before business-plan Phase 3** (white-label + API keys + MCP productization): add a
      per-tenant/per-API-key quota system, generalizing the existing per-IP
      `MAX_CONCURRENT_CRAWLS`/`CRAWL_RATE_LIMIT_PER_HOUR` pattern in `src/mcp-server.ts` — don't
      ship metered API access without it.
- [ ] **Business-plan Phase 4** (LLM "AI recommendations"): no change to this plan — correctly
      deferred; when built, feed it _sanitized summaries_ (per A4), never raw crawled HTML, and cap
      tokens per report per the business plan's existing risk mitigation table.

---

## Phase D — Nice-to-have / Future

- [ ] PDF export of reports (agencies will ask immediately per `docs/business-plan.md` open
      questions) — Markdown→PDF render off the existing `seo-audit.ts` output.
- [ ] CAPTCHA or proof-of-work challenge on the public `/api/crawl` endpoint if abuse persists
      beyond IP rate limiting (only needed if A2/A3 prove insufficient in practice).
- [ ] Competitor comparison mode (crawl two domains, diff scores/categories) — natural extension
      once B1 scoring exists.
- [ ] Visual mobile-emulation screenshots per page (deferred from B3).
- [ ] Self-hosted Lighthouse service (avoid third-party dependency) if B2's Lighthouse integration
      proves valuable at volume.
- [ ] Multi-language score localization beyond EN/CS, reusing `scripts/i18n.ts` pattern.

---

## Notes / Open Decisions to Resolve Before Starting

- [ ] **A1 must be explicitly decided** (build ownership verification vs. accept risk + cap public
      crawl scope) before any marketing push increases traffic to `/api/crawl` — this is the single
      highest-severity open item: right now anyone can crawl any public (non-private-IP) third-party
      domain via the lead-gen endpoint.
- [ ] Confirm whether the frontend directory referenced by `FRONTEND_DIR` in `src/mcp-server.ts` is
      source-controlled in this repo or deployed separately — affects where A2's CSP/security-header
      work and A4's sanitization work actually land.
