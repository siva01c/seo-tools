#!/usr/bin/env tsx

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { messages, resolveLang, withSuffix } from './i18n.js';
import { dedupePagesByUrl, isHtmlPage } from './page-records.js';
import {
    TITLE_MAX_PIXEL_WIDTH,
    META_DESCRIPTION_MAX_PIXEL_WIDTH,
    estimatePixelWidth,
} from '../src/services/issueChecksService.js';
import {
    resolveLlmConfig,
    createLlmClient,
    generateTitleDescriptionFix,
} from '../src/services/llmClient.js';

// ── Types ────────────────────────────────────────────────────────────────────

type Heading = { level: number; text: string };
type Page = {
    url: string;
    title?: string;
    fullText?: string;
    response?: { status?: number; headers?: Record<string, string> };
    seo?: { metaTags?: Record<string, string> };
    aiMetadata?: { customMetadata?: { headingStructure?: Heading[]; language?: string } };
    _metadata?: { crawlDate?: string };
};

// Thresholds mirrored from report-seo-issues.ts's Report 1/Report 2 (kept in sync manually,
// same as that script's own inline constants — not exported from issueChecksService.ts since
// they're specific to the char-count check, unlike the pixel-width constants which are shared).
const TITLE_MIN_CHARS = 30;
const TITLE_MAX_CHARS = 60;
const META_DESC_MIN_CHARS = 70;
const META_DESC_MAX_CHARS = 160;
const CONTENT_EXCERPT_MAX_CHARS = 1500;

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
const mi = messages[lang].titleDescriptionFixes;

if (!domainArg) {
    console.error('Usage: generate-title-description-fixes.ts --domain <domain> [--csv]');
    process.exit(1);
}

// ── Paths ────────────────────────────────────────────────────────────────────

const storageRoot = './storage/datasets';

if (!existsSync(storageRoot)) {
    console.error(`Storage root not found: ${storageRoot}`);
    process.exit(1);
}

const toDomainFile = (domain: string): string =>
    join(storageRoot, domain, `${domain.replace(/\./g, '_')}.jsonl`);

const filePath = toDomainFile(domainArg);
if (!existsSync(filePath)) {
    console.error(`No merged JSONL found for ${domainArg} at ${filePath}`);
    process.exit(1);
}

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

const detectLanguage = (page: Page): 'cs' | 'en' => {
    const declared = page.aiMetadata?.customMetadata?.language;
    if (declared?.toLowerCase().startsWith('cs')) return 'cs';
    if (declared?.toLowerCase().startsWith('en')) return 'en';
    // Fall back to path-based heuristic used elsewhere in this crawl (e.g. /cs/ prefix = Czech).
    try {
        return new URL(page.url).pathname.startsWith('/cs/') || page.url.endsWith('/cs/')
            ? 'cs'
            : 'en';
    } catch {
        return 'en';
    }
};

// ── Load pages ───────────────────────────────────────────────────────────────

console.log(`🔍 Processing ${filePath}`);
const rawPages = readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Page);
const allPages = dedupePagesByUrl(rawPages).filter(isHtmlPage);

if (allPages.length === 0) {
    console.error('No pages loaded. Exiting.');
    process.exit(1);
}

console.log(`📄 Loaded ${allPages.length} pages total\n`);

// ── Determine which pages need a title and/or description fix ───────────────
// Re-derives the same flags report-seo-issues.ts's Report 1/Report 2 already compute, so this
// script is self-contained and doesn't require a prior report-seo-issues.ts run.

interface IFlaggedPage {
    page: Page;
    needsTitleFix: boolean;
    needsDescriptionFix: boolean;
    titleIssues: string[];
    descriptionIssues: string[];
}

const flagged: IFlaggedPage[] = [];

for (const page of allPages) {
    const titleIssues: string[] = [];
    const descriptionIssues: string[] = [];

    const title = page.title;
    if (!title || title.trim() === '') {
        titleIssues.push('missing');
    } else {
        const len = title.length;
        if (len < TITLE_MIN_CHARS) titleIssues.push('too_short');
        else if (len > TITLE_MAX_CHARS) titleIssues.push('too_long');
        if (estimatePixelWidth(title) > TITLE_MAX_PIXEL_WIDTH) titleIssues.push('pixel_too_long');
    }

    const desc = page.seo?.metaTags?.['description'];
    if (!desc || desc.trim() === '') {
        descriptionIssues.push('missing');
    } else {
        const len = desc.length;
        if (len < META_DESC_MIN_CHARS) descriptionIssues.push('too_short');
        else if (len > META_DESC_MAX_CHARS) descriptionIssues.push('too_long');
        if (estimatePixelWidth(desc) > META_DESCRIPTION_MAX_PIXEL_WIDTH) {
            descriptionIssues.push('pixel_too_long');
        }
    }

    if (titleIssues.length > 0 || descriptionIssues.length > 0) {
        flagged.push({
            page,
            needsTitleFix: titleIssues.length > 0,
            needsDescriptionFix: descriptionIssues.length > 0,
            titleIssues,
            descriptionIssues,
        });
    }
}

