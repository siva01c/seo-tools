#!/usr/bin/env tsx

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { messages, resolveLang, langSuffix } from './i18n.js';
import { isHtmlPage } from './page-records.js';

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

    if (!isIndexable) issues.push({ severity: 'critical', message: m.issNotIndexable });
    if (!title) issues.push({ severity: 'critical', message: m.issNoTitle });
    else if (titleLength > 63)
        issues.push({ severity: 'warning', message: m.issTitleLong(titleLength) });
    if (!description) issues.push({ severity: 'critical', message: m.issNoDesc });
    else if (descriptionLength > 163)
        issues.push({ severity: 'warning', message: m.issDescLong(descriptionLength) });
    if (!canonical) issues.push({ severity: 'warning', message: m.issNoCanonical });
    if (!meta['og:title']) issues.push({ severity: 'warning', message: m.issNoOgTitle });
    if (!meta['og:description']) issues.push({ severity: 'warning', message: m.issNoOgDesc });
    if (!meta['og:image']) issues.push({ severity: 'info', message: m.issNoOgImage });
    if (!meta['twitter:card']) issues.push({ severity: 'info', message: m.issNoTwitter });
    if (jsonLdTypes.length === 0) issues.push({ severity: 'warning', message: m.issNoJsonLd });
    if (wordCount < 300 && wordCount > 0)
        issues.push({ severity: 'warning', message: m.issThin(wordCount) });
    if (internalLinkCount === 0) issues.push({ severity: 'warning', message: m.issNoInternal });

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

