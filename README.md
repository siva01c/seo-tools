# Metadata Crawler (SEO & GenAI Crawler)

A comprehensive web crawler built for advanced SEO analysis, AI-powered content indexing, and
website visibility optimization. This powerful tool extracts extensive metadata including
Google-supported SEO tags, structured data, and AI indexing metadata perfect for content
optimization and search engine analysis.

**Docker Compose is the recommended runtime** (reproducible, no host setup) — run crawler commands
inside the `app` service. Local development without Docker also works: `npm install` then use the
`npm run` scripts directly (Node.js >= 20 + `npx playwright install chromium`).

## 🔧 Recent Updates

### ✅ Advanced Rate Limiting (NEW!)

- **Configurable Time Windows**: Support for 1-5 hour rate limiting windows
- **Multiple Concurrent Rules**: Apply multiple rate limits simultaneously
- **Sliding Window Algorithm**: Accurate rate limiting with sliding time windows
- **Persistent Request History**: Request tracking persists across crawler sessions
- **Smart Request Distribution**: Automatic delay calculation for even distribution
- **Built-in Presets**: Conservative, moderate, aggressive, bulk, and tiered options
- **Command Line Support**: Easy rate limiting with `--rate-limit` argument

### ✅ Smart Incremental Crawling

- **Sitemap Comparison**: Automatically compare current sitemap with previous crawls
- **Intelligent URL Filtering**: Only crawl new or modified content since last crawl
- **Multiple Detection Methods**: lastmod dates, failed URLs, age-based thresholds
- **Flexible Modes**: incremental, new-only, modified-only, or full crawl
- **Massive Time Savings**: Reduce crawl scope by 70-90% for established sites

### ✅ Enhanced URL Filtering

- **Path-Based Exclusions**: Exclude specific URL paths like `/user/login`, `/admin`
- **Smart User-Agent Rotation**: Automatically rotate user-agents on 403 errors
- **Advanced Domain Logic**: Improved allowedDomains support with proper subdomain handling
- **Debug Mode**: Enhanced logging for troubleshooting domain/path filtering

### ✅ Enhanced Configuration Management

- **YAML-Based Launch Arguments**: Browser launch arguments moved from code to configuration
- **Separate Browser Profiles**: Different settings for headless vs visible browser modes
- **Maintainable Architecture**: No more hardcoded browser arguments in source code

### ✅ Improved Command Line Interface

- **Flexible URL Input**: Support for multiple URL argument formats
- **Browser Mode Control**: Easy switching between headless and visible modes
- **Direct Execution**: Alternative to npm scripts for simplified usage

## 🚀 Features

### 🎯 SEO Analysis

- **Complete Google Meta Tags**: Extract all Google-supported meta tags including robots, viewport,
  social media tags
- **Canonical & Hreflang**: International SEO and duplicate content management
- **Link Analysis**: Categorize internal vs external links with detailed attributes
- **Response Monitoring**: HTTP status codes, headers, and redirect tracking
- **Bot Detection Bypass**: Advanced fingerprinting and realistic browsing behavior

### 🌐 Advanced Crawling

- **Smart Incremental Crawling**: Only crawl new/modified content based on sitemap comparison
- **Human-like Behavior**: Automatic page scrolling and realistic delays (3-15 seconds)
- **Full Browser Simulation**: 1920x1080 viewport with comprehensive browser fingerprinting
- **Anti-Detection**: Stealth mode with automatic user-agent rotation on 403 errors
- **Visual Debugging**: Optional visible browser mode with 60-second error pauses
- **Smart 403 Retry**: Automatic retry with visible browser when headless mode is blocked
- **Advanced Filtering**: Domain exclusion + path-based exclusions (e.g., `/user/login`)

### 🤖 AI-Powered Indexing

- **Structured Data**: JSON-LD and Schema.org microdata extraction
- **Custom Metadata**: AI-specific tags for enhanced search indexing
- **Content Metrics**: Automatic word count, reading time, and heading structure analysis
- **PageMap Support**: Advanced search filtering attributes for AI systems

### 🗺️ Site Discovery & Storage

