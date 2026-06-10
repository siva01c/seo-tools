#!/usr/bin/env tsx

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

interface IAlternateLink {
    href: string;
    hreflang: string | null;
    media: string | null;
    type: string | null;
}

interface ISpecialLinks {
    canonical?: string;
    alternate?: IAlternateLink[];
    preconnect?: string[];
    [key: string]: unknown;
}

interface IMetaTags {
    description?: string;
    robots?: string;
    author?: string;
    'og:title'?: string;
    'og:description'?: string;
    'og:image'?: string;
    'og:type'?: string;
    'og:url'?: string;
    'twitter:card'?: string;
    'twitter:title'?: string;
    'twitter:description'?: string;
    [key: string]: unknown;
}

interface IJsonLdObject {
    '@context'?: string;
    '@type'?: string | string[];
    '@graph'?: IJsonLdObject[];
    name?: string;
    description?: string;
    publisher?: unknown;
    datePublished?: string;
    dateModified?: string;
    headline?: string;
    [key: string]: unknown;
}

interface ICustomMetadata {
    wordCount?: number;
    readingTime?: string;
    headingStructure?: Record<string, string[]>;
    author?: string;
}

interface ILinkItem {
    href?: string;
    url?: string;
    text?: string;
}

interface IPageRecord {
    url: string;
    title?: string;
    fullText?: string;
    timestamp?: string;
    response?: { status?: number; url?: string; headers?: Record<string, string> };
    seo?: {
        metaTags?: IMetaTags;
        specialLinks?: ISpecialLinks;
        hasDataNoSnippet?: boolean;
    };
    aiMetadata?: {
        structuredData?: {
            jsonLd?: IJsonLdObject[];
            microdata?: unknown[];
        };
        customMetadata?: ICustomMetadata;
    };
    links?: {
        internal?: ILinkItem[];
        external?: ILinkItem[];
        total?: number;
    };
}

// ── Data loading ─────────────────────────────────────────────────────────────