// Crawled URLs are untrusted third-party data (a malicious target page could contain `]`,
// `)`, `|`, or backtick characters designed to break out of Markdown link/table/code syntax).
// Escape before embedding in any report output. Does not attempt full XSS sanitization —
// reports are Markdown-as-text today; revisit before any HTML/dashboard rendering (see
// docs/todo.md A4).
function mdEscapeUrl(url: string): string {
    return url.replace(/[\\`*_[\]()|]/g, '\\$&').replace(/[\r\n]/g, ' ');
}

// Renders a URL as a Markdown link, refusing to make non-http(s) schemes (e.g. `javascript:`)
// clickable — crawled internal links are followed via validateCrawlTarget's http(s)-only
// check, but a page's *displayed* link text/href pairs are raw HTML we don't control.
function mdLink(url: string): string {
    const escaped = mdEscapeUrl(url);
    return /^https?:\/\//i.test(url) ? `[${escaped}](${escaped})` : escaped;
}

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
            `### [SEO-${String(taskId++).padStart(3, '0')}] ${title}\n\n**${m.thRoadmap[1]}:** ${priority} | **${m.thRoadmap[2]}:** ${impact} | **${m.thRoadmap[3]}:** ${effort}\n\n${body}`
        );
    };
    const affected = (
        filter: (a: IPageAnalysis) => boolean,
        label?: (a: IPageAnalysis) => string
    ): string =>
        `**${m.todoAffectedPages}**\n${analyses
            .filter(filter)
            .map(a => (label ? label(a) : `- ${mdEscapeUrl(a.url)}`))
            .join('\n')}`;

    if (missingSchema > 0) {
        task(
            m.todoAddSchema(missingSchema),
            m.levHigh,
            m.levHigh,
            m.levMedium,
            affected(a => a.jsonLdTypes.length === 0)
        );
    }
    if (!allJsonLdTypes.includes('Organization')) {
        task(m.todoAddOrg, m.levHigh, m.levHigh, m.levLow, m.todoAddOrgBody);
    }
    if (!allJsonLdTypes.includes('WebSite')) {
        task(m.todoAddWebsite, m.levMedium, m.levMedium, m.levLow, m.todoAddWebsiteBody);
    }
    if (!allJsonLdTypes.includes('BreadcrumbList')) {
        task(m.todoAddBreadcrumb, m.levMedium, m.levMedium, m.levLow, m.todoAddBreadcrumbBody);
    }
    if (missingDesc > 0) {
        task(
            m.todoWriteDesc(missingDesc),
            m.levHigh,
            m.levHigh,
            m.levLow,
            `${m.todoWriteDescBody}\n\n${affected(a => !a.hasDescription)}`
        );
    }
    if (noCanonical > 0) {
        task(
            m.todoAddCanonical(noCanonical),
            m.levMedium,
            m.levMedium,
            m.levLow,
            affected(a => !a.hasCanonical)
        );
    }
    if (orphans > 0) {
        task(
            m.todoFixOrphans(orphans),
            m.levMedium,
            m.levMedium,
            m.levMedium,
            `${m.todoFixOrphansBody}\n\n${affected(a => a.internalLinkCount === 0)}`
        );
    }
    if (thinContent > 0) {
        task(
            m.todoEnrichThin(thinContent),
            m.levMedium,
            m.levHigh,
            m.levHigh,
            `${m.todoEnrichThinBody}\n\n${affected(
                a => a.wordCount > 0 && a.wordCount < 300,
                a => `- ${mdEscapeUrl(a.url)} (${a.wordCount} ${m.todoWordsSuffix})`
            )}`
        );
    }
    if (
        analyses.filter(
            a => a.pageType === 'Branch/Contact' && !a.jsonLdTypes.includes('LocalBusiness')
        ).length > 0
    ) {
        task(m.todoAddLocalBiz, m.levHigh, m.levHigh, m.levMedium, m.todoAddLocalBizBody);
    }
    task(
        m.todoValidate,
        m.levHigh,
        m.levHigh,
        m.levLow,
        `${m.todoValidateBody}\n${analyses
            .filter(a => a.jsonLdTypes.length > 0)
            .slice(0, 10)
            .map(a => `- ${mdEscapeUrl(a.url)}`)
            .join('\n')}`
    );
    task(m.todoVerifyCanonical, m.levHigh, m.levMedium, m.levLow, m.todoVerifyCanonicalBody);

    // Conditional lines are collected in arrays and the skipped ones filtered out —
    // an inline `${cond ? row : ''}` leaves a blank line, which terminates a markdown table.
    const entityRelationshipLines = [
        allJsonLdTypes.includes('Organization') ? m.eOrgYes : m.eOrgNo,
        allJsonLdTypes.includes('WebSite') ? m.eWebsiteYes : m.eWebsiteNo,
        allJsonLdTypes.includes('BreadcrumbList') ? m.eBreadcrumbYes : m.eBreadcrumbNo,
        allJsonLdTypes.includes('LocalBusiness') ? m.eLocalBizYes : m.eLocalBizNo,
        allJsonLdTypes.some(t => ['Article', 'BlogPosting'].includes(t))
            ? m.eArticleYes(analyses.filter(a => a.pageType === 'Article').length)
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    const roadmapRows = [
        missingSchema > 0
            ? `| ${m.todoAddSchema(missingSchema)} | ${m.levHigh} | ${m.levHigh} | ${m.levMedium} |`
            : '',
        !allJsonLdTypes.includes('Organization')
            ? `| ${m.todoAddOrg} | ${m.levHigh} | ${m.levHigh} | ${m.levLow} |`
            : '',
        !allJsonLdTypes.includes('WebSite')
            ? `| ${m.todoAddWebsite} | ${m.levMedium} | ${m.levMedium} | ${m.levLow} |`
            : '',
        !allJsonLdTypes.includes('BreadcrumbList')
            ? `| ${m.todoAddBreadcrumb} | ${m.levMedium} | ${m.levMedium} | ${m.levLow} |`
            : '',
        missingDesc > 0
            ? `| ${m.todoWriteDesc(missingDesc)} | ${m.levHigh} | ${m.levHigh} | ${m.levLow} |`
            : '',
        noCanonical > 0
            ? `| ${m.todoAddCanonical(noCanonical)} | ${m.levMedium} | ${m.levMedium} | ${m.levLow} |`
            : '',
        orphans > 0
            ? `| ${m.todoFixOrphans(orphans)} | ${m.levMedium} | ${m.levMedium} | ${m.levMedium} |`
            : '',
        thinContent > 0
            ? `| ${m.todoEnrichThin(thinContent)} | ${m.levMedium} | ${m.levHigh} | ${m.levHigh} |`
            : '',
        analyses.filter(
            a => a.pageType === 'Branch/Contact' && !a.jsonLdTypes.includes('LocalBusiness')
        ).length > 0
            ? `| ${m.todoAddLocalBiz} | ${m.levHigh} | ${m.levHigh} | ${m.levMedium} |`
            : '',
        brokenLinks.length > 0
            ? `| ${m.roadmapFixBroken(brokenLinks.length)} | ${m.levHigh} | ${m.levHigh} | ${m.levMedium} |`
            : '',
        `| ${m.todoValidate} | ${m.levHigh} | ${m.levHigh} | ${m.levLow} |`,
        `| ${m.todoVerifyCanonical} | ${m.levHigh} | ${m.levMedium} | ${m.levLow} |`,
    ]
        .filter(Boolean)
        .join('\n');

    // ── Build report ─────────────────────────────────────────────────────────

    return `# ${m.reportTitle} — ${domain}

**${m.metaCrawlDates}:** ${dates.join(', ')}
**${m.metaGenerated}:** ${new Date().toISOString().slice(0, 10)}
**${m.metaUniquePages}:** ${total}

---

## 1. ${m.sExecSummary}

| ${m.thSummary[0]} | ${m.thSummary[1]} | ${m.thSummary[2]} |
|--------|-------|----------|
| ${m.rowUniquePages} | ${total} | 100% |
| ${m.rowCritical} | ${criticalCount} | ${pct(criticalCount, total)} |
| ${m.rowMissingDesc} | ${missingDesc} | ${pct(missingDesc, total)} |
| ${m.rowMissingSchema} | ${missingSchema} | ${pct(missingSchema, total)} |
| ${m.rowNoCanonical} | ${noCanonical} | ${pct(noCanonical, total)} |
| ${m.rowOrphans} | ${orphans} | ${pct(orphans, total)} |
| ${m.rowNotIndexable} | ${notIndexable} | ${pct(notIndexable, total)} |
| ${m.rowThin} | ${thinContent} | ${pct(thinContent, total)} |

### ${m.hKeyFindings}

${missingSchema > 0 ? m.fNoJsonLd(missingSchema) : m.fAllJsonLd}
${!allJsonLdTypes.includes('Organization') ? m.fNoOrg : m.fOrgDefined}
${missingDesc > 0 ? m.fMissingDesc(missingDesc) : m.fAllDesc}
${noCanonical > 0 ? m.fNoCanonical(noCanonical) : m.fAllCanonical}
${orphans > 0 ? m.fOrphans(orphans) : m.fNoOrphans}
${notIndexable > 0 ? m.fNotIndexable(notIndexable) : m.fAllIndexable}

---

## 2. ${m.sScope}

- **${m.lblDomain}:** ${domain}
- **${m.lblCrawlDatesIncluded}:** ${dates.join(', ')}
- **${m.lblDedup}**
- **${m.lblTotalPages}:** ${total}
- **${m.lblPageTypesFound}:**
${Object.entries(pageTypeCounts)
    .map(([type, count]) => `  - ${m.pageType[type] ?? type}: ${count}`)
    .join('\n')}

---

## 3. ${m.sPageTypeInventory}

| ${m.thPageType[0]} | ${m.thPageType[1]} | ${m.thPageType[2]} | ${m.thPageType[3]} | ${m.thPageType[4]} | ${m.thPageType[5]} |
|-----|------|-----------|-----------|--------------|--------|
${analyses
    .map(a => {
        const crits = a.issues.filter(i => i.severity === 'critical').length;
        const warns = a.issues.filter(i => i.severity === 'warning').length;
        const issueStr =
            crits > 0 ? m.issueCellCritical(crits) : warns > 0 ? m.issueCellWarn(warns) : '✅';
        const shortUrl = mdEscapeUrl(a.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 55) || '/');
        const schemas = a.jsonLdTypes.slice(0, 3).join(', ') || '—';
        return `| \`${shortUrl}\` | ${m.pageType[a.pageType] ?? a.pageType} | ${a.isIndexable ? '✅' : '🔴'} | ${a.hasCanonical ? '✅' : '🟡'} | ${schemas} | ${issueStr} |`;
    })
    .join('\n')}

