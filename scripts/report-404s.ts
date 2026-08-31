#!/usr/bin/env tsx

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { messages, resolveLang, langSuffix } from './i18n.js';
import {
    dedupePagesByUrl,
    ddmmyyyyToSortKey,
    getLatestCrawlDate,
    resolveSnapshotMode,
    selectSnapshot,
} from './page-records.js';
import { buildReverseLinkGraph } from '../src/services/linkGraphService.js';
import { mergeSingleDomain, mergeDomainsToIndividualJsonl } from '../src/services/fileService.js';

type Link = { href?: string; text?: string };
type Page = {
    url: string;
    title?: string;
    response?: { status?: number };
    links?: { internal?: Link[]; external?: Link[] };
    timestamp?: string;
    _metadata?: { crawlDate?: string };
};

type Referrer = {
    pageUrl: string;
    pageTitle?: string;
    linkText?: string;
    crawlDate?: string;
};

type ReportEntry = {
    target: string;
    status: number;
    timestamp?: string;
    discovery_source: 'linked_from_page' | 'seeded_or_sitemap';
    referrers: Referrer[];
    /** Crawl that produced this record — differs from the report's crawl_date for stale entries. */
    last_seen?: string;
};

const args = process.argv.slice(2);

const getArg = (name: string): string | undefined => {
    const index = args.findIndex(a => a === `--${name}`);
    if (index >= 0) return args[index + 1];
    const pref = `--${name}=`;
    const direct = args.find(a => a.startsWith(pref));
    return direct ? direct.slice(pref.length) : undefined;
};

const domainArg = getArg('domain'); // optional; if omitted processes all domains
const outputArg = getArg('output'); // optional custom output file
const csvFlag = args.some(a => a === '--csv'); // presence enables CSV output
const lang = resolveLang(getArg('language') ?? getArg('lang'));
const snapshotMode = resolveSnapshotMode(args); // --all-crawls opts into the historical union
const m4 = messages[lang].report404;
const ms = messages[lang].snapshot;

const storageRoot = './storage/datasets';
const reportsRoot = './storage/reports';

if (!existsSync(storageRoot)) {
    console.error(`Storage root not found: ${storageRoot}`);
    process.exit(1);
}

if (!existsSync(reportsRoot)) {
    mkdirSync(reportsRoot, { recursive: true });
}

const toDomainFile = (domain: string): string =>
    join(storageRoot, domain, `${domain.replace(/\./g, '_')}.jsonl`);

const toDatasetDate = (value?: string): string => {
    if (!value) return new Date().toISOString().slice(0, 10);

    if (/^\d{2}-\d{2}-\d{4}$/.test(value)) {
        return value;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-');
        return `${day}-${month}-${year}`;
    }

    return value;
};

const getLatestDatasetDate = (domain: string): string => {
    const domainPath = join(storageRoot, domain);
    const dateFolders = readdirSync(domainPath)
        .filter(name => /^\d{2}-\d{2}-\d{4}$/.test(name))
        .sort((a, b) => ddmmyyyyToSortKey(a).localeCompare(ddmmyyyyToSortKey(b)));

    return dateFolders.at(-1) ?? toDatasetDate(undefined);
};

// Ensure merged files exist for the domain(s) we need to process
if (domainArg) {
    console.log(`▶ Ensuring merged JSONL for ${domainArg}...`);
    mergeSingleDomain(storageRoot, domainArg);
} else {
    console.log('▶ Ensuring per-domain merged JSONL files exist...');
    mergeDomainsToIndividualJsonl(storageRoot);
}

const domainsToProcess = (() => {
    if (domainArg) return [domainArg];
    // process all domains that have a merged jsonl
    return readdirSync(storageRoot).filter((d: string) => existsSync(toDomainFile(d)));
})();

const getReportDir = (domain: string, pages: Page[]): string => {
    const crawlDate = getLatestCrawlDate(pages);
    return join(
        reportsRoot,
        domain,
        crawlDate ? toDatasetDate(crawlDate) : getLatestDatasetDate(domain)
    );
};

const ensureDir = (dir: string): void => {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
};

