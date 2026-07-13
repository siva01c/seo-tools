#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { messages, resolveLang, withSuffix } from './i18n.js';
import { dedupePagesByUrl, isHtmlPage } from './page-records.js';
import {
    findIncompleteOpenGraph,
    findMissingTwitterCard,
    classifyRedirects,
} from '../src/services/issueChecksService.js';

// ── Types ────────────────────────────────────────────────────────────────────

type Heading = { level: number; text: string };
type Link = { href?: string; text?: string };

type Page = {
    url: string;
    title?: string;
    timestamp?: string;
    response?: { status?: number; url?: string };
    seo?: {
        metaTags?: Record<string, string>;
    };
    aiMetadata?: {
        customMetadata?: {
            headingStructure?: Heading[];
        };
        structuredData?: {
            jsonLd?: any[];
        };
    };
    links?: { internal?: Link[]; external?: Link[] };
    _metadata?: { crawlDate?: string };
};

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const getArg = (name: string): string | undefined => {
    const index = args.findIndex(a => a === `--${name}`);
    if (index >= 0) return args[index + 1];
    const pref = `--${name}=`;
    const direct = args.find(a => a.startsWith(pref));
    return direct ? direct.slice(pref.length) : undefined;
};

const domainArg = getArg('domain');
const outputDirArg = getArg('output-dir');
const csvFlag = args.some(a => a === '--csv');
const lang = resolveLang(getArg('language') ?? getArg('lang'));
const mi = messages[lang].seoIssues;

// ── Paths ────────────────────────────────────────────────────────────────────

const storageRoot = './storage/datasets';

if (!existsSync(storageRoot)) {
    console.error(`Storage root not found: ${storageRoot}`);
    process.exit(1);
}

const toDomainFile = (domain: string): string =>
    join(storageRoot, domain, `${domain.replace(/\./g, '_')}.jsonl`);

const domainsToProcess = (() => {
    if (domainArg) return [domainArg];
    return readdirSync(storageRoot).filter(d => existsSync(toDomainFile(d)));
})();

const dateStamp = new Date().toISOString().slice(0, 10);

// Latest crawl date (DD-MM-YYYY) for a domain, taken from its dataset date folders.
const getLatestDatasetDate = (domain: string): string => {
    const dir = join(storageRoot, domain);
    if (!existsSync(dir)) return dateStamp;
    const dates = readdirSync(dir)
        .filter(d => /^\d{2}-\d{2}-\d{4}$/.test(d))
        .sort((a, b) => {
            const iso = (d: string) => `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
            return iso(a).localeCompare(iso(b));
        });
    return dates.length ? dates[dates.length - 1] : dateStamp;
};

// One folder per domain: storage/reports/<domain>/<date>/ — consistent with the other report
// scripts. Aggregate runs (no --domain) collect under _all-domains/.
const reportDate = domainArg ? getLatestDatasetDate(domainArg) : dateStamp;
const reportsRoot =
    outputDirArg ?? join('./storage/reports', domainArg ?? '_all-domains', reportDate);
mkdirSync(reportsRoot, { recursive: true });

// ── Helpers ──────────────────────────────────────────────────────────────────

const csvEscape = (v: string | undefined): string => `"${(v ?? '').replace(/"/g, '""')}"`;

const writeJson = (filename: string, data: unknown): void => {
    const path = join(reportsRoot, withSuffix(filename, lang));
    writeFileSync(path, JSON.stringify(data, null, 2));
    console.log(`  ✅ ${path}`);
};

const writeCsv = (filename: string, rows: string[][]): void => {
    const path = join(reportsRoot, withSuffix(filename, lang));
    writeFileSync(path, rows.map(r => r.map(csvEscape).join(',')).join('\n') + '\n');
    console.log(`  ✅ ${path} (CSV)`);
};

/** Recursively collect all @type values from a JSON-LD object, flattening @graph arrays. */
function extractJsonLdTypes(node: any): string[] {
    if (!node || typeof node !== 'object') return [];
    const types: string[] = [];
    if (Array.isArray(node)) {
        for (const item of node) types.push(...extractJsonLdTypes(item));
        return types;
    }
    if (node['@type']) {
        const t = node['@type'];
        if (Array.isArray(t)) types.push(...t);
        else types.push(String(t));
    }
    if (Array.isArray(node['@graph'])) {
        for (const item of node['@graph']) types.push(...extractJsonLdTypes(item));
    }
    return types;
}

/** Normalize a URL for orphan comparison (strip trailing slash). */
const normalizeUrl = (u: string): string => u.replace(/\/$/, '');

// ── Load pages ───────────────────────────────────────────────────────────────

const allPages: Page[] = [];

for (const domain of domainsToProcess) {
    const filePath = toDomainFile(domain);
    if (!existsSync(filePath)) {
        console.warn(`Skipping ${domain}: merged file not found at ${filePath}`);
        continue;
    }
    console.log(`🔍 Processing ${filePath}`);
    const pages = readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as Page);
    // Latest crawl of each URL only, HTML pages only — feeds and other XML
    // resources have no titles/meta/H1/JSON-LD and would be flagged on every check.
    allPages.push(...dedupePagesByUrl(pages).filter(isHtmlPage));
}

