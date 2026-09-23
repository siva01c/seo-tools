import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    findingDates,
    getFindings,
    isValidDomain,
    severityOf,
} from '../../services/findingsService.js';

const DOMAIN = 'example.com';

describe('findingsService', () => {
    let root: string;

    const write = (date: string, file: string, data: unknown) => {
        const dir = join(root, DOMAIN, date);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, file), JSON.stringify(data));
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
                { url: 'https://example.com/a', issue: 'duplicate' },
                { url: 'https://example.com/b', issue: 'duplicate' },
                { url: 'https://example.com/c', issue: 'too_long' },
            ],
        });
        write('28-08-2026', '404-link-report-28-08-2026.json', {
            entries: [{ target: 'https://example.com/gone', status: 404 }],
        });

        const result = getFindings(root, DOMAIN)!;

        expect(result.reportDate).toBe('28-08-2026');
        expect(result.previousReportDate).toBeNull();
        expect(result.groups.map(g => [g.fingerprint, g.severity, g.count])).toEqual([
            ['seo:example.com:title:duplicate', 'critical', 2],
            ['seo:example.com:broken_link:status_404', 'critical', 1],
            ['seo:example.com:title:too_long', 'high', 1],
        ]);
        expect(result.totals).toEqual({ critical: 3, high: 1, medium: 0, low: 0 });
        // First run: every URL counts as new.
        expect(result.groups[0].newUrls).toEqual([
            'https://example.com/a',
            'https://example.com/b',
        ]);
    });

    it('diffs against the previous report folder that has findings', () => {
        write('14-06-2026', 'orphaned-pages-2026-06-14.json', {
            pages: [{ url: 'https://example.com/old' }, { url: 'https://example.com/kept' }],
        });
        write('14-06-2026', 'h1-issues-2026-06-14.json', {
            issues: [{ url: 'https://example.com/x', issue: 'missing' }],
        });
        // A markdown-only folder in between must be skipped as "previous".
        mkdirSync(join(root, DOMAIN, '22-07-2026'), { recursive: true });
        writeFileSync(join(root, DOMAIN, '22-07-2026', 'seo-audit.md'), '# report');
        write('28-08-2026', 'orphaned-pages-28-08-2026.json', {
            pages: [{ url: 'https://example.com/kept' }, { url: 'https://example.com/new' }],
        });

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

    it('reads a bare-array 404 report (schema v1)', () => {
        write('28-08-2026', '404-link-report-28-08-2026.json', [
            { target: 'https://example.com/gone', status: 410 },
        ]);
        const [group] = getFindings(root, DOMAIN)!.groups;
        expect(group.fingerprint).toBe('seo:example.com:broken_link:status_410');
    });

    it('prefers the unsuffixed file over its language twin', () => {
        write('28-08-2026', 'jsonld-issues-28-08-2026-cs.json', {
            issues: [{ url: 'https://example.com/cs', issue: 'missing' }],
        });
        write('28-08-2026', 'jsonld-issues-28-08-2026.json', {
            issues: [{ url: 'https://example.com/en', issue: 'missing' }],
        });
        expect(getFindings(root, DOMAIN)!.groups[0].urls).toEqual(['https://example.com/en']);
    });

    it('caps URL lists and flags the truncation', () => {
        write('28-08-2026', 'twitter-card-missing-28-08-2026.json', {
            issues: Array.from({ length: 60 }, (_, i) => ({ url: `https://example.com/p${i}` })),
        });
        const [group] = getFindings(root, DOMAIN)!.groups;
        expect(group.count).toBe(60);
        expect(group.urls).toHaveLength(50);
        expect(group.urlsTruncated).toBe(true);
    });

    it('returns null without findings, and for an unknown date', () => {
        expect(getFindings(root, DOMAIN)).toBeNull();
        write('28-08-2026', 'title-issues-28-08-2026.json', { issues: [] });
        expect(getFindings(root, DOMAIN, '01-01-2020')).toBeNull();
        expect(findingDates(root, DOMAIN)).toEqual(['28-08-2026']);
    });

    it('maps unknown kinds to the check default', () => {
        expect(severityOf('title', 'something_new')).toBe('high');
        expect(severityOf('unknown_check', 'x')).toBe('low');
    });

    it('accepts only hostname-shaped domains', () => {
        expect(isValidDomain('ludekkvapil.cz')).toBe(true);
        expect(isValidDomain('sub.example.co.uk')).toBe(true);
        expect(isValidDomain('../etc')).toBe(false);
        expect(isValidDomain('example.com/../../x')).toBe(false);
        expect(isValidDomain('localhost')).toBe(false);
    });
});
