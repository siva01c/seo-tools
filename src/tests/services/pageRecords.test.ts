import { describe, it, expect } from '@jest/globals';
import {
    dedupePagesByUrl,
    ddmmyyyyToSortKey,
    getLatestCrawlDate,
    isHtmlPage,
    resolveSnapshotMode,
    splitByCrawlSnapshot,
} from '../../../scripts/page-records.js';

const page = (url: string, crawlDate?: string, status = 200) => ({
    url,
    response: { status },
    _metadata: crawlDate ? { crawlDate } : undefined,
});

/** Mark a record as coming from an `--incremental` run, the way the merge step stamps it. */
const incremental = <T extends { _metadata?: { crawlDate?: string } }>(record: T): T => ({
    ...record,
    _metadata: { ...record._metadata, crawlMode: 'incremental' as const },
});

describe('page-records', () => {
    describe('ddmmyyyyToSortKey', () => {
        it('orders by year before day — 19-07-2025 is older than 18-07-2026', () => {
            expect(ddmmyyyyToSortKey('19-07-2025') < ddmmyyyyToSortKey('18-07-2026')).toBe(true);
        });
    });

    describe('getLatestCrawlDate', () => {
        it('returns the newest crawl date regardless of record order', () => {
            expect(
                getLatestCrawlDate([
                    page('https://x/a', '28-08-2026'),
                    page('https://x/b', '19-07-2025'),
                    page('https://x/c', '14-06-2026'),
                ])
            ).toBe('28-08-2026');
        });

        it('returns undefined when no record carries a crawl date', () => {
            expect(getLatestCrawlDate([page('https://x/a')])).toBeUndefined();
        });
    });

    describe('dedupePagesByUrl', () => {
        it('keeps the newest record for a URL crawled more than once', () => {
            const result = dedupePagesByUrl([
                page('https://x/a', '14-06-2026', 404),
                page('https://x/a', '28-08-2026', 200),
            ]);
            expect(result).toHaveLength(1);
            expect(result[0].response.status).toBe(200);
        });

        it('keeps the newest record even when the older one comes last in file order', () => {
            const result = dedupePagesByUrl([
                page('https://x/a', '28-08-2026', 200),
                page('https://x/a', '14-06-2026', 404),
            ]);
            expect(result[0].response.status).toBe(200);
        });
    });

    describe('splitByCrawlSnapshot', () => {
        it('moves a URL only ever seen in an older crawl into stale', () => {
            const { latestDate, current, stale } = splitByCrawlSnapshot([
                page('https://x/live', '28-08-2026'),
                page('https://x/retired', '14-06-2026', 404),
            ]);
            expect(latestDate).toBe('28-08-2026');
            expect(current.map(p => p.url)).toEqual(['https://x/live']);
            expect(stale.map(p => p.url)).toEqual(['https://x/retired']);
        });

        it('reports the stale date range across several older crawls', () => {
            const { staleDateRange } = splitByCrawlSnapshot([
                page('https://x/live', '28-08-2026'),
                page('https://x/a', '14-06-2026'),
                page('https://x/b', '19-07-2025'),
                page('https://x/c', '07-08-2026'),
            ]);
            expect(staleDateRange).toEqual({ from: '19-07-2025', to: '07-08-2026' });
        });

        it('treats records without a crawl date as current rather than dropping them', () => {
            const { current, stale } = splitByCrawlSnapshot([
                page('https://x/live', '28-08-2026'),
                page('https://x/legacy'),
            ]);
            expect(current.map(p => p.url)).toContain('https://x/legacy');
            expect(stale).toHaveLength(0);
        });

        it('leaves everything current when no record carries a crawl date', () => {
            const { latestDate, current, stale } = splitByCrawlSnapshot([page('https://x/a')]);
            expect(latestDate).toBeUndefined();
            expect(current).toHaveLength(1);
            expect(stale).toHaveLength(0);
        });

        it('anchors on the last full crawl so an incremental delta does not shrink the snapshot', () => {
            // The incremental run re-fetched one page; the other two were untouched and must stay.
            const { baselineDate, latestDate, incrementalDates, current, stale } =
                splitByCrawlSnapshot([
                    page('https://x/a', '14-06-2026'),
                    page('https://x/b', '14-06-2026'),
                    incremental(page('https://x/c', '28-08-2026')),
                ]);
            expect(baselineDate).toBe('14-06-2026');
            expect(latestDate).toBe('28-08-2026');
            expect(incrementalDates).toEqual(['28-08-2026']);
            expect(current.map(p => p.url)).toEqual(['https://x/a', 'https://x/b', 'https://x/c']);
            expect(stale).toHaveLength(0);
        });

        it('still ages out crawls older than the baseline full crawl', () => {
            const { baselineDate, current, stale } = splitByCrawlSnapshot([
                page('https://x/retired', '19-07-2025'),
                page('https://x/a', '14-06-2026'),
                incremental(page('https://x/b', '28-08-2026')),
            ]);
            expect(baselineDate).toBe('14-06-2026');
            expect(current.map(p => p.url)).toEqual(['https://x/a', 'https://x/b']);
            expect(stale.map(p => p.url)).toEqual(['https://x/retired']);
        });

        it('keeps the union when every recorded crawl is incremental', () => {
            // No complete snapshot exists to anchor on, so narrowing would invent a scope.
            const { baselineDate, current, stale } = splitByCrawlSnapshot([
                incremental(page('https://x/a', '14-06-2026')),
                incremental(page('https://x/b', '28-08-2026')),
            ]);
            expect(baselineDate).toBe('14-06-2026');
            expect(current).toHaveLength(2);
            expect(stale).toHaveLength(0);
        });

        it('anchors on the newest full crawl when a full crawl follows an incremental one', () => {
            const { baselineDate, incrementalDates, current, stale } = splitByCrawlSnapshot([
                page('https://x/a', '14-06-2026'),
                incremental(page('https://x/b', '17-07-2026')),
                page('https://x/c', '28-08-2026'),
            ]);
            expect(baselineDate).toBe('28-08-2026');
            expect(incrementalDates).toEqual([]);
            expect(current.map(p => p.url)).toEqual(['https://x/c']);
            expect(stale.map(p => p.url)).toEqual(['https://x/a', 'https://x/b']);
        });
    });

    describe('resolveSnapshotMode', () => {
        it('defaults to the latest crawl', () => {
            expect(resolveSnapshotMode(['--domain', 'example.com'])).toBe('latest');
        });

        it('returns "all" for --all-crawls', () => {
            expect(resolveSnapshotMode(['--domain', 'example.com', '--all-crawls'])).toBe('all');
        });
    });

    describe('isHtmlPage', () => {
        it('assumes HTML when no content type was recorded', () => {
            expect(isHtmlPage({ url: 'https://x/a' })).toBe(true);
        });

        it('rejects XML feeds', () => {
            expect(
                isHtmlPage({
                    url: 'https://x/feed',
                    response: { headers: { 'content-type': 'application/xml' } },
                })
            ).toBe(false);
        });
    });
});
