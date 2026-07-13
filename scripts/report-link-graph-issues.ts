#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { messages, resolveLang, withSuffix } from './i18n.js';
import { dedupePagesByUrl, isHtmlPage } from './page-records.js';
import { buildReverseLinkGraph } from '../src/services/linkGraphService.js';
import {
    findPagesLinkingToBrokenPages,
    findRedirectsWithNoIncomingLinks,
    findPagesWithSingleDofollowIncomingLink,
} from '../src/services/issueChecksService.js';

// ── Types ────────────────────────────────────────────────────────────────────

type Link = { href?: string; text?: string; rel?: string };

type Page = {
    url: string;
    title?: string;
    response?: { status?: number };
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
const mi = messages[lang].linkGraphIssues;

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
    allPages.push(...dedupePagesByUrl(pages).filter(isHtmlPage));
}

if (allPages.length === 0) {
    console.error('No pages loaded. Exiting.');
    process.exit(1);
}

console.log(`\n📄 Loaded ${allPages.length} pages total\n`);

// Reverse link graph, built once and shared across all three checks below.
const linkGraph = buildReverseLinkGraph(allPages);

// ── Report 1: Pages linking to broken pages ──────────────────────────────────

console.log('📝 Report 1: Pages linking to broken pages');

const brokenLinkIssues = findPagesLinkingToBrokenPages(allPages);

writeJson(`broken-internal-links-${dateStamp}.json`, {
    total: brokenLinkIssues.length,
    issues: brokenLinkIssues,
});

if (csvFlag) {
    const rows: string[][] = [mi.csvBrokenLink];
    for (const e of brokenLinkIssues) {
        rows.push([
            e.sourceUrl,
            e.sourceTitle ?? '',
            e.targetUrl,
            String(e.targetStatus),
            e.linkText ?? '',
        ]);
    }
    writeCsv(`broken-internal-links-${dateStamp}.csv`, rows);
}

// ── Report 2: Redirected pages with no incoming internal links ──────────────

console.log('📝 Report 2: Redirected pages with no incoming internal links');

const orphanedRedirectIssues = findRedirectsWithNoIncomingLinks(allPages, linkGraph);

writeJson(`orphaned-redirects-${dateStamp}.json`, {
    total: orphanedRedirectIssues.length,
    issues: orphanedRedirectIssues,
});

if (csvFlag) {
    const rows: string[][] = [mi.csvOrphanRedirect];
    for (const e of orphanedRedirectIssues) {
        rows.push([e.url, String(e.status)]);
    }
    writeCsv(`orphaned-redirects-${dateStamp}.csv`, rows);
}

// ── Report 3: Pages with only one dofollow incoming internal link ───────────

console.log('📝 Report 3: Pages with only one dofollow incoming internal link');

const singleDofollowIssues = findPagesWithSingleDofollowIncomingLink(allPages, linkGraph);

writeJson(`single-dofollow-link-${dateStamp}.json`, {
    total: singleDofollowIssues.length,
    issues: singleDofollowIssues,
});

if (csvFlag) {
    const rows: string[][] = [mi.csvSingleDofollow];
    for (const e of singleDofollowIssues) {
        rows.push([
            e.url,
            e.dofollowReferrer.pageUrl,
            e.dofollowReferrer.pageTitle ?? '',
            e.dofollowReferrer.linkText ?? '',
            String(e.totalIncomingLinks),
        ]);
    }
    writeCsv(`single-dofollow-link-${dateStamp}.csv`, rows);
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${mi.sumHeader}`);
console.log(`  ${mi.sumBrokenLink}: ${brokenLinkIssues.length}`);
console.log(`  ${mi.sumOrphanRedirect}: ${orphanedRedirectIssues.length}`);
console.log(`  ${mi.sumSingleDofollow}: ${singleDofollowIssues.length}`);
console.log(`\n  ${mi.sumWritten}: ${reportsRoot}`);
