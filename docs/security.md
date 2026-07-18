# Security Decisions

## Domain ownership verification on `/api/crawl` (accepted risk)

**Status:** Accepted risk, not implemented, as of 2026-07-12. Tracked in `docs/todo.md` (A1).

The public, unauthenticated `POST /api/crawl` endpoint in `src/mcp-server.ts` lets anyone submit a
URL + email and get a crawl + SEO audit, by design — it's the free-tier lead-gen flow described in
`docs/business-plan.md`. There is no check that the requester owns or controls the domain being
crawled (no DNS TXT token, HTML file upload, or email-domain match, unlike e.g. Google Search
Console's verification flow). `ai/persona/permissions.md` documents domain-ownership verification as
a policy requirement for the AI persona, but nothing in `src/mcp-server.ts` enforces it in code.

**Decision:** for now, accept this risk rather than build a verification system, because:

- The endpoint already rejects SSRF targets (private/loopback/link-local IPs, non-http(s) schemes)
  via `validateCrawlTarget()`, re-verified again immediately before every page navigation (see
  "SSRF: TOCTOU via DNS rebinding" below) — so the risk is "crawl a public site you don't own," not
  "reach an internal service."
- It's a pre-revenue, low-traffic side project; building verification now is premature relative to
  other gaps.
- The abuse case (someone crawling an arbitrary public site) is bounded by the mitigations below,
  not by ownership — polite, rate-limited, capped crawls of public pages are a much smaller blast
  radius than an unbounded one.

**Mitigations in place instead** (`src/mcp-server.ts`):

- Per-IP rate limiting on crawl starts: `SEO_CRAWL_RATE_LIMIT` requests/hour (default 5), bypassed
  only by a valid `SEO_MCP_TOKEN`.
- Concurrency cap: `SEO_MAX_CONCURRENT_CRAWLS` (default 2) crawls in flight at once.
- **Hard page cap on unauthenticated requests**: `SEO_PUBLIC_CRAWL_MAX_REQUESTS` (default 50) is
  appended as `--max-requests=<N>` to the crawler CLI args whenever a request to `/api/crawl`
  arrives without a valid token. Authenticated (token-bearing) callers are exempt, since a valid
  token implies an authorized/trusted caller. Enforced via a new `--max-requests=<N>` CLI flag in
  `src/main.ts`, which overrides `config.crawler.maxRequestsPerCrawl` (previously defaulted to `0` =
  unlimited).
- **Wall-clock crawl timeout**: `SEO_CRAWL_TIMEOUT_MS` (default 15 minutes) kills the crawler child
  process in `spawnCrawl()` if it hasn't finished in time — Crawlee has no native
  overall-crawl-duration option, only a per-request timeout (`requestTimeoutSecs`), so this is
  enforced externally around the spawned process.
- SSRF protection (`validateCrawlTarget()`), domain-name denylist, and one-crawl-per-domain per-day
  caching (existing, unchanged).

**Revisit this decision when:**

- Traffic to `/api/crawl` grows enough that IP-based rate limiting stops being an effective abuse
  control (e.g. distributed abuse from many IPs).
- The product moves toward `docs/business-plan.md` Phase 1 (paid, authenticated tiers) —
  authenticated/paid crawls should not remain capped at the public-tier page limit forever; a real
  per-tenant quota system (business-plan Phase 3 prerequisite) should replace the binary
  token/no-token check used here.
- A specific abuse incident occurs (e.g. someone crawling a competitor or a site they don't own for
  scraping purposes) that the current mitigations don't address.

## SSRF: TOCTOU via DNS rebinding (closed)

**Status:** Closed, as of 2026-07-17. Found during an ASVS 5.0 review (1.3.6) of `src/mcp-server.ts`.

`validateCrawlTarget()` resolved DNS and checked for private IPs exactly once, when a crawl was
submitted. `POST /api/crawl` then spawns `src/main.ts` as a separate child process, which uses
Crawlee/Playwright to do its own, independent DNS resolution for every page it visits — seconds to
minutes after the one-time check, and again for every page over up to a 15-minute crawl
(`SEO_CRAWL_TIMEOUT_MS`). Neither `main.ts` nor any `src/services/*` module re-validated the target
before actually connecting.

This is a classic TOCTOU SSRF gap via DNS rebinding: an attacker submits a domain they control,
lets it resolve to a public IP long enough to pass `validateCrawlTarget()`, then re-points the
record (short TTL) at a private address before Playwright's actual request goes out. Because the
crawler child process runs in the same container as `mcp-server.ts` on the `agentic-ops` Docker
network, a successful rebind could reach this monorepo's other internal services (MongoDB, the
mail API, etc.), not just an arbitrary public site — a materially worse outcome than the
domain-ownership risk accepted above.

