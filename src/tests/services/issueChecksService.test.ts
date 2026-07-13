import { describe, it, expect } from '@jest/globals';
import {
    findPagesLinkingToBrokenPages,
    findRedirectsWithNoIncomingLinks,
    findPagesWithSingleDofollowIncomingLink,
    findIncompleteOpenGraph,
    findMissingTwitterCard,
    findUrlsInMultipleSitemaps,
    classifyRedirects,
    OG_REQUIRED_FIELDS,
} from '../../services/issueChecksService.js';
import { buildReverseLinkGraph } from '../../services/linkGraphService.js';

describe('issueChecksService', () => {
    describe('findPagesLinkingToBrokenPages', () => {
        it('flags a page linking to a crawled page with status >= 400', () => {
            const pages = [
                {
                    url: 'https://example.com/',
                    title: 'Home',
                    response: { status: 200 },
                    links: { internal: [{ href: 'https://example.com/missing', text: 'Missing' }] },
                },
                { url: 'https://example.com/missing', response: { status: 404 } },
            ];
            const issues = findPagesLinkingToBrokenPages(pages);
            expect(issues).toEqual([
                {
                    sourceUrl: 'https://example.com/',
                    sourceTitle: 'Home',
                    targetUrl: 'https://example.com/missing',
                    targetStatus: 404,
                    linkText: 'Missing',
                },
            ]);
        });

        it('does not flag links to healthy pages', () => {
            const pages = [
                {
                    url: 'https://example.com/',
                    response: { status: 200 },
                    links: { internal: [{ href: 'https://example.com/ok' }] },
                },
                { url: 'https://example.com/ok', response: { status: 200 } },
            ];
            expect(findPagesLinkingToBrokenPages(pages)).toEqual([]);
        });

        it('ignores links to URLs that were never crawled', () => {
            const pages = [
                {
                    url: 'https://example.com/',
                    response: { status: 200 },
                    links: { internal: [{ href: 'https://example.com/never-crawled' }] },
                },
            ];
            expect(findPagesLinkingToBrokenPages(pages)).toEqual([]);
        });
    });

    describe('findRedirectsWithNoIncomingLinks', () => {
        it('flags a 3xx page with no referrers', () => {
            const pages = [{ url: 'https://example.com/old', response: { status: 301 } }];
            const graph = buildReverseLinkGraph(pages);
            expect(findRedirectsWithNoIncomingLinks(pages, graph)).toEqual([
                { url: 'https://example.com/old', status: 301 },
            ]);
        });

        it('does not flag a 3xx page that has an incoming internal link', () => {
            const pages = [
                {
                    url: 'https://example.com/',
                    response: { status: 200 },
                    links: { internal: [{ href: 'https://example.com/old' }] },
                },
                { url: 'https://example.com/old', response: { status: 301 } },
            ];
            const graph = buildReverseLinkGraph(pages);
            expect(findRedirectsWithNoIncomingLinks(pages, graph)).toEqual([]);
        });

        it('ignores non-3xx pages', () => {
            const pages = [{ url: 'https://example.com/', response: { status: 200 } }];
            const graph = buildReverseLinkGraph(pages);
            expect(findRedirectsWithNoIncomingLinks(pages, graph)).toEqual([]);
        });
    });

    describe('findPagesWithSingleDofollowIncomingLink', () => {
        it('flags a crawled page with exactly one dofollow referrer', () => {
            const pages = [
                {
                    url: 'https://example.com/',
                    title: 'Home',
                    response: { status: 200 },
                    links: {
                        internal: [{ href: 'https://example.com/page', text: 'Page', rel: '' }],
                    },
                },
                { url: 'https://example.com/page', response: { status: 200 } },
            ];
            const graph = buildReverseLinkGraph(pages);
            const issues = findPagesWithSingleDofollowIncomingLink(pages, graph);
            expect(issues).toEqual([
                {
                    url: 'https://example.com/page',
                    dofollowReferrer: {
                        pageUrl: 'https://example.com/',
                        pageTitle: 'Home',
                        linkText: 'Page',
                    },
                    totalIncomingLinks: 1,
                },
            ]);
        });

        it('does not flag a page with two or more dofollow referrers', () => {
            const pages = [
                {
                    url: 'https://example.com/a',
                    response: { status: 200 },
                    links: { internal: [{ href: 'https://example.com/page', rel: '' }] },
                },
                {
                    url: 'https://example.com/b',
                    response: { status: 200 },
                    links: { internal: [{ href: 'https://example.com/page', rel: '' }] },
                },
                { url: 'https://example.com/page', response: { status: 200 } },
            ];
            const graph = buildReverseLinkGraph(pages);
            expect(findPagesWithSingleDofollowIncomingLink(pages, graph)).toEqual([]);
        });

        it('does not count a nofollow referrer toward the dofollow total', () => {
            const pages = [
                {
                    url: 'https://example.com/a',
                    response: { status: 200 },
                    links: { internal: [{ href: 'https://example.com/page', rel: 'nofollow' }] },
                },
                { url: 'https://example.com/page', response: { status: 200 } },
            ];
            const graph = buildReverseLinkGraph(pages);
            expect(findPagesWithSingleDofollowIncomingLink(pages, graph)).toEqual([]);
        });
    });

    describe('findIncompleteOpenGraph', () => {
        it('does not flag a page with zero OG tags', () => {
            const pages = [{ url: 'https://example.com/', seo: { metaTags: {} } }];
            expect(findIncompleteOpenGraph(pages)).toEqual([]);
        });

        it('flags a page with 3 of 4 required OG tags', () => {
            const pages = [
                {
                    url: 'https://example.com/',
                    title: 'Home',
                    seo: {
                        metaTags: {
                            'og:title': 'Home',
                            'og:description': 'Desc',
                            'og:image': 'https://example.com/img.png',
                        },
                    },
                },
            ];
            const issues = findIncompleteOpenGraph(pages);
            expect(issues).toEqual([
                {
                    url: 'https://example.com/',
                    title: 'Home',
                    present: ['og:title', 'og:description', 'og:image'],
                    missing: ['og:url'],
                },
            ]);
        });

        it('does not flag a page with all required OG tags present', () => {
            const meta: Record<string, string> = {};
            for (const f of OG_REQUIRED_FIELDS) meta[f] = 'value';
            const pages = [{ url: 'https://example.com/', seo: { metaTags: meta } }];
            expect(findIncompleteOpenGraph(pages)).toEqual([]);
        });
    });

    describe('findMissingTwitterCard', () => {
        it('flags a page with no twitter:card tag', () => {
            const pages = [{ url: 'https://example.com/', title: 'Home', seo: { metaTags: {} } }];
            expect(findMissingTwitterCard(pages)).toEqual([
                { url: 'https://example.com/', title: 'Home' },
            ]);
        });

        it('does not flag a page with a twitter:card tag', () => {
            const pages = [
                { url: 'https://example.com/', seo: { metaTags: { 'twitter:card': 'summary' } } },
            ];
            expect(findMissingTwitterCard(pages)).toEqual([]);
        });
    });

    describe('findUrlsInMultipleSitemaps', () => {
        it('flags a URL listed in more than one sitemap', () => {
            const map = new Map<string, string[]>([
                [
                    'https://example.com/a',
                    ['https://example.com/sitemap-1.xml', 'https://example.com/sitemap-2.xml'],
                ],
                ['https://example.com/b', ['https://example.com/sitemap-1.xml']],
            ]);
            expect(findUrlsInMultipleSitemaps(map)).toEqual([
                {
                    url: 'https://example.com/a',
                    sitemaps: [
                        'https://example.com/sitemap-1.xml',
                        'https://example.com/sitemap-2.xml',
                    ],
                },
            ]);
        });

        it('does not flag URLs listed in only one sitemap', () => {
            const map = new Map<string, string[]>([
                ['https://example.com/b', ['https://example.com/sitemap-1.xml']],
            ]);
            expect(findUrlsInMultipleSitemaps(map)).toEqual([]);
        });
    });

    describe('classifyRedirects', () => {
        it('classifies a same-host http->https redirect as https_upgrade', () => {
            const pages = [
                {
                    url: 'http://example.com/page',
                    response: { status: 301, url: 'https://example.com/page' },
                },
            ];
            expect(classifyRedirects(pages)).toEqual([
                {
                    url: 'http://example.com/page',
                    redirectsTo: 'https://example.com/page',
                    category: 'https_upgrade',
                },
            ]);
        });

        it('classifies a redirect to a different path as other', () => {
            const pages = [
                {
                    url: 'https://example.com/old',
                    response: { status: 301, url: 'https://example.com/new' },
                },
            ];
            expect(classifyRedirects(pages)).toEqual([
                {
                    url: 'https://example.com/old',
                    redirectsTo: 'https://example.com/new',
                    category: 'other',
                },
            ]);
        });

        it('ignores non-redirect pages', () => {
            const pages = [{ url: 'https://example.com/', response: { status: 200 } }];
            expect(classifyRedirects(pages)).toEqual([]);
        });
    });
});
