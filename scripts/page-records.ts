// Shared helpers for working with crawled page records loaded from the
// per-domain JSONL datasets.

type CrawledPage = {
    url?: string;
    response?: { status?: number; headers?: Record<string, string> };
    _metadata?: { crawlDate?: string };
};

const ddmmyyyyToSortKey = (date: string): string => {
    const [dd, mm, yyyy] = date.split('-');
    return `${yyyy}-${mm}-${dd}`;
};

/**
 * Deduplicate crawl records by URL, keeping the latest crawl of each page.
 * Merged per-domain JSONL files contain one record per page per crawl date, so
 * without this step a page crawled N times is reported N times (and becomes a
 * false "duplicate" of itself). A record with a newer `_metadata.crawlDate`
 * wins; when dates are equal or missing the later record in file order wins.
 */
export function dedupePagesByUrl<T extends CrawledPage>(pages: T[]): T[] {
    const byUrl = new Map<string, T>();
    for (const page of pages) {
        if (!page.url) continue;
        const existing = byUrl.get(page.url);
        if (existing) {
            const existingDate = existing._metadata?.crawlDate;
            const candidateDate = page._metadata?.crawlDate;
            if (
                existingDate &&
                candidateDate &&
                ddmmyyyyToSortKey(candidateDate) < ddmmyyyyToSortKey(existingDate)
            ) {
                continue;
            }
        }
        byUrl.set(page.url, page);
    }
    return [...byUrl.values()];
}

/**
 * Whether a crawl record is an HTML page. The crawler stores every successful
 * response it visits — including RSS/Atom feeds and other XML resources (e.g.
 * Drupal `/taxonomy/term/N/feed` URLs linked from taxonomy pages). Those have
 * no title, meta tags, H1 or JSON-LD by nature, so HTML-oriented SEO checks
 * must skip them. Records without a recorded content type are assumed HTML.
 */
export function isHtmlPage(page: CrawledPage): boolean {
    const contentType = String(
        page.response?.headers?.['content-type'] ?? page.response?.headers?.['Content-Type'] ?? ''
    ).toLowerCase();
    if (!contentType) return true;
    return contentType.includes('text/html') || contentType.includes('application/xhtml');
}
