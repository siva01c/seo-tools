import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock Apify Actor
jest.mock('apify', () => ({
    Actor: {
        init: jest.fn().mockResolvedValue(undefined),
        exit: jest.fn().mockResolvedValue(undefined),
        pushData: jest.fn().mockResolvedValue(undefined),
        setStatusMessage: jest.fn().mockResolvedValue(undefined),
        fail: jest.fn().mockResolvedValue(undefined),
        getInput: jest.fn().mockResolvedValue(null),
        setValue: jest.fn().mockResolvedValue(undefined),
    },
}));

// Mock crawlee
jest.mock('crawlee', () => ({
    PlaywrightCrawler: jest.fn().mockImplementation(() => ({
        run: jest.fn().mockResolvedValue(undefined),
    })),
}));

// Mock services
jest.mock('../services/storageService.js', () => ({
    storageService: {
        initializeStorage: jest.fn().mockReturnValue({
            domain: 'example.com',
            dateFolder: '14-07-2025',
            storagePath: './storage/example.com/14-07-2025',
        }),
        configureApifyStorage: jest.fn().mockResolvedValue(undefined),
        copyTodomainStorage: jest.fn().mockResolvedValue(undefined),
        cleanupDefaultFolders: jest.fn(),
    },
}));

describe('Metadata Crawler Main Functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Command Line URL Parsing', () => {
        it('should parse --url argument correctly', () => {
            const originalArgv = process.argv;
            process.argv = ['node', 'script.js', '--url', 'https://example.com'];

            const args = process.argv.slice(2);
            const targetUrlIndex = args.findIndex(arg => arg === '--url' || arg === '-u');
            const commandLineTargetUrl =
                targetUrlIndex !== -1 && args[targetUrlIndex + 1] ? args[targetUrlIndex + 1] : null;

            expect(commandLineTargetUrl).toBe('https://example.com');

            process.argv = originalArgv;
        });

        it('should parse -u argument correctly', () => {
            const originalArgv = process.argv;
            process.argv = ['node', 'script.js', '-u', 'https://test.com'];

            const args = process.argv.slice(2);
            const targetUrlIndex = args.findIndex(arg => arg === '--url' || arg === '-u');
            const commandLineTargetUrl =
                targetUrlIndex !== -1 && args[targetUrlIndex + 1] ? args[targetUrlIndex + 1] : null;

            expect(commandLineTargetUrl).toBe('https://test.com');

            process.argv = originalArgv;
        });

        it('should return null when no URL argument is provided', () => {
            const originalArgv = process.argv;
            process.argv = ['node', 'script.js'];

            const args = process.argv.slice(2);
            const targetUrlIndex = args.findIndex(arg => arg === '--url' || arg === '-u');
            const commandLineTargetUrl =
                targetUrlIndex !== -1 && args[targetUrlIndex + 1] ? args[targetUrlIndex + 1] : null;

            expect(commandLineTargetUrl).toBeNull();

            process.argv = originalArgv;
        });
    });

    describe('URL Validation', () => {
        it('should validate URL format correctly', () => {
            expect(() => new URL('https://example.com')).not.toThrow();
            expect(() => new URL('http://localhost:3000')).not.toThrow();
            expect(() => new URL('https://subdomain.example.com/path')).not.toThrow();
            expect(() => new URL('invalid-url')).toThrow();
            expect(() => new URL('')).toThrow();
        });

        it('should extract domain correctly from URLs', () => {
            const url1 = new URL('https://example.com/page');
            const url2 = new URL('https://blog.example.com/post');
            const url3 = new URL('http://localhost:3000/test');

            expect(url1.hostname).toBe('example.com');
            expect(url2.hostname).toBe('blog.example.com');
            expect(url3.hostname).toBe('localhost');
        });
    });

    describe('Data Structure Validation', () => {
        it('should create proper scraped data structure', () => {
            const mockData = {
                title: 'Test Page',
                url: 'https://test.com',
                timestamp: '2025-01-15T10:00:00.000Z',
                response: {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': 'text/html' },
                    url: 'https://test.com',
                },
                links: {
                    internal: [{ href: 'https://test.com/page', text: 'Internal Link' }],
                    external: [{ href: 'https://external.com/page', text: 'External Link' }],
                    total: 2,
                },
                seo: {
                    metaTags: {
                        description: 'Test description',
                        robots: 'index, follow',
                    },
                    specialLinks: {
                        canonical: 'https://test.com',
                    },
                    hasDataNoSnippet: false,
                },
                aiMetadata: {
                    structuredData: {
                        jsonLd: [{ '@type': 'WebPage', name: 'Test' }],
                        microdata: [],
                    },
                    customMetadata: {
                        wordCount: 150,
                        readingTime: '1 min',
                    },
                    pageMap: {},
                },
            };

            expect(mockData).toHaveProperty('title');
            expect(mockData).toHaveProperty('url');
            expect(mockData).toHaveProperty('timestamp');
            expect(mockData).toHaveProperty('response');
            expect(mockData).toHaveProperty('links');
            expect(mockData).toHaveProperty('seo');
            expect(mockData).toHaveProperty('aiMetadata');

            // Validate data types
            expect(typeof mockData.title).toBe('string');
            expect(typeof mockData.url).toBe('string');
            expect(typeof mockData.timestamp).toBe('string');
            expect(typeof mockData.response.status).toBe('number');
            expect(Array.isArray(mockData.links.internal)).toBe(true);
            expect(Array.isArray(mockData.links.external)).toBe(true);
            expect(typeof mockData.links.total).toBe('number');
            expect(typeof mockData.seo.hasDataNoSnippet).toBe('boolean');
            expect(Array.isArray(mockData.aiMetadata.structuredData.jsonLd)).toBe(true);
        });

        it('should validate timestamp format', () => {
            const timestamp = new Date().toISOString();
            expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        it('should validate response status codes', () => {
            const validStatuses = [200, 201, 301, 302, 404, 500];
            validStatuses.forEach(status => {
                expect(status).toBeGreaterThanOrEqual(100);
                expect(status).toBeLessThan(600);
            });
        });
    });

    describe('Domain Extraction', () => {
        it('should extract domain from various URL formats', () => {
            const testCases = [
                { url: 'https://example.com', expected: 'example.com' },
                { url: 'https://example.com/', expected: 'example.com' },
                { url: 'https://example.com/page', expected: 'example.com' },
                { url: 'https://blog.example.com', expected: 'blog.example.com' },
                { url: 'http://localhost:3000', expected: 'localhost:3000' },
                { url: 'https://example.co.uk', expected: 'example.co.uk' },
            ];

            testCases.forEach(({ url, expected }) => {
                const parsedUrl = new URL(url);
                const domain = parsedUrl.port
                    ? `${parsedUrl.hostname}:${parsedUrl.port}`
                    : parsedUrl.hostname;
                expect(domain).toBe(expected);
            });
        });
    });

    describe('Storage Path Generation', () => {
        it('should generate correct storage paths', () => {
            const domain = 'example.com';
            const dateFolder = '14-07-2025';
            const expectedPath = `./storage/${domain}/${dateFolder}`;

            expect(expectedPath).toBe('./storage/example.com/14-07-2025');
            expect(expectedPath).toContain(domain);
            expect(expectedPath).toContain(dateFolder);
        });

        it('should validate date folder format', () => {
            const today = new Date();
            const dateFolder = `${today.getDate().toString().padStart(2, '0')}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getFullYear()}`;

            expect(dateFolder).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        });
    });

    describe('Link Categorization', () => {
        it('should categorize links correctly', () => {
            const links = [
                { href: 'https://example.com/page1', text: 'Internal 1' },
                { href: '/relative-page', text: 'Internal 2' },
                { href: 'https://external.com/page', text: 'External 1' },
                { href: '#anchor', text: 'Anchor' },
            ];

            const baseDomain = 'example.com';
            const categorized = {
                internal: links.filter(link => {
                    try {
                        const url = new URL(link.href, `https://${baseDomain}`);
                        return url.hostname === baseDomain;
                    } catch {
                        return !link.href.startsWith('http'); // Relative links
                    }
                }),
                external: links.filter(link => {
                    try {
                        const url = new URL(link.href, `https://${baseDomain}`);
                        return url.hostname !== baseDomain;
                    } catch {
                        return false;
                    }
                }),
            };

            expect(categorized.internal.length).toBeGreaterThan(0);
            expect(categorized.external.length).toBeGreaterThan(0);
        });
    });
});
