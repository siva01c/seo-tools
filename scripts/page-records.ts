// Shared helpers for working with crawled page records loaded from the
// per-domain JSONL datasets.

import type { ISnapshotMessages } from './i18n.js';

type CrawledPage = {
    url?: string;
    response?: { status?: number; headers?: Record<string, string> };
    _metadata?: { crawlDate?: string };
};

/** Turn a DD-MM-YYYY crawl date into a lexicographically sortable YYYY-MM-DD key. */
export const ddmmyyyyToSortKey = (date: string): string => {
    const [dd, mm, yyyy] = date.split('-');
    return `${yyyy}-${mm}-${dd}`;
};

/** The newest `_metadata.crawlDate` (DD-MM-YYYY) across a set of records. */
export function getLatestCrawlDate(pages: CrawledPage[]): string | undefined {
    let latest: string | undefined;
    for (const page of pages) {
        const date = page._metadata?.crawlDate;
        if (!date) continue;
        if (!latest || ddmmyyyyToSortKey(date) > ddmmyyyyToSortKey(latest)) latest = date;
    }
    return latest;
}

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

export type SnapshotMode = 'latest' | 'all';

export type CrawlSnapshot<T> = {
    /** Newest crawl date found in the input, or undefined if no record carries one. */
    latestDate?: string;
    /** Records from the newest crawl — the site as it actually looked last time we looked. */
    current: T[];
    /** Records for URLs the newest crawl did not visit at all (retired, unlinked, or missed). */
    stale: T[];
    /** Oldest and newest `crawlDate` among the stale records, for reporting. */
    staleDateRange?: { from: string; to: string };
};

/**
 * Split deduplicated records into the newest crawl's snapshot and everything left over.
 *
 * `dedupePagesByUrl()` keeps the newest record *per URL*, but it never drops a URL the newest
 * crawl did not visit. A page retired months ago (now redirected, so nothing links to it and
 * the crawler never reaches it) keeps its last record forever — and that record is still the
 * "newest" one for that URL. Reports built on the union therefore describe a site state that
 * stopped existing long ago: 404s and missing-schema findings that were fixed by the very
 * redirect that removed the URL from the crawl.
 *
 * Records without a `crawlDate` count as current — datasets predate that field, and dropping
 * them would silently lose data rather than merely age it.
 */
export function splitByCrawlSnapshot<T extends CrawledPage>(pages: T[]): CrawlSnapshot<T> {
    const latestDate = getLatestCrawlDate(pages);
    if (!latestDate) return { latestDate: undefined, current: pages, stale: [] };

    const current: T[] = [];
    const stale: T[] = [];
    for (const page of pages) {
        const date = page._metadata?.crawlDate;
        if (!date || date === latestDate) current.push(page);
        else stale.push(page);
    }

    const staleKeys = stale
        .map(p => p._metadata?.crawlDate)
        .filter((d): d is string => !!d)
        .sort((a, b) => ddmmyyyyToSortKey(a).localeCompare(ddmmyyyyToSortKey(b)));

    return {
        latestDate,
        current,
        stale,
        staleDateRange: staleKeys.length
            ? { from: staleKeys[0], to: staleKeys[staleKeys.length - 1] }
            : undefined,
    };
}

/**
 * Which slice of the merged dataset a report should describe. Default is the newest crawl;
 * `--all-crawls` opts back into the historical union of every URL ever seen.
 */
export function resolveSnapshotMode(args: string[]): SnapshotMode {
    return args.some(a => a === '--all-crawls') ? 'all' : 'latest';
}

/**
 * Apply the snapshot mode and announce which slice of the dataset the report covers.
 * Every report script goes through here so the crawl date and the excluded stale URLs are
 * always stated — a number without its crawl date is what made the old reports misleading.
 */
export function selectSnapshot<T extends CrawledPage>(
    domain: string,
    pages: T[],
    mode: SnapshotMode,
    m: ISnapshotMessages
): { selected: T[]; snapshot: CrawlSnapshot<T> } {
    const snapshot = splitByCrawlSnapshot(pages);
    const selected = mode === 'all' ? pages : snapshot.current;

    const label = mode === 'all' ? m.allCrawlsHeader : (snapshot.latestDate ?? m.allCrawlsHeader);
    console.log(`📄 ${domain} — ${m.header} ${label}: ${selected.length} ${m.pages}`);

    if (mode === 'latest' && snapshot.stale.length > 0) {
        const range = snapshot.staleDateRange;
        const when = range
            ? range.from === range.to
                ? range.from
                : `${range.from} … ${range.to}`
            : '?';
        console.log(`   ⚠ ${snapshot.stale.length} ${m.staleExcluded} ${when}`);
        console.log(`     → ${m.staleHint}`);
    }

    return { selected, snapshot };
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