- **Automatic Sitemap Discovery**: Parse XML sitemaps and sitemap indexes
- **Path Tracking**: Generate comprehensive site structure maps
- **Domain Filtering**: Stay within target domain boundaries with advanced exclusion rules
- **Domain-based Storage**: Organized data structure: `storage/domain.com/DD-MM-YYYY/datasets/`
- **Date-based Organization**: Automatic timestamped storage for historical tracking
- **Real-time Storage**: Save data during crawling with individual files and JSONL format
- **Multi-domain Merging**: Combine all domain JSONL files into unified dataset with metadata

## 📝 Input Configuration

### Target URL Options

1. **Docker Compose CLI (Recommended)**: Run `npm` scripts inside the `app` service
2. **Configuration File**: Set multiple URLs in YAML configuration
3. **Apify Input**: Provide via actor input when running on Apify platform

### Domain Exclusion Configuration

Exclude specific subdomains or domains from crawling:

#### Configuration File Method

```yaml
targets:
  excludedDomains:
    - 'api.example.com' # Exclude API subdomain
    - 'cdn.example.com' # Exclude CDN subdomain
    - 'static.example.com' # Exclude static assets
```

#### Command Line Method

```bash
# Exclude specific subdomains
docker compose run --rm app npm run crawl -- https://example.com --exclude-domains "api.example.com,cdn.example.com"

# Short version
docker compose run --rm app npm run crawl -- https://example.com --exclude "api.example.com,static.example.com"

# Exclude a subdomain, visible browser, with rate limiting
docker compose run --rm app npm run crawl -- https://example.com --exclude "accounts.example.com" --headless=false --rate-limit=conservative
```

### Path-Based Exclusions

Exclude specific URL paths from crawling:

#### Configuration File Method

```yaml
targets:
  excludedPaths:
    - '/user/login' # Exclude login pages
    - '/admin' # Exclude admin section
    - '/api/' # Exclude API endpoints
    - '/private' # Exclude private pages
```

#### Command Line Method

```bash
# Exclude specific paths
docker compose run --rm app npm run crawl -- https://example.com --exclude-paths "/user/login,/admin,/api/"

# Combined with domain exclusions
docker compose run --rm app npm run crawl -- https://example.com --exclude-domains "api.example.com" --exclude-paths "/user/login"
```

## 🔄 Smart Incremental Crawling

Dramatically reduce crawl time by only processing new or modified content since your last crawl.

### How It Works

The crawler compares the current sitemap with your previous crawl data to identify:

- **New URLs**: Pages that didn't exist before
- **Modified URLs**: Pages with updated `lastmod` dates or failed in previous crawls
- **Unchanged URLs**: Content that hasn't changed (skipped)
- **Removed URLs**: Pages that no longer exist

### Usage

#### Command Line

```bash
# Enable incremental mode with specific previous crawl date
docker compose run --rm app npm run crawl -- https://example.com --incremental --incremental-date 12-07-2025

# Enable incremental mode with auto-detection (fallback to full crawl)
docker compose run --rm app npm run crawl -- https://example.com --incremental
```

#### Configuration File

```yaml
crawler:
  incrementalMode: true
  incrementalConfig:
    previousCrawlDate: '12-07-2025' # DD-MM-YYYY format
    mode: 'incremental' # incremental | new-only | modified-only | all
    autoDetectPreviousCrawl: true
    maxAgeThresholdDays: 30 # Consider URLs older than 30 days as modified
```

#### Standalone Comparison

```bash
# Compare sitemaps and see what would be crawled
docker compose run --rm app npx tsx scripts/compare-sitemaps.ts --domain example.com --previous-date 12-07-2025

# Get only new URLs as JSON for scripting
docker compose run --rm app npx tsx scripts/compare-sitemaps.ts --domain example.com --mode new-only --output json

# Get incremental URL list
docker compose run --rm app npx tsx scripts/compare-sitemaps.ts --domain example.com --output list --limit 100
```

### Incremental Modes

- **`incremental`**: Crawl new + modified URLs (recommended)
- **`new-only`**: Only crawl completely new URLs
- **`modified-only`**: Only crawl URLs that have changed
- **`all`**: Full crawl regardless of previous data

### Expected Results

```
📊 Sitemap Comparison Summary:
├── 🆕 New URLs: 45
├── 🔄 Modified URLs: 23
├── ✅ Unchanged URLs: 892
├── 🗑️ Removed URLs: 12
└── 📋 Total current URLs: 960

🎯 Incremental crawl will process 68 URLs (7.1% of total)
```

