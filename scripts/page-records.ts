// Shared helpers for working with crawled page records loaded from the
// per-domain JSONL datasets.

import type { ISnapshotMessages } from './i18n.js';
import type { CrawlMode } from '../src/services/crawlManifest.js';

type CrawledPage = {
    url?: string;
    response?: { status?: number; headers?: Record<string, string> };
    /** `crawlMode` is stamped at merge time from each date folder's `_crawl-meta.json`. */
    _metadata?: { crawlDate?: string; crawlMode?: CrawlMode };
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
    /**
     * The full crawl the snapshot is anchored on — equal to `latestDate` for an ordinary crawl,
     * older when incremental crawls have been layered on top of it since.
     */
    baselineDate?: string;
    /** Incremental crawl dates included on top of the baseline, oldest first. */
    incrementalDates: string[];
    /** Records from the current snapshot — the site as it actually looked last time we looked. */
    current: T[];
    /** Records for URLs the current snapshot does not cover (retired, unlinked, or missed). */
    stale: T[];
    /** Oldest and newest `crawlDate` among the stale records, for reporting. */
    staleDateRange?: { from: string; to: string };
};

/**
 * Map each crawl date in a record set to the mode its crawl ran in.
 * A date is incremental only if its records say so; anything unmarked is a full crawl (see
 * `readCrawlMode` — datasets merged before the manifest existed carry no mode at all).
 */
function crawlModesByDate(pages: CrawledPage[]): Map<string, CrawlMode> {
    const modes = new Map<string, CrawlMode>();
    for (const page of pages) {
        const date = page._metadata?.crawlDate;
        if (!date) continue;
        if (page._metadata?.crawlMode === 'incremental') modes.set(date, 'incremental');
        else if (!modes.has(date)) modes.set(date, 'full');
    }
    return modes;
}

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
 * The snapshot is anchored on the newest *full* crawl, not simply the newest date folder. An
 * incremental crawl (`--incremental`) writes only the URLs it re-fetched, so its date folder is a
 * delta: anchoring on it would push every page that did not happen to change into `stale` and
 * shrink a 300-page report to the handful of URLs the delta touched. Anchoring on the last full
 * crawl and layering every incremental crawl since on top of it reproduces what the site actually
 * looked like — which is what an incremental crawl is for.
 *
 * Records without a `crawlDate` count as current — datasets predate that field, and dropping
 * them would silently lose data rather than merely age it.
 */
export function splitByCrawlSnapshot<T extends CrawledPage>(pages: T[]): CrawlSnapshot<T> {
    const latestDate = getLatestCrawlDate(pages);
    if (!latestDate) {
        return { latestDate: undefined, incrementalDates: [], current: pages, stale: [] };
    }

    const modes = crawlModesByDate(pages);
    const dates = [...modes.keys()].sort((a, b) =>
        ddmmyyyyToSortKey(a).localeCompare(ddmmyyyyToSortKey(b))
    );
    // Newest full crawl. When every recorded crawl is incremental there is no complete snapshot to
    // anchor on, so fall back to the oldest date — i.e. keep the union rather than invent a scope.
    const baselineDate = [...dates].reverse().find(d => modes.get(d) === 'full') ?? dates[0];
    const baselineKey = ddmmyyyyToSortKey(baselineDate);
    const incrementalDates = dates.filter(
        d => ddmmyyyyToSortKey(d) > baselineKey && modes.get(d) === 'incremental'
    );

    const current: T[] = [];
    const stale: T[] = [];
    for (const page of pages) {
        const date = page._metadata?.crawlDate;
        if (!date || ddmmyyyyToSortKey(date) >= baselineKey) current.push(page);
        else stale.push(page);
    }

    const staleKeys = stale
        .map(p => p._metadata?.crawlDate)
        .filter((d): d is string => !!d)
        .sort((a, b) => ddmmyyyyToSortKey(a).localeCompare(ddmmyyyyToSortKey(b)));

    return {
        latestDate,
        baselineDate,
        incrementalDates,
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
 * The scope a report covers, in words. `28-08-2026` for an ordinary crawl; `12-08-2026 … 28-08-2026
 * (+2 incremental)` once incremental crawls have been layered on the last full one, so the reader
 * can see the report spans more than one date folder and why.
 */
export function describeSnapshotScope<T>(
    snapshot: CrawlSnapshot<T>,
    mode: SnapshotMode,
    m: ISnapshotMessages
): string {
    if (mode === 'all') return m.allCrawlsHeader;
    if (!snapshot.latestDate) return m.allCrawlsHeader;
    if (!snapshot.incrementalDates.length) return snapshot.latestDate;
    return `${snapshot.baselineDate} … ${snapshot.latestDate} (${m.plusIncremental(snapshot.incrementalDates.length)})`;
}

/**
 * Shape version stamped into every persisted report JSON. v1 was the unversioned pre-snapshot
 * shape (the 404 report was a bare entry array); v2 wraps the findings in an object carrying the
 * crawl scope. Bump it whenever the shape changes so downstream consumers can branch on it.
 */
export const REPORT_SCHEMA_VERSION = 2;

/**
 * The crawl-scope block every persisted report embeds, so a saved JSON/CSV always carries the
 * crawl it describes. A number without its crawl date is what made the old reports misleading.
 */
export interface ISnapshotMeta {
    snapshot_mode: SnapshotMode;
    /** Newest crawl date in scope. */
    crawl_date?: string;
    /** Full crawl the snapshot is anchored on — differs from `crawl_date` only for incrementals. */
    baseline_crawl_date?: string;
    incremental_crawl_dates?: string[];
    pages_analyzed: number;
}

export function snapshotMeta<T>(
    snapshot: CrawlSnapshot<T>,
    mode: SnapshotMode,
    pagesAnalyzed: number
): ISnapshotMeta {
    return {
        snapshot_mode: mode,
        crawl_date: snapshot.latestDate,
        baseline_crawl_date: snapshot.baselineDate,
        incremental_crawl_dates: snapshot.incrementalDates.length
            ? snapshot.incrementalDates
            : undefined,
        pages_analyzed: pagesAnalyzed,
    };
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

    console.log(
        `📄 ${domain} — ${m.header} ${describeSnapshotScope(snapshot, mode, m)}: ${selected.length} ${m.pages}`
    );

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
