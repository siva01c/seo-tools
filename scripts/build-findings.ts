#!/usr/bin/env tsx
/**
 * Folds one report folder's per-check JSON files into the compact `findings.json` that the
 * MCP tool `get_findings` reads.
 *
 *   npm run report:findings -- --domain example.com --date 28-08-2026
 *
 * Runs as its own process on purpose: the raw files of a large site are 100+ MB each and must
 * not be parsed on the MCP server's event loop. The crawl job runs it after `report:seo-issues`
 * and `report:404`; run it by hand to index a folder produced before findings existed.
 * Exits non-zero when the folder is missing or no check file could be read.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import {
    buildFindingsIndex,
    isValidDomain,
    normaliseDomain,
    writeFindingsIndex,
} from '../src/services/findingsService.js';

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
    const index = args.findIndex(a => a === `--${name}`);
    if (index >= 0) return args[index + 1];
    const pref = `--${name}=`;
    return args.find(a => a.startsWith(pref))?.slice(pref.length);
};

const domain = normaliseDomain(getArg('domain') ?? '');
const date = getArg('date') ?? '';
if (!isValidDomain(domain) || !/^\d{2}-\d{2}-\d{4}$/.test(date)) {
    console.error('Usage: build-findings --domain <domain> --date <DD-MM-YYYY>');
    process.exit(2);
}

const storageRoot = process.env.APIFY_LOCAL_STORAGE_DIR ?? './storage';
const dir = join(storageRoot, 'reports', domain, date);
if (!existsSync(dir)) {
    console.error(`Report folder not found: ${dir}`);
    process.exit(1);
}

const index = buildFindingsIndex(dir, domain, date);
if (index.checks.length === 0) {
    console.error(`No readable check files in ${dir}`);
    process.exit(1);
}
writeFindingsIndex(dir, index);
const urls = index.groups.reduce((n, g) => n + g.urls.length, 0);
console.log(
    `✅ ${join(dir, 'findings.json')}: ${index.checks.length} checks, ${index.groups.length} groups, ${urls} findings`
);
