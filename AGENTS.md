# Metadata Crawler (SEO & GenAI Crawler) - Advanced Web Analysis Tool

## Overview

A comprehensive web crawler built with Crawlee and Playwright for advanced SEO analysis, AI-powered
content indexing, and website visibility optimization. The crawler extracts extensive metadata
including Google-supported SEO tags, structured data, AI indexing metadata, raw HTML content, and
image metadata — with Docker Compose as the recommended runtime.

> 💡 **Docker Compose is the recommended runtime** (reproducible, no host setup needed). The
> commands below all use it. Local development without Docker is also supported: run `npm install`
> (Node.js >= 20) and use the `npm run` scripts directly — handy for editor integration, debugging,
> and the husky/lint-staged pre-commit hooks.

## Docker Compose Workflow

### Build

```bash
# Build the app image (required after Dockerfile or package.json changes)
make build
# or: docker compose build app
```

### Crawl a website

```bash
# Crawl any site (via make)
make crawl ARGS="https://example.com --headless=true"

# Crawl with HTML sitemap (for sites without XML sitemap)
make crawl ARGS="https://example.com \
  --html-sitemap-url https://example.com/sitemap.html \
  --html-content \
  --headless=true"

# Crawl with domain/path exclusions
make crawl ARGS="https://example.com \
  --exclude-domains api.example.com,cdn.example.com \
  --exclude-paths /user/login,/admin"

# Incremental crawl (only new/modified pages)
make crawl ARGS="https://example.com --incremental --incremental-date 12-07-2025"

# Rate-limited crawl
make crawl ARGS="https://example.com --rate-limit=conservative"

# Single-page analysis
make crawl ARGS="https://example.com --single"

# Visible browser (for debugging / sites that block headless)
make crawl ARGS="https://example.com --headless=false"

# One-off without make
docker compose run --rm app npm run crawl -- https://example.com --headless=true
```

### Utilities

```bash
# Merge all domain JSONL files into unified dataset
make merge

# Build TypeScript
make build

# Type-check only (no emit)
make typecheck

# Run Jest tests
make test

# Lint
make lint

# Format
make format

# Open shell inside the container
make shell

# Compare sitemaps (incremental planning)
docker compose run --rm app npx tsx scripts/compare-sitemaps.ts \
  --domain example.com --previous-date 12-07-2025
```

### Command Line Options

```
make crawl ARGS="<URL> [OPTIONS]"
# or: docker compose run --rm app npm run crawl -- <URL> [OPTIONS]

Options:
  --url, -u <URL>                    Target URL to crawl
  --html-sitemap-url <URL>           HTML sitemap URL to discover pages from
  --html-content                     Enable full HTML + main content extraction
  --exclude-domains <domains>        Comma-separated domains to exclude
  --exclude <domains>                Short for --exclude-domains
  --exclude-paths <paths>            Comma-separated URL path prefixes to exclude
  --headless=<true|false>            true = invisible (default), false = visible browser
  --single, -s                       Single URL mode — don't follow links
  --incremental                      Enable incremental crawling mode
  --incremental-date <DD-MM-YYYY>    Previous crawl date for incremental comparison
  --rate-limit=<preset|N/H>          Rate limiting preset or "requests/hours"

Rate Limiting Presets:
  conservative   100 req/hour
  moderate       200 req/2 hours
  aggressive     500 req/3 hours
  bulk           1000 req/5 hours
  tiered         120/h + 300/3h + 600/5h
```

## Architecture

### Core Components

- **`src/main.ts`** — PlaywrightCrawler entry point; CLI argument parsing; sitemap discovery;
  request handler; data assembly
- **`src/services/`** — Modular extraction services
- **`src/utils/`** — URL, link, logging, ID utilities
- **`config/crawler.yml`** — Primary configuration file
- **`Dockerfile`** — Multi-stage build: `builder` (dev deps + tsx), `test` (Jest), final
  (production)
- **`docker-compose.yml`** — Defines `app` (default), `typecheck`, `test`, `mcp` services

