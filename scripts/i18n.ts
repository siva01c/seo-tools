/**
 * Shared i18n for the report scripts (seo-audit, report-seo-issues, report-404s).
 *
 * Language is selected with `--language <code>` (alias `--lang`):
 *   - empty / absent / "en"  → English (default)
 *   - "cs"                    → Czech
 * Unknown values warn and fall back to English.
 *
 * Only human-facing prose and CSV column headers are translated. JSON object keys and enum
 * values (e.g. `issue: "missing"`) stay in English so the data stays a stable machine format.
 *
 * `messages` is typed `Record<Lang, IMessages>`, so `tsc` fails the build if the Czech map is
 * missing any key — a compile-time completeness guarantee.
 */

export type Lang = 'en' | 'cs';

/** Resolve a raw --language value to a supported Lang (default en). */
export const resolveLang = (arg?: string): Lang => {
    const v = (arg ?? '').trim().toLowerCase();
    if (v === '' || v === 'en') return 'en';
    if (v === 'cs') return 'cs';
    console.warn(`⚠️  Unknown language "${arg}" — falling back to English. Supported: en, cs.`);
    return 'en';
};

/** Filename suffix for a language ('' for en, '-cs' for cs). */
export const langSuffix = (lang: Lang): string => (lang === 'cs' ? '-cs' : '');

/** Insert the language suffix before a filename's extension. */
export const withSuffix = (filename: string, lang: Lang): string => {
    const s = langSuffix(lang);
    if (!s) return filename;
    const dot = filename.lastIndexOf('.');
    return dot === -1 ? `${filename}${s}` : `${filename.slice(0, dot)}${s}${filename.slice(dot)}`;
};

// ── Message shapes ─────────────────────────────────────────────────────────────

export interface ISeoAuditMessages {
    reportTitle: string;
    metaCrawlDates: string;
    metaGenerated: string;
    metaUniquePages: string;

    // Section headings (numbers are added by the renderer)
    sExecSummary: string;
    sScope: string;
    sPageTypeInventory: string;
    sStructuredData: string;
    sTechnicalSeo: string;
    sEntityModel: string;
    sGapAnalysis: string;
    sContentAi: string;
    sInternalLinking: string;
    sBrokenLinks: string;
    sValidationPlan: string;
    sRoadmap: string;
    sTodoBacklog: string;
    sSitemapRobots: string;
    sPdfFiles: string;
    sFullIssueList: string;

    // Sub-headings
    hKeyFindings: string;
    hSchemaTypesFound: string;
    hCoverageByType: string;
    hMetaTagCoverage: string;
    hEntitiesDetected: string;
    hEntityRelationship: string;
    hMissingSchemasByType: string;
    hMissingMetaSummary: string;
    hWordCountDist: string;
    hThinContent: string;
    hAiChecklist: string;
    hOrphanPages: string;
    hPriorityPages: string;
    hTechChecklist: string;

    // Table header rows
    thSummary: [string, string, string];
    thPageType: [string, string, string, string, string, string];
    thCoverage: [string, string, string, string, string];
    thMetaCheck: [string, string, string, string];
    thLinking: [string, string];
    thRoadmap: [string, string, string, string];
    thPdf: [string, string];
    thSitemap: [string, string, string, string, string];

    // Executive-summary row labels
    rowUniquePages: string;
    rowCritical: string;
    rowMissingDesc: string;
    rowMissingSchema: string;
    rowNoCanonical: string;
    rowOrphans: string;
    rowNotIndexable: string;
    rowThin: string;

    // Key findings (positive / negative variants)
    fNoJsonLd: (n: number) => string;
    fAllJsonLd: string;
    fNoOrg: string;
    fOrgDefined: string;
    fMissingDesc: (n: number) => string;
    fAllDesc: string;
    fNoCanonical: (n: number) => string;
    fAllCanonical: string;
    fOrphans: (n: number) => string;
    fNoOrphans: string;
    fNotIndexable: (n: number) => string;
    fAllIndexable: string;

    // Scope
    lblDomain: string;
    lblCrawlDatesIncluded: string;
    lblDedup: string;
    lblTotalPages: string;
    lblPageTypesFound: string;

    // Structured data
    noJsonLdAnyPage: string;
    pagesWord: string; // "pages" used in "N pages"
    missingWord: string; // table cell "Missing" already in header; this is value joiner

    // Meta-tag check row labels
    mcTitlePresent: string;
    mcTitleLen: string;
    mcMetaDesc: string;
    mcDescLen: string;
    mcCanonical: string;
    mcHreflang: string;

    // Entity model
    eNoEntities: string;
    eOrgYes: string;
    eOrgNo: string;
    eWebsiteYes: string;
    eWebsiteNo: string;
    eBreadcrumbYes: string;
    eBreadcrumbNo: string;
    eLocalBizYes: string;
    eLocalBizNo: string;
    eArticleYes: (n: number) => string;

    // Gap analysis
    gapMissing: string; // "Missing:" prefix
    gapExpectedPresent: string; // "✅ Expected schemas present"
    gapOrganization: string;
    gapWebsite: string;
    gapBreadcrumb: string;
    gapArticle: string;
    gapLocalBusiness: string;
    gapService: string;
    gapFaq: string;
    missingMetaLine: (tag: string, n: number, coverage: string) => string;
    noMissingMeta: string;

    // Content & AI
    wordBinLine: (range: string, count: number) => string;
    noThin: string;
    thinLine: (url: string, words: number) => string;
    aiBizIdentity: string;
    aiWebsiteEntity: string;
    aiServices: string;
    aiLocation: string;
    aiContentDepth: string;

    // Internal linking
    ilAvg: string;
    ilOrphans: string;
    ilMax: string;
    ilMin: string;
    noOrphanPages: string;