---

## 4. ${m.sStructuredData}

### ${m.hSchemaTypesFound}

${
    allJsonLdTypes.length > 0
        ? allJsonLdTypes
              .map(
                  t =>
                      `- **${t}** — ${analyses.filter(a => a.jsonLdTypes.includes(t)).length} ${m.pagesWord}`
              )
              .join('\n')
        : m.noJsonLdAnyPage
}

### ${m.hCoverageByType}

| ${m.thCoverage[0]} | ${m.thCoverage[1]} | ${m.thCoverage[2]} | ${m.thCoverage[3]} | ${m.thCoverage[4]} |
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
        return `| ${m.pageType[type] ?? type} | ${count} | ${withSchema}/${count} | ${schemaTypes || '—'} | ${missing} |`;
    })
    .join('\n')}

---

## 5. ${m.sTechnicalSeo}

### ${m.hMetaTagCoverage}

| ${m.thMetaCheck[0]} | ${m.thMetaCheck[1]} | ${m.thMetaCheck[2]} | ${m.thMetaCheck[3]} |
|-------|------|------|----------|
| ${m.mcTitlePresent} | ${analyses.filter(a => !!a.title).length} | ${analyses.filter(a => !a.title).length} | ${pct(analyses.filter(a => !!a.title).length, total)} |
| ${m.mcTitleLen} | ${analyses.filter(a => a.titleLength <= 63 && !!a.title).length} | ${analyses.filter(a => a.titleLength > 63).length} | ${pct(analyses.filter(a => a.titleLength <= 63 && !!a.title).length, total)} |
| ${m.mcMetaDesc} | ${analyses.filter(a => a.hasDescription).length} | ${missingDesc} | ${pct(analyses.filter(a => a.hasDescription).length, total)} |
| ${m.mcDescLen} | ${analyses.filter(a => a.descriptionLength <= 163 && a.hasDescription).length} | ${analyses.filter(a => a.descriptionLength > 163).length} | ${pct(analyses.filter(a => a.descriptionLength <= 163 && a.hasDescription).length, total)} |
| ${m.mcCanonical} | ${analyses.filter(a => a.hasCanonical).length} | ${noCanonical} | ${pct(analyses.filter(a => a.hasCanonical).length, total)} |
| og:title | ${analyses.filter(a => a.hasOgTitle).length} | ${analyses.filter(a => !a.hasOgTitle).length} | ${pct(analyses.filter(a => a.hasOgTitle).length, total)} |
| og:description | ${analyses.filter(a => a.hasOgDescription).length} | ${analyses.filter(a => !a.hasOgDescription).length} | ${pct(analyses.filter(a => a.hasOgDescription).length, total)} |
| og:image | ${analyses.filter(a => a.hasOgImage).length} | ${analyses.filter(a => !a.hasOgImage).length} | ${pct(analyses.filter(a => a.hasOgImage).length, total)} |
| twitter:card | ${analyses.filter(a => a.hasTwitterCard).length} | ${analyses.filter(a => !a.hasTwitterCard).length} | ${pct(analyses.filter(a => a.hasTwitterCard).length, total)} |
| ${m.mcHreflang} | ${analyses.filter(a => a.hasHreflang).length} | ${analyses.filter(a => !a.hasHreflang).length} | ${pct(analyses.filter(a => a.hasHreflang).length, total)} |