### Directory Structure

```
metadata-crawler/
├── .actor/                        # Apify platform configuration
├── config/
│   ├── crawler.yml                # Main configuration
│   └── examples/
│       ├── basic.yml              # 50-page setup
│       ├── advanced.yml           # Unlimited, all features
│       ├── performance.yml        # Speed-optimized
│       └── single-url.yml        # Single page mode
├── scripts/
│   ├── compare-sitemaps.ts        # Incremental planning utility
│   ├── merge-domains-jsonl.ts     # Per-domain merger
│   ├── merge-to-jsonl.ts          # Multi-domain unified merger
│   ├── query-url-index.ts         # URL index query tool
│   ├── report-404s.ts             # 404 link report generator
│   ├── report-seo-issues.ts       # SEO issues report
│   └── seo-audit.ts               # Full SEO audit script
├── src/
│   ├── main.ts                    # Main crawler entry point
│   ├── services/
│   │   ├── config/
│   │   │   ├── configService.ts   # YAML config loader + defaults
│   │   │   ├── apifyConfig.ts     # Apify actor input handler
│   │   │   └── types.ts           # TypeScript interfaces
│   │   ├── aiMetadataService.ts   # JSON-LD, microdata, images, content metrics
│   │   ├── fileService.ts         # JSON file operations
│   │   ├── htmlContentService.ts  # Full HTML + main article HTML extraction
│   │   ├── metaTagService.ts      # 80+ Google/SEO meta tag extraction
│   │   ├── rateLimitingService.ts # Sliding-window rate limiting
│   │   ├── sitemapComparison.ts   # Incremental crawl sitemap diff
│   │   ├── sitemapService.ts      # XML + HTML sitemap discovery
│   │   ├── storageService.ts      # Domain/date-based storage management
│   │   └── urlIndexService.ts     # URL index tracking
│   ├── tests/                     # Jest test suite
│   └── utils/
│       ├── idGenerator.ts         # Unique ID generation
│       ├── linkUtils.ts           # Internal/external link classification
│       ├── logger.ts              # Structured logging
│       ├── urlUtils.ts            # URL utilities
│       └── userAgentRotator.ts    # User-agent rotation on 403
├── storage/                       # Runtime storage (git-ignored content)
│   ├── datasets/domain.com/DD-MM-YYYY/   # Per-page JSON + JSONL
│   ├── key_value_stores/          # Sitemaps and metadata
│   ├── logs/                      # Per-domain log files
│   ├── rate-limiting/             # Persistent request history
│   ├── reports/                   # SEO audit reports (JSON/CSV)
│   └── request_queues/            # Crawlee queue state
├── docker-compose.yml
├── Dockerfile
└── package.json
```

## Data Output Schema

Each crawled page produces a JSON record with the following fields:

```json
{
  "title": "Page Title",
  "url": "https://example.com/page",
  "fullText": "Plain text content (no HTML)",
  "timestamp": "2026-05-12T10:30:00.000Z",
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": { "content-type": "text/html", "...": "..." },
    "url": "Final URL after redirects"
  },
  "response_id": "Encrypted identifier based on response",
  "content_id": "Encrypted identifier based on text content",
  "etag": "HTTP ETag header value",
  "seo": {
    "metaTags": {
      "description": "...",
      "robots": "index, follow",
      "og:title": "...",
      "og:image": "..."
    },
    "specialLinks": {
      "canonical": "https://example.com/page",
      "alternate": [{ "hreflang": "cs", "href": "..." }],
      "stylesheet": ["..."],
      "preload": ["..."]
    },
    "hasDataNoSnippet": false
  },
  "aiMetadata": {
    "structuredData": {
      "jsonLd": [{ "@type": "Article", "...": "..." }],
      "microdata": [{ "type": ["..."], "properties": {} }]
    },
    "customMetadata": {
      "author": "...",
      "wordCount": 1250,
      "readingTime": "7 min",
      "headingStructure": [{ "level": 1, "text": "..." }]
    },
    "pageMap": {}
  },
  "links": {
    "internal": [{ "text": "...", "href": "...", "rel": "", "link_title": "" }],
    "external": [{ "text": "...", "href": "...", "rel": "", "link_title": "" }],
    "total": 45
  },
  "images": [
    {
      "src": "https://example.com/photo.jpg",
      "alt": "Description",
      "title": "",
      "width": "800",
      "height": "600",
      "srcset": "",
      "loading": "lazy",
      "classList": ["hero-image"],
      "sources": [{ "srcset": "...", "media": "(max-width: 600px)", "type": "image/webp" }]
    }
  ],
  "htmlContent": {
    "full": "<!DOCTYPE html><html>...</html>",
    "main": "<article>...</article>",
    "mainSelector": "article"
  }
}
```