**Fix:** extracted the IP-check logic to `src/services/ssrfGuard.ts` (`checkUrlIsSafeToRequest`),
shared by `mcp-server.ts`'s submission-time check and a new `preNavigationHooks` entry
(`ssrfPreNavigationHook`) added to all three `PlaywrightCrawler` instances in `main.ts`. The hook
re-runs the same check immediately before every `page.goto()`, shrinking the TOCTOU window from
minutes to milliseconds — the standard mitigation for this class of bug (does not need Chromium's
own connection to be IP-pinned, which Playwright doesn't expose a hook for).

**Not fully eliminated**: the residual window between the hook's `dns.lookup()` and Chromium's own
subsequent resolution inside `page.goto()` is not zero — full elimination would require pinning the
resolved IP for Chromium's actual connection (e.g. via a proxy), which Crawlee/Playwright doesn't
support out of the box. Revisit if this becomes a real target for abuse.

## Related environment variables

| Variable                        | Default           | Purpose                                                     |
| ------------------------------- | ----------------- | ----------------------------------------------------------- |
| `SEO_MCP_TOKEN`                 | (unset)           | Shared secret for Basic/Bearer auth; required in production |
| `SEO_MAX_CONCURRENT_CRAWLS`     | `2`               | Max crawls running at once across all callers               |
| `SEO_CRAWL_RATE_LIMIT`          | `5`               | Unauthenticated crawl starts per IP per hour                |
| `SEO_CRAWL_READ_RATE_LIMIT`     | `120`             | Unauthenticated status/report reads per IP per hour         |
| `SEO_EMAIL_RATE_LIMIT`          | `5`               | Report emails sent to a given address per day               |
| `SEO_PUBLIC_CRAWL_MAX_REQUESTS` | `50`              | Page cap for unauthenticated `/api/crawl` requests          |
| `SEO_CRAWL_TIMEOUT_MS`          | `900000` (15 min) | Wall-clock kill switch per crawl child process              |
| `SEO_CORS_ORIGINS`              | (empty)           | Allowed cross-origin callers; empty = same-origin only      |

## Public endpoint hardening (A2)

In addition to the crawl-start rate limit, the following were added to `src/mcp-server.ts`:

- **Read rate limiting**: `GET /api/crawl/status/:id` and `GET /api/crawl/report/:id` were
  previously unlimited (only crawl _starts_ were rate-limited); both now share a generic
  sliding-window limiter (`isRateLimitedBucket()`) keyed per-IP, bounding job-ID
  scraping/enumeration without penalizing normal status polling. A valid `SEO_MCP_TOKEN` bypasses
  the limit, same as the crawl-start endpoint.
- **Email abuse control**: `sendSeoEmail()` now enforces `SEO_EMAIL_RATE_LIMIT` sends per recipient
  address per day, using the same generic limiter, closing the open-spam-vector risk where any
  address in the public POST body would receive a full report with only regex format validation.
- **Security headers**: all JSON responses and static frontend files now include
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and a
  minimal `Content-Security-Policy` (`object-src 'none'; frame-ancestors 'none'`). A stricter
  `default-src 'self'` was intentionally not applied because `FRONTEND_DIR` is mounted from an
  external build not present in this repo — revisit once that frontend's resource loading is audited
  (see the open question in `docs/todo.md`).

**Not yet addressed** (deferred, still open in `docs/todo.md` A2): in-memory `jobs` Map has no
persistence across restarts.

## Output sanitization for untrusted crawled content (A4)

**Status:** Markdown-syntax injection closed; plain-text prompt injection mitigated but not
guaranteed, as of 2026-07-12. Flagged by an OWASP ASVS review (V1.2.1) on the same date.

Crawled pages are third-party, untrusted content. Two related risks:

1. **Markdown syntax injection**: a crawled page's URL could contain characters (`` ` ``, `*`, `_`,
   `[`, `]`, `(`, `)`, `|`) designed to break out of Markdown link/table/code syntax in the
   generated audit report (`scripts/seo-audit.ts`). Page `title`/meta text is only measured (length,
   presence), never embedded raw, so URLs were the actual injection surface. Fixed by adding
   `mdEscapeUrl()` and `mdLink()` helpers in `scripts/seo-audit.ts`, applied at every site that
   embeds a crawled URL into the report. `mdLink()` additionally refuses to render non-`http(s)`
   schemes (e.g. `javascript:`) as clickable Markdown links.
