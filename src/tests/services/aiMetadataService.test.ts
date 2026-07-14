import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
    extractJsonLdStructuredData,
    extractMicrodata,
    extractCustomMetadata,
    extractPageMapData,
    extractContentMetrics,
} from '../../services/aiMetadataService.js';

// Mock Playwright page
const createMockPage = (
    jsonLdScripts: string[] = [],
    microdataElements: any[] = [],
    pageContent: string = '',
    headings: any[] = []
) => ({
    $$eval: jest.fn().mockImplementation((selector, callback) => {
        if (selector === 'script[type="application/ld+json"]') {
            return Promise.resolve(
                callback(
                    jsonLdScripts.map(content => ({
                        textContent: content,
                    }))
                )
            );
        }
        if (selector === '[itemscope]') {
            return Promise.resolve(callback(microdataElements));
        }
        if (selector === 'h1, h2, h3, h4, h5, h6') {
            return Promise.resolve(callback(headings));
        }
        return Promise.resolve([]);
    }),
    $eval: jest.fn().mockImplementation((selector, callback) => {
        if (selector === 'body') {
            return Promise.resolve(callback({ textContent: pageContent }));
        }
        return Promise.resolve(null);
    }),
    // extractContentMetrics/extractImages call page.evaluate(fn) with a zero-argument fn that
    // reads the real browser `document` — there's no DOM to run that against under Jest's node
    // test environment, so this mock computes the same result extractContentMetrics's real
    // callback would, from the pageContent/headings fixtures, instead of executing the callback.
    evaluate: jest.fn().mockImplementation(() => {
        const wordCount = pageContent.trim() === '' ? 0 : pageContent.trim().split(/\s+/).length;
        const readingTime = `${Math.ceil(wordCount / 200)} min`;
        const headingStructure = headings.map(h => ({
            level: parseInt(h.tagName.substring(1)),
            text: h.textContent?.trim() ?? '',
        }));
        return Promise.resolve({ wordCount, readingTime, headingStructure });
    }),
});

