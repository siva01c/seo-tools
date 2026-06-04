#!/usr/bin/env tsx
/**
 * check-empty-href.ts
 *
 * Detects anchor (<a>) tags with empty / missing / placeholder href attributes by
 * scanning each crawled page's RAW serialized HTML (htmlContent.full).
 *
 * Why htmlContent.full and not the structured `links` field: the crawler extracts
 * links via the DOM `.href` PROPERTY (page.$$eval('a[href]', a => a.href)), which
 * RESOLVES an empty href against the base URL — so `<a href="">` shows up as the
 * page's own URL and `<a href="#">` as `url#`. Empty/placeholder hrefs are only
 * recoverable from the raw attribute, which the serialized HTML preserves.
 *
 * Categories reported:
 *   empty       href=""  or whitespace-only           ← real defect (resolves to self/reload)
 *   missing     <a> with NO href attribute            ← real defect (non-navigable anchor)
 *   hash        href="#"                              ← review (often intentional JS hook)
 *   javascript  href="javascript:..."                 ← review (JS pseudo-link)
 *
 * Requires extraction.modules.htmlContent: true (already enabled in config/crawler.yml).
 *
 * Usage:
 *   npx tsx scripts/check-empty-href.ts --domain example.com
 *   [--include hash,javascript]  [--output <file.json>]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

type Page = {
    url: string;
    title?: string;
    htmlContent?: { full?: string };
    _metadata?: { crawlDate?: string };
};

type Category = 'empty' | 'missing' | 'hash' | 'javascript';
type Finding = {
    category: Category;
    rawHref: string | null;
    text: string;
    locator: string; // id/class hint to find it in the page
    snippet: string; // truncated outerHTML
};
type PageReport = { page: string; title?: string; counts: Record<Category, number>; findings: Finding[] };

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
    const i = args.findIndex(a => a === `--${name}`);
    if (i >= 0) return args[i + 1];
    const pref = `--${name}=`;
    const direct = args.find(a => a.startsWith(pref));
    return direct ? direct.slice(pref.length) : undefined;
};

const domainArg = getArg('domain');
const outputArg = getArg('output');
// Which categories to INCLUDE beyond the always-on real defects (empty, missing).
const includeArg = (getArg('include') ?? 'hash,javascript')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const wantHash = includeArg.includes('hash');
const wantJs = includeArg.includes('javascript');

const storageRoot = './storage/datasets';
const reportsRoot = './storage/reports';
if (!existsSync(storageRoot)) {
    console.error(`Storage root not found: ${storageRoot}`);
    process.exit(1);
}

const toDomainFile = (domain: string): string =>
    join(storageRoot, domain, `${domain.replace(/\./g, '_')}.jsonl`);
const ddmmyyyyToSortKey = (d: string): string => {
    const [dd, mm, yyyy] = d.split('-');
    return `${yyyy}-${mm}-${dd}`;
};
const getLatestDatasetDate = (domain: string): string => {
    const folders = readdirSync(join(storageRoot, domain))
        .filter(n => /^\d{2}-\d{2}-\d{4}$/.test(n))
        .sort((a, b) => ddmmyyyyToSortKey(a).localeCompare(ddmmyyyyToSortKey(b)));
    return folders.at(-1) ?? new Date().toISOString().slice(0, 10);
};
const resolveJsonl = (domain: string): string | undefined => {
    const merged = toDomainFile(domain);
    if (existsSync(merged)) return merged;
    const dir = join(storageRoot, domain);
    if (!existsSync(dir)) return undefined;
    const perDate = join(dir, getLatestDatasetDate(domain), 'crawl-data.jsonl');
    return existsSync(perDate) ? perDate : undefined;
};
const domainsToProcess = domainArg
    ? [domainArg]
    : readdirSync(storageRoot).filter(d => resolveJsonl(d));

// Logical page key: strip the :18443 internal port and any fragment so the
// :443 and :18443 crawls of the same page are not double-counted.
const logicalKey = (u: string): string => {
    try {
        const url = new URL(u);
        url.port = '';
        url.hash = '';
        return url.toString();
    } catch {
        return u;
    }
};

const ensureDir = (d: string): void => {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
};
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '…' : s);

const classify = (raw: string | undefined): Category | null => {
    if (raw === undefined) return 'missing';
    const v = raw.trim();
    if (v === '') return 'empty';
    if (v === '#') return wantHash ? 'hash' : null;
    if (/^javascript:/i.test(v)) return wantJs ? 'javascript' : null;
    return null;
};

const decodeEntities = (s: string): string =>
    s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');

// Read a named attribute's raw value from an <a ...> opening tag.
// Returns undefined if the attribute is absent, '' for value-less or empty attr.
const readAttr = (openTag: string, name: string): string | undefined => {
    const m = openTag.match(
        new RegExp(`\\b${name}\\s*(?:=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>\`]+)))?`, 'i')
    );
    if (!m) return undefined;
    if (m[1] === undefined) return ''; // present but value-less, e.g. <a href>
    const v = m[2] ?? m[3] ?? m[4] ?? '';
    return decodeEntities(v);
};

type Anchor = { openTag: string; inner: string; full: string };
// page.content() yields well-formed, double-quoted browser-serialized HTML, so a
// tolerant regex over <a ...>...</a> is reliable for reading raw href attributes.
const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const scanAnchors = (html: string): Anchor[] => {
    const out: Anchor[] = [];
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html)) !== null) {
        out.push({ openTag: `<a${m[1]}>`, inner: m[2], full: m[0] });
    }
    return out;
};
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, '');

for (const domain of domainsToProcess) {
    const file = resolveJsonl(domain);
    if (!file) {
        console.warn(`Skipping ${domain}: no JSONL found`);
        continue;
    }
    console.log(`\n🔍 ${domain}\n   source: ${file}`);

    const allPages: Page[] = readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l));

    // Restrict to the most recent crawlDate (merged JSONL accumulates all dates).
    const dates = [...new Set(allPages.map(p => p._metadata?.crawlDate).filter((d): d is string => !!d))];
    const latestDate = dates.sort((a, b) => ddmmyyyyToSortKey(a).localeCompare(ddmmyyyyToSortKey(b))).at(-1);
    const pages = latestDate ? allPages.filter(p => p._metadata?.crawlDate === latestDate) : allPages;
    if (latestDate)
        console.log(`   crawlDate ${latestDate} (${pages.length}/${allPages.length} records across ${dates.length} date(s))`);

    const seen = new Set<string>();
    const pageReports: PageReport[] = [];
    let withHtml = 0;
    let logicalPages = 0;

    for (const page of pages) {
        const key = logicalKey(page.url);
        if (seen.has(key)) continue; // dedup :18443/:443 duplicates
        seen.add(key);
        logicalPages++;
        const html = page.htmlContent?.full;
        if (!html) continue;
        withHtml++;

        const counts: Record<Category, number> = { empty: 0, missing: 0, hash: 0, javascript: 0 };
        const findings: Finding[] = [];

        for (const a of scanAnchors(html)) {
            const raw = readAttr(a.openTag, 'href');
            const cat = classify(raw);
            if (!cat) continue;
            counts[cat]++;
            const id = readAttr(a.openTag, 'id');
            const cls = readAttr(a.openTag, 'class');
            const locator =
                [id ? `#${id}` : '', cls ? `.${cls.trim().split(/\s+/).join('.')}` : '']
                    .filter(Boolean)
                    .join(' ') || '(no id/class)';
            findings.push({
                category: cat,
                rawHref: raw ?? null,
                text: clip(decodeEntities(stripTags(a.inner)).replace(/\s+/g, ' ').trim(), 80),
                locator: clip(locator, 120),
                snippet: clip(a.full.replace(/\s+/g, ' ').trim(), 200),
            });
        }

        if (findings.length) {
            pageReports.push({ page: key, title: page.title, counts, findings });
        }
    }

    // Aggregate
    const totals: Record<Category, number> = { empty: 0, missing: 0, hash: 0, javascript: 0 };
    for (const pr of pageReports) for (const c of Object.keys(totals) as Category[]) totals[c] += pr.counts[c];

    pageReports.sort(
        (a, b) =>
            b.counts.empty + b.counts.missing - (a.counts.empty + a.counts.missing) ||
            b.findings.length - a.findings.length
    );

    console.log(`   logical pages: ${logicalPages} (with HTML: ${withHtml})`);
    console.log(`   ── totals ──`);
    console.log(`     empty href=""          : ${totals.empty}   ${'← real defect'}`);
    console.log(`     missing href attribute : ${totals.missing}   ${'← real defect'}`);
    if (wantHash) console.log(`     href="#"               : ${totals.hash}   (review)`);
    if (wantJs) console.log(`     href="javascript:"     : ${totals.javascript}   (review)`);
    const defectPages = pageReports.filter(p => p.counts.empty + p.counts.missing > 0).length;
    console.log(`   pages with empty/missing href: ${defectPages}`);

    const reportDir = outputArg ? undefined : join(reportsRoot, domain, getLatestDatasetDate(domain));
    if (reportDir) ensureDir(reportDir);
    const outPath = outputArg ?? join(reportDir!, `empty-href-${getLatestDatasetDate(domain)}.json`);

    writeFileSync(
        outPath,
        JSON.stringify(
            { domain, crawlDate: getLatestDatasetDate(domain), logicalPages, pagesWithHtml: withHtml, totals, pages: pageReports },
            null,
            2
        )
    );

    const csvPath = outPath.replace(/\.json$/, '.csv');
    const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['page', 'category', 'raw_href', 'text', 'locator', 'snippet'].join(',')];
    for (const pr of pageReports)
        for (const f of pr.findings)
            rows.push([pr.page, f.category, f.rawHref ?? '(missing)', f.text, f.locator, f.snippet].map(esc).join(','));
    writeFileSync(csvPath, rows.join('\n') + '\n');

    console.log(`   ✅ JSON: ${outPath}`);
    console.log(`   ✅ CSV : ${csvPath}`);

    // Inline: top pages with real defects (empty/missing)
    const defects = pageReports.filter(p => p.counts.empty + p.counts.missing > 0).slice(0, 15);
    if (defects.length) {
        console.log(`\n   ── pages with empty/missing href (top ${defects.length}) ──`);
        for (const pr of defects) {
            console.log(`     ${pr.counts.empty}× empty, ${pr.counts.missing}× missing  ${pr.page}`);
            for (const f of pr.findings.filter(x => x.category === 'empty' || x.category === 'missing').slice(0, 3)) {
                console.log(`        [${f.category}] "${f.text || '(no text)'}"  ${f.locator}`);
                console.log(`            ${f.snippet}`);
            }
        }
    } else {
        console.log(`\n   ✅ No empty or missing href anchors found.`);
    }
}