    // Broken links
    blNone: string;
    blFound: (n: number) => string;
    blLinkedFrom: (src: string) => string;
    blSourceUnknown: string;
    blHttpStatus: string;
    blLinkedFromCount: (n: number) => string;

    // Validation plan
    vpRichResults: string;
    vpSchemaValidator: string;
    vpSearchConsole: string;
    chkCanonicalSitemap: string;
    chkNoDupSchema: string;
    chkRobots: string;
    chkJsonLdRenders: string;

    // Sitemap & robots.txt validation (B5)
    robotsNotFound: string;
    robotsSitemapsFound: (n: number) => string;
    robotsNoSitemapDirective: string;
    noSitemapIssues: string;

    // PDF + footer
    noPdf: string;
    pdfFound: (n: number) => string;
    footer: string;

    // Page-type display labels (internal keys stay English)
    pageType: Record<string, string>;
    // Issue-cell short labels
    issueCellCritical: (n: number) => string;
    issueCellWarn: (n: number) => string;

    // Priority / Impact / Effort values
    levHigh: string;
    levMedium: string;
    levLow: string;

    // Per-page issue messages (from analyzePage)
    issNotIndexable: string;
    issNoTitle: string;
    issTitleLong: (len: number) => string;
    issNoDesc: string;
    issDescLong: (len: number) => string;
    issNoCanonical: string;
    issNoOgTitle: string;
    issNoOgDesc: string;
    issNoOgImage: string;
    issNoTwitter: string;
    issNoJsonLd: string;
    issThin: (words: number) => string;
    issNoInternal: string;
    issNoViewport: string;
    issInvalidViewport: string;
    issNotHttps: string;
    issNoHsts: string;
    issNoXContentTypeOptions: string;
    issNoCsp: string;
    issMixedContent: string;
    issMultipleH1: (count: number) => string;
    issNoH1: string;
    issSkippedHeadingLevel: (from: number, to: number) => string;
    issImageMissingAlt: (count: number, total: number) => string;
    issDuplicateTitle: string;
    issDuplicateDescription: string;
    issRedirectChain: (hops: number) => string;

    // TODO backlog tasks (title + body); priority/impact/effort use levHigh/… above
    todoAffectedPages: string; // "Affected pages:"
    todoAddSchema: (n: number) => string;
    todoAddOrg: string;
    todoAddOrgBody: string;
    todoAddWebsite: string;
    todoAddWebsiteBody: string;
    todoAddBreadcrumb: string;
    todoAddBreadcrumbBody: string;
    todoWriteDesc: (n: number) => string;
    todoWriteDescBody: string; // intro line before affected pages
    todoAddCanonical: (n: number) => string;
    todoFixOrphans: (n: number) => string;
    todoFixOrphansBody: string;
    todoEnrichThin: (n: number) => string;
    todoEnrichThinBody: string;
    todoWordsSuffix: string; // "(N words)" → " words)" label
    todoAddLocalBiz: string;
    todoAddLocalBizBody: string;
    todoValidate: string;
    todoValidateBody: string; // "Priority pages to check:" line
    todoVerifyCanonical: string;
    todoVerifyCanonicalBody: string;
    roadmapFixBroken: (n: number) => string;
}

export interface ISeoIssuesMessages {
    csvMetaDesc: string[];
    csvTitle: string[];
    csvH1: string[];
    csvOrphan: string[];
    csvJsonLd: string[];
    csvOgComplete: string[];
    csvTwitterCard: string[];
    csvRedirectClass: string[];
    csvRedirect3xx: string[];
    sumHeader: string;
    sumMetaDesc: string;
    sumTitle: string;
    sumH1: string;
    sumOrphan: string;
    sumJsonLd: string;
    sumOgComplete: string;
    sumTwitterCard: string;
    sumRedirectClass: string;
    sumRedirect3xx: string;
    sumWritten: string;
}

export interface IReport404Messages {
    csvHeader: string[];
    discLinkedFrom: string;
    discSeeded: string;
}

export interface ILinkGraphIssuesMessages {
    csvBrokenLink: string[];
    csvOrphanRedirect: string[];
    csvSingleDofollow: string[];
    sumHeader: string;
    sumBrokenLink: string;
    sumOrphanRedirect: string;
    sumSingleDofollow: string;
    sumWritten: string;
}

export interface ISitemapIssuesMessages {
    csvMultiSitemap: string[];
    sumHeader: string;
    sumMultiSitemap: string;
    sumWritten: string;
}

export interface ITitleDescriptionFixesMessages {
    csvHeader: string[];
    sumHeader: string;
    sumGenerated: string;
    sumWritten: string;
}

export interface IMessages {
    seoAudit: ISeoAuditMessages;
    seoIssues: ISeoIssuesMessages;
    report404: IReport404Messages;
    linkGraphIssues: ILinkGraphIssuesMessages;
    sitemapIssues: ISitemapIssuesMessages;
    titleDescriptionFixes: ITitleDescriptionFixesMessages;
}

// ── English ────────────────────────────────────────────────────────────────────

