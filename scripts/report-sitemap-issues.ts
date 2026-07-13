#!/usr/bin/env tsx

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { messages, resolveLang, withSuffix } from './i18n.js';
import { mapUrlsAcrossSitemaps } from '../src/services/sitemapService.js';
import { findUrlsInMultipleSitemaps } from '../src/services/issueChecksService.js';

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
const urlArg = getArg('url');
const outputDirArg = getArg('output-dir');
const csvFlag = args.some(a => a === '--csv');
const lang = resolveLang(getArg('language') ?? getArg('lang'));
const mi = messages[lang].sitemapIssues;

if (!domainArg) {
    console.error('Usage: report-sitemap-issues.ts --domain <domain> [--url <baseUrl>] [--csv]');
    process.exit(1);
}

const baseUrl = urlArg ?? `https://${domainArg}`;

// ── Paths ────────────────────────────────────────────────────────────────────

const storageRoot = './storage/datasets';
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

const reportDate = getLatestDatasetDate(domainArg);
const reportsRoot = outputDirArg ?? join('./storage/reports', domainArg, reportDate);
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

// ── Report: Pages in multiple sitemaps ───────────────────────────────────────

const run = async (): Promise<void> => {
    console.log(`🗺️  Fetching sitemaps for ${baseUrl}`);

    const sitemapUrlMap = await mapUrlsAcrossSitemaps(baseUrl);
    const multiSitemapIssues = findUrlsInMultipleSitemaps(sitemapUrlMap);

    writeJson(`multi-sitemap-urls-${dateStamp}.json`, {
        total: multiSitemapIssues.length,
        issues: multiSitemapIssues,
    });

    if (csvFlag) {
        const rows: string[][] = [mi.csvMultiSitemap];
        for (const e of multiSitemapIssues) {
            rows.push([e.url, e.sitemaps.join(' | ')]);
        }
        writeCsv(`multi-sitemap-urls-${dateStamp}.csv`, rows);
    }

    console.log(`\n${mi.sumHeader}`);
    console.log(`  ${mi.sumMultiSitemap}: ${multiSitemapIssues.length}`);
    console.log(`\n  ${mi.sumWritten}: ${reportsRoot}`);
};

run().catch(error => {
    console.error(error);
    process.exit(1);
});
