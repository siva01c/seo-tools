# Business Plan — seo-tools as a Product

> Working name: **seo-tools** · planned domain: **seo.ludekkvapil.cz** · status: side project,
> pre-revenue. All prices and costs below are assumptions to validate, not commitments.

## 1. Executive summary

seo-tools is a working crawler + report generator that turns any website into an actionable,
bilingual (EN/CS) SEO audit. The plan: wrap the existing engine in a small SaaS (auth, billing,
hosted crawls), sell subscriptions with included report credits — agencies first (white-label client
reports), self-service SMB owners second, and a metered API/MCP offering for developers and AI
agents as the differentiator. Reports are generated deterministically, so the marginal cost per
report is near zero; margins are driven by subscription price minus a few cents of compute.

## 2. Product

### What exists today (proven on real sites)

- Crawlee/Playwright crawler: XML + HTML sitemap discovery, incremental crawls, rate limiting,
  anti-bot handling (UA rotation, human-like behavior), domain/path exclusions.
- Reports, each in English and Czech:
  - Full SEO audit (13 sections: executive summary, page inventory, structured data, technical SEO,
    entity/gap analysis, content metrics, internal linking, prioritized roadmap, developer backlog).
  - Issue reports as JSON + CSV: titles, meta descriptions, H1s, JSON-LD, orphaned pages.
  - 404 / broken link report with referrers.
- AI-readiness analysis: JSON-LD/microdata extraction, AI metadata, heading structure — the "GEO"
  (Generative Engine Optimization) angle.
- Multi-domain, date-versioned storage — already agency-shaped (one workspace, many client sites).
- MCP HTTP server exposing `crawl`, `get_report`, `list_reports` — AI agents can drive the whole workflow programmatically. It also integrates **Marek** (the AI SEO consultant persona) allowing LLMs to load prompt guidelines (`seo-consultant-marek`) and read audit reports directly.
- Docker-first: reproducible, self-hostable.

### What must be built for SaaS

- Web UI: submit URL → get report; report-language selection (defaults to one language of the user's
  choice; selecting more languages where the tier allows); crawl history per domain; diff between
  crawls.
- Authentication: Google OAuth + email magic link.
- Billing: Stripe subscriptions + credit top-ups.
- Job queue + worker pool for hosted crawls; per-tenant storage isolation.
- Report theming/white-label (logo, agency name, custom subdomain).

## 3. Target market and personas

| Persona                 | Need                                                          | Why they pay                                               |
| ----------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| **Web/SEO agency** (CZ) | Recurring client audits, before/after proof, reports in Czech | White-label PDF/MD reports save hours per client per month |
| SMB site owner          | "Is my web OK?" one-click check                               | Cheap subscription or one-off credit                       |
| Developer / AI agent    | Programmatic crawl + structured SEO data (API/MCP)            | Metered usage; unique GEO/AI-search capability             |

**Agencies first.** Fewer customers needed for the same revenue, the bilingual output and
multi-domain storage already fit their workflow, and one agency brings 10–50 sites at once. SMB
self-service runs on the same infrastructure with zero extra sales effort; API/MCP is early-stage
but almost nobody else offers it.

## 4. Value proposition and differentiation

- **Reports in the customer's language** — the user picks the report language (EN or CS today,
  extensible); incumbents are English-only, so Czech-language client-ready audits are a real niche.
  Multi-language output for the same crawl is an agency-tier capability.
- **AI/GEO readiness** — structured data and AI-metadata analysis plus an MCP interface; positions
  the product for "how visible is my site to AI search" demand before big players package it.
- **Data ownership** — self-host option (Docker) for agencies with confidentiality requirements.
- **Honest depth over breadth** — focused technical/on-page audit, not a 40-tool suite; cheaper and
  simpler than Ahrefs/Semrush for the audit use case.

## 5. Competitive landscape

| Competitor                         | Price (approx.)   | Their strength                  | Our edge / their gap                                           |
| ---------------------------------- | ----------------- | ------------------------------- | -------------------------------------------------------------- |
| Screaming Frog                     | £199/yr desktop   | Deep crawler, industry standard | Desktop-only, EN-only, no hosted/white-label                   |
| Ahrefs / Semrush audit             | $100–500/mo suite | Backlinks, rank tracking, brand | Expensive; audit is a side feature; EN-only                    |
| Sitebulb                           | $13–35/mo desktop | Great visual audit explanations | Desktop/cloud EN-only; no API/MCP, no CS                       |
| SE Ranking                         | ~$50/mo           | Affordable suite                | Audit shallow on structured data; EN-centric                   |
| Search Console + Lighthouse (free) | free              | Authoritative Google data       | No cross-site reports, no white-label, no JSON-LD gap analysis |

