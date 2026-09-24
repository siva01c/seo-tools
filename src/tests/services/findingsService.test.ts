import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    ALL_CHECKS,
    FINDINGS_FILE,
    buildFindingsIndex,
    entriesOf,
    findingDates,
    getFindings,
    isValidDomain,
    normaliseDomain,
    severityOf,
    writeFindingsIndex,
} from '../../services/findingsService.js';

const DOMAIN = 'example.com';

describe('findingsService', () => {
    let root: string;

    const write = (date: string, file: string, data: unknown) => {
        const dir = join(root, DOMAIN, date);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, file), typeof data === 'string' ? data : JSON.stringify(data));
    };
    // What build-findings does at the end of a successful generate_findings run.
    const index = (date: string) => {
        const dir = join(root, DOMAIN, date);
        writeFindingsIndex(dir, buildFindingsIndex(dir, DOMAIN, date));
    };

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'findings-'));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it('groups entries per check and kind with severity and fingerprint', () => {
        write('28-08-2026', 'title-issues-28-08-2026.json', {
            total: 3,
            issues: [
                { url: 'https://example.com/a', issue: 'duplicate', duplicateUrls: ['x', 'y'] },
                { url: 'https://example.com/b', issue: 'duplicate' },
                { url: 'https://example.com/c', issue: 'too_long' },
            ],
        });
        write('28-08-2026', '404-link-report-28-08-2026.json', {
            entries: [{ target: 'https://example.com/gone', status: 404 }],
        });
        index('28-08-2026');

        const result = getFindings(root, DOMAIN)!;

        expect(result.reportDate).toBe('28-08-2026');
        expect(result.previousReportDate).toBeNull();
        expect(result.groups.map(g => [g.fingerprint, g.severity, g.count])).toEqual([
            ['seo:example.com:title:duplicate', 'critical', 2],
            ['seo:example.com:broken_link:status_404', 'critical', 1],
            ['seo:example.com:title:too_long', 'high', 1],
        ]);
        expect(result.totals).toEqual({ critical: 3, high: 1, medium: 0, low: 0 });
        expect(result.checksPresent).toEqual(['broken_link', 'title']);
        expect(result.checksMissing).toHaveLength(ALL_CHECKS.length - 2);
        // First run: every URL counts as new.
        expect(result.groups[0].newUrls).toEqual([
            'https://example.com/a',
            'https://example.com/b',
        ]);
        expect(result.groups[0].previousCheckMissing).toBe(false);
    });

    it('keeps the index compact: no duplicateUrls or other raw fields', () => {
        write('28-08-2026', 'title-issues-28-08-2026.json', {
            issues: [{ url: 'https://example.com/a', issue: 'duplicate', duplicateUrls: ['z'] }],
        });
        const built = buildFindingsIndex(join(root, DOMAIN, '28-08-2026'), DOMAIN, '28-08-2026');
        expect(built.groups).toEqual([
            { check: 'title', kind: 'duplicate', urls: ['https://example.com/a'] },
        ]);
    });

    it('diffs against the previous complete report folder', () => {
        write('14-06-2026', 'orphaned-pages-2026-06-14.json', {
            pages: [{ url: 'https://example.com/old' }, { url: 'https://example.com/kept' }],
        });
        write('14-06-2026', 'h1-issues-2026-06-14.json', {
            issues: [{ url: 'https://example.com/x', issue: 'missing' }],
        });
        index('14-06-2026');
        // A folder without an index (markdown-only, or still being written) is never "previous".
        write('22-07-2026', 'seo-audit.md', '# report');
        write('28-08-2026', 'orphaned-pages-28-08-2026.json', {
            pages: [{ url: 'https://example.com/kept' }, { url: 'https://example.com/new' }],
        });
        write('28-08-2026', 'h1-issues-28-08-2026.json', { issues: [] });
        index('28-08-2026');

        const result = getFindings(root, DOMAIN)!;
        const orphans = result.groups.find(g => g.check === 'orphaned_page')!;

        expect(result.previousReportDate).toBe('14-06-2026');
        expect(orphans.newUrls).toEqual(['https://example.com/new']);
        expect(orphans.resolvedUrls).toEqual(['https://example.com/old']);
        expect(result.resolvedGroups).toEqual([
            {
                fingerprint: 'seo:example.com:h1:missing',
                check: 'h1',
                kind: 'missing',
                severity: 'high',
            },
        ]);
    });

    it('never reports a check the current report could not read as resolved', () => {
        write('14-06-2026', '404-link-report-14-06-2026.json', {
            entries: [{ target: 'https://example.com/gone', status: 404 }],
        });
        write('14-06-2026', 'title-issues-14-06-2026.json', { issues: [] });
        index('14-06-2026');
        // report-404s failed this time: only the seo-issues files exist.
        write('28-08-2026', 'title-issues-28-08-2026.json', { issues: [] });
        index('28-08-2026');

        const result = getFindings(root, DOMAIN)!;
        expect(result.checksMissing).toContain('broken_link');
        expect(result.resolvedGroups).toEqual([]);
    });

    it('does not diff a check the previous report could not read', () => {
        write('14-06-2026', 'title-issues-14-06-2026.json', 'not json {');
        write('14-06-2026', 'h1-issues-14-06-2026.json', { issues: [] });
        index('14-06-2026');
        write('28-08-2026', 'title-issues-28-08-2026.json', {
            issues: [{ url: 'https://example.com/a', issue: 'too_short' }],
        });
        index('28-08-2026');

        const [group] = getFindings(root, DOMAIN)!.groups;
        expect(group.previousCheckMissing).toBe(true);
        expect(group.newUrls).toEqual(['https://example.com/a']);
        expect(group.resolvedUrls).toEqual([]);
    });

    it('leaves a corrupt check file out of the index instead of treating it as empty', () => {
        write('28-08-2026', 'title-issues-28-08-2026.json', '{"issues": [');
        write('28-08-2026', 'h1-issues-28-08-2026.json', { issues: [] });
        const built = buildFindingsIndex(join(root, DOMAIN, '28-08-2026'), DOMAIN, '28-08-2026');
        expect(built.checks).toEqual(['h1']);
    });

    it('ignores folders without an index', () => {
        write('28-08-2026', 'title-issues-28-08-2026.json', {
            issues: [{ url: 'https://example.com/a', issue: 'duplicate' }],
        });
        expect(findingDates(root, DOMAIN)).toEqual([]);
        expect(getFindings(root, DOMAIN)).toBeNull();
        index('28-08-2026');
        expect(existsSync(join(root, DOMAIN, '28-08-2026', FINDINGS_FILE))).toBe(true);
        expect(findingDates(root, DOMAIN)).toEqual(['28-08-2026']);
    });

    it('orders report folders by date, not by name', () => {
        for (const date of ['01-09-2026', '28-08-2026', '14-06-2026']) {
            write(date, 'h1-issues-x.json', { issues: [] });
            index(date);
        }
        expect(findingDates(root, DOMAIN)).toEqual(['01-09-2026', '28-08-2026', '14-06-2026']);
        expect(getFindings(root, DOMAIN, '28-08-2026')!.previousReportDate).toBe('14-06-2026');
    });

    it('rereads an index that was rewritten', () => {
        write('28-08-2026', 'h1-issues-x.json', { issues: [] });
        index('28-08-2026');
        expect(getFindings(root, DOMAIN)!.groups).toEqual([]);
        write('28-08-2026', 'h1-issues-x.json', {
            issues: [{ url: 'https://example.com/a', issue: 'multiple' }],
        });
        index('28-08-2026');
        const file = join(root, DOMAIN, '28-08-2026', FINDINGS_FILE);
        utimesSync(file, new Date(), new Date(Date.now() + 5000));
        expect(getFindings(root, DOMAIN)!.groups).toHaveLength(1);
    });

    it('reads every check shape the report scripts emit', () => {
        expect(entriesOf('broken_link', [{ target: 'u1', status: 410 }])).toEqual([
            { url: 'u1', kind: 'status_410' },
        ]);
        expect(
            entriesOf('redirect_class', { issues: [{ url: 'u', category: 'https_upgrade' }] })
        ).toEqual([{ url: 'u', kind: 'https_upgrade' }]);
        expect(
            entriesOf('redirect_3xx', { issues: [{ url: 'u', status: 301, redirectsTo: 'v' }] })
        ).toEqual([{ url: 'u', kind: 'status_301' }]);
        expect(
            entriesOf('open_graph', {
                issues: [{ url: 'u', present: ['og:title'], missing: ['og:image'] }],
            })
        ).toEqual([{ url: 'u', kind: 'incomplete' }]);
        expect(entriesOf('twitter_card', { issues: [{ url: 'u' }] })).toEqual([
            { url: 'u', kind: 'missing' },
        ]);
        expect(entriesOf('orphaned_page', { pages: [{ url: 'u' }] })).toEqual([
            { url: 'u', kind: 'missing' },
        ]);
        expect(
            entriesOf('jsonld', { issues: [{ url: 'u', issue: 'missing', typesFound: [] }] })
        ).toEqual([{ url: 'u', kind: 'missing' }]);
        expect(
            entriesOf('meta_description', { issues: [{ url: 'u', issue: 'pixel_too_long' }] })
        ).toEqual([{ url: 'u', kind: 'pixel_too_long' }]);
        expect(entriesOf('title', { issues: 'not a list' })).toEqual([]);
    });

    it('prefers the unsuffixed file over its language twin', () => {
        write('28-08-2026', 'jsonld-issues-28-08-2026-cs.json', {
            issues: [{ url: 'https://example.com/cs', issue: 'missing' }],
        });
        write('28-08-2026', 'jsonld-issues-28-08-2026.json', {
            issues: [{ url: 'https://example.com/en', issue: 'missing' }],
        });
        index('28-08-2026');
        expect(getFindings(root, DOMAIN)!.groups[0].urls).toEqual(['https://example.com/en']);
    });

    it('caps URL lists and flags the truncation', () => {
        write('28-08-2026', 'twitter-card-missing-28-08-2026.json', {
            issues: Array.from({ length: 60 }, (_, i) => ({ url: `https://example.com/p${i}` })),
        });
        index('28-08-2026');
        const [group] = getFindings(root, DOMAIN)!.groups;
        expect(group.count).toBe(60);
        expect(group.urls).toHaveLength(50);
        expect(group.urlsTruncated).toBe(true);
    });

    it('returns null for an unknown date', () => {
        write('28-08-2026', 'title-issues-28-08-2026.json', { issues: [] });
        index('28-08-2026');
        expect(getFindings(root, DOMAIN, '01-01-2020')).toBeNull();
    });

    it('maps unknown kinds to the check default', () => {
        expect(severityOf('title', 'something_new')).toBe('high');
        expect(severityOf('unknown_check', 'x')).toBe('low');
    });

    it('normalises domains the same way for crawl and get_findings', () => {
        expect(normaliseDomain('WWW.Example.COM.')).toBe('example.com');
        expect(normaliseDomain(' example.com ')).toBe('example.com');
    });

    it('accepts only hostname-shaped domains', () => {
        expect(isValidDomain('example.cz')).toBe(true);
        expect(isValidDomain('sub.example.co.uk')).toBe(true);
        expect(isValidDomain('../etc')).toBe(false);
        expect(isValidDomain('example.com/../../x')).toBe(false);
        expect(isValidDomain('localhost')).toBe(false);
        expect(isValidDomain('[2001:db8::1]')).toBe(false);
    });
});
