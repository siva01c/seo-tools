#!/usr/bin/env tsx

import { existsSync, createReadStream, writeFileSync } from 'fs';
import { join } from 'path';
import readline from 'readline';
import { mergeDomainsToIndividualJsonl } from '../src/services/fileService.js';

const storageDir = './storage/datasets';

// -------------------------------------------------------
// Step 1: Run the existing TypeScript merge tool logic
// -------------------------------------------------------
console.log('▶ Merging per-date JSONL files...');
try {
    const result = mergeDomainsToIndividualJsonl(storageDir);
    console.log('');

    if (!result) {
        process.exit(1);
    }
} catch (error) {
    console.error(
        '❌ Failed to merge per-domain JSONL files:',
        error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
}

const domain = process.argv[2];

if (!domain) {
    console.log('✅ All domains merged. Run with a domain name to dedup:');
    console.log('   npm run merge:dedup -- <domain>');
    process.exit(0);
}

const domainDir = join(storageDir, domain);
const domainFileBasename = domain.replace(/\./g, '_');
const mergedFile = join(domainDir, `${domainFileBasename}.jsonl`);
const dedupedFile = join(domainDir, `${domainFileBasename}_dedup.jsonl`);

// -------------------------------------------------------
// Step 2: Deduplicate by URL (keep newest)
// -------------------------------------------------------
console.log(`▶ Deduplicating ${domain} by URL (keeping newest)...`);

if (!existsSync(mergedFile)) {
    console.error(`❌ Merged file not found: ${mergedFile}`);
    process.exit(1);
}

async function deduplicate() {
    try {
        const fileStream = createReadStream(mergedFile);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });

        const urlMap = new Map<string, string>();
        let totalLines = 0;

        for await (const line of rl) {
            if (!line.trim()) continue;
            totalLines++;

            let url: string | undefined;
            try {
                const obj = JSON.parse(line);
                url = obj.url;
            } catch {
                // Regex fallback in case of invalid or partial JSON
                const match = line.match(/"url"\s*:\s*"([^"]+)"/);
                if (match) {
                    url = match[1];
                }
            }

            if (url) {
                // Since later records are appended later, setting the url key
                // naturally overwrites older records (keeping the newest).
                urlMap.set(url, line);
            } else {
                urlMap.set(`__no_url__${totalLines}`, line);
            }
        }

        const dedupedLines = Array.from(urlMap.values());
        const dedupedCount = dedupedLines.length;
        const removedCount = totalLines - dedupedCount;

        writeFileSync(dedupedFile, dedupedLines.join('\n') + '\n');
        console.log(`   ${totalLines} → ${dedupedCount} (${removedCount} duplicates removed)`);

        // -------------------------------------------------------
        // Step 3: Summary
        // -------------------------------------------------------
        console.log('');
        console.log('═══════════════════════════════════════════');
        console.log(` ${domain}: ${dedupedCount} unique URLs`);
        console.log('═══════════════════════════════════════════');
        console.log('');

        const pathCounts: Record<string, number> = {};
        for (const url of urlMap.keys()) {
            if (url.startsWith('__no_url__')) continue;
            try {
                const parsedUrl = new URL(url);
                const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
                const firstSegment = pathSegments[0] ?? '';
                if (firstSegment) {
                    pathCounts[firstSegment] = (pathCounts[firstSegment] ?? 0) + 1;
                }
            } catch {
                // Ignore invalid URLs
            }
        }

        const sortedCounts = Object.entries(pathCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25);

        sortedCounts.forEach(([segment, count]) => {
            console.log(`${String(count).padStart(7)} ${segment}`);
        });
        console.log('');
    } catch (err) {
        console.error('❌ Deduplication failed:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}

deduplicate().catch(error => {
    console.error(error);
    process.exit(1);
});
