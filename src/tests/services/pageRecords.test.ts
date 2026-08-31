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