if (allPages.length === 0) {
    console.error('No pages loaded. Exiting.');
    process.exit(1);
}

console.log(`\n📄 Loaded ${allPages.length} pages total\n`);

// ── Report 1: Meta description issues ────────────────────────────────────────

console.log('📝 Report 1: Meta description issues');

type MetaDescIssue = {
    url: string;
    title?: string;
    issue: 'missing' | 'too_short' | 'too_long' | 'duplicate';
    value?: string;
    length?: number;
    duplicateUrls?: string[];
};

const metaDescIssues: MetaDescIssue[] = [];

// Collect descriptions for duplicate detection
const descMap = new Map<string, Page[]>();
for (const page of allPages) {
    const desc = page.seo?.metaTags?.['description'];
    if (desc) {
        const list = descMap.get(desc) ?? [];
        list.push(page);
        descMap.set(desc, list);
    }
}

const duplicateDescs = new Set(
    [...descMap.entries()].filter(([, pages]) => pages.length > 1).map(([desc]) => desc)
);

for (const page of allPages) {
    const desc = page.seo?.metaTags?.['description'];
    if (!desc || desc.trim() === '') {
        metaDescIssues.push({ url: page.url, title: page.title, issue: 'missing' });
        continue;
    }
    const len = desc.length;
    if (len < 70) {
        metaDescIssues.push({
            url: page.url,
            title: page.title,
            issue: 'too_short',
            value: desc,
            length: len,
        });
    } else if (len > 160) {
        metaDescIssues.push({
            url: page.url,
            title: page.title,
            issue: 'too_long',
            value: desc,
            length: len,
        });
    }
    if (duplicateDescs.has(desc)) {
        const others = (descMap.get(desc) ?? []).filter(p => p.url !== page.url).map(p => p.url);
        metaDescIssues.push({
            url: page.url,
            title: page.title,
            issue: 'duplicate',
            value: desc,
            length: len,
            duplicateUrls: others,
        });
    }
}

writeJson(`meta-description-${dateStamp}.json`, {
    total: metaDescIssues.length,
    issues: metaDescIssues,
});

if (csvFlag) {
    const rows: string[][] = [mi.csvMetaDesc];
    for (const e of metaDescIssues) {
        rows.push([
            e.url,
            e.title ?? '',
            e.issue,
            e.value ?? '',
            String(e.length ?? ''),
            (e.duplicateUrls ?? []).join(' | '),
        ]);
    }
    writeCsv(`meta-description-${dateStamp}.csv`, rows);
}

// ── Report 2: Title issues ────────────────────────────────────────────────────

console.log('📝 Report 2: Title tag issues');

type TitleIssue = {
    url: string;
    issue: 'missing' | 'too_short' | 'too_long' | 'duplicate';
    value?: string;
    length?: number;
    duplicateUrls?: string[];
};

const titleIssues: TitleIssue[] = [];

const titleMap = new Map<string, Page[]>();
for (const page of allPages) {
    if (page.title) {
        const list = titleMap.get(page.title) ?? [];
        list.push(page);
        titleMap.set(page.title, list);
    }
}

const duplicateTitles = new Set(
    [...titleMap.entries()].filter(([, pages]) => pages.length > 1).map(([t]) => t)
);

for (const page of allPages) {
    const title = page.title;
    if (!title || title.trim() === '') {
        titleIssues.push({ url: page.url, issue: 'missing' });
        continue;
    }
    const len = title.length;
    if (len < 30) {
        titleIssues.push({ url: page.url, issue: 'too_short', value: title, length: len });
    } else if (len > 60) {
        titleIssues.push({ url: page.url, issue: 'too_long', value: title, length: len });
    }
    if (duplicateTitles.has(title)) {
        const others = (titleMap.get(title) ?? []).filter(p => p.url !== page.url).map(p => p.url);
        titleIssues.push({
            url: page.url,
            issue: 'duplicate',
            value: title,
            length: len,
            duplicateUrls: others,
        });
    }
}