Realistic positioning: we will not out-feature the suites. We win on Czech language, white-label
price/performance for agencies, AI/GEO analysis, and programmable access.

## 6. Pros and cons (SWOT-style)

**Pros / strengths**

- The hard part (crawler + report engine) already works and is field-tested.
- Deterministic reports → marginal cost per report is cents; gross margin ~95 %+.
- CZ market niche with weak localized competition; founder has direct agency network.
- MCP/API for AI agents — genuine first-mover angle while GEO demand grows.
- Multi-domain storage and date-versioned crawls already match the agency workflow.

**Cons / weaknesses**

- Crowded global market with strong, cheap incumbents; differentiation must stay narrow.
- Solo/side-project capacity: support, sales, and SaaS plumbing compete with feature work.
- No brand, no SEO authority of its own yet (ironically, the product must rank).
- Polite crawling is slow (3–9 s/page) — big-site crawls take hours; needs queueing and expectation
  management.

**Threats / risks**

- Hosted crawler IPs get blocked (Cloudflare etc.); mitigation: per-customer rate limits, proxy pool
  budget, self-host fallback.
- Incumbents add Czech localization or bundled GEO audits.
- If an LLM layer is added, token costs and quality variance enter the margin equation.

**Opportunities**

- "AI search visibility" reports as a separately marketed product on the same data.
- White-label reseller deals: agencies sell the audit under their brand, we take a cut.
- Upsell path from automated report → paid human consultation.

## 7. Cost model per report (assumptions to validate)

Crawling is CPU-light but wall-clock-slow (polite delays dominate). One worker on a ~€10/month VPS
can run several concurrent crawls.

| Site size (pages) | Crawl time (approx.) | Compute + storage cost | Notes                           |
| ----------------- | -------------------- | ---------------------- | ------------------------------- |
| ≤ 50              | ~5–10 min            | < €0.01                | typical SMB site (~2.5 MB data) |
| ≤ 500             | ~1–2 h               | ~€0.02–0.05            | queue per tenant                |
| ≤ 5 000           | ~10–20 h             | ~€0.20–0.50            | needs incremental crawls        |

- **Single vs. multiple languages:** the crawl is shared; an additional report language only re-runs
  generation (seconds, no tokens today) — effectively free to serve. Product model: every report is
  generated in **one language selected by the user** by default; selecting more languages is an
  Agency-tier feature. Since the extra language costs ~nothing, the gate is pure upsell margin.
- **Token usage today: zero.** All current reports are deterministic code, no LLM involved.
- **Future LLM recommendations layer** (per ~50-page site, feeding summaries — not raw HTML — to the
  model, est. 20–50k input / 2–5k output tokens):
  - Frontier API model: best quality, ~€0.05–0.30/report, zero ops. Best fit for a paid add-on.
  - Small hosted model (Haiku-class): ~€0.01–0.03/report, good for bulk/agency volume.
  - Open-source self-hosted (e.g. via Docker Model Runner): no per-token cost and full data privacy,
    but a GPU box is a fixed cost (~€100+/mo) and quality/maintenance burden is ours — only worth it
    at volume or for self-host enterprise deals.
  - Recommendation: launch without LLM; add it as a priced add-on ("AI recommendations") using a
    frontier API, revisit self-hosting when volume justifies it.

## 8. Monetization options

| #   | Model                              | Pros                                                           | Cons                                                               |
| --- | ---------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | Pay-per-report credits             | Zero-commitment entry; matches "audit before redesign" demand  | Unpredictable revenue; no recurring relationship                   |
| 2   | Subscription tiers                 | Predictable MRR; fits agency monthly-report workflow           | Entry barrier; must keep delivering monthly value (diffs, history) |
| 3   | Freemium + free trial              | Marketing engine; report itself advertises the product         | Free riders; crawl compute abuse needs limits                      |
| 4   | White-label for agencies           | Higher willingness to pay; sticky; they do the selling         | Support burden; feature requests (PDF export, branding)            |
| 5   | Metered API / MCP access           | Differentiator; usage scales with AI-agent adoption            | Small market today; metering/abuse infrastructure needed           |
| 6   | One-off professional audit (human) | High ticket (€300–1 000); validates the tool with real clients | Sells founder time, doesn't scale                                  |
| 7   | Self-hosted / on-prem license      | Enterprise privacy story; no hosting costs for us              | Piracy/licensing enforcement; support without access to the system |
| 8   | Affiliate / marketplace referrals  | Monetizes free users (report links to fix-it services)         | Weak revenue; can undermine trust if pushy                         |

**Recommendation — hybrid, in this order:**

1. **Subscriptions with included credits** (core revenue): monthly tiers include N report credits;
   top-up credit packs for overflow. Combines MRR predictability with per-report flexibility from
   the original notes ("credits vs subscriptions with some limits").