> `htmlContent` is only present when `--html-content` flag is passed or
> `extraction.modules.htmlContent: true` is set in config.
>
> `images` is extracted by default (`extraction.modules.images: true`).

## Configuration

### Key Options (`config/crawler.yml`)

```yaml
targets:
  startUrls: [] # Override via CLI or .env
  allowedDomains: []
  excludedDomains: []
  excludedPaths: []
  sitemapDiscovery: true # Auto-discover XML sitemap
  htmlSitemapUrl: '' # HTML sitemap URL (for sites without XML sitemap)

crawler:
  maxRequestsPerCrawl: 0 # 0 = unlimited
  maxConcurrency: 2
  requestTimeoutSecs: 30
  headless: false # false = visible, true = invisible (stealth)
  requestDelayMin: 3000
  requestDelayMax: 9000
  singleUrlMode: false
  incrementalMode: false
  rateLimiting:
    enabled: false
    preset: 'bulk' # conservative | moderate | aggressive | bulk | tiered
    persistData: true

extraction:
  modules:
    basicData: true # Title, URL, timestamp, fullText
    responseData: true # HTTP status, headers
    links: true # Internal/external links
    seoTags: true # 80+ meta tags
    specialLinks: true # Canonical, hreflang, preload, etc.
    structuredData: true # JSON-LD, microdata
    aiMetadata: true # Custom fields, word count, headings
    contentMetrics: true # Word count, reading time
    pageMap: true # PageMap data
    htmlContent: false # Full HTML + main content (opt-in; increases output size)
    images: true # Image metadata (src, alt, width, height, srcset, etc.)
```

### Target URL — Required

A target URL must be provided via one of:

1. **Make**: `make crawl ARGS="https://example.com"`
2. **Docker Compose CLI**: `docker compose run --rm app npm run crawl -- https://example.com`
3. **`config/crawler.yml`**: set `targets.startUrls`
4. **`.env` file**: set `CRAWLER_START_URLS=https://example.com`

If none is provided, the crawler exits with "Domain is required".

### HTML Sitemap Support

For sites that use an HTML page as their sitemap (no XML sitemap):

```bash
docker compose run --rm app npm run crawl -- https://example.com \
  --html-sitemap-url https://example.com/sitemap.html
```

The crawler fetches the HTML page, extracts all `href` links matching the target domain, and
enqueues them alongside any XML sitemap URLs.

## Key Features

### SEO Extraction

- **80+ Meta Tags**: Google, Bing, Apple, Microsoft, Open Graph, Twitter Cards, Dublin Core
- **Special Links**: Canonical, hreflang, preload, dns-prefetch, stylesheet, AMP, manifest
- **Data-NoSnippet Detection**: Identifies Google snippet exclusion attributes

### Content Extraction

- **Full HTML** (`htmlContent.full`): Complete serialized page HTML via `page.content()`
- **Main Content HTML** (`htmlContent.main`): Auto-detected article body via CSS selector cascade:
  `main → article → [role="main"] → #content → .content → #main-content → .main-content → .article → .page-content → #main → .main → .entry-content → .post-content → body`
- **Plain Text** (`fullText`): Body text with scripts/styles stripped
- **Content Metrics**: Word count, reading time, heading structure (H1–H6)