function listDates(domain: string): string[] {
    const domainDir = join('storage', 'datasets', domain);
    if (!existsSync(domainDir)) return [];
    return readdirSync(domainDir)
        .filter(d => /^\d{2}-\d{2}-\d{4}$/.test(d))
        .sort((a, b) => {
            const toIso = (d: string) => `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
            return toIso(a).localeCompare(toIso(b)); // ascending = oldest first
        });
}

function loadPagesFromDir(dir: string): IPageRecord[] {
    const jsonlFile = readdirSync(dir).find(f => f.endsWith('.jsonl'));
    if (jsonlFile) {
        return readFileSync(join(dir, jsonlFile), 'utf-8')
            .split('\n')
            .filter(l => l.trim())
            .map(l => JSON.parse(l) as IPageRecord);
    }
    return readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as IPageRecord);
}

/**
 * Load pages from all crawl dates, deduplicating by URL.
 * Later dates win (most recent data for each URL is used).
 */
function loadAllPages(domain: string, dates: string[]): IPageRecord[] {
    const byUrl = new Map<string, IPageRecord>();

    for (const date of dates) {
        const dir = join('storage', 'datasets', domain, date);
        if (!existsSync(dir)) continue;
        const pages = loadPagesFromDir(dir);
        for (const page of pages) {
            byUrl.set(page.url, page); // later date overwrites — latest wins
        }
    }

    return [...byUrl.values()];
}

// ── Page type classification ─────────────────────────────────────────────────

type PageType = 'Homepage' | 'Article' | 'Service' | 'Branch/Contact' | 'FAQ' | 'About' | 'Generic';

function extractJsonLdTypes(page: IPageRecord): string[] {
    const types: string[] = [];
    const jsonLd = page.aiMetadata?.structuredData?.jsonLd ?? [];
    for (const block of jsonLd) {
        const addType = (t: string | string[]) => {
            if (Array.isArray(t)) types.push(...t);
            else types.push(t);
        };
        if (block['@type']) addType(block['@type']);
        for (const node of block['@graph'] ?? []) {
            if (node['@type']) addType(node['@type']);
        }
    }
    return [...new Set(types)];
}

function isPdf(page: IPageRecord): boolean {
    const url = page.url.toLowerCase();
    const contentType = String(page.response?.headers?.['content-type'] ?? '').toLowerCase();
    return url.endsWith('.pdf') || contentType.includes('application/pdf');
}

function classifyPageType(page: IPageRecord): PageType {
    const path = new URL(page.url).pathname;
    const jsonLdTypes = extractJsonLdTypes(page);

    if (jsonLdTypes.some(t => ['Article', 'BlogPosting', 'NewsArticle'].includes(t)))
        return 'Article';
    if (jsonLdTypes.some(t => ['LocalBusiness', 'PostalAddress'].includes(t)))
        return 'Branch/Contact';
    if (jsonLdTypes.some(t => t === 'FAQPage')) return 'FAQ';

    if (path === '/' || path === '') return 'Homepage';
    if (/\/(kontakt|contact|pobocky|branch|location|poradna)/i.test(path)) return 'Branch/Contact';
    if (/\/(pojisteni|pojistovna|produkty|product|service|sluzby|nabidka)/i.test(path))
        return 'Service';
    if (/\/(faq|otazky|casto-kladene)/i.test(path)) return 'FAQ';
    if (/\/(o-nas|about|kdo-jsme|spolecnost|firma)/i.test(path)) return 'About';
    if (/\/\d{4}\/\d{2}\//.test(path)) return 'Article';

    return 'Generic';
}

// ── Per-page analysis ────────────────────────────────────────────────────────

interface IPageIssue {
    severity: 'critical' | 'warning' | 'info';
    message: string;
}

interface IPageAnalysis {
    url: string;
    title: string;
    pageType: PageType;
    isIndexable: boolean;
    hasCanonical: boolean;
    canonicalUrl: string | null;
    hasDescription: boolean;
    descriptionLength: number;
    titleLength: number;
    hasOgTitle: boolean;
    hasOgDescription: boolean;
    hasOgImage: boolean;
    hasTwitterCard: boolean;
    hasHreflang: boolean;
    hreflangCount: number;
    jsonLdTypes: string[];
    wordCount: number;
    internalLinkCount: number;
    issues: IPageIssue[];
}

function analyzePage(page: IPageRecord): IPageAnalysis {
    const meta = page.seo?.metaTags ?? {};
    const specialLinks = page.seo?.specialLinks ?? {};
    const issues: IPageIssue[] = [];

    const title = page.title ?? '';
    const titleLength = title.length;
    const description = String(meta['description'] ?? '');
    const descriptionLength = description.length;
    const robots = String(meta['robots'] ?? 'index, follow');
    const isIndexable = !robots.includes('noindex') && (page.response?.status ?? 200) === 200;
    const canonical = (specialLinks.canonical as string | undefined) ?? null;
    const alternate = (specialLinks.alternate as IAlternateLink[] | undefined) ?? [];
    const hasHreflang = alternate.some(a => a.hreflang && a.hreflang !== 'x-default');
    const jsonLdTypes = extractJsonLdTypes(page);
    const wordCount =
        page.aiMetadata?.customMetadata?.wordCount ??
        (page.fullText ? page.fullText.split(/\s+/).filter(Boolean).length : 0);
    const internalLinkCount = page.links?.internal?.length ?? 0;

    if (!isIndexable)
        issues.push({
            severity: 'critical',
            message: 'Page is not indexable (noindex or non-200)',
        });
    if (!title) issues.push({ severity: 'critical', message: 'Missing <title> tag' });
    else if (titleLength > 63)
        issues.push({
            severity: 'warning',
            message: `Title too long (${titleLength} chars, max 63)`,
        });
    if (!description) issues.push({ severity: 'critical', message: 'Missing meta description' });
    else if (descriptionLength > 163)
        issues.push({
            severity: 'warning',
            message: `Description too long (${descriptionLength} chars, max 163)`,
        });
    if (!canonical) issues.push({ severity: 'warning', message: 'No canonical URL defined' });
    if (!meta['og:title']) issues.push({ severity: 'warning', message: 'Missing og:title' });
    if (!meta['og:description'])
        issues.push({ severity: 'warning', message: 'Missing og:description' });
    if (!meta['og:image']) issues.push({ severity: 'info', message: 'Missing og:image' });
    if (!meta['twitter:card']) issues.push({ severity: 'info', message: 'Missing twitter:card' });
    if (jsonLdTypes.length === 0)
        issues.push({ severity: 'warning', message: 'No JSON-LD structured data' });
    if (wordCount < 300 && wordCount > 0)
        issues.push({ severity: 'warning', message: `Thin content (${wordCount} words, min 300)` });
    if (internalLinkCount === 0)
        issues.push({ severity: 'warning', message: 'No internal links (orphan page risk)' });

    return {
        url: page.url,
        title,
        pageType: classifyPageType(page),
        isIndexable,
        hasCanonical: !!canonical,
        canonicalUrl: canonical,
        hasDescription: !!description,
        descriptionLength,
        titleLength,
        hasOgTitle: !!meta['og:title'],
        hasOgDescription: !!meta['og:description'],
        hasOgImage: !!meta['og:image'],
        hasTwitterCard: !!meta['twitter:card'],
        hasHreflang,
        hreflangCount: alternate.filter(a => a.hreflang).length,
        jsonLdTypes,
        wordCount,
        internalLinkCount,
        issues,
    };
}

// ── Markdown rendering ───────────────────────────────────────────────────────

function pct(n: number, total: number): string {
    return total === 0 ? '0%' : `${Math.round((n / total) * 100)}%`;
}

function severityIcon(s: IPageIssue['severity']): string {
    return s === 'critical' ? '🔴' : s === 'warning' ? '🟡' : 'ℹ️';
}

interface IBrokenLink {
    targetUrl: string;
    status: number;
    foundOn: string[];
}

function buildBrokenLinks(pages: IPageRecord[]): IBrokenLink[] {
    // Map each URL to the pages that link to it
    const backlinks = new Map<string, string[]>();
    for (const page of pages) {
        for (const link of page.links?.internal ?? []) {
            const href = link.href ?? '';
            if (!href) continue;
            const list = backlinks.get(href) ?? [];
            list.push(page.url);
            backlinks.set(href, list);
        }
    }

    // Find pages that returned a non-200 status
    const broken: IBrokenLink[] = [];
    for (const page of pages) {
        const status = page.response?.status ?? 200;
        if (status !== 200) {
            broken.push({
                targetUrl: page.url,
                status,
                foundOn: backlinks.get(page.url) ?? [],
            });
        }
    }

    return broken.sort((a, b) => a.status - b.status);
}

function renderMarkdown(
    domain: string,
    dates: string[],
    pages: IPageRecord[],
    analyses: IPageAnalysis[],
    pdfPages: IPageRecord[]
): string {
    const total = analyses.length;
    const criticalCount = analyses.filter(a =>
        a.issues.some(i => i.severity === 'critical')
    ).length;
    const missingDesc = analyses.filter(a => !a.hasDescription).length;
    const missingSchema = analyses.filter(a => a.jsonLdTypes.length === 0).length;
    const noCanonical = analyses.filter(a => !a.hasCanonical).length;
    const orphans = analyses.filter(a => a.internalLinkCount === 0).length;
    const notIndexable = analyses.filter(a => !a.isIndexable).length;
    const thinContent = analyses.filter(a => a.wordCount > 0 && a.wordCount < 300).length;

    const brokenLinks = buildBrokenLinks(pages);
    const pageTypeCounts: Record<string, number> = {};
    for (const a of analyses) pageTypeCounts[a.pageType] = (pageTypeCounts[a.pageType] ?? 0) + 1;

    const allJsonLdTypes = [...new Set(analyses.flatMap(a => a.jsonLdTypes))].sort();

    // Generate TODO tasks from findings
    const todos: string[] = [];
    let taskId = 1;
    const task = (
        title: string,
        priority: string,
        impact: string,
        effort: string,
        body: string
    ) => {
        todos.push(
            `### [SEO-${String(taskId++).padStart(3, '0')}] ${title}\n\n**Priority:** ${priority} | **Impact:** ${impact} | **Effort:** ${effort}\n\n${body}`
        );
    };

    if (missingSchema > 0) {
        task(
            `Add JSON-LD structured data to ${missingSchema} pages without schema`,
            'High',
            'High',
            'Medium',
            `**Affected pages:**\n${analyses
                .filter(a => a.jsonLdTypes.length === 0)
                .map(a => `- ${a.url}`)
                .join('\n')}`
        );
    }
    if (!allJsonLdTypes.includes('Organization')) {
        task(
            'Add global Organization schema to all pages',
            'High',
            'High',
            'Low',
            'Add `Organization` JSON-LD to the global site `<head>`. Include: `name`, `url`, `logo`, `contactPoint`, `sameAs`.'
        );
    }
    if (!allJsonLdTypes.includes('WebSite')) {
        task(
            'Add WebSite schema with SearchAction',
            'Medium',
            'Medium',
            'Low',
            'Add `WebSite` JSON-LD globally. Include `SearchAction` if site search is available.'
        );
    }
    if (!allJsonLdTypes.includes('BreadcrumbList')) {
        task(
            'Add BreadcrumbList schema sitewide',
            'Medium',
            'Medium',
            'Low',
            'Generate breadcrumb schema from navigation hierarchy on all non-homepage pages.'
        );
    }
    if (missingDesc > 0) {
        task(
            `Write meta descriptions for ${missingDesc} pages`,
            'High',
            'High',
            'Low',
            `Keep descriptions 120–163 characters.\n\n**Affected pages:**\n${analyses
                .filter(a => !a.hasDescription)
                .map(a => `- ${a.url}`)
                .join('\n')}`
        );
    }
    if (noCanonical > 0) {
        task(
            `Add canonical URL tags to ${noCanonical} pages`,
            'Medium',
            'Medium',
            'Low',
            `**Affected pages:**\n${analyses
                .filter(a => !a.hasCanonical)
                .map(a => `- ${a.url}`)
                .join('\n')}`
        );
    }
    if (orphans > 0) {
        task(
            `Fix ${orphans} orphan pages with no internal links`,
            'Medium',
            'Medium',
            'Medium',
            `Link these pages from relevant hub/index pages.\n\n**Affected pages:**\n${analyses
                .filter(a => a.internalLinkCount === 0)
                .map(a => `- ${a.url}`)
                .join('\n')}`
        );
    }
    if (thinContent > 0) {
        task(
            `Enrich thin-content pages (< 300 words) — ${thinContent} pages`,
            'Medium',
            'High',
            'High',
            `Add explicit service definitions, scope, audience, and FAQ sections.\n\n**Affected pages:**\n${analyses
                .filter(a => a.wordCount > 0 && a.wordCount < 300)
                .map(a => `- ${a.url} (${a.wordCount} words)`)
                .join('\n')}`
        );
    }
    if (
        analyses.filter(
            a => a.pageType === 'Branch/Contact' && !a.jsonLdTypes.includes('LocalBusiness')
        ).length > 0
    ) {
        task(
            'Add LocalBusiness schema to branch/contact pages',
            'High',
            'High',
            'Medium',
            'Required fields: `name`, `address` (PostalAddress), `geo`, `telephone`, `openingHours`, `parentOrganization`.'
        );
    }
    task(
        'Validate all JSON-LD via Google Rich Results Test',
        'High',
        'High',
        'Low',
        `**Tool:** https://search.google.com/test/rich-results\n\n**Priority pages to check:**\n${analyses
            .filter(a => a.jsonLdTypes.length > 0)
            .slice(0, 10)
            .map(a => `- ${a.url}`)
            .join('\n')}`
    );
    task(
        'Verify canonical/sitemap consistency',
        'High',
        'Medium',
        'Low',
        'Confirm all canonical URLs are included in sitemap.xml. Check for canonical loops and mismatches.'
    );

    // ── Build report ─────────────────────────────────────────────────────────

    return `# SEO Audit Report — ${domain}

**Crawl dates analyzed:** ${dates.join(', ')}
**Generated:** ${new Date().toISOString().slice(0, 10)}
**Unique pages analyzed:** ${total}

---

## 1. Executive Summary

| Metric | Count | Coverage |
|--------|-------|----------|
| Unique pages analyzed | ${total} | 100% |
| 🔴 Pages with critical issues | ${criticalCount} | ${pct(criticalCount, total)} |
| Missing meta description | ${missingDesc} | ${pct(missingDesc, total)} |
| Missing JSON-LD schema | ${missingSchema} | ${pct(missingSchema, total)} |
| No canonical URL | ${noCanonical} | ${pct(noCanonical, total)} |
| Orphan pages (0 internal links) | ${orphans} | ${pct(orphans, total)} |
| Not indexable | ${notIndexable} | ${pct(notIndexable, total)} |
| Thin content (< 300 words) | ${thinContent} | ${pct(thinContent, total)} |

### Key findings

${missingSchema > 0 ? `- ⚠️ **${missingSchema} pages** have no JSON-LD — machine readability is severely limited` : '- ✅ All pages have some JSON-LD structured data'}
${!allJsonLdTypes.includes('Organization') ? '- 🔴 **No Organization schema** — AI systems and search engines cannot reliably identify the business entity' : '- ✅ Organization entity defined'}
${missingDesc > 0 ? `- ⚠️ **${missingDesc} pages** missing meta descriptions — poor CTR in search results` : '- ✅ All pages have meta descriptions'}
${noCanonical > 0 ? `- ⚠️ **${noCanonical} pages** lack canonical tags — duplicate content risk` : '- ✅ All pages have canonical tags'}
${orphans > 0 ? `- ⚠️ **${orphans} pages** have zero internal links — invisible to crawlers` : '- ✅ No orphan pages detected'}
${notIndexable > 0 ? `- 🔴 **${notIndexable} pages** not indexable — verify robots meta and HTTP status` : '- ✅ All pages are indexable'}

---

## 2. Scope

- **Domain:** ${domain}
- **Crawl dates included:** ${dates.join(', ')}
- **Deduplication:** latest crawl date per URL used when same page appears in multiple dates
- **Total unique pages analyzed:** ${total}
- **Page types found:**
${Object.entries(pageTypeCounts)
    .map(([type, count]) => `  - ${type}: ${count}`)
    .join('\n')}

---

## 3. Page Type Inventory

| URL | Type | Indexable | Canonical | Schema Types | Issues |
|-----|------|-----------|-----------|--------------|--------|
${analyses
    .map(a => {
        const crits = a.issues.filter(i => i.severity === 'critical').length;
        const warns = a.issues.filter(i => i.severity === 'warning').length;
        const issueStr = crits > 0 ? `🔴 ${crits} critical` : warns > 0 ? `🟡 ${warns} warn` : '✅';
        const shortUrl = a.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 55) || '/';
        const schemas = a.jsonLdTypes.slice(0, 3).join(', ') || '—';
        return `| \`${shortUrl}\` | ${a.pageType} | ${a.isIndexable ? '✅' : '🔴'} | ${a.hasCanonical ? '✅' : '🟡'} | ${schemas} | ${issueStr} |`;
    })
    .join('\n')}

