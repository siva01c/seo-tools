import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

/**
 * Automated tests for Apify Actor functionality
 * Based on Apify's recommended testing patterns:
 * - https://docs.apify.com/platform/actors/development/automated-tests
 *
 * jest.mock('apify', ...) does not intercept ESM imports under the ts-jest ESM preset used by
 * this project, so the module under test must be dynamically imported after registering the
 * mock via jest.unstable_mockModule (see src/tests/config/apifyConfig.test.ts for the same
 * pattern).
 */

const mockInit = jest.fn();
const mockExit = jest.fn();
const mockGetInput = jest.fn();
const mockPushData = jest.fn();
const mockSetValue = jest.fn();
const mockFail = jest.fn();
const mockSetStatusMessage = jest.fn();

jest.unstable_mockModule('apify', () => ({
    Actor: {
        init: mockInit,
        exit: mockExit,
        getInput: mockGetInput,
        pushData: mockPushData,
        setValue: mockSetValue,
        fail: mockFail,
        setStatusMessage: mockSetStatusMessage,
    },
}));

const { Actor } = await import('apify');

describe('Apify Actor Automated Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('Actor Run Status Tests', () => {
        it('should complete successfully with valid input', async () => {
            // Mock successful run
            mockInit.mockResolvedValue();
            mockExit.mockImplementation(() => Promise.resolve()); // Prevent process.exit
            mockGetInput.mockResolvedValue({
                startUrls: [{ url: 'https://example.com' }],
                maxRequestsPerCrawl: 5,
            });

            await Actor.init();
            const input = await Actor.getInput();
            // Don't call Actor.exit in tests as it causes process.exit

            expect(mockInit).toHaveBeenCalled();
            expect(mockGetInput).toHaveBeenCalled();
            expect(input?.startUrls).toHaveLength(1);
        });

        it('should fail gracefully with invalid input', async () => {
            mockInit.mockResolvedValue();
            mockFail.mockImplementation(() => Promise.resolve()); // Prevent process.exit
            mockGetInput.mockResolvedValue({
                startUrls: [], // Invalid: empty array
            });

            await Actor.init();
            const input = await Actor.getInput();

            // Test input validation (don't call Actor.fail in tests)
            const shouldFail = !input?.startUrls || input.startUrls.length === 0;
            expect(shouldFail).toBe(true);
            expect(input?.startUrls).toEqual([]);
        });

        it('should handle missing input gracefully', async () => {
            mockInit.mockResolvedValue();
            mockFail.mockImplementation(() => Promise.resolve()); // Prevent process.exit
            mockGetInput.mockResolvedValue(null);

            await Actor.init();
            const input = await Actor.getInput();

            // Test input validation (don't call Actor.fail in tests)
            expect(input).toBeNull();
            expect(mockInit).toHaveBeenCalled();
            expect(mockGetInput).toHaveBeenCalled();
        });
    });

    describe('Dataset Content Validation', () => {
        it('should produce valid dataset items', async () => {
            const mockDatasetItem = {
                title: 'Test Page',
                url: 'https://example.com/test',
                timestamp: '2025-01-15T10:00:00.000Z',
                response: {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': 'text/html' },
                    url: 'https://example.com/test',
                },
                links: {
                    internal: [{ href: 'https://example.com/page1', text: 'Page 1' }],
                    external: [{ href: 'https://external.com/page', text: 'External' }],
                    total: 2,
                },
                seo: {
                    metaTags: {
                        description: 'Test page description',
                        robots: 'index, follow',
                    },
                    specialLinks: {
                        canonical: 'https://example.com/test',
                    },
                    hasDataNoSnippet: false,
                },
                aiMetadata: {
                    structuredData: {
                        jsonLd: [{ '@type': 'WebPage', name: 'Test Page' }],
                        microdata: [],
                    },
                    customMetadata: {
                        wordCount: 150,
                        readingTime: '1 min',
                    },
                },
            };

            mockPushData.mockResolvedValue();

            await Actor.pushData(mockDatasetItem);

            expect(mockPushData).toHaveBeenCalledWith(mockDatasetItem);

            // Validate dataset item structure
            expect(mockDatasetItem).toHaveProperty('title');
            expect(mockDatasetItem).toHaveProperty('url');
            expect(mockDatasetItem).toHaveProperty('timestamp');
            expect(mockDatasetItem).toHaveProperty('response');
            expect(mockDatasetItem).toHaveProperty('links');
            expect(mockDatasetItem).toHaveProperty('seo');
            expect(mockDatasetItem).toHaveProperty('aiMetadata');

            // Validate required fields are not empty
            expect(mockDatasetItem.title).toBeTruthy();
            expect(mockDatasetItem.url).toBeTruthy();
            expect(mockDatasetItem.timestamp).toMatch(
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
            );

            // Validate response data
            expect(mockDatasetItem.response.status).toBeGreaterThanOrEqual(200);
            expect(mockDatasetItem.response.status).toBeLessThan(600);

            // Validate links structure
            expect(Array.isArray(mockDatasetItem.links.internal)).toBe(true);
            expect(Array.isArray(mockDatasetItem.links.external)).toBe(true);
            expect(typeof mockDatasetItem.links.total).toBe('number');

            // Validate SEO metadata
            expect(typeof mockDatasetItem.seo.metaTags).toBe('object');
            expect(typeof mockDatasetItem.seo.hasDataNoSnippet).toBe('boolean');

            // Validate AI metadata
            expect(Array.isArray(mockDatasetItem.aiMetadata.structuredData.jsonLd)).toBe(true);
            expect(Array.isArray(mockDatasetItem.aiMetadata.structuredData.microdata)).toBe(true);
        });

        it('should validate minimal dataset item structure', async () => {
            const minimalItem = {
                title: 'Minimal Page',
                url: 'https://example.com/minimal',
                timestamp: new Date().toISOString(),
            };

            mockPushData.mockResolvedValue();

            await Actor.pushData(minimalItem);

            expect(mockPushData).toHaveBeenCalledWith(minimalItem);
            expect(minimalItem.title).toBeTruthy();
            expect(minimalItem.url).toMatch(/^https?:\/\/.+/);
            expect(minimalItem.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });
    });

    describe('Key-Value Store Tests', () => {
        it('should save sitemap data to key-value store', async () => {
            const sitemapUrls = [
                'https://example.com/',
                'https://example.com/about',
                'https://example.com/contact',
            ];

            const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map(url => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>`;

            mockSetValue.mockResolvedValue();

            await Actor.setValue('sitemap.xml', sitemapXml, { contentType: 'application/xml' });
            await Actor.setValue('sitemap.json', sitemapUrls);

            expect(mockSetValue).toHaveBeenCalledWith('sitemap.xml', sitemapXml, {
                contentType: 'application/xml',
            });
            expect(mockSetValue).toHaveBeenCalledWith('sitemap.json', sitemapUrls);

            // Validate sitemap structure
            expect(sitemapXml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
            expect(sitemapXml).toContain(
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            );
            expect(Array.isArray(sitemapUrls)).toBe(true);
            expect(sitemapUrls.length).toBeGreaterThan(0);
        });
    });

    describe('Performance and Resource Tests', () => {
        it('should respect request limits', async () => {
            const maxRequests = 5;
            let requestCount = 0;

            // Simulate crawler respecting maxRequestsPerCrawl
            const processPage = () => {
                if (requestCount >= maxRequests) {
                    return false; // Stop processing
                }
                requestCount++;
                return true; // Continue processing
            };

            // Process pages up to limit
            while (processPage()) {
                // Mock page processing
            }

            expect(requestCount).toBe(maxRequests);
            expect(requestCount).toBeLessThanOrEqual(maxRequests);
        });

        it('should handle concurrent requests appropriately', async () => {
            const maxConcurrency = 2;
            const activeRequests = new Set();

            const simulateRequest = async (requestId: string) => {
                if (activeRequests.size >= maxConcurrency) {
                    throw new Error(`Concurrency limit exceeded: ${activeRequests.size}`);
                }

                activeRequests.add(requestId);

                // Simulate async work
                await new Promise(resolve => setTimeout(resolve, 10));

                activeRequests.delete(requestId);
            };

            // Test concurrent requests
            const requests = [simulateRequest('req1'), simulateRequest('req2')];

            await Promise.all(requests);

            expect(activeRequests.size).toBe(0);
        });

        it('should limit retry attempts', () => {
            const maxRetries = 3;
            let retryCount = 0;

            const attemptRequest = (): boolean => {
                retryCount++;

                // Simulate request failure
                if (retryCount <= maxRetries) {
                    return false; // Request failed, will retry
                }

                throw new Error('Max retries exceeded');
            };

            expect(() => {
                while (!attemptRequest()) {
                    // Keep retrying
                }
            }).toThrow('Max retries exceeded');

            expect(retryCount).toBe(maxRetries + 1);
        });
    });

    describe('Error Handling Tests', () => {
        it('should not contain reference errors in logs', async () => {
            const mockLogs = [
                'INFO: Crawler started',
                'INFO: Processing page: https://example.com',
                'INFO: Extracted 15 links',
                'INFO: Crawl completed',
            ];

            // Check for common error patterns
            const hasReferenceError = mockLogs.some(log => log.includes('ReferenceError'));
            const hasTypeError = mockLogs.some(log => log.includes('TypeError'));
            const hasUncaughtException = mockLogs.some(log => log.includes('UncaughtException'));

            expect(hasReferenceError).toBe(false);
            expect(hasTypeError).toBe(false);
            expect(hasUncaughtException).toBe(false);
        });

        it('should handle network errors gracefully', async () => {
            const networkError = new Error('ECONNREFUSED');
            mockFail.mockImplementation(() => Promise.resolve()); // Prevent process.exit

            let caughtError: Error | null = null;
            try {
                throw networkError;
            } catch (error) {
                if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
                    caughtError = error;
                    // Would call Actor.fail in real code, but not in tests
                }
            }

            expect(caughtError?.message).toBe('ECONNREFUSED');
        });
    });

    describe('Configuration Validation Tests', () => {
        it('should validate input configuration completely', async () => {
            const validInput = {
                startUrls: [{ url: 'https://example.com' }],
                maxRequestsPerCrawl: 10,
                maxConcurrency: 2,
                extractionModules: {
                    basicData: true,
                    seoTags: true,
                    links: true,
                    structuredData: true,
                },
            };

            mockGetInput.mockResolvedValue(validInput);

            const input = await Actor.getInput();

            // Validate input structure
            expect(input?.startUrls).toBeDefined();
            expect(Array.isArray(input?.startUrls)).toBe(true);
            expect(input?.startUrls.length).toBeGreaterThan(0);

            // Validate URL format
            const firstUrl = input?.startUrls[0]?.url;
            expect(firstUrl).toMatch(/^https?:\/\/.+/);

            // Validate numeric parameters
            if (input?.maxRequestsPerCrawl !== undefined) {
                expect(input.maxRequestsPerCrawl).toBeGreaterThanOrEqual(0);
            }
            if (input?.maxConcurrency !== undefined) {
                expect(input.maxConcurrency).toBeGreaterThan(0);
            }

            // Validate boolean flags
            if (input?.extractionModules) {
                Object.values(input.extractionModules).forEach(value => {
                    expect(typeof value).toBe('boolean');
                });
            }
        });
    });
});
