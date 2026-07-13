import { describe, it, expect } from '@jest/globals';
import { invertSitemapUrlLists } from '../../services/sitemapService.js';

describe('sitemapService', () => {
    describe('invertSitemapUrlLists', () => {
        it('maps a URL to every sitemap it appears in', () => {
            const map = invertSitemapUrlLists([
                {
                    sitemapUrl: 'https://example.com/sitemap-1.xml',
                    urls: ['https://example.com/a'],
                },
                {
                    sitemapUrl: 'https://example.com/sitemap-2.xml',
                    urls: ['https://example.com/a'],
                },
            ]);
            expect(map.get('https://example.com/a')).toEqual([
                'https://example.com/sitemap-1.xml',
                'https://example.com/sitemap-2.xml',
            ]);
        });

        it('maps a URL appearing in only one sitemap to a single-entry list', () => {
            const map = invertSitemapUrlLists([
                {
                    sitemapUrl: 'https://example.com/sitemap-1.xml',
                    urls: ['https://example.com/b'],
                },
            ]);
            expect(map.get('https://example.com/b')).toEqual(['https://example.com/sitemap-1.xml']);
        });

        it('returns an empty map for no sitemaps', () => {
            expect(invertSitemapUrlLists([])).toEqual(new Map());
        });

        it('does not flag a URL repeated multiple times within a single sitemap', () => {
            const map = invertSitemapUrlLists([
                {
                    sitemapUrl: 'https://example.com/sitemap.xml',
                    urls: [
                        'https://example.com/c',
                        'https://example.com/c',
                        'https://example.com/c',
                    ],
                },
            ]);
            expect(map.get('https://example.com/c')).toEqual(['https://example.com/sitemap.xml']);
        });
    });
});