---

## 4. Structured Data Inventory

### Schema types found across site

${
    allJsonLdTypes.length > 0
        ? allJsonLdTypes
              .map(
                  t =>
                      `- **${t}** — ${analyses.filter(a => a.jsonLdTypes.includes(t)).length} pages`
              )
              .join('\n')
        : '⚠️ No JSON-LD structured data found on any page'
}

### Coverage by page type

| Page Type | Pages | Has Schema | Schema Types | Missing |
|-----------|-------|------------|--------------|---------|
${Object.entries(pageTypeCounts)
    .map(([type, count]) => {
        const ta = analyses.filter(a => a.pageType === type);
        const withSchema = ta.filter(a => a.jsonLdTypes.length > 0).length;
        const schemaTypes = [...new Set(ta.flatMap(a => a.jsonLdTypes))].join(', ') || '—';
        const missing =
            type === 'Homepage' && !schemaTypes.includes('Organization')
                ? 'Organization, WebSite'
                : type === 'Branch/Contact' && !schemaTypes.includes('LocalBusiness')
                  ? 'LocalBusiness'
                  : type === 'Service' && !schemaTypes.includes('Service')
                    ? 'Service'
                    : type === 'FAQ' && !schemaTypes.includes('FAQPage')
                      ? 'FAQPage'
                      : '—';
        return `| ${type} | ${count} | ${withSchema}/${count} | ${schemaTypes || '—'} | ${missing} |`;
    })
    .join('\n')}