### Image Metadata

Extracted from all `<img>` tags and `<picture>` elements:

- `src`, `alt`, `title`, `width`, `height`, `srcset`, `loading`, `classList`
- `sources[]` from `<picture>` — `srcset`, `media`, `type`

### Sitemap Discovery

- **XML Sitemap**: Auto-discovers `/sitemap.xml`, follows sitemap indexes
- **HTML Sitemap**: Parses any `href` links from a specified HTML sitemap page

### Incremental Crawling

Compare current sitemap against previous crawl to only process changed content:

```bash
docker compose run --rm app npm run crawl -- https://example.com \
  --incremental --incremental-date 12-05-2026
```

Modes: `incremental` (new+modified), `new-only`, `modified-only`, `all`

### Rate Limiting

Sliding-window rate limiting with persistent tracking across sessions:

| Preset       | Limit                   |
| ------------ | ----------------------- |
| conservative | 100 req/hour            |
| moderate     | 200 req/2 hours         |
| aggressive   | 500 req/3 hours         |
| bulk         | 1000 req/5 hours        |
| tiered       | 120/h + 300/3h + 600/5h |

### Anti-Bot Features

- **User-Agent Rotation**: Rotates through 8 real browser UAs on consecutive 403s
- **Human-like Scrolling**: Smooth scroll to middle (visible) or bottom (headless)
- **Realistic Headers**: Full browser header set with Accept, Sec-Fetch-\* etc.
- **Smart 403 Retry**: Automatically retries with visible browser when headless is blocked
- **Random Delays**: Configurable min/max delays between requests

## Storage Architecture

```
./storage/
├── datasets/
│   └── domain.com/
│       └── 12-05-2026/
│           ├── crawl-data.jsonl       # All pages for this domain+date
│           └── page-N-timestamp.json  # Individual page files (if enabled)
├── key_value_stores/
│   └── domain.com/
│       └── 12-05-2026/               # Sitemaps and metadata
├── logs/
│   └── domain.com/                   # Per-domain crawler logs
├── rate-limiting/
│   └── domain.com-requests.json      # Persistent request history
├── reports/                          # SEO audit output (JSON/CSV)
└── request_queues/
    └── domain.com/                   # Crawlee queue state
```

### Merge All Domains

```bash
docker compose run --rm app npm run merge-to-jsonl
# Output: ./storage/all-domains-merged.jsonl
```

Each merged record gains `_metadata.domain`, `_metadata.crawlDate`, `_metadata.sourceFile`.

## Examples

### Crawl a site that uses an HTML sitemap

```bash
make crawl ARGS="https://example.com \
  --html-sitemap-url https://example.com/sitemap.html \
  --html-content \
  --headless=true"
# Discovers pages from the HTML sitemap, extracts full HTML content + images
```

### SEO Audit

```bash
docker compose run --rm app npx tsx scripts/seo-audit.ts --domain example.com
docker compose run --rm app npx tsx scripts/report-seo-issues.ts --domain example.com
docker compose run --rm app npx tsx scripts/report-404s.ts --domain example.com
```

### Crawl with exclusions and rate limiting

```bash
docker compose run --rm app npm run crawl -- https://example.com \
  --exclude-domains "accounts.example.com" \
  --rate-limit=conservative \
  --headless=false
```

### Incremental update

```bash
docker compose run --rm app npm run crawl -- https://example.com \
  --incremental --incremental-date 01-05-2026 \
  --rate-limit=moderate
```

## Use Cases

- **SEO Auditing**: Meta tag completeness, canonical URLs, hreflang, robots directives
- **Content Archival**: Full HTML preservation with article body detection
- **Image Inventory**: Collect all image assets and their metadata
- **Site Structure Analysis**: Internal linking, sitemap coverage, 404 detection
- **AI Content Indexing**: Structured data, custom metadata, heading hierarchy
- **Historical Tracking**: Date-based storage for change analysis over time
- **Multi-site Management**: Domain-isolated storage for agency workflows