---

## 6. ${m.sEntityModel}

### ${m.hEntitiesDetected}

${allJsonLdTypes.length > 0 ? allJsonLdTypes.map(t => `- **${t}**`).join('\n') : m.eNoEntities}

### ${m.hEntityRelationship}

${entityRelationshipLines}

---

## 7. ${m.sGapAnalysis}

### ${m.hMissingSchemasByType}

${Object.entries(pageTypeCounts)
    .map(([type]) => {
        const ta = analyses.filter(a => a.pageType === type);
        const schemaTypes = [...new Set(ta.flatMap(a => a.jsonLdTypes))];
        const gaps: string[] = [];
        if (type === 'Homepage') {
            if (!schemaTypes.includes('Organization')) gaps.push(m.gapOrganization);
            if (!schemaTypes.includes('WebSite')) gaps.push(m.gapWebsite);
            if (!schemaTypes.includes('BreadcrumbList')) gaps.push(m.gapBreadcrumb);
        }
        if (type === 'Article') {
            if (!schemaTypes.some(t => ['Article', 'BlogPosting', 'NewsArticle'].includes(t)))
                gaps.push(m.gapArticle);
        }
        if (type === 'Branch/Contact') {
            if (!schemaTypes.includes('LocalBusiness')) gaps.push(m.gapLocalBusiness);
        }
        if (type === 'Service') {
            if (!schemaTypes.includes('Service')) gaps.push(m.gapService);
        }
        if (type === 'FAQ') {
            if (!schemaTypes.includes('FAQPage')) gaps.push(m.gapFaq);
        }
        const label = m.pageType[type] ?? type;
        return gaps.length > 0
            ? `**${label}:**\n${gaps.map(g => `- ${m.gapMissing}: ${g}`).join('\n')}`
            : `**${label}:** ${m.gapExpectedPresent}`;
    })
    .join('\n\n')}