---

## 5. Technical SEO Review

### Meta tag coverage

| Check | Pass | Fail | Coverage |
|-------|------|------|----------|
| Title present | ${analyses.filter(a => !!a.title).length} | ${analyses.filter(a => !a.title).length} | ${pct(analyses.filter(a => !!a.title).length, total)} |
| Title ≤ 63 chars | ${analyses.filter(a => a.titleLength <= 63 && !!a.title).length} | ${analyses.filter(a => a.titleLength > 63).length} | ${pct(analyses.filter(a => a.titleLength <= 63 && !!a.title).length, total)} |
| Meta description | ${analyses.filter(a => a.hasDescription).length} | ${missingDesc} | ${pct(analyses.filter(a => a.hasDescription).length, total)} |
| Description ≤ 163 chars | ${analyses.filter(a => a.descriptionLength <= 163 && a.hasDescription).length} | ${analyses.filter(a => a.descriptionLength > 163).length} | ${pct(analyses.filter(a => a.descriptionLength <= 163 && a.hasDescription).length, total)} |
| Canonical tag | ${analyses.filter(a => a.hasCanonical).length} | ${noCanonical} | ${pct(analyses.filter(a => a.hasCanonical).length, total)} |
| og:title | ${analyses.filter(a => a.hasOgTitle).length} | ${analyses.filter(a => !a.hasOgTitle).length} | ${pct(analyses.filter(a => a.hasOgTitle).length, total)} |
| og:description | ${analyses.filter(a => a.hasOgDescription).length} | ${analyses.filter(a => !a.hasOgDescription).length} | ${pct(analyses.filter(a => a.hasOgDescription).length, total)} |
| og:image | ${analyses.filter(a => a.hasOgImage).length} | ${analyses.filter(a => !a.hasOgImage).length} | ${pct(analyses.filter(a => a.hasOgImage).length, total)} |
| twitter:card | ${analyses.filter(a => a.hasTwitterCard).length} | ${analyses.filter(a => !a.hasTwitterCard).length} | ${pct(analyses.filter(a => a.hasTwitterCard).length, total)} |
| Hreflang | ${analyses.filter(a => a.hasHreflang).length} | ${analyses.filter(a => !a.hasHreflang).length} | ${pct(analyses.filter(a => a.hasHreflang).length, total)} |

