## Memory Schema & Rules (SEO Consultant)

Directory layout for SEO-specific runtime memory:

```text
memory/
├── domains/              # Long-term domain profiles, targets, and client goals
├── crawls/               # Crawl history, statistics, and issue logs (JSON)
├── audits/               # Generated reports, technical recommendations, and diffs
└── user_preferences/     # Specific client exceptions, language defaults, and ignored warnings
```

### Memory Entry Schema

Each long-term memory entry regarding a crawled website or client goal must contain:

- `id`: UUID (String)
- `domain`: Target website domain name (e.g., `ludekkvapil.cz`)
- `type`: Category of entry (`domain_target`, `crawl_stats`, `technical_exception`, `historical_fix`)
- `source`: Triggering crawl ID, user input, or system action
- `text`: Detailed textual observation or requirement (e.g., "Target keywords: Drupal development, SEO services")
- `metadata`: Key-value pairs of technical metrics (e.g., `{ "word_count_average": 450, "structured_data_present": true }`)
- `importance`: 0 to 100 rating of importance (critical bugs like 404 on homepage get 100)
- `pinned`: Boolean (if true, prevents decay of historical preference or target goal)
- `created_at`: ISO8601 timestamp
- `version`: Crawler engine / persona version at write time

### Write Rules for SEO State
1. **Append-Only History**: Historical crawl summaries are immutable and append-only. Diffs are calculated dynamically or written as a comparison record.
2. **Client Target Pining**: Client preferences (e.g., preferred report language, list of excluded paths, customized warning thresholds) must be marked as `pinned: true` to prevent automatic decay.
3. **Audit Cleanup (TTL)**: Raw crawl data directories (HTML copies, full page logs) age out after a configurable TTL (e.g., 30 days) to save storage, while high-level audit summaries remain in long-term memory.
4. **Validation of Facts**: Before updating a domain's status (e.g., "broken link fixed"), a quick validation check (re-fetch/re-crawl of target URL) should be run to verify the change.
