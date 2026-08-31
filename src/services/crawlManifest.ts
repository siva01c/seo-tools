import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * How much of the site a single crawl covered.
 *
 * `full`        — the crawler walked the whole site, so its date folder is a complete snapshot.
 * `incremental` — `--incremental` limited the run to new/modified URLs, so its date folder is a
 *                 *delta* on top of an earlier crawl, not a picture of the site on its own.
 *
 * Reports need the distinction: treating an incremental date folder as "the latest snapshot"
 * silently shrinks every report to the handful of pages that happened to change.
 */
export type CrawlMode = 'full' | 'incremental';

/** Written into each crawl's date folder next to the JSONL the crawl produced. */
export const CRAWL_MANIFEST_FILE = '_crawl-meta.json';

export interface ICrawlManifest {
    /** Date folder this manifest describes (DD-MM-YYYY). */
    crawlDate: string;
    mode: CrawlMode;
    /** For incremental runs, the crawl this one was diffed against. */
    previousCrawlDate?: string;
    startUrls?: string[];
    finishedAt?: string;
}

/** Persist the manifest for a finished crawl. Failures are logged, never fatal — the crawl data
 * itself is already on disk and a missing manifest only costs the `full` default on read. */
export function writeCrawlManifest(dateFolderPath: string, manifest: ICrawlManifest): void {
    try {
        writeFileSync(
            join(dateFolderPath, CRAWL_MANIFEST_FILE),
            JSON.stringify(manifest, null, 2) + '\n'
        );
    } catch (error) {
        console.warn(
            `⚠️ Could not write ${CRAWL_MANIFEST_FILE} to ${dateFolderPath}:`,
            error instanceof Error ? error.message : String(error)
        );
    }
}

/**
 * Crawl mode recorded for a date folder.
 *
 * Folders written before the manifest existed — and any folder whose manifest is missing or
 * unreadable — report `full`. That is the pre-manifest assumption, so existing datasets keep
 * behaving exactly as they did rather than being reinterpreted as deltas.
 */
export function readCrawlMode(dateFolderPath: string): CrawlMode {
    const manifestPath = join(dateFolderPath, CRAWL_MANIFEST_FILE);
    if (!existsSync(manifestPath)) return 'full';
    try {
        const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<ICrawlManifest>;
        return parsed.mode === 'incremental' ? 'incremental' : 'full';
    } catch {
        return 'full';
    }
}
