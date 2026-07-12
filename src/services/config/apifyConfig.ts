import { Actor } from 'apify';
import { ICrawlerConfig } from './types.js';

interface IApifyEnv {
    DEBUG?: string;
    REQUEST_DELAY_MS?: string;
    MAX_CONCURRENCY?: string;
    SKIP_SITEMAP_DISCOVERY?: string;
}

export interface IApifyInput {
    startUrls: Array<{ url: string }>;
    maxRequestsPerCrawl?: number;
    maxConcurrency?: number;
    requestDelay?: number;
    requestDelayMin?: number;
    requestDelayMax?: number;
    sitemapDiscovery?: boolean;
    respectRobotsTxt?: boolean;
    extractionModules?: {
        basicData?: boolean;
        responseData?: boolean;
        links?: boolean;
        seoTags?: boolean;
        specialLinks?: boolean;
        structuredData?: boolean;
        aiMetadata?: boolean;
        contentMetrics?: boolean;
        pageMap?: boolean;
    };
    customFields?: string[];
    outputFormats?: {
        prettyPrint?: boolean;
        includeTimestamp?: boolean;
    };
    performance?: {
        skipHeavyExtraction?: boolean;
        requestTimeoutSecs?: number;
    };
    debugMode?: boolean;
}

export class ApifyConfigService {
    public static async getConfigFromInput(): Promise<ICrawlerConfig> {
        const input = await Actor.getInput<IApifyInput>();

        if (!input) {
            throw new Error('No input provided to the actor');
        }

        // Validate required fields
        if (!input.startUrls || input.startUrls.length === 0) {
            throw new Error('startUrls is required and must contain at least one URL');
        }

        // Apply environment variable overrides
        const apifyEnv = Actor.getEnv() as IApifyEnv;
        const envDebug = apifyEnv.DEBUG === 'true' || apifyEnv.DEBUG === '1';
        const envRequestDelay = apifyEnv.REQUEST_DELAY_MS
            ? parseInt(apifyEnv.REQUEST_DELAY_MS)
            : undefined;
        const envMaxConcurrency = apifyEnv.MAX_CONCURRENCY
            ? parseInt(apifyEnv.MAX_CONCURRENCY)
            : undefined;
        const envSkipSitemapDiscovery = apifyEnv.SKIP_SITEMAP_DISCOVERY === 'true';

        // Convert Apify input to internal configuration format
        const config: ICrawlerConfig = {
            targets: {
                startUrls: input.startUrls.map(item => item.url),
                allowedDomains: [],
                excludedDomains: [],
                excludedPaths: [],
                sitemapDiscovery: envSkipSitemapDiscovery
                    ? false
                    : (input.sitemapDiscovery ?? true),
                respectRobotsTxt: input.respectRobotsTxt ?? true,
            },
            crawler: {
                maxRequestsPerCrawl: input.maxRequestsPerCrawl ?? 0,
                maxConcurrency: envMaxConcurrency ?? input.maxConcurrency ?? 2,
                requestTimeoutSecs: input.performance?.requestTimeoutSecs ?? 60,
                headless: false,
                requestDelay: envRequestDelay ?? input.requestDelay ?? 1000,
                requestDelayMin: input.requestDelayMin ?? 500,
                requestDelayMax: input.requestDelayMax ?? 6000,
                singleUrlMode: false,
                incrementalMode: false,
            },
            extraction: {
                modules: {
                    basicData: input.extractionModules?.basicData ?? true,
                    responseData: input.extractionModules?.responseData ?? true,
                    links: input.extractionModules?.links ?? true,
                    seoTags: input.extractionModules?.seoTags ?? true,
                    specialLinks: input.extractionModules?.specialLinks ?? true,
                    structuredData: input.extractionModules?.structuredData ?? true,
                    aiMetadata: input.extractionModules?.aiMetadata ?? true,
                    contentMetrics: input.extractionModules?.contentMetrics ?? true,
                    pageMap: input.extractionModules?.pageMap ?? false,
                    htmlContent: false,
                    images: true,
                },
                links: {
                    extractAttributes: false,
                    categorizeByDomain: true,
                },
                customFields: input.customFields ?? [
                    'department',
                    'category',
                    'tags',
                    'rating',
                    'difficulty',
                    'audience',
                    'priority',
                    'boost',
                ],
            },
            output: {
                files: {
                    scrapedData: 'scraped-data.json',
                    sitemap: 'sitemap.json',
                },
                storage: {
                    enabled: true,
                    path: './storage/datasets/default',
                    realTimeStorage: {
                        enabled: true,
                        saveIndividualFiles: true,
                        saveJsonl: true,
                        jsonlFilename: 'crawl-data.jsonl',
                    },
                },
                formatting: {
                    prettyPrint: input.outputFormats?.prettyPrint ?? true,
                    includeTimestamp: input.outputFormats?.includeTimestamp ?? true,
                },
            },
            logging: {
                level: envDebug || input.debugMode ? 'debug' : 'info',
                enableConsole: true,
                enableFileLogging: true,
                logFile: 'crawler.log',
                sessionLogs: true,
                events: {
                    pageProcessed: true,
                    errorEncountered: true,
                    sitemapDiscovered: true,
                    linksCategorized: (envDebug || input.debugMode) ?? false,
                },
            },
            errorHandling: {
                continueOnError: true,
                retryCount: 3,
                retryDelay: 5000,
                skipOnTimeout: true,
            },
            performance: {
                skipHeavyExtraction: input.performance?.skipHeavyExtraction ?? false,
                batchSize: 5,
                clearPageData: true,
            },
        };

        return config;
    }

    public static logInputSummary(config: ICrawlerConfig): void {
        console.log('🎭 Apify Actor Input Summary:');
        console.log(`  📍 Start URLs: ${config.targets.startUrls.length} URLs`);
        console.log(`  📊 Max requests: ${config.crawler.maxRequestsPerCrawl || 'unlimited'}`);
        console.log(`  🔄 Concurrency: ${config.crawler.maxConcurrency}`);
        console.log(
            `  🗺️ Sitemap discovery: ${config.targets.sitemapDiscovery ? 'enabled' : 'disabled'}`
        );
        console.log(`  🔧 Debug mode: ${!config.crawler.headless ? 'enabled' : 'disabled'}`);

        const enabledModules = Object.entries(config.extraction.modules)
            .filter(([_, enabled]) => enabled)
            .map(([module, _]) => module);
        console.log(`  📦 Extraction modules: ${enabledModules.join(', ')}`);
    }
}
