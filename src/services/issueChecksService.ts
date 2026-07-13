import { ILinkRef } from './linkGraphService.js';

type Link = { href?: string; text?: string; rel?: string };
type Page = {
    url: string;
    title?: string;
    response?: { status?: number; url?: string };
    seo?: { metaTags?: Record<string, string> };
    links?: { internal?: Link[]; external?: Link[] };
};

// ── Page has links to broken page ───────────────────────────────────────────

export interface IBrokenInternalLinkIssue {
    sourceUrl: string;
    sourceTitle?: string;
    targetUrl: string;
    targetStatus: number;
    linkText?: string;
}

/** Cross-references each page's own outgoing internal links against the crawl's own
 * status-code map. Purely static — does not re-probe links over HTTP. */
export const findPagesLinkingToBrokenPages = (pages: Page[]): IBrokenInternalLinkIssue[] => {
    const statusByUrl = new Map<string, number>();
    for (const page of pages) {
        if (typeof page.response?.status === 'number') {
            statusByUrl.set(page.url, page.response.status);
        }
    }

    const issues: IBrokenInternalLinkIssue[] = [];
    for (const page of pages) {
        for (const link of page.links?.internal ?? []) {
            if (!link.href) continue;
            const targetStatus = statusByUrl.get(link.href);
            if (targetStatus !== undefined && targetStatus >= 400) {
                issues.push({
                    sourceUrl: page.url,
                    sourceTitle: page.title,
                    targetUrl: link.href,
                    targetStatus,
                    linkText: link.text,
                });
            }
        }
    }
    return issues;
};

// ── Redirected page has no incoming internal links ──────────────────────────

export interface IOrphanedRedirectIssue {
    url: string;
    status: number;
}

export const findRedirectsWithNoIncomingLinks = (
    pages: Page[],
    refGraph: Map<string, ILinkRef[]>
): IOrphanedRedirectIssue[] => {
    const issues: IOrphanedRedirectIssue[] = [];
    for (const page of pages) {
        const status = page.response?.status;
        if (typeof status !== 'number' || status < 300 || status >= 400) continue;

        const refs = (refGraph.get(page.url) ?? []).filter(r => r.pageUrl !== page.url);
        if (refs.length === 0) {
            issues.push({ url: page.url, status });
        }
    }
    return issues;
};

// ── Page has only one dofollow incoming internal link ───────────────────────

export interface ISingleDofollowLinkIssue {
    url: string;
    dofollowReferrer: { pageUrl: string; pageTitle?: string; linkText?: string };
    totalIncomingLinks: number;
}

export const findPagesWithSingleDofollowIncomingLink = (
    pages: Page[],
    refGraph: Map<string, ILinkRef[]>
): ISingleDofollowLinkIssue[] => {
    const issues: ISingleDofollowLinkIssue[] = [];
    for (const [url, refs] of refGraph.entries()) {
        const nonSelfRefs = refs.filter(r => r.pageUrl !== url);
        const dofollowRefs = nonSelfRefs.filter(r => r.isDofollow);
        if (dofollowRefs.length === 1) {
            const ref = dofollowRefs[0];
            issues.push({
                url,
                dofollowReferrer: {
                    pageUrl: ref.pageUrl,
                    pageTitle: ref.pageTitle,
                    linkText: ref.linkText,
                },
                totalIncomingLinks: nonSelfRefs.length,
            });
        }
    }
    // Only report targets that were actually crawled as pages (keeps output focused on
    // on-site pages rather than every internal href ever referenced).
    const crawledUrls = new Set(pages.map(p => p.url));
    return issues.filter(i => crawledUrls.has(i.url));
};

// ── Open Graph tags incomplete ───────────────────────────────────────────────

export const OG_REQUIRED_FIELDS = ['og:title', 'og:description', 'og:image', 'og:url'] as const;

export interface IOgIncompleteIssue {
    url: string;
    title?: string;
    present: string[];
    missing: string[];
}

/** Flags pages with a partial Open Graph implementation: at least one of the required OG
 * fields present, but not all of them. Pages with zero OG tags are not "incomplete" — that's a
 * separate, already-covered "no OG tags at all" condition. */
export const findIncompleteOpenGraph = (pages: Page[]): IOgIncompleteIssue[] => {
    const issues: IOgIncompleteIssue[] = [];
    for (const page of pages) {
        const meta = page.seo?.metaTags ?? {};
        const present = OG_REQUIRED_FIELDS.filter(f => !!meta[f]);
        if (present.length > 0 && present.length < OG_REQUIRED_FIELDS.length) {
            issues.push({
                url: page.url,
                title: page.title,
                present,
                missing: OG_REQUIRED_FIELDS.filter(f => !present.includes(f)),
            });
        }
    }
    return issues;
};

// ── X (Twitter) card missing ─────────────────────────────────────────────────

export interface ITwitterCardMissingIssue {
    url: string;
    title?: string;
}

export const findMissingTwitterCard = (pages: Page[]): ITwitterCardMissingIssue[] =>
    pages
        .filter(page => !page.seo?.metaTags?.['twitter:card'])
        .map(page => ({ url: page.url, title: page.title }));

// ── Page in multiple sitemaps ────────────────────────────────────────────────

export interface IMultiSitemapIssue {
    url: string;
    sitemaps: string[];
}

export const findUrlsInMultipleSitemaps = (
    sitemapUrlMap: Map<string, string[]>
): IMultiSitemapIssue[] =>
    [...sitemapUrlMap.entries()]
        .filter(([, sitemaps]) => sitemaps.length > 1)
        .map(([url, sitemaps]) => ({ url, sitemaps }));

// ── HTTP -> HTTPS redirect classification ────────────────────────────────────

export type RedirectCategory = 'https_upgrade' | 'other';

export interface IHttpsRedirectIssue {
    url: string;
    redirectsTo?: string;
    category: RedirectCategory;
}

const hostnameOf = (url: string): string | undefined => {
    try {
        return new URL(url).hostname;
    } catch {
        return undefined;
    }
};

export const classifyRedirects = (pages: Page[]): IHttpsRedirectIssue[] => {
    const issues: IHttpsRedirectIssue[] = [];
    for (const page of pages) {
        const status = page.response?.status;
        if (typeof status !== 'number' || status < 300 || status >= 400) continue;

        const redirectsTo = page.response?.url;
        const isHttpToHttps =
            page.url.startsWith('http://') &&
            !!redirectsTo &&
            redirectsTo.startsWith('https://') &&
            hostnameOf(page.url) === hostnameOf(redirectsTo);

        issues.push({
            url: page.url,
            redirectsTo,
            category: isHttpToHttps ? 'https_upgrade' : 'other',
        });
    }
    return issues;
};
