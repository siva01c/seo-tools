import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    CRAWL_MANIFEST_FILE,
    readCrawlMode,
    writeCrawlManifest,
} from '../../services/crawlManifest.js';

describe('crawlManifest', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'crawl-manifest-'));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips an incremental crawl', () => {
        writeCrawlManifest(dir, {
            crawlDate: '28-08-2026',
            mode: 'incremental',
            previousCrawlDate: '14-06-2026',
        });
        expect(readCrawlMode(dir)).toBe('incremental');
    });

    it('round-trips a full crawl', () => {
        writeCrawlManifest(dir, { crawlDate: '28-08-2026', mode: 'full' });
        expect(readCrawlMode(dir)).toBe('full');
    });

    it('reports "full" for a date folder with no manifest', () => {
        // Datasets crawled before the manifest existed must keep their previous meaning.
        expect(readCrawlMode(dir)).toBe('full');
    });

    it('reports "full" rather than throwing on an unreadable manifest', () => {
        writeFileSync(join(dir, CRAWL_MANIFEST_FILE), 'not json');
        expect(readCrawlMode(dir)).toBe('full');
    });
});