---

## 6. Entity Model Analysis

### Entities detected

${
    allJsonLdTypes.length > 0
        ? allJsonLdTypes.map(t => `- **${t}**`).join('\n')
        : '⚠️ No structured entities found'
}

### Entity relationship assessment

${allJsonLdTypes.includes('Organization') ? '✅ **Organization** entity defined' : '🔴 **Organization** missing — AI systems cannot identify the business'}
${allJsonLdTypes.includes('WebSite') ? '✅ **WebSite** schema present' : '⚠️ **WebSite** missing — add WebSite with SearchAction'}
${allJsonLdTypes.includes('BreadcrumbList') ? '✅ **BreadcrumbList** present — site hierarchy defined' : '⚠️ **BreadcrumbList** missing — no hierarchy signal for search engines'}
${allJsonLdTypes.includes('LocalBusiness') ? '✅ **LocalBusiness** found — local SEO supported' : '⚠️ **LocalBusiness** missing — critical for local discoverability'}
${allJsonLdTypes.some(t => ['Article', 'BlogPosting'].includes(t)) ? `✅ **Article/BlogPosting** found on ${analyses.filter(a => a.pageType === 'Article').length} pages` : ''}

---

## 7. Gap Analysis

### Missing schemas by page type

${Object.entries(pageTypeCounts)
    .map(([type]) => {
        const ta = analyses.filter(a => a.pageType === type);
        const schemaTypes = [...new Set(ta.flatMap(a => a.jsonLdTypes))];
        const gaps: string[] = [];
        if (type === 'Homepage') {
            if (!schemaTypes.includes('Organization'))
                gaps.push('`Organization` — defines the business entity globally');
            if (!schemaTypes.includes('WebSite'))
                gaps.push('`WebSite` — enables sitelinks search box');
            if (!schemaTypes.includes('BreadcrumbList'))
                gaps.push('`BreadcrumbList` — hierarchy signal');
        }
        if (type === 'Article') {
            if (!schemaTypes.some(t => ['Article', 'BlogPosting', 'NewsArticle'].includes(t)))
                gaps.push('`Article`/`BlogPosting` — required for Google rich results');
        }
        if (type === 'Branch/Contact') {
            if (!schemaTypes.includes('LocalBusiness'))
                gaps.push('`LocalBusiness` — critical for Google Maps and local SEO');
        }
        if (type === 'Service') {
            if (!schemaTypes.includes('Service'))
                gaps.push('`Service` — improves entity clarity for AI systems');
        }
        if (type === 'FAQ') {
            if (!schemaTypes.includes('FAQPage')) gaps.push('`FAQPage` — enables FAQ rich results');
        }
        return gaps.length > 0
            ? `**${type}:**\n${gaps.map(g => `- Missing: ${g}`).join('\n')}`
            : `**${type}:** ✅ Expected schemas present`;
    })
    .join('\n\n')}

