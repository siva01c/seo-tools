import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
    extractGoogleMetaTags,
    extractSpecialLinks,
    detectDataNoSnippet,
} from '../../services/metaTagService.js';

// Mock Playwright page
const createMockPage = (
    metaTags: Array<{ name?: string; property?: string; content?: string }> = []
) => ({
    $$eval: jest.fn().mockImplementation((selector, callback) => {
        if (selector === 'meta') {
            return Promise.resolve(
                callback(
                    metaTags.map(tag => ({
                        getAttribute: (attr: string) => tag[attr as keyof typeof tag] || null,
                        name: tag.name || '',
                        content: tag.content || '',
                    }))
                )
            );
        }
        if (selector === 'link[rel]') {
            return Promise.resolve([]);
        }
        if (selector === '[data-nosnippet]') {
            return Promise.resolve([]);
        }
        return Promise.resolve([]);
    }),
});

describe('MetaTagService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('extractGoogleMetaTags', () => {
        it('should extract basic meta tags', async () => {
            const mockMetaTags = [
                { name: 'description', content: 'Test description' },
                { name: 'keywords', content: 'test, keywords' },
                { name: 'robots', content: 'index, follow' },
                { name: 'author', content: 'Test Author' },
            ];

            const mockPage = createMockPage(mockMetaTags);
            const result = await extractGoogleMetaTags(mockPage as any);

            expect(result).toEqual({
                description: 'Test description',
                keywords: 'test, keywords',
                robots: 'index, follow',
                author: 'Test Author',
            });
        });

        it('should extract Open Graph meta tags', async () => {
            const mockMetaTags = [
                { property: 'og:title', content: 'OG Title' },
                { property: 'og:description', content: 'OG Description' },
                { property: 'og:image', content: 'https://example.com/image.jpg' },
                { property: 'og:url', content: 'https://example.com' },
            ];

            const mockPage = createMockPage(mockMetaTags);
            const result = await extractGoogleMetaTags(mockPage as any);

            expect(result).toEqual({
                'og:title': 'OG Title',
                'og:description': 'OG Description',
                'og:image': 'https://example.com/image.jpg',
                'og:url': 'https://example.com',
            });
        });

        it('should extract Twitter Card meta tags', async () => {
            const mockMetaTags = [
                { name: 'twitter:card', content: 'summary_large_image' },
                { name: 'twitter:title', content: 'Twitter Title' },
                { name: 'twitter:description', content: 'Twitter Description' },
                { name: 'twitter:image', content: 'https://example.com/twitter-image.jpg' },
            ];

            const mockPage = createMockPage(mockMetaTags);
            const result = await extractGoogleMetaTags(mockPage as any);

            expect(result).toEqual({
                'twitter:card': 'summary_large_image',
                'twitter:title': 'Twitter Title',
                'twitter:description': 'Twitter Description',
                'twitter:image': 'https://example.com/twitter-image.jpg',
            });
        });

        it('should handle Google-specific meta tags', async () => {
            const mockMetaTags = [
                { name: 'googlebot', content: 'index, follow' },
                { name: 'google-site-verification', content: 'verification-code' },
                { name: 'google', content: 'notranslate' },
            ];

            const mockPage = createMockPage(mockMetaTags);
            const result = await extractGoogleMetaTags(mockPage as any);

            expect(result).toEqual({
                googlebot: 'index, follow',
                'google-site-verification': 'verification-code',
                google: 'notranslate',
            });
        });

        it('should handle mobile and app meta tags', async () => {
            const mockMetaTags = [
                { name: 'viewport', content: 'width=device-width, initial-scale=1' },
                { name: 'apple-mobile-web-app-capable', content: 'yes' },
                { name: 'apple-mobile-web-app-title', content: 'App Title' },
                { name: 'theme-color', content: '#000000' },
            ];

            const mockPage = createMockPage(mockMetaTags);
            const result = await extractGoogleMetaTags(mockPage as any);

            expect(result).toEqual({
                viewport: 'width=device-width, initial-scale=1',
                'apple-mobile-web-app-capable': 'yes',
                'apple-mobile-web-app-title': 'App Title',
                'theme-color': '#000000',
            });
        });

        it('should return empty object when no meta tags found', async () => {
            const mockPage = createMockPage([]);
            const result = await extractGoogleMetaTags(mockPage as any);

            expect(result).toEqual({});
        });
    });

    describe('extractSpecialLinks', () => {
        it('should extract canonical and alternate links', async () => {
            const mockLinks = [
                { rel: 'canonical', href: 'https://example.com/canonical' },
                { rel: 'alternate', href: 'https://example.com/fr', hreflang: 'fr' },
                { rel: 'alternate', href: 'https://example.com/es', hreflang: 'es' },
            ];

            const mockPage = {
                $$eval: jest.fn().mockImplementation((selector, callback) => {
                    if (selector === 'link[rel]') {
                        return Promise.resolve(
                            callback(
                                mockLinks.map(link => ({
                                    rel: link.rel,
                                    href: link.href,
                                    getAttribute: (attr: string) => (link as any)[attr] || null,
                                }))
                            )
                        );
                    }
                    return Promise.resolve([]);
                }),
            };

            const result = await extractSpecialLinks(mockPage as any);

            expect(result).toEqual({
                canonical: 'https://example.com/canonical',
                alternate: [
                    { href: 'https://example.com/fr', hreflang: 'fr', media: null, type: null },
                    { href: 'https://example.com/es', hreflang: 'es', media: null, type: null },
                ],
            });
        });

        it('should extract preload and prefetch links', async () => {
            const mockLinks = [
                { rel: 'preload', href: '/styles.css', as: 'style' },
                { rel: 'prefetch', href: '/next-page.html' },
                { rel: 'dns-prefetch', href: 'https://fonts.googleapis.com' },
            ];

            const mockPage = {
                $$eval: jest.fn().mockImplementation((selector, callback) => {
                    if (selector === 'link[rel]') {
                        return Promise.resolve(
                            callback(
                                mockLinks.map(link => ({
                                    rel: link.rel,
                                    href: link.href,
                                    getAttribute: (attr: string) => (link as any)[attr] || null,
                                }))
                            )
                        );
                    }
                    return Promise.resolve([]);
                }),
            };

            const result = await extractSpecialLinks(mockPage as any);

            expect(result).toHaveProperty('preload');
            expect(result).toHaveProperty('prefetch');
            expect(result).toHaveProperty('dns-prefetch');
        });

        it('should return empty object when no special links found', async () => {
            const mockPage = {
                $$eval: jest
                    .fn()
                    .mockImplementation((selector, callback) => Promise.resolve(callback([]))),
            };

            const result = await extractSpecialLinks(mockPage as any);
            expect(result).toEqual({});
        });
    });

    describe('detectDataNoSnippet', () => {
        it('should return true when data-nosnippet elements exist', async () => {
            const mockPage = {
                $eval: jest.fn().mockResolvedValue(true),
            };

            const result = await detectDataNoSnippet(mockPage as any);
            expect(result).toBe(true);
        });

        it('should return false when no data-nosnippet elements exist', async () => {
            const mockPage = {
                $eval: jest.fn().mockResolvedValue(false),
            };

            const result = await detectDataNoSnippet(mockPage as any);
            expect(result).toBe(false);
        });

        it('should handle errors gracefully', async () => {
            const mockPage = {
                $eval: jest.fn().mockRejectedValue(new Error('Page error')),
            };

            const result = await detectDataNoSnippet(mockPage as any);
            expect(result).toBe(false);
        });
    });
});