**Time Savings**: Reduce crawl scope by 70-90% for established sites!

## ⏱️ Advanced Rate Limiting

Prevent overwhelming target servers with advanced rate limiting that supports multiple time windows
and intelligent request distribution.

### How It Works

The rate limiting system uses sliding time windows to accurately track and limit requests:

- **Multiple Rules**: Apply several rate limits simultaneously (e.g., 100/hour + 300/3hours)
- **Sliding Windows**: More accurate than fixed time periods
- **Persistent Tracking**: Request history saved across crawler sessions
- **Smart Distribution**: Automatically calculates optimal delays between requests

### Usage

#### Docker Compose CLI (Recommended)

```bash
# Use built-in presets
docker compose run --rm app npm run crawl -- https://example.com --rate-limit=conservative  # 100 requests/hour
docker compose run --rm app npm run crawl -- https://example.com --rate-limit=moderate      # 200 requests/2h
docker compose run --rm app npm run crawl -- https://example.com --rate-limit=aggressive    # 500 requests/3h
docker compose run --rm app npm run crawl -- https://example.com --rate-limit=bulk          # 1000 requests/5h
docker compose run --rm app npm run crawl -- https://example.com --rate-limit=tiered        # Multiple rules

# Custom format: "requests/hours"
docker compose run --rm app npm run crawl -- https://example.com --rate-limit=200/3         # 200 requests per 3 hours
docker compose run --rm app npm run crawl -- https://example.com --rate-limit=100/1         # 100 requests per hour
docker compose run --rm app npm run crawl -- https://example.com --rate-limit=600/5         # 600 requests per 5 hours
```

#### Configuration File

```yaml
crawler:
  rateLimiting:
    enabled: true
    persistData: true # Save request history across sessions

    # Use a preset (uncomment one):
    # preset: "conservative"       # 100 requests per hour
    # preset: "moderate"           # 200 requests per 2 hours
    # preset: "aggressive"         # 500 requests per 3 hours
    # preset: "bulk"               # 1000 requests per 5 hours
    # preset: "tiered"             # Multiple rules: 120/h, 300/3h, 600/5h

    # Custom rules (overrides preset):
    rules:
      - windowHours: 1 # 1 hour window
        maxRequests: 100 # Max 100 requests per hour
        enabled: true
        description: 'Hourly limit'

      - windowHours: 3 # 3 hour window
        maxRequests: 250 # Max 250 requests per 3 hours
        enabled: true
        description: '3-hour limit'
```

### Built-in Presets

| Preset         | Description             | Use Case                     |
| -------------- | ----------------------- | ---------------------------- |
| `conservative` | 100 requests/hour       | Gentle crawling, small sites |
| `moderate`     | 200 requests/2 hours    | Balanced performance         |
| `aggressive`   | 500 requests/3 hours    | Fast crawling, larger sites  |
| `bulk`         | 1000 requests/5 hours   | High-volume operations       |
| `tiered`       | 120/h + 300/3h + 600/5h | Multiple concurrent limits   |

### Rate Limiting Status

The crawler provides real-time rate limiting information:

```
📊 Rate Limit Status:
├── Last hour: 45 requests
├── Last 2 hours: 89 requests
├── Last 3 hours: 134 requests
└── Last 5 hours: 201 requests

✅ Requests allowed
⏱️ Recommended delay: 36s
```

When rate limited:

```
🚫 BLOCKED by 1h rule (100 max)
⏰ Next request allowed in: 15 minutes
```

### Features

- **Sliding Time Windows**: More accurate than fixed time periods
- **Multiple Concurrent Rules**: Apply several limits simultaneously
- **Persistent Storage**: Request history survives crawler restarts
- **Smart Distribution**: Even request spacing to avoid bursts
- **Real-time Monitoring**: Status updates every 10 requests
- **Automatic Delays**: Built-in waiting when limits are reached

### Optional Configuration