### Missing meta tags summary

${
    [
        ['Meta description', analyses.filter(a => !a.hasDescription)],
        ['og:title', analyses.filter(a => !a.hasOgTitle)],
        ['og:description', analyses.filter(a => !a.hasOgDescription)],
        ['og:image', analyses.filter(a => !a.hasOgImage)],
        ['twitter:card', analyses.filter(a => !a.hasTwitterCard)],
        ['Canonical', analyses.filter(a => !a.hasCanonical)],
    ]
        .filter(([, pages]) => (pages as IPageAnalysis[]).length > 0)
        .map(
            ([tag, pages]) =>
                `- **${tag}**: missing on ${(pages as IPageAnalysis[]).length} pages (${pct((pages as IPageAnalysis[]).length, total)})`
        )
        .join('\n') || '✅ No missing critical meta tags'
}

---

## 8. Content & AI Readability Review

### Word count distribution

${(() => {
    const bins: Record<string, number> = {
        '<100': 0,
        '100–299': 0,
        '300–599': 0,
        '630–999': 0,
        '1000+': 0,
    };
    for (const a of analyses) {
        if (a.wordCount < 100) bins['<100']++;
        else if (a.wordCount < 300) bins['100–299']++;
        else if (a.wordCount < 630) bins['300–599']++;
        else if (a.wordCount < 1000) bins['630–999']++;
        else bins['1000+']++;
    }
    return Object.entries(bins)
        .map(([range, count]) => `- **${range} words**: ${count} pages`)
        .join('\n');
})()}

### Thin content pages (< 300 words)

