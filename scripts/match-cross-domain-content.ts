#!/usr/bin/env tsx

/**
 * Pair the pages of two crawled domains that hold the same content in different languages, and
 * report which source pages have no counterpart yet.
 *
 * Unlike compare-sitemaps.ts (two crawls of one domain), the two sides here are different sites
 * with translated titles and translated URL slugs, so there is no shared key to join on. Three
 * passes are used, strongest first:
 *
 *   A. `--alias-map` — a CSV of source-alias/target-alias pairs exported from the CMS that owns
 *      both language versions. Authoritative: it comes from the content model, not from guessing.
 *   B. Deterministic keys — matching titles, matching slugs, and product model codes, which
 *      survive translation (MFD, SBT, KUA-160) and are decisive when they agree.
 *   C. The LLM, for whatever is left, choosing from the still-unmatched target pages.
 *
 * Every pass is allowed to answer "no counterpart": on a partially translated site that is the
 * correct answer for a large share of pages, and it is the answer the report exists to surface.
 */

import 'dotenv/config';
import {
    createReadStream,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import * as yaml from 'js-yaml';
import { messages, resolveLang, withSuffix } from './i18n.js';
import {
    dedupePagesByUrl,
    isHtmlPage,
    resolveSnapshotMode,
    selectSnapshot,
    snapshotMeta,
    REPORT_SCHEMA_VERSION,
} from './page-records.js';
import { readCrawlMode } from '../src/services/crawlManifest.js';
import {
    resolveLlmConfig,
    createLlmClient,
    matchTranslatedPage,
    type IPageMatchCandidate,
} from '../src/services/llmClient.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** The slice of a crawl record this report needs. Kept deliberately small: the source dataset is
 * 150 MB+ and holding every `fullText` in memory is what makes the naive readFileSync approach
 * fall over. */
type Page = {
    url: string;
    title?: string;
    description?: string;
    canonical?: string;
    excerpt?: string;
    response?: { status?: number; headers?: Record<string, string> };
    _metadata?: { crawlDate?: string; crawlMode?: 'full' | 'incremental' };
};

type MatchMethod = 'alias' | 'root' | 'title' | 'slug' | 'code' | 'llm' | 'none';
type Confidence = 'high' | 'medium' | 'low';
type Status = 'matched' | 'missing_target' | 'target_only';

interface IMappingRow {
    source_url: string;
    source_title?: string;
    source_section: string;
    target_url?: string;
    target_title?: string;
    match_method: MatchMethod;
    confidence?: Confidence;
    status: Status;
    notes?: string;
}

const CONTENT_EXCERPT_MAX_CHARS = 1200;

/**
 * Site-specific vocabulary the matcher works better with, supplied per run via `--profile`.
 *
 * The useful values here are a particular site's words — the model-code suffixes its product
 * slugs carry, the nouns its pages repeat until they identify nothing. Those belong to whoever
 * owns the site, not to this tool, so they are configuration rather than constants. The defaults
 * below are the domain-neutral minimum, enough to run without a profile.
 */
interface IMatchProfile {
    /** Path prefixes that are never content: crawler-visited infrastructure and file responses. */
    nonContentPrefixes: string[];
    /** Slug tails the source site appends but the target site drops, so a slug matches without them. */
    slugQualifierSuffixes: string[];
    /** Words too generic to identify a page on their own — without them a trailing-token key
     * matches every other page whose slug happens to end in the same common noun. */
    stopTokens: string[];
}

const DEFAULT_PROFILE: IMatchProfile = {
    nonContentPrefixes: ['/sites/', '/user', '/form', '/cart', '/media/', '/system/'],
    slugQualifierSuffixes: [],
    stopTokens: ['page', 'pages', 'product', 'products', 'index', 'home'],
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

const sourceArg = getArg('source');
const targetArg = getArg('target');
const sourcePathPrefix = getArg('source-path-prefix') ?? '';
const targetPathPrefix = getArg('target-path-prefix') ?? '';
const aliasMapArg = getArg('alias-map');
const profileArg = getArg('profile');
const outputDirArg = getArg('output-dir');
const csvFlag = args.some(a => a === '--csv');
const noLlmFlag = args.some(a => a === '--no-llm');
const lang = resolveLang(getArg('language') ?? getArg('lang'));
const snapshotMode = resolveSnapshotMode(args);
const mi = messages[lang].contentMapping;
const ms = messages[lang].snapshot;

if (!sourceArg || !targetArg) {
    console.error(
        'Usage: match-cross-domain-content.ts --source <domain> --target <domain> ' +
            '[--source-path-prefix /en] [--target-path-prefix /cs] [--alias-map <csv>] ' +
            '[--profile <yml>] [--no-llm] [--csv]'
    );
    process.exit(1);
}

/**
 * Load a match profile, falling back to the domain-neutral defaults for anything it omits.
 * A malformed profile is fatal rather than silently ignored: running with the wrong vocabulary
 * produces a plausible-looking report with quietly worse matching.
 */
const loadProfile = (file: string | undefined): IMatchProfile => {
    if (!file) return DEFAULT_PROFILE;
    if (!existsSync(file)) {
        console.error(`Match profile not found: ${file}`);
        process.exit(1);
    }
    const parsed = yaml.load(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        console.error(`Match profile is not a YAML mapping: ${file}`);
        process.exit(1);
    }
    const record = parsed as Record<string, unknown>;
    const list = (key: keyof IMatchProfile): string[] | undefined => {
        const value = record[key];
        if (value === undefined) return undefined;
        if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
            console.error(`Match profile key "${key}" must be a list of strings: ${file}`);
            process.exit(1);
        }
        return value as string[];
    };
    return {
        nonContentPrefixes: list('nonContentPrefixes') ?? DEFAULT_PROFILE.nonContentPrefixes,
        slugQualifierSuffixes:
            list('slugQualifierSuffixes') ?? DEFAULT_PROFILE.slugQualifierSuffixes,
        stopTokens: list('stopTokens') ?? DEFAULT_PROFILE.stopTokens,
    };
};

const profile = loadProfile(profileArg);
const stopTokens = new Set(profile.stopTokens);

// ── Paths ────────────────────────────────────────────────────────────────────

const storageRoot = './storage/datasets';

if (!existsSync(storageRoot)) {
    console.error(`Storage root not found: ${storageRoot}`);
    process.exit(1);
}

const dateStamp = new Date().toISOString().slice(0, 10);

const crawlDateFolders = (domain: string): string[] => {
    const dir = join(storageRoot, domain);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(d => /^\d{2}-\d{2}-\d{4}$/.test(d))
        .sort((a, b) => {
            const iso = (d: string) => `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
            return iso(a).localeCompare(iso(b));
        });
};

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * Stream every crawl of a domain, projecting each record down to {@link Page} as it is read.
 *
 * This reads the per-date JSONL files directly rather than the merged per-domain file the other
 * report scripts use. mergeSingleDomain() concatenates every crawl into one string in memory and
 * writes a second copy to disk; for a 150 MB dataset that is a large allocation and a large
 * duplicate to produce for a read-only report. The `_metadata` the snapshot helpers need is
 * stamped here exactly as the merge would stamp it.
 */
async function loadDomainPages(domain: string): Promise<Page[]> {
    const domainDir = join(storageRoot, domain);
    const filename = `${domain.replace(/\./g, '_')}.jsonl`;
    const pages: Page[] = [];

    const folders = crawlDateFolders(domain);
    if (folders.length === 0) {
        console.error(`No crawl date folders found for ${domain} in ${domainDir}`);
        process.exit(1);
    }

    for (const folder of folders) {
        const file = join(domainDir, folder, filename);
        if (!existsSync(file)) continue;
        const crawlMode = readCrawlMode(join(domainDir, folder));

        const reader = createInterface({
            input: createReadStream(file, 'utf8'),
            crlfDelay: Infinity,
        });

        for await (const line of reader) {
            if (!line.trim()) continue;
            let record: Record<string, unknown>;
            try {
                record = JSON.parse(line) as Record<string, unknown>;
            } catch {
                continue;
            }
            const url = record.url;
            if (typeof url !== 'string') continue;

            const seo = record.seo as
                | { metaTags?: Record<string, string>; specialLinks?: { canonical?: string } }
                | undefined;

            pages.push({
                url,
                title: typeof record.title === 'string' ? record.title : undefined,
                description: seo?.metaTags?.['description'],
                canonical: seo?.specialLinks?.canonical,
                excerpt:
                    typeof record.fullText === 'string'
                        ? record.fullText.slice(0, CONTENT_EXCERPT_MAX_CHARS)
                        : undefined,
                response: record.response as Page['response'],
                _metadata: { crawlDate: folder, crawlMode },
            });
        }
    }

    return pages;
}

/** Decoded path of a URL, without query and without a trailing slash. `''` for the site root. */
const pathOf = (url: string): string => {
    try {
        return decodeURIComponent(new URL(url).pathname).replace(/\/+$/, '');
    } catch {
        return '';
    }
};

/**
 * Collapse a domain's crawl records to one entry per real page, keyed by path.
 *
 * Deduplicating by URL is not enough: a faceted listing is crawled once per filter combination
 * and every one of those records is a distinct URL pointing at the same page. The canonical link
 * is what collapses them — on the source dataset it takes 4564 records down to a few hundred.
 */
function toPageIndex(pages: Page[], pathPrefix: string): Map<string, Page> {
    const byPath = new Map<string, Page>();
    for (const page of pages) {
        if (page.response?.status !== 200) continue;
        const path = pathOf(page.canonical ?? page.url);
        if (!path && pathPrefix) continue;
        if (pathPrefix && path !== pathPrefix && !path.startsWith(`${pathPrefix}/`)) continue;
        const relative = pathPrefix ? path.slice(pathPrefix.length) : path;
        if (profile.nonContentPrefixes.some(p => relative.startsWith(p))) continue;
        if (!byPath.has(path)) byPath.set(path, page);
    }
    return byPath;
}

// ── Matching keys ────────────────────────────────────────────────────────────

const normalize = (value: string | undefined): string =>
    (value ?? '')
        .replace(/[™®]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const lastSegment = (path: string): string => path.split('/').filter(Boolean).pop() ?? '';

/** Title with the site-name tail removed — "MFD | Plymovent" and "MFD - Plymovent.cz" both to "mfd". */
const titleHead = (title: string | undefined): string =>
    normalize((title ?? '').split('|')[0].split(' - ')[0]);

/**
 * Every string that could identify this page on the other site. A key that turns out to be
 * ambiguous is dropped later, so being generous here costs nothing.
 */
function matchKeys(page: Page, path: string, pathPrefix: string): Set<string> {
    const keys = new Set<string>();
    const add = (value: string) => {
        if (value && !stopTokens.has(value)) keys.add(value);
    };

    const relative = pathPrefix ? path.slice(pathPrefix.length) : path;
    const slug = lastSegment(relative);

    add(titleHead(page.title));
    add(normalize(slug));
    add(normalize(relative));

    // Model codes are written in parentheses on one site and used bare on the other:
    // "Sliding Balancer Track (SBT)" against a page simply titled "SBT".
    for (const match of (page.title ?? '').matchAll(/\(([A-Za-z0-9/-]{2,12})\)/g)) {
        add(normalize(match[1]));
    }

    // ...or appended to the slug: /products/sliding-balancer-track-sbt against /produkty/sbt.
    const tokens = slug.split('-');
    if (tokens.length > 1) add(normalize(tokens[tokens.length - 1]));
    if (tokens.length > 2) add(normalize(tokens.slice(-2).join('-')));

    for (const suffix of profile.slugQualifierSuffixes) {
        if (slug.endsWith(suffix)) add(normalize(slug.slice(0, -suffix.length)));
    }

    return keys;
}

/** Which key produced a match, for the report's `match_method` column. */
function methodForKey(page: Page, path: string, pathPrefix: string, key: string): MatchMethod {
    if (key === titleHead(page.title)) return 'title';
    const relative = pathPrefix ? path.slice(pathPrefix.length) : path;
    if (key === normalize(lastSegment(relative)) || key === normalize(relative)) return 'slug';
    return 'code';
}

/** Top-level section of a path, used to group the report ("products", "insights", …). */
function sectionOf(path: string, pathPrefix: string): string {
    const relative = pathPrefix ? path.slice(pathPrefix.length) : path;
    const segments = relative.split('/').filter(Boolean);
    if (segments.length === 0) return 'home';
    if (segments.length > 1 && (segments[0] === 'insights' || segments[0] === 'aktuality')) {
        return `${segments[0]}/${segments[1]}`;
    }
    return segments[0];
}

// ── Alias map ────────────────────────────────────────────────────────────────

/**
 * Read the CMS-exported alias map: `system_path,source_alias,target_alias[,…]`.
 *
 * Both language versions of a page share a system path in the CMS, so a row pairs two aliases
 * that are the same content by construction. Parsed with a small reader rather than a CSV
 * dependency — the file is machine-written and only the first three columns are read.
 */
function loadAliasMap(file: string): { sourceAlias: string; targetAlias: string }[] {
    const rows: { sourceAlias: string; targetAlias: string }[] = [];
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        const fields = line.match(/("([^"]|"")*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) ?? [];
        const clean = fields.map(f => f.replace(/^"|"$/g, '').replace(/""/g, '"'));
        if (index === 0 && clean[0] === 'system_path') continue;
        const [, sourceAlias, targetAlias] = clean;
        if (sourceAlias && targetAlias) rows.push({ sourceAlias, targetAlias });
    }
    return rows;
}

// ── Run ──────────────────────────────────────────────────────────────────────

const run = async (): Promise<void> => {
    const reportDate = crawlDateFolders(sourceArg).pop() ?? dateStamp;
    const reportsRoot = outputDirArg ?? join('./storage/reports', sourceArg, reportDate);
    mkdirSync(reportsRoot, { recursive: true });

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

    console.log(`🔍 ${sourceArg} → ${targetArg}\n`);

    const sourceRaw = await loadDomainPages(sourceArg);
    const { selected: sourceSelected, snapshot: sourceSnapshot } = selectSnapshot(
        sourceArg,
        dedupePagesByUrl(sourceRaw).filter(isHtmlPage),
        snapshotMode,
        ms
    );
    const targetRaw = await loadDomainPages(targetArg);
    const { selected: targetSelected, snapshot: targetSnapshot } = selectSnapshot(
        targetArg,
        dedupePagesByUrl(targetRaw).filter(isHtmlPage),
        snapshotMode,
        ms
    );

    const source = toPageIndex(sourceSelected, sourcePathPrefix);
    const target = toPageIndex(targetSelected, targetPathPrefix);
    console.log(`\n📄 ${source.size} source pages / ${target.size} target pages\n`);

    if (source.size === 0 || target.size === 0) {
        console.error('Nothing to match. Exiting.');
        process.exit(1);
    }

    const sourceOrigin = new URL([...source.values()][0].url).origin;
    const targetOrigin = new URL([...target.values()][0].url).origin;

    /** Source path → target path, with how it was decided. */
    const matches = new Map<
        string,
        { targetPath: string; method: MatchMethod; confidence: Confidence; notes?: string }
    >();
    const claimedTargets = new Set<string>();

    // ── Pass A: alias map ───────────────────────────────────────────────────
    let aliasPairs = 0;
    if (aliasMapArg) {
        if (!existsSync(aliasMapArg)) {
            console.error(`Alias map not found: ${aliasMapArg}`);
            process.exit(1);
        }
        for (const { sourceAlias, targetAlias } of loadAliasMap(aliasMapArg)) {
            const sourcePath = `${sourcePathPrefix}${sourceAlias}`.replace(/\/+$/, '');
            const targetPath = `${targetPathPrefix}${targetAlias}`.replace(/\/+$/, '');
            // The map comes from a CMS snapshot that can be older than the crawls, so a pair only
            // counts once both sides are confirmed to still exist.
            if (!source.has(sourcePath) || !target.has(targetPath)) continue;
            if (matches.has(sourcePath)) continue;
            matches.set(sourcePath, {
                targetPath,
                method: 'alias',
                confidence: 'high',
                notes: `alias map: ${sourceAlias} → ${targetAlias}`,
            });
            claimedTargets.add(targetPath);
            aliasPairs++;
        }
        console.log(`🔗 alias map: ${aliasPairs} pairs`);
    }

    // The two front pages are each other's counterpart by definition, and nothing else can say
    // so: a front page has no slug to match on, and its two titles are both marketing lines
    // rather than translations of each other.
    if (
        source.has(sourcePathPrefix) &&
        target.has(targetPathPrefix) &&
        !matches.has(sourcePathPrefix)
    ) {
        matches.set(sourcePathPrefix, {
            targetPath: targetPathPrefix,
            method: 'root',
            confidence: 'high',
            notes: 'site root',
        });
        claimedTargets.add(targetPathPrefix);
    }

    // ── Pass B: deterministic keys ──────────────────────────────────────────
    // Built over the target pages still unclaimed, so pass A's answers are never second-guessed.
    const targetByKey = new Map<string, string[]>();
    for (const [path, page] of target) {
        if (claimedTargets.has(path)) continue;
        for (const key of matchKeys(page, path, targetPathPrefix)) {
            const existing = targetByKey.get(key);
            if (existing) existing.push(path);
            else targetByKey.set(key, [path]);
        }
    }

    let deterministicPairs = 0;
    for (const [path, page] of source) {
        if (matches.has(path)) continue;
        for (const key of matchKeys(page, path, sourcePathPrefix)) {
            const hits = targetByKey.get(key);
            // An ambiguous key proves nothing; leave the page to the LLM pass, which sees the
            // page content rather than just its slug.
            if (!hits || hits.length !== 1) continue;
            matches.set(path, {
                targetPath: hits[0],
                method: methodForKey(page, path, sourcePathPrefix, key),
                confidence: 'high',
                notes: `key: ${key}`,
            });
            claimedTargets.add(hits[0]);
            deterministicPairs++;
            break;
        }
    }
    console.log(`🔑 deterministic keys: ${deterministicPairs} pairs`);

    // ── Pass C: LLM ─────────────────────────────────────────────────────────
    const unmatchedSource = [...source.keys()].filter(p => !matches.has(p));
    let llmPairs = 0;

    if (!noLlmFlag && unmatchedSource.length > 0) {
        const llmConfig = resolveLlmConfig();
        if (llmConfig.provider === 'openai' && !llmConfig.apiKey) {
            console.error('LLM_API_KEY is required when LLM_PROVIDER=openai (or unset).');
            process.exit(1);
        }
        console.log(`\n🤖 provider=${llmConfig.provider} model=${llmConfig.model}`);
        const llmClient = createLlmClient(llmConfig);

        for (const [i, path] of unmatchedSource.entries()) {
            const page = source.get(path);
            if (!page) continue;
            console.log(`  [${i + 1}/${unmatchedSource.length}] ${path}`);

            // Rebuilt each iteration: once a target page is taken it stops being offered, which
            // both shrinks the prompt and stops two source pages claiming the same translation.
            const candidates: IPageMatchCandidate[] = [];
            for (const [targetPath, targetPage] of target) {
                if (claimedTargets.has(targetPath)) continue;
                candidates.push({
                    path: targetPath,
                    title: targetPage.title,
                    description: targetPage.description,
                });
            }
            if (candidates.length === 0) break;

            const result = await matchTranslatedPage(llmClient, llmConfig, {
                sourcePath: path,
                sourceTitle: page.title,
                sourceDescription: page.description,
                contentExcerpt: page.excerpt ?? '',
                candidates,
            });

            if (!result) {
                console.warn('    ⚠️  Skipped (LLM call failed or returned unusable output)');
                continue;
            }
            if (!result.path) continue;
            if (!target.has(result.path) || claimedTargets.has(result.path)) {
                console.warn(`    ⚠️  Ignored invented/taken path: ${result.path}`);
                continue;
            }

            matches.set(path, {
                targetPath: result.path,
                method: 'llm',
                confidence: result.confidence,
                notes: result.reason,
            });
            claimedTargets.add(result.path);
            llmPairs++;
        }
        console.log(`\n🤖 LLM: ${llmPairs} pairs`);
    }

    // ── Rows ────────────────────────────────────────────────────────────────
    const rows: IMappingRow[] = [];
    const matchedTargetPaths = new Set([...matches.values()].map(m => m.targetPath));

    /**
     * Nearest ancestor of a target path that was itself matched.
     *
     * Most target-only pages here are product variations: the target site gives each variation
     * its own URL where the source site keeps them on the product page, so they have no source
     * counterpart by construction rather than by oversight. Naming the matched ancestor lets a
     * reader tell those apart from a page that is genuinely absent from the source site, without
     * this report having to guess which kind of parent it is looking at.
     */
    const parentOf = (path: string): string | undefined => {
        const parent = path.slice(0, path.lastIndexOf('/'));
        return parent && matchedTargetPaths.has(parent) ? parent : undefined;
    };

    for (const path of [...source.keys()].sort()) {
        const page = source.get(path);
        if (!page) continue;
        const match = matches.get(path);
        const targetPage = match ? target.get(match.targetPath) : undefined;
        rows.push({
            source_url: `${sourceOrigin}${path}`,
            source_title: page.title,
            source_section: sectionOf(path, sourcePathPrefix),
            target_url: match ? `${targetOrigin}${match.targetPath}` : undefined,
            target_title: targetPage?.title,
            match_method: match?.method ?? 'none',
            confidence: match?.confidence,
            status: match ? 'matched' : 'missing_target',
            notes: match?.notes,
        });
    }

    for (const path of [...target.keys()].sort()) {
        if (claimedTargets.has(path)) continue;
        const page = target.get(path);
        if (!page) continue;
        const parent = parentOf(path);
        rows.push({
            source_url: '',
            source_section: sectionOf(path, targetPathPrefix),
            target_url: `${targetOrigin}${path}`,
            target_title: page.title,
            match_method: 'none',
            status: 'target_only',
            notes: parent ? `nested under matched ${targetOrigin}${parent}` : undefined,
        });
    }

    const matched = rows.filter(r => r.status === 'matched').length;
    const missing = rows.filter(r => r.status === 'missing_target').length;
    const targetOnly = rows.filter(r => r.status === 'target_only').length;

    writeJson(`content-mapping-${dateStamp}.json`, {
        schema_version: REPORT_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        source_domain: sourceArg,
        target_domain: targetArg,
        source_crawl_scope: snapshotMeta(sourceSnapshot, snapshotMode, source.size),
        target_crawl_scope: snapshotMeta(targetSnapshot, snapshotMode, target.size),
        summary: {
            source_pages: source.size,
            target_pages: target.size,
            matched,
            missing_target: missing,
            target_only: targetOnly,
            by_method: {
                alias: aliasPairs,
                deterministic: deterministicPairs,
                llm: llmPairs,
            },
        },
        mapping: rows,
    });

    if (csvFlag) {
        const csvRows: string[][] = [mi.csvHeader];
        for (const row of rows) {
            csvRows.push([
                row.source_url,
                row.source_title ?? '',
                row.source_section,
                row.target_url ?? '',
                row.target_title ?? '',
                row.match_method,
                row.confidence ?? '',
                row.status,
                row.notes ?? '',
            ]);
        }
        writeCsv(`content-mapping-${dateStamp}.csv`, csvRows);
    }

    console.log(`\n${mi.sumHeader}`);
    console.log(`  ${mi.sumSourcePages}: ${source.size}`);
    console.log(`  ${mi.sumTargetPages}: ${target.size}`);
    console.log(`  ${mi.sumMatched}: ${matched}`);
    console.log(`  ${mi.sumMissing}: ${missing}`);
    console.log(`  ${mi.sumTargetOnly}: ${targetOnly}`);
    console.log(`\n  ${mi.sumWritten}: ${reportsRoot}`);
};

run().catch(error => {
    console.error(error);
    process.exit(1);
});
