type Link = { href?: string; text?: string; rel?: string };
type Page = {
    url: string;
    title?: string;
    links?: { internal?: Link[]; external?: Link[] };
    _metadata?: { crawlDate?: string };
};

export interface ILinkRef {
    pageUrl: string;
    pageTitle?: string;
    linkText?: string;
    rel?: string;
    isDofollow: boolean;
    crawlDate?: string;
}

/** Split a rel="..." attribute value into its lowercase whitespace-separated tokens. */
export const parseRelTokens = (rel: string | undefined): Set<string> =>
    new Set((rel ?? '').toLowerCase().split(/\s+/).filter(Boolean));

/** A link is dofollow unless its rel attribute carries the "nofollow" token. */
export const isDofollowLink = (rel: string | undefined): boolean =>
    !parseRelTokens(rel).has('nofollow');

/**
 * Builds a reverse link graph (target URL -> referring links) across a crawl.
 * By default only internal links are considered, since the checks that consume this graph
 * (orphaned redirects, single-dofollow-incoming-link) only care about internal linking structure.
 */
export const buildReverseLinkGraph = (
    pages: Page[],
    opts?: { internalOnly?: boolean }
): Map<string, ILinkRef[]> => {
    const internalOnly = opts?.internalOnly ?? true;
    const graph = new Map<string, ILinkRef[]>();

    for (const page of pages) {
        const links = internalOnly
            ? (page.links?.internal ?? [])
            : [...(page.links?.internal ?? []), ...(page.links?.external ?? [])];

        for (const link of links) {
            if (!link?.href) continue;
            const list = graph.get(link.href) ?? [];
            list.push({
                pageUrl: page.url,
                pageTitle: page.title,
                linkText: link.text,
                rel: link.rel,
                isDofollow: isDofollowLink(link.rel),
                crawlDate: page._metadata?.crawlDate,
            });
            graph.set(link.href, list);
        }
    }

    return graph;
};
