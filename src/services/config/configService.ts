import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ICrawlerConfig } from './types.js';

export class ConfigService {
    private static instance: ConfigService;
    private config: ICrawlerConfig | null = null;

    private constructor() {}

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    public loadConfig(configPath?: string): ICrawlerConfig {
        if (this.config) {
            return this.config;
        }

        const defaultPath = path.join(process.cwd(), 'config', 'crawler.yml');
        const targetPath = configPath ?? defaultPath;

        try {
            if (!fs.existsSync(targetPath)) {
                console.warn(`Config file not found at ${targetPath}, using defaults`);
                return this.applyEnvOverrides(this.getDefaultConfig());
            }

            const configFile = fs.readFileSync(targetPath, 'utf8');
            const parsedConfig = yaml.load(configFile) as ICrawlerConfig;

            // Validate and merge with defaults, then apply env overrides
            this.config = this.applyEnvOverrides(this.mergeWithDefaults(parsedConfig));

            console.info(`Configuration loaded from ${targetPath}`);
            return this.config;
        } catch (error) {
            console.error(`Failed to load configuration: ${error}`);
            console.info('Using default configuration');
            return this.applyEnvOverrides(this.getDefaultConfig());
        }
    }

    public getConfig(): ICrawlerConfig {
        if (!this.config) {
            return this.loadConfig();
        }
        return this.config;
    }

    public reloadConfig(configPath?: string): ICrawlerConfig {
        this.config = null;
        return this.loadConfig(configPath);
    }

    private getDefaultConfig(): ICrawlerConfig {
        return {
            targets: {
                startUrls: ['https://example.com'],
                allowedDomains: [],
                excludedDomains: [],
                excludedPaths: [],
                sitemapDiscovery: true,
                respectRobotsTxt: true,
            },
            crawler: {
                maxRequestsPerCrawl: 0,
                maxConcurrency: 1,
                requestTimeoutSecs: 120,
                headless: false,
                requestDelay: 5000,
                requestDelayMin: 5000,
                requestDelayMax: 30000,
                singleUrlMode: false,
                incrementalMode: false,
            },
            extraction: {
                modules: {
                    basicData: true,
                    responseData: true,
                    links: true,
                    seoTags: true,
                    specialLinks: true,
                    structuredData: true,
                    aiMetadata: true,
                    contentMetrics: true,
                    pageMap: true,
                    htmlContent: false,
                    images: true,
                },
                links: {
                    extractAttributes: false,
                    categorizeByDomain: true,
                },
                customFields: [
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
                    path: './storage',
                    realTimeStorage: {
                        enabled: true,
                        saveIndividualFiles: true,
                        saveJsonl: true,
                        jsonlFilename: 'crawl-data.jsonl',
                    },
                },
                formatting: {
                    prettyPrint: true,
                    includeTimestamp: true,
                },
            },
            logging: {
                level: 'info',
                enableConsole: true,
                enableFileLogging: true,
                logFile: 'crawler.log',
                sessionLogs: true,
                events: {
                    pageProcessed: true,
                    errorEncountered: true,
                    sitemapDiscovered: true,
                    linksCategorized: false,
                },
            },
            errorHandling: {
                continueOnError: true,
                retryCount: 3,
                retryDelay: 5000,
                skipOnTimeout: true,
            },
            performance: {
                skipHeavyExtraction: false,
                batchSize: 5,
                clearPageData: true,
            },
        };
    }