writeJson(`title-issues-${dateStamp}.json`, { total: titleIssues.length, issues: titleIssues });

if (csvFlag) {
    const rows: string[][] = [mi.csvTitle];
    for (const e of titleIssues) {
        rows.push([
            e.url,
            e.issue,
            e.value ?? '',
            String(e.length ?? ''),
            (e.duplicateUrls ?? []).join(' | '),
        ]);
    }
    writeCsv(`title-issues-${dateStamp}.csv`, rows);
}

// ── Report 3: H1 issues ───────────────────────────────────────────────────────

console.log('📝 Report 3: H1 tag issues');

type H1Issue = {
    url: string;
    title?: string;
    issue: 'missing' | 'multiple' | 'too_short' | 'too_long' | 'duplicate';
    h1Values: string[];
    duplicateUrls?: string[];
};

const h1Issues: H1Issue[] = [];

const h1Map = new Map<string, Page[]>();
for (const page of allPages) {
    const h1s = (page.aiMetadata?.customMetadata?.headingStructure ?? [])
        .filter(h => h.level === 1)
        .map(h => h.text);
    for (const h1 of h1s) {
        const list = h1Map.get(h1) ?? [];
        list.push(page);
        h1Map.set(h1, list);
    }
}

const duplicateH1s = new Set(
    [...h1Map.entries()].filter(([, pages]) => pages.length > 1).map(([h]) => h)
);

for (const page of allPages) {
    const headings = page.aiMetadata?.customMetadata?.headingStructure ?? [];
    const h1s = headings.filter(h => h.level === 1).map(h => h.text);

    if (h1s.length === 0) {
        h1Issues.push({ url: page.url, title: page.title, issue: 'missing', h1Values: [] });
        continue;
    }

    if (h1s.length > 1) {
        h1Issues.push({ url: page.url, title: page.title, issue: 'multiple', h1Values: h1s });
    }

    for (const h1 of h1s) {
        const len = h1.length;
        if (len < 10) {
            h1Issues.push({ url: page.url, title: page.title, issue: 'too_short', h1Values: h1s });
        } else if (len > 70) {
            h1Issues.push({ url: page.url, title: page.title, issue: 'too_long', h1Values: h1s });
        }
        if (duplicateH1s.has(h1)) {
            const others = (h1Map.get(h1) ?? []).filter(p => p.url !== page.url).map(p => p.url);
            h1Issues.push({
                url: page.url,
                title: page.title,
                issue: 'duplicate',
                h1Values: h1s,
                duplicateUrls: others,
            });
        }
    }
}

writeJson(`h1-issues-${dateStamp}.json`, { total: h1Issues.length, issues: h1Issues });

if (csvFlag) {
    const rows: string[][] = [mi.csvH1];
    for (const e of h1Issues) {
        rows.push([
            e.url,
            e.title ?? '',
            e.issue,
            e.h1Values.join(' | '),
            (e.duplicateUrls ?? []).join(' | '),
        ]);
    }
    writeCsv(`h1-issues-${dateStamp}.csv`, rows);
}

// ── Report 4: Orphaned pages ──────────────────────────────────────────────────

console.log('📝 Report 4: Orphaned pages');

type OrphanEntry = { url: string; title?: string; timestamp?: string };

// Build set of all internal link targets across all pages
const linkedUrls = new Set<string>();
for (const page of allPages) {
    for (const link of page.links?.internal ?? []) {
        if (link.href) linkedUrls.add(normalizeUrl(link.href));
    }
}

// Detect root URLs (homepages) to exclude
const rootUrls = new Set<string>();
for (const _domain of domainsToProcess) {
    // Any page whose path is just "/" or "" is a homepage
    try {
        const parsed = new URL(
            allPages.find(p => {
                try {
                    return new URL(p.url).pathname === '/';
                } catch {
                    return false;
                }
            })?.url ?? ''
        );
        rootUrls.add(normalizeUrl(parsed.origin + '/'));
        rootUrls.add(normalizeUrl(parsed.origin));
    } catch {
        /* ignore */
    }
}

const orphanedPages: OrphanEntry[] = allPages
    .filter(page => {
        const norm = normalizeUrl(page.url);
        if (rootUrls.has(norm)) return false; // skip homepages
        return !linkedUrls.has(norm);
    })
    .map(page => ({ url: page.url, title: page.title, timestamp: page.timestamp }));

writeJson(`orphaned-pages-${dateStamp}.json`, {
    total: orphanedPages.length,
    pages: orphanedPages,
});