- **Max pages to crawl**: Limit the number of pages (default: unlimited)
- **Max concurrency**: Number of concurrent requests (default: 1)
- **Request delay**: Delay between requests in milliseconds (default: 1000-3000ms)
- **Sitemap discovery**: Auto-discover URLs from XML sitemaps (default: true)
- **Headless mode**: Control browser visibility - false=visible, true=invisible (default: false)
- **Domain exclusion**: Filter out specific subdomains (API, CDN, static assets)

### Data Extraction Modules

Enable/disable specific data extraction:

- ✅ **Basic data**: Title, URL, timestamp
- ✅ **Response data**: HTTP status, headers
- ✅ **Links**: Internal/external link analysis
- ✅ **SEO tags**: Google meta tags
- ✅ **Special links**: Canonical, hreflang
- ✅ **Structured data**: JSON-LD, microdata
- ✅ **AI metadata**: Custom fields
- ✅ **Content metrics**: Word count, reading time
- ⚪ **PageMap data**: Advanced search attributes

### Performance Options

- **Skip heavy extraction**: Disable expensive operations for speed
- **Request timeout**: Maximum time to wait per page (default: 60s)
- **Debug mode**: Enable detailed logging and browser visibility

## 📊 Output Data

The actor provides comprehensive data for each crawled page:

```json
{
  "title": "Page Title",
  "url": "https://example.com/page",
  "timestamp": "2025-01-12T10:30:00.000Z",
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": {
      /* HTTP headers */
    }
  },
  "links": {
    "internal": [
      /* same-domain links */
    ],
    "external": [
      /* external links */
    ],
    "total": 45
  },
  "seo": {
    "metaTags": {
      "description": "Page description",
      "robots": "index, follow",
      "og:title": "Social media title"
    },
    "specialLinks": {
      "canonical": "https://example.com/canonical-url",
      "alternate": [
        /* language alternatives */
      ]
    }
  },
  "aiMetadata": {
    "structuredData": {
      "jsonLd": [
        /* Schema.org objects */
      ],
      "microdata": [
        /* Microdata items */
      ]
    },
    "customMetadata": {
      "wordCount": 1250,
      "readingTime": "7 min",
      "headingStructure": [
        /* H1-H6 hierarchy */
      ]
    }
  }
}
```

## 📊 Reports & Analysis

After crawling a domain, generate analysis reports from the stored dataset. All reports read from
`storage/datasets/<domain>/` and write to **`storage/reports/`** (JSON, with most also supporting
`--csv`). Run any of them inside the `app` container.

> Reports are generated from already-crawled data — crawl the site first (see Quick Start). The
> active link/href checkers additionally make live HTTP requests.

### SEO Audit — `seo-audit.ts`

A comprehensive **Markdown** audit of a crawled site. Per page it checks indexability
(`noindex`/non-200), missing `<title>`, overlong title (>63 chars), missing/overlong meta
description (>163), missing canonical, missing Open Graph (`og:title`/`og:description`/`og:image`),
missing `twitter:card`, absent JSON-LD structured data, thin content (<300 words), and orphan pages
(no internal links). It also aggregates structured-data coverage, classifies page types (Homepage,
Service, FAQ, Branch/Contact, …), and emits a prioritized recommendations table.

```bash
docker compose run --rm app npm run seo-audit -- --domain example.com
# Options: --date DD-MM-YYYY (pick a crawl date), --output <file.md>
# Output:  storage/reports/seo-audit-<domain>-<date>.md
```

### SEO Issues — `report-seo-issues.ts`

Focused, machine-readable issue lists for bulk fixing. Flags **meta description** and **title**
problems categorized as `missing` / `too_short` / `too_long` / `duplicate`, plus heading-structure
and structured-data gaps.

```bash
docker compose run --rm app npm run report:seo-issues -- --domain example.com --csv
# Options: --domain <d>, --output-dir <dir>, --csv
# Output:  per-issue JSON (and CSV with --csv) in storage/reports/
```

### 404 Link Report — `report-404s.ts`

Lists URLs that returned **HTTP 404** among the pages the crawler actually visited, grouped with
their **referrers** (which page linked to them, the link text, and crawl date) and the discovery
source (`linked_from_page` vs `seeded_or_sitemap`). Fast — it reads crawl results only and makes no
new requests.

```bash
docker compose run --rm app npm run report:404 -- --domain example.com --csv
# --domain is optional (processes all crawled domains if omitted)
# Output:  storage/reports/<domain>/404-link-report-<date>.json (+ .csv with --csv)
```