const en: IMessages = {
    seoAudit: {
        reportTitle: 'SEO Audit Report',
        metaCrawlDates: 'Crawl dates analyzed',
        metaGenerated: 'Generated',
        metaUniquePages: 'Unique pages analyzed',
        sExecSummary: 'Executive Summary',
        sScope: 'Scope',
        sPageTypeInventory: 'Page Type Inventory',
        sStructuredData: 'Structured Data Inventory',
        sTechnicalSeo: 'Technical SEO Review',
        sEntityModel: 'Entity Model Analysis',
        sGapAnalysis: 'Gap Analysis',
        sContentAi: 'Content & AI Readability Review',
        sInternalLinking: 'Internal Linking Review',
        sBrokenLinks: 'Broken Links',
        sValidationPlan: 'Validation Plan',
        sRoadmap: 'Prioritized Implementation Roadmap',
        sTodoBacklog: 'Developer TODO Backlog',
        sSitemapRobots: 'Sitemap & Robots.txt Validation',
        sPdfFiles: 'PDF Files',
        sFullIssueList: 'Full Issue List Per Page',
        hKeyFindings: 'Key findings',
        hSchemaTypesFound: 'Schema types found across site',
        hCoverageByType: 'Coverage by page type',
        hMetaTagCoverage: 'Meta tag coverage',
        hEntitiesDetected: 'Entities detected',
        hEntityRelationship: 'Entity relationship assessment',
        hMissingSchemasByType: 'Missing schemas by page type',
        hMissingMetaSummary: 'Missing meta tags summary',
        hWordCountDist: 'Word count distribution',
        hThinContent: 'Thin content pages (< 300 words)',
        hAiChecklist: 'AI answerability checklist',
        hOrphanPages: 'Orphan pages',
        hPriorityPages: 'Priority pages to validate',
        hTechChecklist: 'Technical checklist',
        thSummary: ['Metric', 'Count', 'Coverage'],
        thPageType: ['URL', 'Type', 'Indexable', 'Canonical', 'Schema Types', 'Issues'],
        thCoverage: ['Page Type', 'Pages', 'Has Schema', 'Schema Types', 'Missing'],
        thMetaCheck: ['Check', 'Pass', 'Fail', 'Coverage'],
        thLinking: ['Metric', 'Value'],
        thRoadmap: ['Task', 'Priority', 'Impact', 'Effort'],
        thPdf: ['URL', 'Status'],
        thSitemap: ['Sitemap', 'Reachable', 'Well-formed', 'URLs', 'Lastmod issues'],
        rowUniquePages: 'Unique pages analyzed',
        rowCritical: '🔴 Pages with critical issues',
        rowMissingDesc: 'Missing meta description',
        rowMissingSchema: 'Missing JSON-LD schema',
        rowNoCanonical: 'No canonical URL',
        rowOrphans: 'Orphan pages (0 internal links)',
        rowNotIndexable: 'Not indexable',
        rowThin: 'Thin content (< 300 words)',
        fNoJsonLd: n =>
            `- ⚠️ **${n} pages** have no JSON-LD — machine readability is severely limited`,
        fAllJsonLd: '- ✅ All pages have some JSON-LD structured data',
        fNoOrg: '- 🔴 **No Organization schema** — AI systems and search engines cannot reliably identify the business entity',
        fOrgDefined: '- ✅ Organization entity defined',
        fMissingDesc: n =>
            `- ⚠️ **${n} pages** missing meta descriptions — poor CTR in search results`,
        fAllDesc: '- ✅ All pages have meta descriptions',
        fNoCanonical: n => `- ⚠️ **${n} pages** lack canonical tags — duplicate content risk`,
        fAllCanonical: '- ✅ All pages have canonical tags',
        fOrphans: n => `- ⚠️ **${n} pages** have zero internal links — invisible to crawlers`,
        fNoOrphans: '- ✅ No orphan pages detected',
        fNotIndexable: n =>
            `- 🔴 **${n} pages** not indexable — verify robots meta and HTTP status`,
        fAllIndexable: '- ✅ All pages are indexable',
        lblDomain: 'Domain',
        lblCrawlDatesIncluded: 'Crawl dates included',
        lblDedup:
            'Deduplication: latest crawl date per URL used when same page appears in multiple dates',
        lblTotalPages: 'Total unique pages analyzed',
        lblPageTypesFound: 'Page types found',
        noJsonLdAnyPage: '⚠️ No JSON-LD structured data found on any page',
        pagesWord: 'pages',
        missingWord: 'Missing',
        mcTitlePresent: 'Title present',
        mcTitleLen: 'Title ≤ 63 chars',
        mcMetaDesc: 'Meta description',
        mcDescLen: 'Description ≤ 163 chars',
        mcCanonical: 'Canonical tag',
        mcHreflang: 'Hreflang',
        eNoEntities: '⚠️ No structured entities found',
        eOrgYes: '✅ **Organization** entity defined',
        eOrgNo: '🔴 **Organization** missing — AI systems cannot identify the business',
        eWebsiteYes: '✅ **WebSite** schema present',
        eWebsiteNo: '⚠️ **WebSite** missing — add WebSite with SearchAction',
        eBreadcrumbYes: '✅ **BreadcrumbList** present — site hierarchy defined',
        eBreadcrumbNo: '⚠️ **BreadcrumbList** missing — no hierarchy signal for search engines',
        eLocalBizYes: '✅ **LocalBusiness** found — local SEO supported',
        eLocalBizNo: '⚠️ **LocalBusiness** missing — critical for local discoverability',
        eArticleYes: n => `✅ **Article/BlogPosting** found on ${n} pages`,
        gapMissing: 'Missing',
        gapExpectedPresent: '✅ Expected schemas present',
        gapOrganization: '`Organization` — defines the business entity globally',
        gapWebsite: '`WebSite` — enables sitelinks search box',
        gapBreadcrumb: '`BreadcrumbList` — hierarchy signal',
        gapArticle: '`Article`/`BlogPosting` — required for Google rich results',
        gapLocalBusiness: '`LocalBusiness` — critical for Google Maps and local SEO',
        gapService: '`Service` — improves entity clarity for AI systems',
        gapFaq: '`FAQPage` — enables FAQ rich results',
        missingMetaLine: (tag, n, coverage) => `- **${tag}**: missing on ${n} pages (${coverage})`,
        noMissingMeta: '✅ No missing critical meta tags',
        wordBinLine: (range, count) => `- **${range} words**: ${count} pages`,
        noThin: '✅ No thin content pages detected',
        thinLine: (url, words) => `- ${url} — **${words} words**`,
        aiBizIdentity: 'Business identity clear (Organization schema)',
        aiWebsiteEntity: 'Website entity defined',
        aiServices: 'Services machine-readable (Service schema)',
        aiLocation: 'Location data structured (LocalBusiness schema)',
        aiContentDepth: 'Content depth adequate (≥300 words on 70%+ of pages)',
        ilAvg: 'Average internal links / page',
        ilOrphans: 'Orphan pages (0 internal links)',
        ilMax: 'Max internal links on one page',
        ilMin: 'Min (excluding orphans)',
        noOrphanPages: '✅ No orphan pages',
        blNone: '✅ No broken links detected (all crawled pages returned HTTP 200)',
        blFound: n =>
            `Found **${n} broken link(s)** — pages with non-200 HTTP status that are still linked from other pages.`,
        blLinkedFrom: src => `  - linked from: [${src}](${src})`,
        blSourceUnknown: '  - source page unknown (not linked from any crawled page)',
        blHttpStatus: 'HTTP status',
        blLinkedFromCount: n => `Linked from ${n} page(s):`,
        vpRichResults: '**Google Rich Results Test:** https://search.google.com/test/rich-results',
        vpSchemaValidator: '**Schema.org Validator:** https://validator.schema.org/',
        vpSearchConsole: '**Google Search Console** → URL Inspection for rendering checks',
        chkCanonicalSitemap: 'Canonical URLs match sitemap entries',
        chkNoDupSchema: 'No duplicate schema blocks (e.g., multiple Organization definitions)',
        chkRobots: 'robots.txt does not block key page templates',
        chkJsonLdRenders: 'JSON-LD renders correctly in page source (not JS-only)',
        robotsNotFound: '_robots.txt could not be fetched or is empty — treating as unrestricted._',
        robotsSitemapsFound: n => `robots.txt lists ${n} sitemap directive(s).`,
        robotsNoSitemapDirective:
            '_robots.txt has no Sitemap: directive — falling back to /sitemap.xml._',
        noSitemapIssues: '_No sitemap validation issues found._',
        noPdf: '_No PDF files detected._',
        pdfFound: n => `Found **${n} PDF file(s)**:`,
        footer: '*Generated by metadata-crawler SEO audit script — https://github.com/siva01c/seo-tools*',
        pageType: {
            Homepage: 'Homepage',
            Article: 'Article',
            Service: 'Service',
            'Branch/Contact': 'Branch/Contact',
            FAQ: 'FAQ',
            About: 'About',
            Generic: 'Generic',
        },
        issueCellCritical: n => `🔴 ${n} critical`,
        issueCellWarn: n => `🟡 ${n} warn`,
        levHigh: 'High',
        levMedium: 'Medium',
        levLow: 'Low',
        issNotIndexable: 'Page is not indexable (noindex or non-200)',
        issNoTitle: 'Missing <title> tag',
        issTitleLong: len => `Title too long (${len} chars, max 63)`,
        issNoDesc: 'Missing meta description',
        issDescLong: len => `Description too long (${len} chars, max 163)`,
        issNoCanonical: 'No canonical URL defined',
        issNoOgTitle: 'Missing og:title',
        issNoOgDesc: 'Missing og:description',
        issNoOgImage: 'Missing og:image',
        issNoTwitter: 'Missing twitter:card',
        issNoJsonLd: 'No JSON-LD structured data',
        issThin: words => `Thin content (${words} words, min 300)`,
        issNoInternal: 'No internal links (orphan page risk)',
        issNoViewport: 'Missing viewport meta tag (not mobile-friendly)',
        issInvalidViewport:
            'Viewport meta tag present but not responsive (missing width=device-width)',
        issNotHttps: 'Page served over plain HTTP, not HTTPS',
        issNoHsts: 'Missing Strict-Transport-Security header',
        issNoXContentTypeOptions: 'Missing X-Content-Type-Options header',
        issNoCsp: 'Missing Content-Security-Policy header',
        issMixedContent: 'Mixed content: HTTP resources loaded on an HTTPS page',
        issMultipleH1: count => `Multiple H1 tags found (${count})`,
        issNoH1: 'Missing H1 tag',
        issSkippedHeadingLevel: (from, to) => `Skipped heading level: H${from} followed by H${to}`,
        issImageMissingAlt: (count, total) => `${count} of ${total} images missing alt text`,
        issDuplicateTitle: 'Title duplicated on another page',
        issDuplicateDescription: 'Meta description duplicated on another page',
        issRedirectChain: hops => `Redirect chain of ${hops} hops before reaching this page`,
        todoAffectedPages: 'Affected pages:',
        todoAddSchema: n => `Add JSON-LD structured data to ${n} pages without schema`,
        todoAddOrg: 'Add global Organization schema to all pages',
        todoAddOrgBody:
            'Add `Organization` JSON-LD to the global site `<head>`. Include: `name`, `url`, `logo`, `contactPoint`, `sameAs`.',
        todoAddWebsite: 'Add WebSite schema with SearchAction',
        todoAddWebsiteBody:
            'Add `WebSite` JSON-LD globally. Include `SearchAction` if site search is available.',
        todoAddBreadcrumb: 'Add BreadcrumbList schema sitewide',
        todoAddBreadcrumbBody:
            'Generate breadcrumb schema from navigation hierarchy on all non-homepage pages.',
        todoWriteDesc: n => `Write meta descriptions for ${n} pages`,
        todoWriteDescBody: 'Keep descriptions 120–163 characters.',
        todoAddCanonical: n => `Add canonical URL tags to ${n} pages`,
        todoFixOrphans: n => `Fix ${n} orphan pages with no internal links`,
        todoFixOrphansBody: 'Link these pages from relevant hub/index pages.',
        todoEnrichThin: n => `Enrich thin-content pages (< 300 words) — ${n} pages`,
        todoEnrichThinBody: 'Add explicit service definitions, scope, audience, and FAQ sections.',
        todoWordsSuffix: 'words',
        todoAddLocalBiz: 'Add LocalBusiness schema to branch/contact pages',
        todoAddLocalBizBody:
            'Required fields: `name`, `address` (PostalAddress), `geo`, `telephone`, `openingHours`, `parentOrganization`.',
        todoValidate: 'Validate all JSON-LD via Google Rich Results Test',
        todoValidateBody:
            '**Tool:** https://search.google.com/test/rich-results\n\n**Priority pages to check:**',
        todoVerifyCanonical: 'Verify canonical/sitemap consistency',
        todoVerifyCanonicalBody:
            'Confirm all canonical URLs are included in sitemap.xml. Check for canonical loops and mismatches.',
        roadmapFixBroken: n => `Fix ${n} broken links (non-200 pages)`,
    },
    seoIssues: {
        csvMetaDesc: ['url', 'title', 'issue', 'value', 'length', 'pixel_width', 'duplicate_urls'],
        csvTitle: ['url', 'issue', 'value', 'length', 'pixel_width', 'duplicate_urls'],
        csvH1: ['url', 'title', 'issue', 'h1_values', 'duplicate_urls'],
        csvOrphan: ['url', 'title', 'timestamp'],
        csvJsonLd: ['url', 'title', 'issue', 'types_found'],
        csvOgComplete: ['url', 'title', 'present', 'missing'],
        csvTwitterCard: ['url', 'title'],
        csvRedirectClass: ['url', 'redirects_to', 'category'],
        csvRedirect3xx: ['url', 'status', 'redirects_to'],
        sumHeader: '📊 Summary',
        sumMetaDesc: 'Meta description issues',
        sumTitle: 'Title issues',
        sumH1: 'H1 issues',
        sumOrphan: 'Orphaned pages',
        sumJsonLd: 'JSON-LD issues',
        sumOgComplete: 'Open Graph incomplete',
        sumTwitterCard: 'Twitter Card missing',
        sumRedirect3xx: '3xx redirects',
        sumRedirectClass: 'Redirect classification',
        sumWritten: 'Reports written to',
    },
    report404: {
        csvHeader: [
            'target',
            'status',
            'timestamp',
            'discovery_source',
            'ref_page',
            'ref_title',
            'link_text',
            'crawl_date',
        ],
        discLinkedFrom: 'linked_from_page',
        discSeeded: 'seeded_or_sitemap',
    },
    linkGraphIssues: {
        csvBrokenLink: ['source_url', 'source_title', 'target_url', 'target_status', 'link_text'],
        csvOrphanRedirect: ['url', 'status'],
        csvSingleDofollow: [
            'url',
            'dofollow_referrer_url',
            'dofollow_referrer_title',
            'link_text',
            'total_incoming_links',
        ],
        sumHeader: '📊 Summary',
        sumBrokenLink: 'Pages linking to broken pages',
        sumOrphanRedirect: 'Redirected pages with no incoming internal links',
        sumSingleDofollow: 'Pages with only one dofollow incoming internal link',
        sumWritten: 'Reports written to',
    },
    sitemapIssues: {
        csvMultiSitemap: ['url', 'sitemaps'],
        sumHeader: '📊 Summary',
        sumMultiSitemap: 'Pages in multiple sitemaps',
        sumWritten: 'Reports written to',
    },
    titleDescriptionFixes: {
        csvHeader: [
            'url',
            'issues',
            'current_title',
            'recommended_title',
            'recommended_title_length',
            'recommended_title_pixel_width',
            'current_description',
            'recommended_description',
            'recommended_description_length',
            'recommended_description_pixel_width',
        ],
        sumHeader: '📊 Summary',
        sumGenerated: 'Fixes generated',
        sumWritten: 'Reports written to',
    },
};