if (csvFlag) {
    const rows: string[][] = [mi.csvOrphan];
    for (const e of orphanedPages) {
        rows.push([e.url, e.title ?? '', e.timestamp ?? '']);
    }
    writeCsv(`orphaned-pages-${dateStamp}.csv`, rows);
}

// ── Report 5: JSON-LD issues ──────────────────────────────────────────────────

console.log('📝 Report 5: JSON-LD issues');

type JsonLdIssue = {
    url: string;
    title?: string;
    issue: 'missing' | 'no_type';
    typesFound: string[];
};

const jsonLdIssues: JsonLdIssue[] = [];
const schemaTypeSummary: Record<string, number> = {};

for (const page of allPages) {
    const jsonLd = page.aiMetadata?.structuredData?.jsonLd ?? [];
    const types = extractJsonLdTypes(jsonLd);

    // Count types for summary
    for (const t of types) {
        schemaTypeSummary[t] = (schemaTypeSummary[t] ?? 0) + 1;
    }

    if (jsonLd.length === 0) {
        jsonLdIssues.push({ url: page.url, title: page.title, issue: 'missing', typesFound: [] });
    } else if (types.length === 0) {
        jsonLdIssues.push({ url: page.url, title: page.title, issue: 'no_type', typesFound: [] });
    }
}

// Sort summary by count descending
const sortedSummary = Object.fromEntries(
    Object.entries(schemaTypeSummary).sort(([, a], [, b]) => b - a)
);

writeJson(`jsonld-issues-${dateStamp}.json`, {
    total: jsonLdIssues.length,
    schemaTypeSummary: sortedSummary,
    issues: jsonLdIssues,
});

if (csvFlag) {
    const rows: string[][] = [mi.csvJsonLd];
    for (const e of jsonLdIssues) {
        rows.push([e.url, e.title ?? '', e.issue, e.typesFound.join(' | ')]);
    }
    writeCsv(`jsonld-issues-${dateStamp}.csv`, rows);
}

// ── Report 6: Open Graph completeness ────────────────────────────────────────

console.log('📝 Report 6: Open Graph completeness');

const ogIssues = findIncompleteOpenGraph(allPages);

writeJson(`og-completeness-${dateStamp}.json`, { total: ogIssues.length, issues: ogIssues });

if (csvFlag) {
    const rows: string[][] = [mi.csvOgComplete];
    for (const e of ogIssues) {
        rows.push([e.url, e.title ?? '', e.present.join(' | '), e.missing.join(' | ')]);
    }
    writeCsv(`og-completeness-${dateStamp}.csv`, rows);
}

// ── Report 7: Twitter Card missing ───────────────────────────────────────────

console.log('📝 Report 7: Twitter Card missing');

const twitterCardIssues = findMissingTwitterCard(allPages);

writeJson(`twitter-card-missing-${dateStamp}.json`, {
    total: twitterCardIssues.length,
    issues: twitterCardIssues,
});

if (csvFlag) {
    const rows: string[][] = [mi.csvTwitterCard];
    for (const e of twitterCardIssues) {
        rows.push([e.url, e.title ?? '']);
    }
    writeCsv(`twitter-card-missing-${dateStamp}.csv`, rows);
}

// ── Report 8: Redirect classification ────────────────────────────────────────

console.log('📝 Report 8: Redirect classification');

const redirectClassIssues = classifyRedirects(allPages);

writeJson(`redirect-classification-${dateStamp}.json`, {
    total: redirectClassIssues.length,
    issues: redirectClassIssues,
});

if (csvFlag) {
    const rows: string[][] = [mi.csvRedirectClass];
    for (const e of redirectClassIssues) {
        rows.push([e.url, e.redirectsTo ?? '', e.category]);
    }
    writeCsv(`redirect-classification-${dateStamp}.csv`, rows);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${mi.sumHeader}`);
console.log(`  ${mi.sumMetaDesc}: ${metaDescIssues.length}`);
console.log(`  ${mi.sumTitle}: ${titleIssues.length}`);
console.log(`  ${mi.sumH1}: ${h1Issues.length}`);
console.log(`  ${mi.sumOrphan}: ${orphanedPages.length}`);
console.log(`  ${mi.sumJsonLd}: ${jsonLdIssues.length}`);
console.log(`  ${mi.sumOgComplete}: ${ogIssues.length}`);
console.log(`  ${mi.sumTwitterCard}: ${twitterCardIssues.length}`);
console.log(`  ${mi.sumRedirectClass}: ${redirectClassIssues.length}`);
console.log(`\n  ${mi.sumWritten}: ${reportsRoot}`);
