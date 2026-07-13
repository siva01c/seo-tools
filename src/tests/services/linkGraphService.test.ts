import { describe, it, expect } from '@jest/globals';
import {
    parseRelTokens,
    isDofollowLink,
    buildReverseLinkGraph,
} from '../../services/linkGraphService.js';

describe('linkGraphService', () => {
    describe('parseRelTokens', () => {
        it('splits a whitespace-separated rel value into lowercase tokens', () => {
            expect(parseRelTokens('nofollow sponsored')).toEqual(
                new Set(['nofollow', 'sponsored'])
            );
        });

        it('returns an empty set for undefined or empty rel', () => {
            expect(parseRelTokens(undefined)).toEqual(new Set());
            expect(parseRelTokens('')).toEqual(new Set());
        });

        it('lowercases mixed-case tokens', () => {
            expect(parseRelTokens('NoFollow')).toEqual(new Set(['nofollow']));
        });
    });

    describe('isDofollowLink', () => {
        it('treats a link with no rel attribute as dofollow', () => {
            expect(isDofollowLink(undefined)).toBe(true);
            expect(isDofollowLink('')).toBe(true);
        });

        it('treats a link with rel="nofollow" as not dofollow', () => {
            expect(isDofollowLink('nofollow')).toBe(false);
        });

        it('treats "nofollow" combined with other tokens as not dofollow', () => {
            expect(isDofollowLink('nofollow sponsored')).toBe(false);
            expect(isDofollowLink('ugc nofollow')).toBe(false);
        });

        it('treats "sponsored" or "ugc" alone as still dofollow', () => {
            expect(isDofollowLink('sponsored')).toBe(true);
            expect(isDofollowLink('ugc')).toBe(true);
        });
    });

    describe('buildReverseLinkGraph', () => {
        const pages = [
            {
                url: 'https://example.com/',
                title: 'Home',
                links: {
                    internal: [
                        { href: 'https://example.com/about', text: 'About', rel: '' },
                        { href: 'https://example.com/contact', text: 'Contact', rel: 'nofollow' },
                    ],
                    external: [{ href: 'https://other.com/', text: 'Other', rel: '' }],
                },
                _metadata: { crawlDate: '01-01-2026' },
            },
            {
                url: 'https://example.com/about',
                title: 'About',
                links: {
                    internal: [{ href: 'https://example.com/about', text: 'Self', rel: '' }],
                    external: [],
                },
            },
        ];

        it('builds a map from target URL to referring links (internal only by default)', () => {
            const graph = buildReverseLinkGraph(pages);
            expect(graph.has('https://other.com/')).toBe(false);

            const aboutRefs = graph.get('https://example.com/about');
            expect(aboutRefs).toHaveLength(2);
            expect(aboutRefs?.[0]).toMatchObject({
                pageUrl: 'https://example.com/',
                pageTitle: 'Home',
                linkText: 'About',
                isDofollow: true,
                crawlDate: '01-01-2026',
            });
        });

        it('includes self-referencing links in the graph (callers filter them out if needed)', () => {
            const graph = buildReverseLinkGraph(pages);
            const aboutRefs = graph.get('https://example.com/about') ?? [];
            expect(aboutRefs.some(r => r.pageUrl === 'https://example.com/about')).toBe(true);
        });

        it('marks nofollow-linked targets accordingly', () => {
            const graph = buildReverseLinkGraph(pages);
            const contactRefs = graph.get('https://example.com/contact') ?? [];
            expect(contactRefs[0]?.isDofollow).toBe(false);
        });

        it('includes external links when internalOnly is false', () => {
            const graph = buildReverseLinkGraph(pages, { internalOnly: false });
            expect(graph.has('https://other.com/')).toBe(true);
        });
    });
});