${
    analyses.filter(a => a.wordCount > 0 && a.wordCount < 300).length === 0
        ? '✅ No thin content pages detected'
        : analyses
              .filter(a => a.wordCount > 0 && a.wordCount < 300)
              .map(a => `- ${a.url} — **${a.wordCount} words**`)
              .join('\n')
}

### AI answerability checklist

- ${allJsonLdTypes.includes('Organization') ? '✅' : '❌'} Business identity clear (Organization schema)
- ${allJsonLdTypes.includes('WebSite') ? '✅' : '⚠️'} Website entity defined
- ${analyses.filter(a => a.pageType === 'Service' && a.jsonLdTypes.includes('Service')).length > 0 ? '✅' : '⚠️'} Services machine-readable (Service schema)
- ${allJsonLdTypes.includes('LocalBusiness') ? '✅' : '⚠️'} Location data structured (LocalBusiness schema)
- ${analyses.filter(a => a.wordCount >= 300).length >= total * 0.7 ? '✅' : '⚠️'} Content depth adequate (≥300 words on 70%+ of pages)

---

## 9. Internal Linking Review

| Metric | Value |
|--------|-------|
| Average internal links / page | ${(analyses.reduce((s, a) => s + a.internalLinkCount, 0) / total).toFixed(1)} |
| Orphan pages (0 internal links) | ${orphans} |
| Max internal links on one page | ${Math.max(...analyses.map(a => a.internalLinkCount))} |
| Min (excluding orphans) | ${Math.min(...analyses.filter(a => a.internalLinkCount > 0).map(a => a.internalLinkCount), Infinity) || 0} |

### Orphan pages

${
    orphans === 0
        ? '✅ No orphan pages'
        : analyses
              .filter(a => a.internalLinkCount === 0)
              .map(a => `- ${a.url}`)
              .join('\n')
}

---

## 10. Broken Links

${
    brokenLinks.length === 0
        ? '✅ No broken links detected (all crawled pages returned HTTP 200)'
        : `Found **${brokenLinks.length} broken link(s)** — pages with non-200 HTTP status that are still linked from other pages.\n\n${brokenLinks
              .map(b => {
                  const linkedFrom =
                      b.foundOn.length > 0
                          ? b.foundOn.map(src => `  - linked from: [${src}](${src})`).join('\n')
                          : '  - source page unknown (not linked from any crawled page)';
                  return `### 🔴 \`${b.targetUrl}\`\n- **HTTP status:** ${b.status}\n- **Linked from ${b.foundOn.length} page(s):**\n${linkedFrom}`;
              })
              .join('\n\n')}`
}

---

## 11. Validation Plan

- **Google Rich Results Test:** https://search.google.com/test/rich-results
- **Schema.org Validator:** https://validator.schema.org/
- **Google Search Console** → URL Inspection for rendering checks

### Priority pages to validate

${analyses
    .filter(a => a.jsonLdTypes.length > 0)
    .slice(0, 10)
    .map(a => `- [${a.url}](${a.url}) — ${a.jsonLdTypes.join(', ')}`)
    .join('\n')}

### Technical checklist

- [ ] Canonical URLs match sitemap entries
- [ ] No duplicate schema blocks (e.g., multiple Organization definitions)
- [ ] robots.txt does not block key page templates
- [ ] JSON-LD renders correctly in page source (not JS-only)

---

## 12. Prioritized Implementation Roadmap

| Task | Priority | Impact | Effort |
|------|----------|--------|--------|
${missingSchema > 0 ? `| Add JSON-LD to ${missingSchema} pages without schema | High | High | Medium |` : ''}
${!allJsonLdTypes.includes('Organization') ? '| Add global Organization schema | High | High | Low |' : ''}
${!allJsonLdTypes.includes('WebSite') ? '| Add WebSite + SearchAction schema | Medium | Medium | Low |' : ''}
${!allJsonLdTypes.includes('BreadcrumbList') ? '| Add BreadcrumbList sitewide | Medium | Medium | Low |' : ''}
${missingDesc > 0 ? `| Write meta descriptions for ${missingDesc} pages | High | High | Low |` : ''}
${noCanonical > 0 ? `| Add canonical tags to ${noCanonical} pages | Medium | Medium | Low |` : ''}
${orphans > 0 ? `| Fix ${orphans} orphan pages | Medium | Medium | Medium |` : ''}
${thinContent > 0 ? `| Enrich ${thinContent} thin-content pages | Medium | High | High |` : ''}
${analyses.filter(a => a.pageType === 'Branch/Contact' && !a.jsonLdTypes.includes('LocalBusiness')).length > 0 ? '| Add LocalBusiness to branch/contact pages | High | High | Medium |' : ''}
${brokenLinks.length > 0 ? `| Fix ${brokenLinks.length} broken links (non-200 pages) | High | High | Medium |` : ''}
| Validate all JSON-LD (Rich Results Test) | High | High | Low |
| Verify canonical/sitemap consistency | High | Medium | Low |

---

## 13. Developer TODO Backlog

${todos.join('\n\n---\n\n')}

---

## PDF Files

${
    pdfPages.length === 0
        ? '_No PDF files detected._'
        : `Found **${pdfPages.length} PDF file(s)**:\n\n| URL | Status |\n|-----|--------|\n${pdfPages.map(p => `| [${p.url}](${p.url}) | ${p.response?.status ?? '—'} |`).join('\n')}`
}

---

## Full Issue List Per Page

${analyses
    .filter(a => a.issues.length > 0)
    .map(a => {
        const path = a.url.replace(/^https?:\/\/[^/]+/, '') || '/';
        return `### \`${path}\`\n${a.issues.map(i => `- ${severityIcon(i.severity)} ${i.message}`).join('\n')}`;
    })
    .join('\n\n')}