    private mergeWithDefaults(userConfig: Partial<ICrawlerConfig>): ICrawlerConfig {
        const defaults = this.getDefaultConfig();

        return {
            targets: { ...defaults.targets, ...userConfig.targets },
            crawler: { ...defaults.crawler, ...userConfig.crawler },
            extraction: {
                modules: { ...defaults.extraction.modules, ...userConfig.extraction?.modules },
                links: { ...defaults.extraction.links, ...userConfig.extraction?.links },
                customFields:
                    userConfig.extraction?.customFields ?? defaults.extraction.customFields,
            },
            output: {
                files: { ...defaults.output.files, ...userConfig.output?.files },
                storage: {
                    ...defaults.output.storage,
                    ...userConfig.output?.storage,
                    realTimeStorage: {
                        ...defaults.output.storage.realTimeStorage,
                        ...userConfig.output?.storage?.realTimeStorage,
                    },
                },
                formatting: { ...defaults.output.formatting, ...userConfig.output?.formatting },
            },
            logging: {
                ...defaults.logging,
                ...userConfig.logging,
                events: { ...defaults.logging.events, ...userConfig.logging?.events },
            },
            errorHandling: { ...defaults.errorHandling, ...userConfig.errorHandling },
            performance: { ...defaults.performance, ...userConfig.performance },
        };
    }

    private applyEnvOverrides(config: ICrawlerConfig): ICrawlerConfig {
        const startUrls = process.env['CRAWLER_START_URLS'];
        const allowedDomains = process.env['CRAWLER_ALLOWED_DOMAINS'];
        const excludedDomains = process.env['CRAWLER_EXCLUDED_DOMAINS'];
        const excludedPaths = process.env['CRAWLER_EXCLUDED_PATHS'];
        const sitemapDiscovery = process.env['CRAWLER_SITEMAP_DISCOVERY'];
        const respectRobotsTxt = process.env['CRAWLER_RESPECT_ROBOTS_TXT'];

        const splitTrim = (s: string) =>
            s
                .split(',')
                .map(v => v.trim())
                .filter(Boolean);

        if (startUrls) config.targets.startUrls = splitTrim(startUrls);
        if (allowedDomains) {
            config.targets.allowedDomains = Array.from(
                new Set([...config.targets.allowedDomains, ...splitTrim(allowedDomains)])
            );
        }
        if (excludedDomains) {
            config.targets.excludedDomains = Array.from(
                new Set([...config.targets.excludedDomains, ...splitTrim(excludedDomains)])
            );
        }
        if (excludedPaths) {
            config.targets.excludedPaths = Array.from(
                new Set([...config.targets.excludedPaths, ...splitTrim(excludedPaths)])
            );
        }
        if (sitemapDiscovery !== undefined)
            config.targets.sitemapDiscovery = sitemapDiscovery === 'true';
        if (respectRobotsTxt !== undefined)
            config.targets.respectRobotsTxt = respectRobotsTxt === 'true';

        return config;
    }

    public validateConfig(config: ICrawlerConfig): boolean {
        try {
            // Basic validation
            if (!config.targets.startUrls || config.targets.startUrls.length === 0) {
                throw new Error('At least one start URL is required');
            }

            // Validate URLs
            config.targets.startUrls.forEach(url => {
                try {
                    const parsedUrl = new URL(url);
                    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                        throw new Error(
                            `Forbidden protocol: ${parsedUrl.protocol}. Only http: and https: are allowed.`
                        );
                    }
                } catch (err: any) {
                    throw new Error(
                        `Invalid URL or forbidden protocol: ${url}. Details: ${err.message}`
                    );
                }
            });

            // Validate numeric values
            if (config.crawler.maxConcurrency < 1) {
                throw new Error('maxConcurrency must be at least 1');
            }

            if (config.crawler.requestTimeoutSecs < 1) {
                throw new Error('requestTimeoutSecs must be at least 1');
            }

            return true;
        } catch (error) {
            console.error(`Configuration validation failed: ${error}`);
            return false;
        }
    }

    public getBaseDomain(): string {
        const config = this.getConfig();
        const firstUrl = config.targets.startUrls[0];
        return new URL(firstUrl).hostname;
    }

    public getAllowedDomains(): string[] {
        const config = this.getConfig();
        if (config.targets.allowedDomains.length > 0) {
            return config.targets.allowedDomains;
        }
        return [this.getBaseDomain()];
    }
}