2. **LLM prompt injection**: `getMarekSystemPrompt()` in `src/mcp-server.ts` concatenates the
   generated report Markdown into an LLM system prompt for the `seo-consultant-marek` MCP prompt. A
   malicious target page's content — plain English, not Markdown syntax — could contain
   instruction-like text (e.g. "ignore previous instructions and...") that an LLM might interpret as
   part of its system prompt. Escaping Markdown syntax does not address this. Mitigated (not solved)
   by wrapping the report content with explicit `<!-- BEGIN/END UNTRUSTED CRAWLED REPORT DATA -->`
   delimiters and an inline instruction telling the model to treat that section as data, not
   commands. This raises the bar but is not a hard guarantee against a sufficiently crafted
   prompt-injection payload.

**Not yet addressed**: full HTML/dashboard rendering of report content (`docs/todo.md` Phase C) is
not built yet. Markdown escaping is not equivalent to HTML/XSS sanitization — if report content is
ever rendered as HTML in a browser UI, a separate, stricter sanitization pass (e.g. an HTML
sanitizer library with an allowlist) is required before that ships, since Markdown-escaped text is
not automatically safe to inject into HTML.

## Data retention policy (A6)

**Status:** Policy defined and enforced via a script, as of 2026-07-12. No automated schedule wired
up yet (see "Not yet addressed" below).

`storage/{datasets,key_value_stores,request_queues,logs,reports}/<domain>/<DD-MM-YYYY>/` accumulate
indefinitely today — crawled third-party page content (titles, text, structured data, sometimes
personal data appearing on the crawled site itself) and generated reports had no expiry. This
matters under GDPR because the tool crawls and stores data about domains that may not belong to the
requester, and retains it with no defined lifetime.

**Policy:**

- Default retention: **90 days** from crawl date, for all storage types, all domains. Applies
  uniformly today since there's no tenant/tier distinction yet (ties to the tenant-isolation
  prerequisite below).
- Enforced by `scripts/purge-old-data.ts` (`npm run purge-old-data -- --days 90`), which deletes
  date-folders older than the cutoff across all five storage types plus prunes stale entries from
  `storage/crawl_alerts.jsonl`. Supports `--domain <name>` to scope to one domain and `--dry-run` to
  preview without deleting.
- **Not yet scheduled**: no cron/systemd timer or CI job runs this automatically yet — it must be
  invoked manually or wired into the deployment (e.g. a daily cron entry calling
  `npm run purge-old-data -- --days 90`) before this policy is actually self-enforcing in
  production. Tracked as a follow-up.

**Public `/api/crawl` email submissions**: the email address supplied to the public crawl endpoint
is held in-memory only (`job.email`/`job.emails` in `src/mcp-server.ts`'s `jobs` Map) and evicted
after `JOB_TTL_MS` (24h) via the existing cleanup interval — it is never written to disk except
indirectly, if a crawl triggers 3+ consecutive failures for that domain, in which case only the
domain name and failure count (not the email) are appended to `storage/crawl_alerts.jsonl`. There is
currently no durable, queryable store of submitted emails, so there is no separate
data-subject-deletion path to build yet; this will need revisiting once Phase C
(`docs/business-plan.md`) introduces persistent accounts/emails.

**Tenant isolation**: `ai/persona/integrity.md` documents "never leak one client's data to another"
as a rule, but there is no multi-tenant storage today — all crawl data lives in one shared
`storage/` tree with no per-tenant scoping, so there is nothing to isolate yet. This is a **hard
prerequisite** for Phase C: any tenant/account model must design per-tenant storage scoping (e.g.
`storage/<tenant>/<domain>/<date>/` or a separate bucket/prefix per tenant) from day one, not
retrofit it after multiple tenants already share the flat layout above.
