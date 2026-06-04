import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ApifyConfigService, ApifyInput } from '../../services/config/apifyConfig.js';
import { Actor } from 'apify';

// Mock Apify Actor
const mockGetInput = jest.fn();
const mockGetEnv = jest.fn();

jest.mock('apify', () => ({
    Actor: {
        getInput: mockGetInput,
        getEnv: mockGetEnv,
    },
}));

describe('ApifyConfigService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('getConfigFromInput', () => {
        it('should convert Apify input to internal configuration format', async () => {
            const mockInput: ApifyInput = {
                startUrls: [{ url: 'https://example.com' }],
                maxRequestsPerCrawl: 10,
                maxConcurrency: 2,
                sitemapDiscovery: true,
                extractionModules: {
                    basicData: true,
                    seoTags: true,
                    links: true,
                },
            };

            mockGetInput.mockResolvedValue(mockInput);
            mockGetEnv.mockReturnValue({});

            const config = await ApifyConfigService.getConfigFromInput();

            expect(config.targets.startUrls).toEqual(['https://example.com']);
            expect(config.crawler.maxRequestsPerCrawl).toBe(10);
            expect(config.crawler.maxConcurrency).toBe(2);
            expect(config.targets.sitemapDiscovery).toBe(true);
            expect(config.extraction.modules.basicData).toBe(true);
            expect(config.extraction.modules.seoTags).toBe(true);
            expect(config.extraction.modules.links).toBe(true);
        });

        it('should apply environment variable overrides', async () => {
            const mockInput: ApifyInput = {
                startUrls: [{ url: 'https://example.com' }],
                maxConcurrency: 1,
            };

            const mockEnv = {
                DEBUG: 'true',
                REQUEST_DELAY_MS: '2000',
                MAX_CONCURRENCY: '4',
                SKIP_SITEMAP_DISCOVERY: 'true',
            };

            mockGetInput.mockResolvedValue(mockInput);
            mockGetEnv.mockReturnValue(mockEnv);

            const config = await ApifyConfigService.getConfigFromInput();

            expect(config.crawler.maxConcurrency).toBe(4); // Environment override
            expect(config.crawler.requestDelay).toBe(2000); // Environment override
            expect(config.targets.sitemapDiscovery).toBe(false); // Environment override
            expect(config.logging.level).toBe('debug'); // Debug mode enabled
        });

        it('should throw error when no input provided', async () => {
            mockGetInput.mockResolvedValue(null);

            await expect(ApifyConfigService.getConfigFromInput()).rejects.toThrow(
                'No input provided to the actor'
            );
        });

        it('should throw error when startUrls is empty', async () => {
            const mockInput: ApifyInput = {
                startUrls: [],
            };

            mockGetInput.mockResolvedValue(mockInput);

            await expect(ApifyConfigService.getConfigFromInput()).rejects.toThrow(
                'startUrls is required and must contain at least one URL'
            );
        });

        it('should use default values for optional fields', async () => {
            const mockInput: ApifyInput = {
                startUrls: [{ url: 'https://example.com' }],
            };

            mockGetInput.mockResolvedValue(mockInput);
            mockGetEnv.mockReturnValue({});

            const config = await ApifyConfigService.getConfigFromInput();

            expect(config.crawler.maxRequestsPerCrawl).toBe(0); // Default unlimited
            expect(config.crawler.maxConcurrency).toBe(2); // Default
            expect(config.targets.sitemapDiscovery).toBe(true); // Default
            expect(config.extraction.modules.basicData).toBe(true); // Default
            expect(config.logging.level).toBe('info'); // Default
        });
    });

    describe('logInputSummary', () => {
        it('should log input summary without errors', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            const mockConfig = {
                targets: {
                    startUrls: ['https://example.com'],
                    sitemapDiscovery: true,
                },
                crawler: {
                    maxRequestsPerCrawl: 10,
                    maxConcurrency: 2,
                    headless: true,
                },
                extraction: {
                    modules: {
                        basicData: true,
                        seoTags: true,
                        links: false,
                    },
                },
            };

            ApifyConfigService.logInputSummary(mockConfig as any);

            expect(consoleSpy).toHaveBeenCalledWith('🎭 Apify Actor Input Summary:');
            expect(consoleSpy).toHaveBeenCalledWith('  📍 Start URLs: 1 URLs');
            expect(consoleSpy).toHaveBeenCalledWith('  📊 Max requests: 10');
            expect(consoleSpy).toHaveBeenCalledWith('  🔄 Concurrency: 2');
            expect(consoleSpy).toHaveBeenCalledWith('  🗺️ Sitemap discovery: enabled');

            consoleSpy.mockRestore();
        });
    });
});