### ${m.hMissingMetaSummary}

${
    (
        [
            [m.mcMetaDesc, analyses.filter(a => !a.hasDescription)],
            ['og:title', analyses.filter(a => !a.hasOgTitle)],
            ['og:description', analyses.filter(a => !a.hasOgDescription)],
            ['og:image', analyses.filter(a => !a.hasOgImage)],
            ['twitter:card', analyses.filter(a => !a.hasTwitterCard)],
            [m.mcCanonical, analyses.filter(a => !a.hasCanonical)],
        ] as [string, IPageAnalysis[]][]
    )
        .filter(([, pages]) => pages.length > 0)
        .map(([tag, pages]) => m.missingMetaLine(tag, pages.length, pct(pages.length, total)))
        .join('\n') || m.noMissingMeta
}

---

## 8. ${m.sContentAi}

### ${m.hWordCountDist}

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
        .map(([range, count]) => m.wordBinLine(range, count))
        .join('\n');
})()}

### ${m.hThinContent}

${
    analyses.filter(a => a.wordCount > 0 && a.wordCount < 300).length === 0
        ? m.noThin
        : analyses
              .filter(a => a.wordCount > 0 && a.wordCount < 300)
              .map(a => m.thinLine(mdEscapeUrl(a.url), a.wordCount))
              .join('\n')
}

### ${m.hAiChecklist}

- ${allJsonLdTypes.includes('Organization') ? '✅' : '❌'} ${m.aiBizIdentity}
- ${allJsonLdTypes.includes('WebSite') ? '✅' : '⚠️'} ${m.aiWebsiteEntity}
- ${analyses.filter(a => a.pageType === 'Service' && a.jsonLdTypes.includes('Service')).length > 0 ? '✅' : '⚠️'} ${m.aiServices}
- ${allJsonLdTypes.includes('LocalBusiness') ? '✅' : '⚠️'} ${m.aiLocation}
- ${analyses.filter(a => a.wordCount >= 300).length >= total * 0.7 ? '✅' : '⚠️'} ${m.aiContentDepth}

---

## 9. ${m.sInternalLinking}