---

*Generated by metadata-crawler SEO audit script — https://github.com/your-org/metadata-crawler*
`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function getArg(args: string[], name: string): string | undefined {
    const flag = args.find(a => a.startsWith(`--${name}=`));
    if (flag) return flag.split('=').slice(1).join('=');
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
    return undefined;
}

const args = process.argv.slice(2);
const domain = getArg(args, 'domain');
const dateArg = getArg(args, 'date');
const outputArg = getArg(args, 'output');

const main = (): void => {
    if (!domain) {
        console.error(
            '❌ Usage: npx tsx scripts/seo-audit.ts --domain <domain> [--date DD-MM-YYYY] [--output file.md]'
        );
        process.exit(1);
    }

    const domainDir = join('storage', 'datasets', domain);
    if (!existsSync(domainDir)) {
        console.error(`❌ No crawl data found for domain: ${domain}`);
        process.exit(1);
    }

    const allDates = listDates(domain);
    if (allDates.length === 0) {
        console.error(`❌ No date folders found under storage/datasets/${domain}`);
        process.exit(1);
    }

    // If specific date given, use only that; otherwise use all available dates
    const datesToLoad = dateArg ? [dateArg] : allDates;

    console.log(`🔍 Domain: ${domain}`);
    console.log(`📅 Dates to analyze: ${datesToLoad.join(', ')}`);

    try {
        const allPages = loadAllPages(domain, datesToLoad);
        const pdfPages = allPages.filter(isPdf);
        const pages = allPages.filter(p => !isPdf(p));
        console.log(`📄 Unique pages loaded: ${pages.length} HTML + ${pdfPages.length} PDF`);

        console.log('🔬 Analyzing pages...');
        const analyses = pages.map(analyzePage);

        console.log('📝 Generating SEO audit report...');
        const markdown = renderMarkdown(domain, datesToLoad, pages, analyses, pdfPages);

        const dateLabel = dateArg ?? `all-${allDates.length}-crawls`;
        // One folder per domain: storage/reports/<domain>/<date>/ (matches the other report
        // scripts). allDates is sorted ascending, so the last entry is the latest crawl.
        const folderDate = dateArg ?? allDates[allDates.length - 1];
        const reportsDir = join('storage', 'reports', domain, folderDate);
        if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
        const outputPath = outputArg ?? join(reportsDir, `seo-audit-${dateLabel}.md`);
        writeFileSync(outputPath, markdown, 'utf-8');

        const criticalCount = analyses.filter(a =>
            a.issues.some(i => i.severity === 'critical')
        ).length;
        const warnings = analyses.reduce(
            (s, a) => s + a.issues.filter(i => i.severity === 'warning').length,
            0
        );

        console.log('\n📊 Summary:');
        console.log(`   Unique pages analyzed:  ${analyses.length}`);
        console.log(`   Critical issues:        ${criticalCount} pages`);
        console.log(`   Warnings:               ${warnings}`);
        console.log(
            `   Missing schema:         ${analyses.filter(a => a.jsonLdTypes.length === 0).length} pages`
        );
        console.log(
            `   Missing description:    ${analyses.filter(a => !a.hasDescription).length} pages`
        );
        console.log(
            `   Orphan pages:           ${analyses.filter(a => a.internalLinkCount === 0).length} pages`
        );
        console.log(`\n✅ Report saved to: ${outputPath}`);
    } catch (error) {
        console.error('❌ Audit failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
};

main();