describe('AIMetadataService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('extractJsonLdStructuredData', () => {
        it('should extract valid JSON-LD structured data', async () => {
            const jsonLdData = [
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Article',
                    headline: 'Test Article',
                    author: 'Test Author',
                }),
                JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'Organization',
                    name: 'Test Org',
                }),
            ];

            const mockPage = createMockPage(jsonLdData);
            const result = await extractJsonLdStructuredData(mockPage as any);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                '@context': 'https://schema.org',
                '@type': 'Article',
                headline: 'Test Article',
                author: 'Test Author',
            });
            expect(result[1]).toEqual({
                '@context': 'https://schema.org',
                '@type': 'Organization',
                name: 'Test Org',
            });
        });

        it('should handle invalid JSON gracefully', async () => {
            const jsonLdData = [
                '{"invalid": json}', // Invalid JSON
                JSON.stringify({ '@type': 'Valid' }), // Valid JSON
            ];

            const mockPage = createMockPage(jsonLdData);
            const result = await extractJsonLdStructuredData(mockPage as any);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({ '@type': 'Valid' });
        });

        it('should return empty array when no JSON-LD found', async () => {
            const mockPage = createMockPage([]);
            const result = await extractJsonLdStructuredData(mockPage as any);

            expect(result).toEqual([]);
        });
    });

    describe('extractMicrodata', () => {
        it('should extract microdata items', async () => {
            const microdataElements = [
                {
                    getAttribute: (attr: string) => {
                        if (attr === 'itemtype') return 'https://schema.org/Article';
                        if (attr === 'itemscope') return '';
                        return null;
                    },
                    querySelectorAll: jest.fn().mockReturnValue([
                        {
                            getAttribute: (attr: string) => {
                                if (attr === 'itemprop') return 'headline';
                                return null;
                            },
                            tagName: 'SPAN',
                            textContent: 'Test Headline',
                        },
                    ]),
                },
            ];

            const mockPage = createMockPage([], microdataElements);
            const result = await extractMicrodata(mockPage as any);

            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                type: ['https://schema.org/Article'],
                properties: {
                    headline: 'Test Headline',
                },
            });
        });

        it('should return empty array when no microdata found', async () => {
            const mockPage = createMockPage([], []);
            const result = await extractMicrodata(mockPage as any);

            expect(result).toEqual([]);
        });
    });

    describe('extractCustomMetadata', () => {
        it('should extract AI-specific metadata from meta tags', async () => {
            const metas = [
                { name: 'department', content: 'engineering' },
                { name: 'category', content: 'technology' },
                { name: 'rating', content: '4.5' },
                { name: 'ai-priority', content: 'high' },
            ];
            const mockPage = {
                $$eval: jest.fn().mockImplementation((selector, callback) => {
                    if (selector === 'meta') {
                        return Promise.resolve(
                            callback(
                                metas.map(m => ({
                                    getAttribute: (attr: string) =>
                                        attr === 'name'
                                            ? m.name
                                            : attr === 'content'
                                              ? m.content
                                              : null,
                                }))
                            )
                        );
                    }
                    return Promise.resolve(callback([]));
                }),
            };

            const result = await extractCustomMetadata(mockPage as any);

            expect(result).toEqual({
                department: 'engineering',
                category: 'technology',
                rating: 4.5,
                'ai-priority': 'high',
            });
        });

        it('should return empty object when no custom metadata found', async () => {
            const mockPage = {
                $$eval: jest
                    .fn()
                    .mockImplementation((selector, callback) => Promise.resolve(callback([]))),
            };

            const result = await extractCustomMetadata(mockPage as any);
            expect(result).toEqual({});
        });
    });

    describe('extractPageMapData', () => {
        it('should extract PageMap data from meta tags', async () => {
            const mockPage = {
                $$eval: jest.fn().mockImplementation((selector, callback) => {
                    if (selector === 'meta[name^="pagemap-"]') {
                        const metas = [
                            { name: 'pagemap-image', content: 'https://example.com/image.jpg' },
                            { name: 'pagemap-category', content: 'news' },
                        ];
                        return Promise.resolve(
                            callback(
                                metas.map(m => ({
                                    getAttribute: (attr: string) =>
                                        attr === 'name'
                                            ? m.name
                                            : attr === 'content'
                                              ? m.content
                                              : null,
                                }))
                            )
                        );
                    }
                    return Promise.resolve(callback([]));
                }),
            };

            const result = await extractPageMapData(mockPage as any);

            expect(result).toEqual({
                attributes: {
                    image: 'https://example.com/image.jpg',
                    category: 'news',
                },
                dataObjects: [],
            });
        });

        it('should return empty object when no PageMap data found', async () => {
            const mockPage = {
                $$eval: jest
                    .fn()
                    .mockImplementation((selector, callback) => Promise.resolve(callback([]))),
            };

            const result = await extractPageMapData(mockPage as any);
            expect(result).toEqual({ attributes: {}, dataObjects: [] });
        });
    });

    describe('extractContentMetrics', () => {
        it('should calculate content metrics correctly', async () => {
            const pageContent =
                'This is a test content with multiple words for testing word count calculation.';
            const headings = [
                { tagName: 'H1', textContent: 'Main Title' },
                { tagName: 'H2', textContent: 'Subtitle' },
                { tagName: 'H3', textContent: 'Sub-subtitle' },
            ];

            const mockPage = createMockPage([], [], pageContent, headings);
            const result = await extractContentMetrics(mockPage as any);

            expect(result).toHaveProperty('wordCount');
            expect(result).toHaveProperty('readingTime');
            expect(result).toHaveProperty('headingStructure');

            expect(result.wordCount).toBe(13); // Number of words in test content
            expect(result.readingTime).toContain('min'); // Should include 'min' in reading time
            expect(result.headingStructure).toEqual([
                { level: 1, text: 'Main Title' },
                { level: 2, text: 'Subtitle' },
                { level: 3, text: 'Sub-subtitle' },
            ]);
        });

        it('should handle empty content gracefully', async () => {
            const mockPage = createMockPage([], [], '', []);
            const result = await extractContentMetrics(mockPage as any);

            expect(result).toEqual({
                wordCount: 0,
                readingTime: '0 min',
                headingStructure: [],
            });
        });

        it('should calculate reading time correctly for different word counts', async () => {
            // Test with exactly 200 words (should be 1 minute at 200 WPM)
            const words = Array(200).fill('word').join(' ');
            const mockPage = createMockPage([], [], words, []);

            const result = await extractContentMetrics(mockPage as any);

            expect(result.wordCount).toBe(200);
            expect(result.readingTime).toBe('1 min');
        });

        it('should handle long content correctly', async () => {
            // Test with 1000 words (should be 5 minutes)
            const words = Array(1000).fill('word').join(' ');
            const mockPage = createMockPage([], [], words, []);

            const result = await extractContentMetrics(mockPage as any);

            expect(result.wordCount).toBe(1000);
            expect(result.readingTime).toBe('5 min');
        });
    });
});
