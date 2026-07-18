#!/usr/bin/env tsx

/**
 * Enforces the data-retention policy documented in docs/security.md (A6): deletes
 * date-folders older than a cutoff from storage/{datasets,key_value_stores,request_queues,
 * logs,reports}/<domain>/<DD-MM-YYYY>/, and prunes stale crawl_alerts.jsonl entries.
 *
 * Usage:
 *   npx tsx scripts/purge-old-data.ts --days 90              # purge everything older than 90 days
 *   npx tsx scripts/purge-old-data.ts --days 14 --domain example.com
 *   npx tsx scripts/purge-old-data.ts --days 90 --dry-run    # report only, delete nothing
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

const STORAGE_DIR = process.env.APIFY_LOCAL_STORAGE_DIR ?? './storage';
const STORAGE_TYPES = [
    'datasets',
    'key_value_stores',
    'request_queues',
    'logs',
    'reports',
] as const;

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
    const index = args.findIndex(a => a === `--${name}`);
    if (index >= 0) return args[index + 1];
    const pref = `--${name}=`;
    const direct = args.find(a => a.startsWith(pref));
    return direct ? direct.slice(pref.length) : undefined;
}

const dryRun = args.includes('--dry-run');
const domainFilter = getArg('domain');
const daysArg = getArg('days');
const days = daysArg ? parseInt(daysArg, 10) : NaN;

if (!Number.isFinite(days) || days < 0) {
    console.error(
        'Usage: npx tsx scripts/purge-old-data.ts --days <N> [--domain example.com] [--dry-run]'
    );
    process.exit(1);
}

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

function parseDateFolder(name: string): Date | null {
    const match = name.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!match) return null;
    const [, d, m, y] = match;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
}

let deletedDirs = 0;
let deletedBytes = 0;

function dirSizeBytes(dir: string): number {
    let total = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        total += entry.isDirectory() ? dirSizeBytes(full) : statSync(full).size;
    }
    return total;
}

for (const type of STORAGE_TYPES) {
    const typeDir = join(STORAGE_DIR, type);
    if (!existsSync(typeDir)) continue;

    for (const domain of readdirSync(typeDir)) {
        if (domainFilter && domain !== domainFilter) continue;
        const domainDir = join(typeDir, domain);
        if (!statSync(domainDir).isDirectory()) continue;

        for (const dateFolder of readdirSync(domainDir)) {
            const date = parseDateFolder(dateFolder);
            if (!date || date.getTime() >= cutoff) continue;

            const fullPath = join(domainDir, dateFolder);
            const size = dirSizeBytes(fullPath);
            console.log(
                `${dryRun ? '[dry-run] would delete' : 'Deleting'}: ${fullPath} (${(size / 1024).toFixed(1)} KB)`
            );
            if (!dryRun) {
                rmSync(fullPath, { recursive: true, force: true });
            }
            deletedDirs++;
            deletedBytes += size;
        }
    }
}

// Prune stale entries from crawl_alerts.jsonl (per-line timestamp field) to match the same policy
const alertsFile = join(STORAGE_DIR, 'crawl_alerts.jsonl');
if (existsSync(alertsFile)) {
    const lines = readFileSync(alertsFile, 'utf8').split('\n').filter(Boolean);
    const kept = lines.filter(line => {
        try {
            const entry = JSON.parse(line);
            return new Date(entry.timestamp).getTime() >= cutoff;
        } catch {
            return true; // keep unparseable lines rather than silently drop data
        }
    });
    if (kept.length !== lines.length) {
        console.log(
            `${dryRun ? '[dry-run] would prune' : 'Pruning'} ${lines.length - kept.length} stale alert(s) from ${alertsFile}`
        );
        if (!dryRun) {
            writeFileSync(alertsFile, kept.length > 0 ? kept.join('\n') + '\n' : '');
        }
    }
}

console.log(
    `\n${dryRun ? '[dry-run] ' : ''}Done. ${deletedDirs} date-folder(s) ${dryRun ? 'would be' : ''} removed, ${(deletedBytes / 1024 / 1024).toFixed(2)} MB ${dryRun ? 'would be' : ''} freed.`
);