// ── Czech ────────────────────────────────────────────────────────────────────

const cs: IMessages = {
    seoAudit: {
        reportTitle: 'SEO audit',
        metaCrawlDates: 'Analyzované dny crawlu',
        metaGenerated: 'Vygenerováno',
        metaUniquePages: 'Počet unikátních stránek',
        sExecSummary: 'Manažerské shrnutí',
        sScope: 'Rozsah auditu',
        sPageTypeInventory: 'Inventář typů stránek',
        sStructuredData: 'Inventář strukturovaných dat',
        sTechnicalSeo: 'Technické SEO',
        sEntityModel: 'Analýza entitního modelu',
        sGapAnalysis: 'Analýza nedostatků',
        sContentAi: 'Obsah a čitelnost pro AI',
        sInternalLinking: 'Interní prolinkování',
        sBrokenLinks: 'Nefunkční odkazy',
        sValidationPlan: 'Plán validace',
        sRoadmap: 'Prioritizovaný plán implementace',
        sTodoBacklog: 'Backlog úkolů pro vývojáře',
        sSitemapRobots: 'Validace sitemap a robots.txt',
        sPdfFiles: 'PDF soubory',
        sFullIssueList: 'Úplný seznam problémů po stránkách',
        hKeyFindings: 'Klíčová zjištění',
        hSchemaTypesFound: 'Typy schémat nalezené na webu',
        hCoverageByType: 'Pokrytí podle typu stránky',
        hMetaTagCoverage: 'Pokrytí meta tagů',
        hEntitiesDetected: 'Zjištěné entity',
        hEntityRelationship: 'Posouzení vztahů mezi entitami',
        hMissingSchemasByType: 'Chybějící schémata podle typu stránky',
        hMissingMetaSummary: 'Souhrn chybějících meta tagů',
        hWordCountDist: 'Rozložení počtu slov',
        hThinContent: 'Stránky s tenkým obsahem (< 300 slov)',
        hAiChecklist: 'Kontrolní seznam pro odpovědi AI',
        hOrphanPages: 'Osamocené stránky',
        hPriorityPages: 'Prioritní stránky k validaci',
        hTechChecklist: 'Technický kontrolní seznam',
        thSummary: ['Metrika', 'Počet', 'Pokrytí'],
        thPageType: ['URL', 'Typ', 'Indexovatelná', 'Kanonická', 'Typy schémat', 'Problémy'],
        thCoverage: ['Typ stránky', 'Stránek', 'Má schéma', 'Typy schémat', 'Chybí'],
        thMetaCheck: ['Kontrola', 'Splněno', 'Nesplněno', 'Pokrytí'],
        thLinking: ['Metrika', 'Hodnota'],
        thRoadmap: ['Úkol', 'Priorita', 'Dopad', 'Náročnost'],
        thPdf: ['URL', 'Stav'],
        thSitemap: ['Sitemap', 'Dostupná', 'Validní XML', 'URL', 'Problémy s lastmod'],
        rowUniquePages: 'Počet unikátních stránek',
        rowCritical: '🔴 Stránky s kritickými problémy',
        rowMissingDesc: 'Chybí meta popis',
        rowMissingSchema: 'Chybí JSON-LD schéma',
        rowNoCanonical: 'Chybí kanonická URL',
        rowOrphans: 'Osamocené stránky (0 interních odkazů)',
        rowNotIndexable: 'Neindexovatelné',
        rowThin: 'Tenký obsah (< 300 slov)',
        fNoJsonLd: n =>
            `- ⚠️ **${n} stránek** nemá JSON-LD — strojová čitelnost je výrazně omezená`,
        fAllJsonLd: '- ✅ Všechny stránky mají nějaká strukturovaná data JSON-LD',
        fNoOrg: '- 🔴 **Chybí schéma Organization** — AI systémy ani vyhledávače nedokážou spolehlivě identifikovat firemní entitu',
        fOrgDefined: '- ✅ Entita Organization je definována',
        fMissingDesc: n =>
            `- ⚠️ **${n} stránkám** chybí meta popis — nízký CTR ve výsledcích vyhledávání`,
        fAllDesc: '- ✅ Všechny stránky mají meta popis',
        fNoCanonical: n =>
            `- ⚠️ **${n} stránkám** chybí kanonické tagy — riziko duplicitního obsahu`,
        fAllCanonical: '- ✅ Všechny stránky mají kanonické tagy',
        fOrphans: n => `- ⚠️ **${n} stránek** nemá žádné interní odkazy — neviditelné pro roboty`,
        fNoOrphans: '- ✅ Nebyly nalezeny žádné osamocené stránky',
        fNotIndexable: n =>
            `- 🔴 **${n} stránek** není indexovatelných — zkontrolujte robots meta a HTTP stav`,
        fAllIndexable: '- ✅ Všechny stránky jsou indexovatelné',
        lblDomain: 'Doména',
        lblCrawlDatesIncluded: 'Zahrnuté dny crawlu',
        lblDedup: 'Deduplikace: při výskytu téže stránky ve více dnech se použije nejnovější crawl',
        lblTotalPages: 'Celkem unikátních analyzovaných stránek',
        lblPageTypesFound: 'Nalezené typy stránek',
        noJsonLdAnyPage: '⚠️ Na žádné stránce nebyla nalezena strukturovaná data JSON-LD',
        pagesWord: 'stránek',
        missingWord: 'Chybí',
        mcTitlePresent: 'Title je přítomen',
        mcTitleLen: 'Title ≤ 63 znaků',
        mcMetaDesc: 'Meta popis',
        mcDescLen: 'Popis ≤ 163 znaků',
        mcCanonical: 'Kanonický tag',
        mcHreflang: 'Hreflang',
        eNoEntities: '⚠️ Nebyly nalezeny žádné strukturované entity',
        eOrgYes: '✅ Entita **Organization** je definována',
        eOrgNo: '🔴 **Organization** chybí — AI systémy nedokážou identifikovat firmu',
        eWebsiteYes: '✅ Schéma **WebSite** je přítomno',
        eWebsiteNo: '⚠️ **WebSite** chybí — přidejte WebSite se SearchAction',
        eBreadcrumbYes: '✅ **BreadcrumbList** je přítomen — hierarchie webu je definována',
        eBreadcrumbNo: '⚠️ **BreadcrumbList** chybí — žádný signál hierarchie pro vyhledávače',
        eLocalBizYes: '✅ **LocalBusiness** nalezen — lokální SEO je podporováno',
        eLocalBizNo: '⚠️ **LocalBusiness** chybí — klíčové pro lokální vyhledatelnost',
        eArticleYes: n => `✅ **Article/BlogPosting** nalezen na ${n} stránkách`,
        gapMissing: 'Chybí',
        gapExpectedPresent: '✅ Očekávaná schémata jsou přítomna',
        gapOrganization: '`Organization` — globálně definuje firemní entitu',
        gapWebsite: '`WebSite` — umožňuje vyhledávací pole v sitelinks',
        gapBreadcrumb: '`BreadcrumbList` — signál hierarchie',
        gapArticle: '`Article`/`BlogPosting` — nutné pro Google rich results',
        gapLocalBusiness: '`LocalBusiness` — klíčové pro Mapy Google a lokální SEO',
        gapService: '`Service` — zpřesňuje entitu pro AI systémy',
        gapFaq: '`FAQPage` — umožňuje FAQ rich results',
        missingMetaLine: (tag, n, coverage) =>
            `- **${tag}**: chybí na ${n} stránkách (${coverage})`,
        noMissingMeta: '✅ Nechybí žádné kritické meta tagy',
        wordBinLine: (range, count) => `- **${range} slov**: ${count} stránek`,
        noThin: '✅ Nebyly nalezeny stránky s tenkým obsahem',
        thinLine: (url, words) => `- ${url} — **${words} slov**`,
        aiBizIdentity: 'Identita firmy je jasná (schéma Organization)',
        aiWebsiteEntity: 'Entita webu je definována',
        aiServices: 'Služby jsou strojově čitelné (schéma Service)',
        aiLocation: 'Lokační data jsou strukturovaná (schéma LocalBusiness)',
        aiContentDepth: 'Dostatečná hloubka obsahu (≥300 slov na 70 %+ stránek)',
        ilAvg: 'Průměr interních odkazů / stránku',
        ilOrphans: 'Osamocené stránky (0 interních odkazů)',
        ilMax: 'Max. interních odkazů na jedné stránce',
        ilMin: 'Min. (mimo osamocené)',
        noOrphanPages: '✅ Žádné osamocené stránky',
        blNone: '✅ Nebyly zjištěny nefunkční odkazy (všechny stránky vrátily HTTP 200)',
        blFound: n =>
            `Nalezeno **${n} nefunkčních odkazů** — stránky s jiným než 200 HTTP stavem, na které stále vedou odkazy z jiných stránek.`,
        blLinkedFrom: src => `  - odkazováno z: [${src}](${src})`,
        blSourceUnknown: '  - zdrojová stránka neznámá (neodkazováno z žádné procházené stránky)',
        blHttpStatus: 'HTTP stav',
        blLinkedFromCount: n => `Odkazováno z ${n} stránek:`,
        vpRichResults: '**Google Rich Results Test:** https://search.google.com/test/rich-results',
        vpSchemaValidator: '**Validátor Schema.org:** https://validator.schema.org/',
        vpSearchConsole: '**Google Search Console** → kontrola vykreslení přes URL Inspection',
        chkCanonicalSitemap: 'Kanonické URL odpovídají záznamům v sitemap',
        chkNoDupSchema: 'Žádné duplicitní bloky schémat (např. více definic Organization)',
        chkRobots: 'robots.txt neblokuje klíčové šablony stránek',
        chkJsonLdRenders: 'JSON-LD se správně vykresluje ve zdroji stránky (ne jen přes JS)',
        robotsNotFound:
            '_robots.txt se nepodařilo načíst nebo je prázdný — považováno za neomezené._',
        robotsSitemapsFound: n => `robots.txt uvádí ${n} direktiv(u) Sitemap.`,
        robotsNoSitemapDirective:
            '_robots.txt neobsahuje direktivu Sitemap: — použije se výchozí /sitemap.xml._',
        noSitemapIssues: '_Nebyly nalezeny žádné problémy s validací sitemap._',
        noPdf: '_Žádné PDF soubory nebyly nalezeny._',
        pdfFound: n => `Nalezeno **${n} PDF souborů**:`,
        footer: '*Vygenerováno skriptem SEO auditu metadata-crawler — https://github.com/siva01c/seo-tools*',
        pageType: {
            Homepage: 'Domovská stránka',
            Article: 'Článek',
            Service: 'Služba',
            'Branch/Contact': 'Pobočka/Kontakt',
            FAQ: 'FAQ',
            About: 'O nás',
            Generic: 'Obecná',
        },
        issueCellCritical: n => `🔴 ${n} kritických`,
        issueCellWarn: n => `🟡 ${n} varování`,
        levHigh: 'Vysoká',
        levMedium: 'Střední',
        levLow: 'Nízká',
        issNotIndexable: 'Stránka není indexovatelná (noindex nebo jiný stav než 200)',
        issNoTitle: 'Chybí tag <title>',
        issTitleLong: len => `Title je příliš dlouhý (${len} znaků, max 63)`,
        issNoDesc: 'Chybí meta popis',
        issDescLong: len => `Popis je příliš dlouhý (${len} znaků, max 163)`,
        issNoCanonical: 'Není definována kanonická URL',
        issNoOgTitle: 'Chybí og:title',
        issNoOgDesc: 'Chybí og:description',
        issNoOgImage: 'Chybí og:image',
        issNoTwitter: 'Chybí twitter:card',
        issNoJsonLd: 'Žádná strukturovaná data JSON-LD',
        issThin: words => `Tenký obsah (${words} slov, min 300)`,
        issNoInternal: 'Žádné interní odkazy (riziko osamocené stránky)',
        issNoViewport: 'Chybí meta tag viewport (stránka není optimalizovaná pro mobily)',
        issInvalidViewport:
            'Meta tag viewport je přítomen, ale není responzivní (chybí width=device-width)',
        issNotHttps: 'Stránka je servírována přes obyčejné HTTP, ne HTTPS',
        issNoHsts: 'Chybí hlavička Strict-Transport-Security',
        issNoXContentTypeOptions: 'Chybí hlavička X-Content-Type-Options',
        issNoCsp: 'Chybí hlavička Content-Security-Policy',
        issMixedContent: 'Smíšený obsah: HTTP zdroje načítané na HTTPS stránce',
        issMultipleH1: count => `Nalezeno více tagů H1 (${count})`,
        issNoH1: 'Chybí tag H1',
        issSkippedHeadingLevel: (from, to) =>
            `Přeskočená úroveň nadpisu: H${from} následuje H${to}`,
        issImageMissingAlt: (count, total) => `${count} z ${total} obrázků bez alt textu`,
        issDuplicateTitle: 'Title je duplicitní s jinou stránkou',
        issDuplicateDescription: 'Meta popis je duplicitní s jinou stránkou',
        issRedirectChain: hops => `Řetězec ${hops} přesměrování před dosažením této stránky`,
        todoAffectedPages: 'Dotčené stránky:',
        todoAddSchema: n => `Přidat strukturovaná data JSON-LD na ${n} stránek bez schématu`,
        todoAddOrg: 'Přidat globální schéma Organization na všechny stránky',
        todoAddOrgBody:
            'Přidejte JSON-LD `Organization` do globální `<head>` webu. Uveďte: `name`, `url`, `logo`, `contactPoint`, `sameAs`.',
        todoAddWebsite: 'Přidat schéma WebSite se SearchAction',
        todoAddWebsiteBody:
            'Přidejte globálně JSON-LD `WebSite`. Pokud je k dispozici vyhledávání, uveďte `SearchAction`.',
        todoAddBreadcrumb: 'Přidat schéma BreadcrumbList na celý web',
        todoAddBreadcrumbBody:
            'Vygenerujte schéma drobečkové navigace z hierarchie navigace na všech stránkách kromě domovské.',
        todoWriteDesc: n => `Napsat meta popisy pro ${n} stránek`,
        todoWriteDescBody: 'Délku popisů udržujte 120–163 znaků.',
        todoAddCanonical: n => `Přidat kanonické URL tagy na ${n} stránek`,
        todoFixOrphans: n => `Opravit ${n} osamocených stránek bez interních odkazů`,
        todoFixOrphansBody:
            'Odkažte tyto stránky z relevantních rozcestníkových/přehledových stránek.',
        todoEnrichThin: n => `Obohatit stránky s tenkým obsahem (< 300 slov) — ${n} stránek`,
        todoEnrichThinBody:
            'Doplňte explicitní definice služeb, rozsah, cílovou skupinu a sekce FAQ.',
        todoWordsSuffix: 'slov',
        todoAddLocalBiz: 'Přidat schéma LocalBusiness na stránky poboček/kontaktů',
        todoAddLocalBizBody:
            'Povinná pole: `name`, `address` (PostalAddress), `geo`, `telephone`, `openingHours`, `parentOrganization`.',
        todoValidate: 'Ověřit veškeré JSON-LD přes Google Rich Results Test',
        todoValidateBody:
            '**Nástroj:** https://search.google.com/test/rich-results\n\n**Prioritní stránky ke kontrole:**',
        todoVerifyCanonical: 'Ověřit konzistenci kanonických URL a sitemap',
        todoVerifyCanonicalBody:
            'Ověřte, že všechny kanonické URL jsou obsaženy v sitemap.xml. Zkontrolujte smyčky a nesoulady kanonických URL.',
        roadmapFixBroken: n => `Opravit ${n} nefunkčních odkazů (stránky bez stavu 200)`,
    },
    seoIssues: {
        csvMetaDesc: [
            'url',
            'titulek',
            'problem',
            'hodnota',
            'delka',
            'sirka_px',
            'duplicitni_url',
        ],
        csvTitle: ['url', 'problem', 'hodnota', 'delka', 'sirka_px', 'duplicitni_url'],
        csvH1: ['url', 'titulek', 'problem', 'h1_hodnoty', 'duplicitni_url'],
        csvOrphan: ['url', 'titulek', 'casova_znacka'],
        csvJsonLd: ['url', 'titulek', 'problem', 'nalezene_typy'],
        csvOgComplete: ['url', 'titulek', 'pritomne', 'chybejici'],
        csvTwitterCard: ['url', 'titulek'],
        csvRedirectClass: ['url', 'presmerovano_na', 'kategorie'],
        csvRedirect3xx: ['url', 'stav', 'presmerovano_na'],
        sumHeader: '📊 Souhrn',
        sumMetaDesc: 'Problémy s meta popisem',
        sumTitle: 'Problémy s titulkem',
        sumH1: 'Problémy s H1',
        sumOrphan: 'Osamocené stránky',
        sumJsonLd: 'Problémy s JSON-LD',
        sumOgComplete: 'Neúplné Open Graph značky',
        sumTwitterCard: 'Chybějící Twitter Card',
        sumRedirectClass: 'Klasifikace přesměrování',
        sumRedirect3xx: 'Přesměrování 3xx',
        sumWritten: 'Reporty zapsány do',
    },
    report404: {
        csvHeader: [
            'cil',
            'stav',
            'casova_znacka',
            'zdroj_objeveni',
            'odkazujici_stranka',
            'titulek_odkazujici',
            'text_odkazu',
            'datum_crawlu',
        ],
        discLinkedFrom: 'linked_from_page',
        discSeeded: 'seeded_or_sitemap',
    },
    linkGraphIssues: {
        csvBrokenLink: [
            'zdrojova_url',
            'zdrojovy_titulek',
            'cilova_url',
            'cilovy_stav',
            'text_odkazu',
        ],
        csvOrphanRedirect: ['url', 'stav'],
        csvSingleDofollow: [
            'url',
            'dofollow_odkazujici_url',
            'dofollow_odkazujici_titulek',
            'text_odkazu',
            'celkem_prichozich_odkazu',
        ],
        sumHeader: '📊 Souhrn',
        sumBrokenLink: 'Stránky odkazující na nefunkční stránky',
        sumOrphanRedirect: 'Přesměrované stránky bez příchozích interních odkazů',
        sumSingleDofollow: 'Stránky s pouze jedním dofollow příchozím interním odkazem',
        sumWritten: 'Reporty zapsány do',
    },
    sitemapIssues: {
        csvMultiSitemap: ['url', 'sitemapy'],
        sumHeader: '📊 Souhrn',
        sumMultiSitemap: 'Stránky ve více sitemapách',
        sumWritten: 'Reporty zapsány do',
    },
    titleDescriptionFixes: {
        csvHeader: [
            'url',
            'problemy',
            'soucasny_titulek',
            'doporuceny_titulek',
            'doporuceny_titulek_delka',
            'doporuceny_titulek_sirka_px',
            'soucasny_popis',
            'doporuceny_popis',
            'doporuceny_popis_delka',
            'doporuceny_popis_sirka_px',
        ],
        sumHeader: '📊 Souhrn',
        sumGenerated: 'Vygenerováno oprav',
        sumWritten: 'Reporty zapsány do',
    },
};

export const messages: Record<Lang, IMessages> = { en, cs };