### Broken Link Validation — `check-broken-links.ts`

Unlike the 404 report, this **actively probes every referenced URL** — internal links, external
links, and image `src`/`srcset`/`<picture>` sources — with a `HEAD` request (falling back to `GET`)
and reports any 4xx/5xx or network failure, grouped by the page(s) referencing it.

```bash
docker compose run --rm app npx tsx scripts/check-broken-links.ts --domain example.com
# Options: --concurrency 10, --timeout 20000, --skip-external, --status 403, --output <file.json>
#   --status <code> narrows the report to that exact status (e.g. 403) and folds in crawled
#   pages whose own response had that status but which nothing links to.
# Output:  storage/reports/<domain>/<code>-report-<date>.json/.csv
```

### Empty / Missing href — `check-empty-href.ts`

Scans each page's **raw HTML** for anchors with broken hrefs: `empty` (`href=""` → reloads the
page), `missing` (no `href` → non-navigable), `hash` (`href="#"`), and `javascript:` pseudo-links.
Requires HTML content extraction (`--html-content` at crawl time, or `extraction.modules.htmlContent: true`).

```bash
docker compose run --rm app npx tsx scripts/check-empty-href.ts --domain example.com
# Options: --include hash,javascript (include review-only categories), --output <file.json>
# Output:  storage/reports/<domain>/empty-href-<date>.json (+ .csv)
```

## 🎯 Use Cases

### SEO Auditing

- Analyze meta tag completeness and optimization
- Identify missing canonical URLs or hreflang tags
- Monitor robots directives and indexing status
- Track social media optimization (Open Graph, Twitter Cards)

### Content Analysis

- Extract structured data for rich snippets
- Analyze content metrics (word count, reading time)
- Monitor heading structure and content organization
- Track custom metadata for content categorization

### Technical SEO

- Monitor HTTP response codes and redirects
- Analyze response headers for performance insights
- Track site structure and internal linking
- Identify crawl errors and accessibility issues

### AI-Powered Search

- Extract metadata for Google Cloud AI App Builder
- Support advanced filtering and content boosting
- Enable rich content understanding for generative AI
- Provide structured data for enhanced search experiences

## 🐳 Docker Compose Usage

### Quick Start

```bash
# 1. Create your .env from the template (required first step), then edit values as needed
cp .env.example .env

# 2. Build the crawler image
docker compose build app

# 3. Crawl a site
docker compose run --rm app npm run crawl -- https://example.com --headless=true

# Crawl with exclusions and rate limiting
docker compose run --rm app npm run crawl -- https://example.com \
  --exclude-domains "api.example.com,cdn.example.com" \
  --rate-limit=conservative
```

### Workflow Rules

- Docker Compose is the recommended runtime: `docker compose run --rm app ...`
- Use `docker compose build app` after Dockerfile or dependency changes
- Prefer the container for reproducible runs; running the `npm run` scripts on the host
  (Node.js >= 20) is also supported for local development

### Running NPM Scripts in Docker

```bash
# Crawl
docker compose run --rm app npm run crawl -- https://example.com --headless=true

# Merge all crawled JSONL files
docker compose run --rm app npm run merge-to-jsonl

# Build TypeScript
docker compose run --rm app npm run build

# Run tests
docker compose run --rm app npm test

# Lint and format
docker compose run --rm app npm run lint
docker compose run --rm app npm run format
docker compose run --rm app npm run style
```

### Storage Structure

After running, your local storage will contain:

```
./storage/
├── datasets/
│   ├── domain.com/
│   │   └── 14-07-2025/
│   │       ├── crawl-data.jsonl      # Domain-specific JSONL data
│   │       ├── page-1-timestamp.json # Individual page files
│   │       └── page-2-timestamp.json
│   └── anotherdomain.com/
│       └── 15-07-2025/
├── key_value_stores/
│   └── domain.com/             # Sitemaps and metadata
├── request_queues/
│   └── domain.com/             # Processing queues
└── all-domains-merged.jsonl    # Unified JSONL from all domains
```

### Data Export & Merging

**Merge all domain data into unified JSONL:**

```bash
# Merge all JSONL files from all domains and dates
docker compose run --rm app npm run merge-to-jsonl

# Output: ./storage/all-domains-merged.jsonl
```