| ${m.thLinking[0]} | ${m.thLinking[1]} |
|--------|-------|
| ${m.ilAvg} | ${(analyses.reduce((s, a) => s + a.internalLinkCount, 0) / total).toFixed(1)} |
| ${m.ilOrphans} | ${orphans} |
| ${m.ilMax} | ${Math.max(...analyses.map(a => a.internalLinkCount))} |
| ${m.ilMin} | ${Math.min(...analyses.filter(a => a.internalLinkCount > 0).map(a => a.internalLinkCount), Infinity) || 0} |

### ${m.hOrphanPages}

${
    orphans === 0
        ? m.noOrphanPages
        : analyses
              .filter(a => a.internalLinkCount === 0)
              .map(a => `- ${mdEscapeUrl(a.url)}`)
              .join('\n')
}

---

## 10. ${m.sBrokenLinks}

${
    brokenLinks.length === 0
        ? m.blNone
        : `${m.blFound(brokenLinks.length)}\n\n${brokenLinks
              .map(b => {
                  const linkedFrom =
                      b.foundOn.length > 0
                          ? b.foundOn.map(src => m.blLinkedFrom(src)).join('\n')
                          : m.blSourceUnknown;
                  return `### 🔴 \`${b.targetUrl}\`\n- **${m.blHttpStatus}:** ${b.status}\n- **${m.blLinkedFromCount(b.foundOn.length)}**\n${linkedFrom}`;
              })
              .join('\n\n')}`
}

---

## 11. ${m.sValidationPlan}

- ${m.vpRichResults}
- ${m.vpSchemaValidator}
- ${m.vpSearchConsole}

### ${m.hPriorityPages}

${analyses
    .filter(a => a.jsonLdTypes.length > 0)
    .slice(0, 10)
    .map(a => `- ${mdLink(a.url)} — ${a.jsonLdTypes.join(', ')}`)
    .join('\n')}

### ${m.hTechChecklist}

- [ ] ${m.chkCanonicalSitemap}
- [ ] ${m.chkNoDupSchema}
- [ ] ${m.chkRobots}
- [ ] ${m.chkJsonLdRenders}

---

## 12. ${m.sRoadmap}

| ${m.thRoadmap[0]} | ${m.thRoadmap[1]} | ${m.thRoadmap[2]} | ${m.thRoadmap[3]} |
|------|----------|--------|--------|
${roadmapRows}

---

## 13. ${m.sTodoBacklog}

${todos.join('\n\n---\n\n')}

---

## ${m.sPdfFiles}

${
    pdfPages.length === 0
        ? m.noPdf
        : `${m.pdfFound(pdfPages.length)}\n\n| ${m.thPdf[0]} | ${m.thPdf[1]} |\n|-----|--------|\n${pdfPages.map(p => `| ${mdLink(p.url)} | ${p.response?.status ?? '—'} |`).join('\n')}`
}

---

## ${m.sFullIssueList}

${analyses
    .filter(a => a.issues.length > 0)
    .map(a => {
        const path = mdEscapeUrl(a.url.replace(/^https?:\/\/[^/]+/, '') || '/');
        return `### \`${path}\`\n${a.issues.map(i => `- ${severityIcon(i.severity)} ${i.message}`).join('\n')}`;
    })
    .join('\n\n')}

---

${m.footer}
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
const lang = resolveLang(getArg(args, 'language') ?? getArg(args, 'lang'));
// Translated message bundle for this run; analyzePage/renderMarkdown close over it.
const m = messages[lang].seoAudit;

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
        const nonHtmlPages = allPages.filter(p => !isPdf(p) && !isHtmlPage(p));
        const pages = allPages.filter(p => !isPdf(p) && isHtmlPage(p));
        console.log(
            `📄 Unique pages loaded: ${pages.length} HTML + ${pdfPages.length} PDF + ${nonHtmlPages.length} non-HTML (feeds/XML, excluded from analysis)`
        );

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
        const outputPath =
            outputArg ?? join(reportsDir, `seo-audit-${dateLabel}${langSuffix(lang)}.md`);
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