for (const domain of domainsToProcess) {
    const filePath = toDomainFile(domain);
    if (!existsSync(filePath)) {
        console.warn(`Skipping ${domain}: merged file not found at ${filePath}`);
        continue;
    }

    console.log(`🔍 Processing ${filePath}`);
    // Latest crawl of each URL only — a page that 404ed once but is fixed in a
    // newer crawl must not be reported from the stale record.
    const deduped: Page[] = dedupePagesByUrl(
        readFileSync(filePath, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => JSON.parse(line) as Page)
    );
    // ...and the latest crawl's URLs only — a URL retired since an older crawl keeps its old
    // record forever, so without this the report resurrects long-fixed 404s (see selectSnapshot).
    const { selected: pages, snapshot } = selectSnapshot(domain, deduped, snapshotMode, ms);
    const reportDir = outputArg ? undefined : getReportDir(domain, pages);
    const pageCrawlDate = getLatestCrawlDate(pages);
    const dateStamp = pageCrawlDate ? toDatasetDate(pageCrawlDate) : getLatestDatasetDate(domain);
    const defaultOutput =
        outputArg ?? join(reportDir!, `404-link-report-${dateStamp}${langSuffix(lang)}.json`);
    const defaultCsv = outputArg
        ? outputArg.replace(/\.json$/, '.csv')
        : join(reportDir!, `404-link-report-${dateStamp}${langSuffix(lang)}.csv`);
    const domainEntries: ReportEntry[] = [];
    const staleEntries: ReportEntry[] = [];

    if (reportDir) {
        ensureDir(reportDir);
    }

    // Build reverse index: target URL -> referrers (internal + external links, matching the
    // original inline behavior here — unlike the internal-only default used elsewhere).
    const linkGraph = buildReverseLinkGraph(pages, { internalOnly: false });
    const refMap = new Map<string, Referrer[]>(
        [...linkGraph.entries()].map(([url, refs]) => [
            url,
            refs.map(r => ({
                pageUrl: r.pageUrl,
                pageTitle: r.pageTitle,
                linkText: r.linkText,
                crawlDate: r.crawlDate,
            })),
        ])
    );

    const toEntry = (nf: Page): ReportEntry => {
        const refs = refMap.get(nf.url) ?? [];
        // Drop self-references from error pages to reduce noise
        const filteredRefs = refs.filter(r => r.pageUrl !== nf.url);
        return {
            target: nf.url,
            status: nf.response?.status ?? 404,
            timestamp: nf.timestamp,
            discovery_source: filteredRefs.length > 0 ? 'linked_from_page' : 'seeded_or_sitemap',
            referrers: filteredRefs,
            last_seen: nf._metadata?.crawlDate,
        };
    };

    // Collect 404 pages
    domainEntries.push(...pages.filter(p => p.response?.status === 404).map(toEntry));
    // Stale 404s are reported separately, never mixed in: their status was true at `last_seen`
    // but the URL has not been crawled since, so it may well have been redirected or removed.
    if (snapshotMode === 'latest') {
        staleEntries.push(...snapshot.stale.filter(p => p.response?.status === 404).map(toEntry));
    }

    writeFileSync(
        defaultOutput,
        JSON.stringify(
            {
                domain,
                crawl_date: snapshot.latestDate ?? dateStamp,
                snapshot_mode: snapshotMode,
                pages_analyzed: pages.length,
                total: domainEntries.length,
                entries: domainEntries,
                [ms.staleSectionTitle]: staleEntries,
            },
            null,
            2
        )
    );
    console.log(
        `✅ Wrote JSON report: ${defaultOutput} (${domainEntries.length} entries` +
            (staleEntries.length ? `, ${staleEntries.length} stale` : '') +
            ')'
    );

    if (csvFlag) {
        const csvRow = (values: (string | undefined)[]): string =>
            values.map(v => `"${(v ?? '').replace(/"/g, '""')}"`).join(',');
        const rows = [m4.csvHeader.join(',')];
        // Stale rows are carried in the CSV too, tagged in the `snapshot` column, so a
        // spreadsheet reader can tell a current finding from an unverified historical one.
        const tagged: [ReportEntry, string][] = [
            ...domainEntries.map((e): [ReportEntry, string] => [e, 'latest']),
            ...staleEntries.map((e): [ReportEntry, string] => [e, 'stale']),
        ];
        for (const [entry, snapshotTag] of tagged) {
            const head = [
                entry.target,
                String(entry.status),
                entry.timestamp ?? '',
                entry.discovery_source,
            ];
            if (entry.referrers.length === 0) {
                rows.push(csvRow([...head, '', '', '', '', snapshotTag, entry.last_seen ?? '']));
            } else {
                for (const ref of entry.referrers) {
                    rows.push(
                        csvRow([
                            ...head,
                            ref.pageUrl ?? '',
                            ref.pageTitle ?? '',
                            ref.linkText ?? '',
                            ref.crawlDate ?? '',
                            snapshotTag,
                            entry.last_seen ?? '',
                        ])
                    );
                }
            }
        }
        writeFileSync(defaultCsv, rows.join('\n') + '\n');
        console.log(`✅ Wrote CSV report: ${defaultCsv}`);
    }
}