**Features:**

- **Multi-domain Support**: Combines data from all crawled domains
- **Metadata Enrichment**: Adds domain, crawl date, and source file information
- **Historical Data**: Preserves data from different crawl dates
- **Standard Format**: JSONL output (one JSON object per line)

**Example merged record:**

```json
{
  "title": "Page Title",
  "url": "https://example.com/page",
  "seo": { "metaTags": {...} },
  "_metadata": {
    "domain": "example.com",
    "crawlDate": "19-07-2025",
    "sourceFile": "example.com/19-07-2025/crawl-data.jsonl"
  }
}
```

## 🛠️ Docker Compose Workflows

Run every project command inside the `app` container:

```bash
# Run with specific target URL
docker compose run --rm app npm run crawl -- https://example.com

# Exclude specific domains/subdomains
docker compose run --rm app npm run crawl -- https://example.com --exclude-domains "api.example.com,cdn.example.com"

# Control browser visibility
docker compose run --rm app npm run crawl -- https://example.com --headless=false
docker compose run --rm app npm run crawl -- https://example.com --headless=true

# Single URL mode
docker compose run --rm app npm run crawl -- https://example.com --single

# Merge all domain JSONL files
docker compose run --rm app npm run merge-to-jsonl

# Build, test, and code quality
docker compose run --rm app npm run build
docker compose run --rm app npm test
docker compose run --rm app npm run lint
docker compose run --rm app npm run format
docker compose run --rm app npm run style
```

### Quick Start Examples

```bash
# Crawl a blog for SEO analysis (with visible browser)
docker compose run --rm app npm run crawl -- https://myblog.com --headless=false

# Analyze e-commerce site structure (excluding API and CDN)
docker compose run --rm app npm run crawl -- https://mystore.com --exclude-domains "api.mystore.com,cdn.mystore.com"

# Debug crawling with visible browser
docker compose run --rm app npm run crawl -- https://example.com --headless=false

# Stealth crawling with invisible browser
docker compose run --rm app npm run crawl -- https://example.com --headless=true

# Test local development site
docker compose run --rm app npm run crawl -- http://localhost:3000 --headless=false

# Single page analysis with visible browser
docker compose run --rm app npm run crawl -- https://example.com --single --headless=false

# Visible browser with a domain exclusion
docker compose run --rm app npm run crawl -- https://www.example.com --headless=false --exclude-domains "accounts.example.com"

```

### Configuration Files

- `config/crawler.yml` - Main configuration (5 pages limit for testing)
- `config/examples/basic.yml` - Simple crawling setup (50 pages)
- `config/examples/advanced.yml` - Full-featured analysis (unlimited)
- `config/examples/performance.yml` - Speed-optimized setup (1000 pages)

### Key Configuration Options

```yaml
targets:
  excludedDomains:
    - 'api.example.com'
    - 'cdn.example.com'
    - 'static.example.com'

crawler:
  maxRequestsPerCrawl: 0 # Page limit (0 = unlimited)
  maxConcurrency: 1 # Concurrent requests
  headless: false # Show browser window (true for stealth mode)
  requestDelayMin: 1000 # Min delay between requests (ms)
  requestDelayMax: 3000 # Max delay between requests (ms)

  # Rate limiting configuration
  rateLimiting:
    enabled: false # Enable/disable rate limiting
    persistData: true # Save request history across sessions
    preset: 'moderate' # Use built-in preset
    # OR define custom rules:
    rules:
      - windowHours: 1
        maxRequests: 100
        enabled: true
        description: 'Hourly limit'

  # Browser launch arguments (configurable in YAML)
  launchArgs:
    headless: # Stealth mode arguments
      - '--no-sandbox'
      - '--disable-setuid-sandbox'
      - '--disable-dev-shm-usage'
      - '--disable-blink-features=AutomationControlled'
      - '--disable-features=VizDisplayCompositor'

    visible: # Visible browser arguments
      - '--no-sandbox'
      - '--disable-setuid-sandbox'
      - '--disable-dev-shm-usage'
      - '--disable-blink-features=AutomationControlled'
      - '--no-first-run'
      - '--no-default-browser-check'

output:
  storage:
    realTimeStorage:
      enabled: true # Save files during crawling
      saveIndividualFiles: true # Individual JSON files
      saveJsonl: true # Continuous JSONL file
```