2. **Agency tier with white-label** as the premium plan — this is where CZ revenue actually is.
3. **Free tier** (1 small site, 1 report/month, no white-label) as the marketing engine instead of a
   time-limited trial: every generated report is a demo.
4. **Metered API/MCP** for developers/AI agents — keep cheap and simple at first (credit-based, same
   credits as reports); it is positioning as much as revenue.
5. Keep **one-off human audits** opportunistically (they fund development and feed case studies);
   defer self-hosted licensing and affiliates until there is inbound demand.

## 9. Pricing sketch (to validate with 5–10 agency interviews)

| Tier   | Price (EUR/mo)  | Domains | Pages/crawl | Reports/mo | Languages                      | White-label | API/MCP |
| ------ | --------------- | ------- | ----------- | ---------- | ------------------------------ | ----------- | ------- |
| Free   | 0               | 1       | 50          | 1          | 1 (user's choice)              | —           | —       |
| Solo   | 19              | 3       | 500         | 10         | 1 (user's choice)              | —           | —       |
| Agency | 79              | 25      | 5 000       | 50         | multiple (EN + CS, extensible) | ✅          | ✅      |
| Top-up | 10 / 10 credits | —       | —           | +10        | —                              | —           | —       |

- CZ market note: display CZK prices (~25 CZK/EUR), Solo ≈ 490 Kč, Agency ≈ 1 990 Kč; prices excl.
  VAT (21 %).
- 1 credit = 1 report generation for one domain in the selected language. Multi-language output for
  the same crawl is included in the Agency tier only.

## 10. Payments and authentication

- **Payments:** Stripe (subscriptions + one-time credit packs). Czech specifics: Stripe Tax for EU
  VAT, invoices required by CZ B2B customers — Stripe invoicing or Fakturoid integration.
- **Auth:** Google OAuth + email magic link (no passwords to manage). Per the original notes.
- **Tenancy:** one account → many domains; API keys per account for the metered tier.

## 11. Go-to-market

1. **CZ first.** Direct outreach to the founder's web-dev/Drupal network and agencies; the
   macronsoftware.cz audit is the first case study.
2. **The report is the funnel:** free tier reports carry discreet branding; every shared audit
   recruits the next user.
3. Content: publish tool-generated teardowns of known Czech sites ("Co říká o vašem webu jeho
   JSON-LD"), Drupal community talks/posts.
4. **EN market second**, led by the API/MCP + GEO angle (where bilingual CS is irrelevant but
   AI-agent integration is rare).

## 12. MVP roadmap

| Phase | Scope                                                                      | Gate to next phase          |
| ----- | -------------------------------------------------------------------------- | --------------------------- |
| 1     | Hosted crawl + report behind Google/email auth, Stripe checkout, free tier | 10 active users, 3 paying   |
| 2     | Dashboard: crawl history, report diffs between dates, CSV export           | 1 agency using it weekly    |
| 3     | White-label (logo/subdomain), API keys, MCP productization                 | first white-label customer  |
| 4     | LLM "AI recommendations" add-on (frontier API), AI-visibility report       | margin per report validated |

## 13. Unit economics and metrics

- Marginal cost per report: < €0.05 (compute) today; +€0.05–0.30 if AI add-on used.
- Solo tier at €19/mo with 10 reports ≈ 97 %+ gross margin → economics are about acquisition and
  churn, not COGS.
- Track: signup → first report conversion, free → paid conversion, monthly active domains, churn by
  tier, credit top-up frequency (signal to retier), crawl failure rate (blocking).

## 14. Risks and mitigations

| Risk                                           | Mitigation                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hosted crawler blocked by target sites/CDNs    | Polite defaults, per-tenant rate limits, proxy budget, self-host docs                         |
| Legal: crawling ToS, GDPR (storing crawl data) | Crawl only customer-authorized domains (verification step), data retention policy, EU hosting |
| Incumbent adds CZ/GEO features                 | Stay niche-fast: agency workflow + MCP depth they won't prioritize                            |
| Solo-founder bandwidth                         | Strict phase gates (§12), no custom features before Phase 3                                   |
| LLM cost/quality drift (Phase 4)               | Add-on priced separately; cap tokens per report; model swap layer                             |

## 15. Open questions

- Branding: launch under seo.ludekkvapil.cz, or pick a product name + domain before Phase 1 (renames
  after agencies adopt white-label are painful)?
- Is MCP access free marketing (drives adoption) or a paid tier from day one?
- PDF export: agencies will ask immediately — Phase 2 or Phase 3?
- When to enter the EN market — after CZ validation, or in parallel via the API/GEO angle?
- One-off human audit pricing and how prominently to offer it without cannibalizing self-service.