console.log(`📝 ${flagged.length} pages need a title and/or description fix\n`);

if (flagged.length === 0) {
    writeJson(`title-description-fixes-${dateStamp}.json`, { total: 0, fixes: [] });
    process.exit(0);
}

// ── Generate fixes via LLM ───────────────────────────────────────────────────

interface IFixEntry {
    url: string;
    issues: string[];
    currentTitle?: string;
    recommendedTitle?: string;
    recommendedTitleLength?: number;
    recommendedTitlePixelWidth?: number;
    currentDescription?: string;
    recommendedDescription?: string;
    recommendedDescriptionLength?: number;
    recommendedDescriptionPixelWidth?: number;
}

const llmConfig = resolveLlmConfig();
if (llmConfig.provider === 'openai' && !llmConfig.apiKey) {
    console.error('LLM_API_KEY is required when LLM_PROVIDER=openai (or unset).');
    process.exit(1);
}
console.log(`🤖 Using LLM provider=${llmConfig.provider} model=${llmConfig.model}\n`);
const llmClient = createLlmClient(llmConfig);

const run = async (): Promise<void> => {
    const fixes: IFixEntry[] = [];

    for (const [i, entry] of flagged.entries()) {
        const { page, needsTitleFix, needsDescriptionFix, titleIssues, descriptionIssues } = entry;
        console.log(`  [${i + 1}/${flagged.length}] ${page.url}`);

        const headings = (page.aiMetadata?.customMetadata?.headingStructure ?? [])
            .filter(h => h.level <= 2)
            .map(h => h.text);
        const contentExcerpt = (page.fullText ?? '').slice(0, CONTENT_EXCERPT_MAX_CHARS);

        const result = await generateTitleDescriptionFix(llmClient, llmConfig, {
            url: page.url,
            currentTitle: page.title,
            currentDescription: page.seo?.metaTags?.['description'],
            headings,
            contentExcerpt,
            needsTitleFix,
            needsDescriptionFix,
            language: detectLanguage(page),
        });

        if (!result) {
            console.warn(`    ⚠️  Skipped (LLM call failed or returned unusable output)`);
            continue;
        }

        const fix: IFixEntry = {
            url: page.url,
            issues: [
                ...titleIssues.map(i => `title_${i}`),
                ...descriptionIssues.map(i => `description_${i}`),
            ],
            currentTitle: page.title,
            currentDescription: page.seo?.metaTags?.['description'],
        };

        if (needsTitleFix && result.title) {
            fix.recommendedTitle = result.title;
            fix.recommendedTitleLength = result.title.length;
            fix.recommendedTitlePixelWidth = Math.round(estimatePixelWidth(result.title));
        }
        if (needsDescriptionFix && result.description) {
            fix.recommendedDescription = result.description;
            fix.recommendedDescriptionLength = result.description.length;
            fix.recommendedDescriptionPixelWidth = Math.round(
                estimatePixelWidth(result.description)
            );
        }

        fixes.push(fix);
    }

    writeJson(`title-description-fixes-${dateStamp}.json`, { total: fixes.length, fixes });

    if (csvFlag) {
        const rows: string[][] = [mi.csvHeader];
        for (const f of fixes) {
            rows.push([
                f.url,
                f.issues.join(' | '),
                f.currentTitle ?? '',
                f.recommendedTitle ?? '',
                String(f.recommendedTitleLength ?? ''),
                String(f.recommendedTitlePixelWidth ?? ''),
                f.currentDescription ?? '',
                f.recommendedDescription ?? '',
                String(f.recommendedDescriptionLength ?? ''),
                String(f.recommendedDescriptionPixelWidth ?? ''),
            ]);
        }
        writeCsv(`title-description-fixes-${dateStamp}.csv`, rows);
    }

    console.log(`\n${mi.sumHeader}`);
    console.log(`  ${mi.sumGenerated}: ${fixes.length} / ${flagged.length}`);
    console.log(`\n  ${mi.sumWritten}: ${reportsRoot}`);
};

run().catch(error => {
    console.error(error);
    process.exit(1);
});
