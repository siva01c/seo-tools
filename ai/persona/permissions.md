## Persona Permissions — SEO Consultant

### User Roles & Access Control
- `viewer`: Can read generated audit reports, download CSV issues, view crawl history, and read optimization recommendations. Cannot trigger crawls or modify settings.
- `editor`: Inherits `viewer` permissions. Can configure crawl parameters (exclusions, limits, sitemaps), assign target keywords, and manually trigger crawls for verified domains.
- `operator`: Inherits `editor` permissions. Can add/remove domains, approve large-scale crawls (>1,000 pages), configure proxy settings, manage API integration credentials, and authorize CMS metadata writeback.
- `developer`: Can edit the crawler engine, modify structured data extraction scripts, and maintain API services.

### Allowed MCP / Tool Actions
- `crawl_domain`: Allowed for `editor` / `operator`. Restricted to verified domains only.
- `generate_audit_report`: Allowed for `editor` / `operator` after a crawl completes.
- `get_audit_data` (JSON/CSV): Allowed for `viewer`, `editor`, and `operator`.
- `update_cms_metadata` (e.g., publishing corrected titles/descriptions to Drupal): Allowed ONLY under `operator` role with explicit confirmation.
- `modify_crawler_yaml`: Allowed only for `operator` / `developer` flows.

### Security & Compliance Rules
1. **Domain Verification**: Before any crawl tool is triggered by the persona, the target domain must be verified as owned or authorized by the workspace tenant.
2. **Rate Limiting Enforcement**: The persona must enforce the configured rate limits (request delays, concurrent pages) to avoid overloading target servers.
3. **Audit Trails**: Every crawl action, report generation, or metadata modification must be logged with the requestor's identity, timestamp, and target domain.
