type Link = { href?: string };
type Page = {
    url: string;
    title?: string;
    timestamp?: string;
    links?: { internal?: Link[] };
};

export interface IOrphanEntry {
    url: string;
    title?: string;
    timestamp?: string;
}

export interface IOrphanedPagesResult {
    /** Pages no internal link points to (the root page "/" is never listed). */
    pages: IOrphanEntry[];
    /**
     * Homepages ("/" or a language root such as "/cs/") no internal link points to. A real
     * site practically always links its homepage, so a hit here almost certainly means the
     * crawl lost its internal links (e.g. a too broad --exclude-domains), not the site.
     */
    orphanedHomepages: string[];
}

/** Normalize a URL for orphan comparison (strip trailing slash). */
const normalizeUrl = (u: string): string => u.replace(/\/$/, '');

const LANGUAGE_ROOT = /^\/[a-z]{2}(?:[-_][a-z]{2,4})?\/?$/i;

const pathOf = (url: string): string | null => {
    try {
        return new URL(url).pathname;
    } catch {
        return null;
    }
};

const isRootPage = (url: string): boolean => pathOf(url) === '/';

const isHomepage = (url: string): boolean => {
    const path = pathOf(url);
    return path !== null && (path === '/' || LANGUAGE_ROOT.test(path));
};

export const findOrphanedPages = (pages: Page[]): IOrphanedPagesResult => {
    const linkedUrls = new Set<string>();
    for (const page of pages) {
        for (const link of page.links?.internal ?? []) {
            if (link.href) linkedUrls.add(normalizeUrl(link.href));
        }
    }

    const unlinked = pages.filter(page => !linkedUrls.has(normalizeUrl(page.url)));

    return {
        pages: unlinked
            .filter(page => !isRootPage(page.url))
            .map(page => ({ url: page.url, title: page.title, timestamp: page.timestamp })),
        orphanedHomepages: unlinked.filter(page => isHomepage(page.url)).map(page => page.url),
    };
};
