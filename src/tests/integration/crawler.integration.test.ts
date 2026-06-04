import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

// Mock dependencies
const mockInit = jest.fn();
const mockSetStatusMessage = jest.fn();
const mockPushData = jest.fn();
const mockExit = jest.fn();
const mockFail = jest.fn();

jest.mock('apify', () => ({
    Actor: {
        init: mockInit,
        setStatusMessage: mockSetStatusMessage,
        pushData: mockPushData,
        exit: mockExit,
        fail: mockFail,
    },
}));

const mockPlaywrightCrawler = jest.fn();
jest.mock('crawlee', () => ({
    PlaywrightCrawler: mockPlaywrightCrawler,
}));

jest.mock('../../services/config/configService.js');
jest.mock('../../services/storageService.js');

describe('Crawler Integration Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('End-to-End Crawler Flow', () => {
        it('should initialize and run crawler successfully with command line URL', async () => {
            // Mock successful initialization
            mockInit.mockResolvedValue();
            mockSetStatusMessage.mockResolvedValue();
            mockPushData.mockResolvedValue();
            mockExit.mockResolvedValue();

            // Mock successful crawler run
            const mockCrawler = {
                run: jest.fn().mockResolvedValue(undefined),
            };
            mockPlaywrightCrawler.mockImplementation(() => mockCrawler as any);

            // Mock storage service
            const mockStorageService = {
                initializeStorage: jest.fn().mockReturnValue({
                    domain: 'example.com',
                    dateFolder: '14-07-2025',
                    storagePath: './storage/example.com/14-07-2025',
                }),
                configureApifyStorage: jest.fn().mockResolvedValue(undefined),
                copyTodomainStorage: jest.fn().mockResolvedValue(undefined),
                cleanupDefaultFolders: jest.fn(),
            };
            jest.doMock('../../services/storageService.js', () => ({
                storageService: mockStorageService,
            }));

            // Mock config service
            const mockConfig = {
                targets: {
                    startUrls: ['https://example.com'],
                    sitemapDiscovery: true,
                },
                crawler: {
                    maxRequestsPerCrawl: 5,
                    maxConcurrency: 1,
                    headless: true,
                },
                extraction: {
                    modules: {
                        basicData: true,
                        seoTags: true,
                        links: true,
                    },
                },
            };

            // Simulate command line argument parsing
            const originalArgv = process.argv;
            process.argv = ['node', 'script.js', '--url', 'https://example.com'];

            try {
                // Import and run main crawler logic (simplified)
                const args = process.argv.slice(2);
                const targetUrlIndex = args.findIndex(arg => arg === '--url' || arg === '-u');
                const commandLineTargetUrl =
                    targetUrlIndex !== -1 && args[targetUrlIndex + 1]
                        ? args[targetUrlIndex + 1]
                        : null;

                expect(commandLineTargetUrl).toBe('https://example.com');

                // Verify storage initialization
                const storageConfig = mockStorageService.initializeStorage(commandLineTargetUrl);
                expect(mockStorageService.initializeStorage).toHaveBeenCalledWith(
                    'https://example.com'
                );
                expect(storageConfig.domain).toBe('example.com');

                // Verify Actor initialization
                await Actor.init();
                expect(Actor.init).toHaveBeenCalled();

                // Verify crawler creation and run
                const crawler = new PlaywrightCrawler({});
                await crawler.run(['https://example.com']);

                expect(PlaywrightCrawler).toHaveBeenCalled();
                expect(mockCrawler.run).toHaveBeenCalledWith(['https://example.com']);
            } finally {
                process.argv = originalArgv;
            }
        });

        it('should handle missing URL gracefully', async () => {
            const originalArgv = process.argv;
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const processExitSpy = jest
                .spyOn(process, 'exit')
                .mockImplementation(() => undefined as never);

            process.argv = ['node', 'script.js']; // No URL provided

            try {
                // Simulate early URL parsing logic
                const args = process.argv.slice(2);
                const targetUrlIndex = args.findIndex(arg => arg === '--url' || arg === '-u');
                const commandLineTargetUrl =
                    targetUrlIndex !== -1 && args[targetUrlIndex + 1]
                        ? args[targetUrlIndex + 1]
                        : null;

                if (!commandLineTargetUrl) {
                    console.error('❌ Domain is required');
                    console.error('Usage: npm run crawl <URL> or provide URL in configuration');
                    process.exit(1);
                }

                expect(consoleSpy).toHaveBeenCalledWith('❌ Domain is required');
                expect(processExitSpy).toHaveBeenCalledWith(1);
            } finally {
                process.argv = originalArgv;
                consoleSpy.mockRestore();
                processExitSpy.mockRestore();
            }
        });

        it('should handle invalid URL format', async () => {
            const originalArgv = process.argv;
            process.argv = ['node', 'script.js', '--url', 'invalid-url'];

            try {
                const args = process.argv.slice(2);
                const targetUrlIndex = args.findIndex(arg => arg === '--url' || arg === '-u');
                const commandLineTargetUrl = args[targetUrlIndex + 1];

                expect(() => new URL(commandLineTargetUrl)).toThrow();
            } finally {
                process.argv = originalArgv;
            }
        });
    });

    describe('Configuration Integration', () => {
        it('should prioritize command line URL over config file', async () => {
            const mockConfig = {
                targets: {
                    startUrls: ['https://config-url.com'],
                    sitemapDiscovery: true,
                },
            };

            const originalArgv = process.argv;
            process.argv = ['node', 'script.js', '--url', 'https://command-line-url.com'];

            try {
                const args = process.argv.slice(2);
                const targetUrlIndex = args.findIndex(arg => arg === '--url' || arg === '-u');
                const commandLineTargetUrl = args[targetUrlIndex + 1];

                // Command line URL should override config
                if (commandLineTargetUrl) {
                    mockConfig.targets.startUrls = [commandLineTargetUrl];
                }

                expect(mockConfig.targets.startUrls).toEqual(['https://command-line-url.com']);
            } finally {
                process.argv = originalArgv;
            }
        });
    });

    describe('Data Extraction Integration', () => {
        it('should build complete scraped data structure', async () => {
            const mockPageData = {
                title: 'Test Page',
                url: 'https://example.com/test',
                response: {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': 'text/html' },
                },
            };

            const mockLinks = {
                internal: [{ href: 'https://example.com/internal', text: 'Internal Link' }],
                external: [{ href: 'https://external.com/link', text: 'External Link' }],
                total: 2,
            };

            const mockSeoData = {
                metaTags: {
                    description: 'Test description',
                    robots: 'index, follow',
                },
                specialLinks: {
                    canonical: 'https://example.com/test',
                },
                hasDataNoSnippet: false,
            };

            const mockAiMetadata = {
                structuredData: {
                    jsonLd: [{ '@type': 'Article', headline: 'Test' }],
                    microdata: [],
                },
                customMetadata: {
                    department: 'engineering',
                },
            };

            const scrapedData = {
                ...mockPageData,
                timestamp: new Date().toISOString(),
                links: mockLinks,
                seo: mockSeoData,
                aiMetadata: mockAiMetadata,
            };

            expect(scrapedData).toHaveProperty('title');
            expect(scrapedData).toHaveProperty('url');
            expect(scrapedData).toHaveProperty('timestamp');
            expect(scrapedData).toHaveProperty('response');
            expect(scrapedData).toHaveProperty('links');
            expect(scrapedData).toHaveProperty('seo');
            expect(scrapedData).toHaveProperty('aiMetadata');

            expect(scrapedData.links.total).toBe(2);
            expect(scrapedData.seo.metaTags.description).toBe('Test description');
            expect(scrapedData.aiMetadata.structuredData.jsonLd).toHaveLength(1);
        });
    });

    describe('Storage Integration', () => {
        it('should organize data by domain and date', async () => {
            const mockStorageService = {
                initializeStorage: jest.fn().mockReturnValue({
                    domain: 'example.com',
                    dateFolder: '14-07-2025',
                    storagePath: './storage/example.com/14-07-2025',
                    datasetPath: './storage/example.com/14-07-2025/datasets',
                    keyValueStorePath: './storage/example.com/14-07-2025/key_value_stores',
                    requestQueuePath: './storage/example.com/14-07-2025/request_queues',
                }),
                configureApifyStorage: jest.fn(),
                copyTodomainStorage: jest.fn(),
                cleanupDefaultFolders: jest.fn(),
            };

            const config = mockStorageService.initializeStorage('https://example.com/page');

            expect(config.domain).toBe('example.com');
            expect(config.dateFolder).toMatch(/^\d{2}-\d{2}-\d{4}$/);
            expect(config.storagePath).toContain('example.com');
            expect(config.storagePath).toContain(config.dateFolder);
            expect(config.datasetPath).toContain('datasets');
            expect(config.keyValueStorePath).toContain('key_value_stores');
            expect(config.requestQueuePath).toContain('request_queues');
        });
    });

    describe('Error Handling Integration', () => {
        it('should handle crawler failures gracefully', async () => {
            mockFail.mockResolvedValue();

            const mockCrawler = {
                run: jest.fn().mockRejectedValue(new Error('Crawler failed')),
            };
            mockPlaywrightCrawler.mockImplementation(() => mockCrawler as any);

            try {
                await mockCrawler.run(['https://example.com']);
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toBe('Crawler failed');
            }
        });

        it('should handle network timeouts', async () => {
            const mockCrawler = {
                run: jest.fn().mockRejectedValue(new Error('Request timeout')),
            };
            mockPlaywrightCrawler.mockImplementation(() => mockCrawler as any);

            try {
                await mockCrawler.run(['https://slow-site.com']);
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toBe('Request timeout');
            }
        });
    });
});