### Configuration Best Practices

#### Browser Launch Arguments

- **Headless Mode**: Optimized for stealth crawling with minimal detection
- **Visible Mode**: Simplified arguments for debugging and development
- **Customizable**: Easily modify browser behavior through YAML configuration
- **Maintainable**: No hardcoded arguments in source code

#### Storage Organization

- **Domain-based**: Automatic organization by target domain
- **Date-based**: Daily folders for historical tracking
- **Real-time**: Data saved during crawling for immediate analysis
- **Multiple formats**: JSON, JSONL, and CSV export options

### Command Line Options

```bash
# Basic usage
docker compose run --rm app npm run crawl -- <URL>

# Advanced options
docker compose run --rm app npm run crawl -- <URL> [OPTIONS]

Options:
  --url, -u <URL>                    Target URL to crawl
  --exclude-domains <domains>        Comma-separated list of domains to exclude
  --exclude <domains>                Short version of --exclude-domains
  --exclude-paths <paths>            Comma-separated list of URL paths to exclude
  --headless=<true|false>            Set headless mode (true=invisible, false=visible)
  --single, -s                       Single URL mode - don't follow links
  --incremental                      Enable incremental crawling mode
  --incremental-date <date>          Previous crawl date (DD-MM-YYYY format)
  --rate-limit=<preset|format>       Rate limiting: preset name or "requests/hours"

Rate Limiting Presets:
  conservative  - 100 requests per hour
  moderate      - 200 requests per 2 hours
  aggressive    - 500 requests per 3 hours
  bulk          - 1000 requests per 5 hours
  tiered        - Multiple rules: 120/h, 300/3h, 600/5h


Command Line Argument Parsing (lines 31-54):
    - --url or -u: Target URL
    - --single or -s: Single URL mode
    - --exclude-domains: Comma-separated domains to exclude
    - --headless=true/false: Headless mode control

Examples:
  docker compose run --rm app npm run crawl -- https://example.com
  docker compose run --rm app npm run crawl -- https://example.com --exclude-domains "api.example.com,cdn.example.com"
  docker compose run --rm app npm run crawl -- https://example.com --exclude-paths "/user/login,/admin"
  docker compose run --rm app npm run crawl -- https://example.com --headless=false
  docker compose run --rm app npm run crawl -- https://example.com --rate-limit=moderate
  docker compose run --rm app npm run crawl -- https://example.com --rate-limit=200/3
  docker compose run --rm app npm run crawl -- https://example.com --incremental --incremental-date 19-07-2025 --headless=false --rate-limit=conservative
  docker compose run --rm app npm run crawl -- https://example.com --headless=true --single --rate-limit=conservative

 Usage examples:
  - docker compose run --rm app npm run crawl -- https://example.com --headless=false
  - docker compose run --rm app npm run crawl -- https://example.com --single
  - docker compose run --rm app npm run crawl -- https://example.com --single --headless=false


```

### Domain Requirement

The crawler requires a target URL to be provided via:

1. Docker Compose command: `docker compose run --rm app npm run crawl -- https://example.com`
2. Configuration file: Set in `config/crawler.yml`
3. Docker environment: Configure in container

**If no URL is provided, the crawler will exit with "Domain is required" error.**

## 📈 Performance Tips

- Start with **basic extraction modules** for initial testing
- Use **max pages limit** to control scope during development
- Adjust **concurrency** based on target server capacity
- Enable **debug mode** for troubleshooting crawling issues
- Use **performance mode** for large-scale crawling

## 🔗 Integration

This actor integrates seamlessly with:

- **Google Search Console** for SEO monitoring
- **Google Cloud AI App Builder** for enhanced search
- **Data analysis tools** via JSON export
- **SEO platforms** through API access
- **Content management systems** for metadata enrichment

## 📞 Support

For issues or feature requests:

1. Check the [Crawlee documentation](https://crawlee.dev/)
2. Review the actor's configuration options
3. Enable debug mode for detailed logging
4. Contact support through Apify platform

---

**Built with ❤️ for SEO professionals, content creators, and developers seeking comprehensive
website analysis**
