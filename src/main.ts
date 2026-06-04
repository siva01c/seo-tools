// For more information, see https://crawlee.dev/
import { PlaywrightCrawler } from 'crawlee';
import { Actor } from 'apify';
import { ConfigService } from './services/config/configService.js';
import { ApifyConfigService } from './services/config/apifyConfig.js';
import {
    fetchSitemapUrls,
    generateSitemapXml,
    fetchHtmlSitemapUrls,
} from './services/sitemapService.js';
import { sitemapComparisonService, ISitemapUrl } from './services/sitemapComparison.js';
import { RateLimitingService, rateLimitPresets } from './services/rateLimitingService.js';
import { storageService } from './services/storageService.js';
import { UrlIndexService } from './services/urlIndexService.js';
import { isHomepage } from './utils/urlUtils.js';
import { categorizeLinks } from './utils/linkUtils.js';
import { globalUserAgentRotator } from './utils/userAgentRotator.js';
import {
    extractGoogleMetaTags,
    extractSpecialLinks,
    detectDataNoSnippet,
} from './services/metaTagService.js';
import {
    extractJsonLdStructuredData,
    extractMicrodata,
    extractCustomMetadata,
    extractPageMapData,
    extractContentMetrics,
    extractImages,
} from './services/aiMetadataService.js';
import { extractHtmlContent } from './services/htmlContentService.js';
import { Logger } from './utils/logger.js';
import { generateUniqueId, generateContentId } from './utils/idGenerator.js';

// First, we need to determine the target URL to configure storage before Actor.init()
// Parse command line arguments for target URL, single URL mode, and excluded domains
const args = process.argv.slice(2);
console.log('🐛 DEBUG: Received args:', args);
const targetUrlIndex = args.findIndex(arg => arg === '--url' || arg === '-u');
let commandLineTargetUrl =
    targetUrlIndex !== -1 && args[targetUrlIndex + 1] ? args[targetUrlIndex + 1] : null;

// Check for --url= syntax
if (!commandLineTargetUrl) {
    const urlArg = args.find(arg => arg.startsWith('--url='));
    if (urlArg) {
        commandLineTargetUrl = urlArg.split('=')[1];
    }
}

// If no --url flag, try to use first argument as URL (if it doesn't start with --)
if (!commandLineTargetUrl && args.length > 0 && !args[0].startsWith('-')) {
    commandLineTargetUrl = args[0];
}
const singleUrlMode = args.includes('--single') || args.includes('-s');

// Parse excluded domains from command line (--exclude-domains "domain1,domain2,domain3")
const excludeDomainsIndex = args.findIndex(
    arg => arg === '--exclude-domains' || arg === '--exclude'
);
const commandLineExcludedDomains =
    excludeDomainsIndex !== -1 && args[excludeDomainsIndex + 1]
        ? args[excludeDomainsIndex + 1]
              .split(',')
              .map(domain => domain.trim())
              .filter(Boolean)
        : [];

// Parse excluded paths from command line (--exclude-paths "/path1,/path2,/path3")
const excludePathsIndex = args.findIndex(
    arg => arg === '--exclude-paths' || arg === '--exclude-path'
);
const commandLineExcludedPaths =
    excludePathsIndex !== -1 && args[excludePathsIndex + 1]
        ? args[excludePathsIndex + 1]
              .split(',')
              .map(path => path.trim())
              .filter(Boolean)
        : [];

// Parse incremental mode from command line (--incremental or --incremental-date DD-MM-YYYY)
const incrementalMode = args.includes('--incremental');
const incrementalDateIndex = args.findIndex(arg => arg === '--incremental-date');
const commandLineIncrementalDate =
    incrementalDateIndex !== -1 && args[incrementalDateIndex + 1]
        ? args[incrementalDateIndex + 1]
        : null;

// Parse headless mode from command line (--headless=true/false)
const headlessArg = args.find(arg => arg.startsWith('--headless='));
console.log('🐛 DEBUG: Found headless arg:', headlessArg);
let commandLineHeadless: boolean | null = null;
if (headlessArg) {
    const headlessValue = headlessArg.split('=')[1]?.toLowerCase();
    console.log('🐛 DEBUG: Headless value:', headlessValue);
    if (headlessValue === 'true' || headlessValue === '1') {
        commandLineHeadless = true;
        console.log('🐛 DEBUG: Set commandLineHeadless to true');
    } else if (headlessValue === 'false' || headlessValue === '0') {
        commandLineHeadless = false;
        console.log('🐛 DEBUG: Set commandLineHeadless to false');
    }
}
console.log('🐛 DEBUG: Final commandLineHeadless value:', commandLineHeadless);

// Parse rate limiting from command line
const rateLimitArg = args.find(arg => arg.startsWith('--rate-limit='));
let commandLineRateLimit: string | null = null;
if (rateLimitArg) {
    commandLineRateLimit = rateLimitArg.split('=')[1];
}

// Parse HTML sitemap URL from command line (--html-sitemap-url <URL>)
const htmlSitemapUrlIndex = args.findIndex(arg => arg === '--html-sitemap-url');
const commandLineHtmlSitemapUrl =
    htmlSitemapUrlIndex !== -1 && args[htmlSitemapUrlIndex + 1]
        ? args[htmlSitemapUrlIndex + 1]
        : null;

// Parse --html-content flag (enables htmlContent extraction module)
const commandLineHtmlContent = args.includes('--html-content');

// Check for START_URL environment variable (for Docker)
const envTargetUrl = process.env.START_URL;

// Prioritize command line, then environment variable, then config file
let earlyTargetUrl = commandLineTargetUrl ?? envTargetUrl;
if (!earlyTargetUrl) {
    // Load config file to get start URLs as fallback
    try {
        const { ConfigService } = await import('./services/config/configService.js');
        const configService = ConfigService.getInstance();
        const config = configService.loadConfig();
        if (config.targets.startUrls && config.targets.startUrls.length > 0) {
            earlyTargetUrl = config.targets.startUrls[0];
        }
    } catch {
        // Config file might not exist or be invalid
    }
}

// If still no URL found, abort
if (!earlyTargetUrl) {
    console.error('❌ Domain is required');
    console.error('Usage: npm run crawl <URL> [OPTIONS] or provide URL in configuration');
    console.error('');
    console.error('Options:');
    console.error('  --url, -u <URL>                    Target URL to crawl');
    console.error(
        '  --exclude-domains <domains>        Comma-separated list of domains to exclude'
    );
    console.error(
        '  --headless=<true|false>            Set headless mode (true=invisible, false=visible)'
    );
    console.error("  --single, -s                       Single URL mode - don't follow links");
    console.error(
        '  --rate-limit=<preset|format>       Rate limiting: preset name or "requests/hours"'
    );
    console.error('');
    console.error('Rate Limiting Presets:');
    console.error('  conservative  - 100 requests per hour');
    console.error('  moderate      - 200 requests per 2 hours');
    console.error('  aggressive    - 500 requests per 3 hours');
    console.error('  bulk          - 1000 requests per 5 hours');
    console.error('  tiered        - Multiple rules: 120/h, 300/3h, 600/5h');
    console.error('');
    console.error('Examples:');
    console.error('  npm run crawl https://example.com');
    console.error(
        '  npm run crawl https://example.com --exclude-domains "api.example.com,cdn.example.com"'
    );
    console.error('  npm run crawl https://example.com --headless=false');
    console.error('  npm run crawl https://example.com --rate-limit=moderate');
    console.error('  npm run crawl https://example.com --rate-limit=200/3');
    process.exit(1);
}

// Initialize domain-based storage BEFORE Actor.init()
const storageConfig = storageService.initializeStorage(earlyTargetUrl);
storageService.configureApifyStorage();

// Initialize URL index service
const urlIndexService = new UrlIndexService(
    storageConfig.domain,
    storageConfig.dateFolder,
    storageConfig.basePath
);

// Initialize Apify Actor after storage configuration
await Actor.init();

// Initialize logger
const logger = Logger.getInstance();
logger.configure({
    logLevel: 'info',
    enableFileLogging: true,
    logFile: 'crawler.log',
    domain: storageConfig.domain,
    dateFolder: storageConfig.dateFolder,
    storagePath: storageConfig.basePath,
});

// Set initial status
await Actor.setStatusMessage('Initializing SEO & GenAI Crawler...');
logger.info('Initializing SEO & GenAI Crawler');

// Command line target URL was already parsed earlier
if (commandLineTargetUrl) {
    console.log(`🎯 Target URL provided via command line: ${commandLineTargetUrl}`);

    // Validate URL format
    try {
        const parsedUrl = new URL(commandLineTargetUrl);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error(
                `Forbidden protocol: ${parsedUrl.protocol}. Only http: and https: are allowed.`
            );
        }
    } catch (err: any) {
        console.error(
            `❌ Invalid URL format or forbidden protocol: ${commandLineTargetUrl}. Details: ${err.message}`
        );
        await Actor.fail('Invalid URL format provided');
        process.exit(1);
    }
}

// Load configuration (either from Apify input or local YAML)
let config;
let configService;

try {
    await Actor.setStatusMessage('Loading configuration...');

    // Try to get configuration from Apify input first
    config = await ApifyConfigService.getConfigFromInput();
    logger.setLogLevel(config.logging.level);
    ApifyConfigService.logInputSummary(config);
    logger.info('Using Apify actor input configuration');
    logger.configInfo(config);

    await Actor.setStatusMessage('Configuration loaded from Apify input');
} catch {
    // Fallback to local YAML configuration
    await Actor.setStatusMessage('Loading local YAML configuration...');
    console.log('📝 No Apify input found, using local configuration');
    configService = ConfigService.getInstance();
    config = configService.loadConfig();

    // Override start URLs with command line or environment URL if provided (before validation)
    if (commandLineTargetUrl) {
        config.targets.startUrls = [commandLineTargetUrl];
        console.log(`🔄 Overriding configuration with command line URL: ${commandLineTargetUrl}`);
    } else if (envTargetUrl) {
        config.targets.startUrls = [envTargetUrl];
        console.log(`🔄 Overriding configuration with environment URL: ${envTargetUrl}`);
    }

    // Validate configuration
    if (!configService.validateConfig(config)) {
        console.error('❌ Configuration validation failed');
        await Actor.fail('Configuration validation failed');
        process.exit(1);
    }

    await Actor.setStatusMessage('Local configuration loaded and validated');

    // Configure logger with loaded configuration
    logger.configure({
        logLevel: config.logging.level,
        enableFileLogging: config.logging.enableFileLogging,
        logFile: config.logging.logFile,
        domain: storageConfig.domain,
        dateFolder: storageConfig.dateFolder,
        storagePath: storageConfig.basePath,
    });
}

// Override excluded domains with command line if provided
if (commandLineExcludedDomains.length > 0) {
    config.targets.excludedDomains = commandLineExcludedDomains;
    console.log(
        `🚫 Overriding excluded domains with command line: ${commandLineExcludedDomains.join(', ')}`
    );
}

// Override excluded paths with command line if provided
if (commandLineExcludedPaths.length > 0) {
    config.targets.excludedPaths = commandLineExcludedPaths;
    console.log(
        `🚫 Overriding excluded paths with command line: ${commandLineExcludedPaths.join(', ')}`
    );
}

// Override HTML sitemap URL with command line if provided
if (commandLineHtmlSitemapUrl) {
    config.targets.htmlSitemapUrl = commandLineHtmlSitemapUrl;
    console.log(`🗺️  Overriding HTML sitemap URL with command line: ${commandLineHtmlSitemapUrl}`);
}

// Enable htmlContent extraction module if --html-content flag is set
if (commandLineHtmlContent) {
    config.extraction.modules.htmlContent = true;
    console.log(`🧩 HTML content extraction enabled via command line`);
}

// Override headless mode with command line if provided
if (commandLineHeadless !== null) {
    config.crawler.headless = commandLineHeadless;
    console.log(
        `🖥️ Overriding headless mode with command line: ${commandLineHeadless ? 'enabled (invisible browser)' : 'disabled (visible browser)'}`
    );
}

// Override incremental mode with command line if provided
if (incrementalMode) {
    config.crawler.incrementalMode = true;
    if (commandLineIncrementalDate) {
        config.crawler.incrementalConfig ??= {
            mode: 'incremental',
            autoDetectPreviousCrawl: false,
            maxAgeThresholdDays: 30,
        };
        config.crawler.incrementalConfig.previousCrawlDate = commandLineIncrementalDate;
        config.crawler.incrementalConfig.autoDetectPreviousCrawl = false;
    }
    console.log(
        `🔄 Incremental mode enabled via command line${commandLineIncrementalDate ? ` with date: ${commandLineIncrementalDate}` : ''}`
    );
}

// Override rate limiting with command line if provided
if (commandLineRateLimit) {
    config.crawler.rateLimiting ??= {
        enabled: false,
        rules: [],
        persistData: true,
    };

    if (commandLineRateLimit in rateLimitPresets) {
        // Use preset configuration
        const preset = rateLimitPresets[commandLineRateLimit as keyof typeof rateLimitPresets];
        config.crawler.rateLimiting = { ...preset };
        console.log(
            `⏱️ Rate limiting enabled via command line with preset: ${commandLineRateLimit}`
        );
    } else {
        // Try to parse custom format: "requests/hours" e.g., "200/3" for 200 requests per 3 hours
        const match = commandLineRateLimit.match(/^(\d+)\/(\d+)$/);
        if (match) {
            const [, requests, hours] = match;
            const maxRequests = parseInt(requests, 10);
            const windowHours = parseInt(hours, 10);

            if (windowHours >= 1 && windowHours <= 5) {
                config.crawler.rateLimiting = {
                    enabled: true,
                    persistData: true,
                    rules: [
                        {
                            windowHours,
                            maxRequests,
                            enabled: true,
                            description: `${maxRequests} requests per ${windowHours} hour(s) (command line)`,
                        },
                    ],
                };
                console.log(
                    `⏱️ Rate limiting enabled via command line: ${maxRequests} requests per ${windowHours} hour(s)`
                );
            } else {
                console.warn(
                    `⚠️ Invalid window hours: ${windowHours} (must be 1-5). Rate limiting not applied.`
                );
            }
        } else {
            console.warn(
                `⚠️ Invalid rate limit format: ${commandLineRateLimit}. Use format "requests/hours" (e.g., "200/3") or preset name.`
            );
        }
    }
}

// Get base domain for rate limiting and link categorization
let baseDomain = new URL(config.targets.startUrls[0]).hostname;
console.log(`🌐 Initial base domain for link categorization: ${baseDomain}`);

// Initialize rate limiting service
let rateLimitingService: RateLimitingService | null = null;
if (config.crawler.rateLimiting?.enabled) {
    rateLimitingService = new RateLimitingService(
        {
            enabled: config.crawler.rateLimiting.enabled,
            rules: config.crawler.rateLimiting.rules,
            persistData: config.crawler.rateLimiting.persistData,
        },
        baseDomain
    );
    console.log('⏱️ Rate limiting enabled');
    console.log(rateLimitingService.getStatusSummary());
}

// Display final configuration after any overrides
console.log('📝 Final configuration:');
console.log(`  Start URLs: ${config.targets.startUrls.join(', ')}`);
console.log(`  Max requests: ${config.crawler.maxRequestsPerCrawl ?? 'unlimited'}`);
console.log(
    `  Headless mode: ${config.crawler.headless ? 'enabled (invisible browser)' : 'disabled (visible browser)'}`
);
console.log(`  Sitemap discovery: ${config.targets.sitemapDiscovery}`);
if (config.targets.excludedDomains && config.targets.excludedDomains.length > 0) {
    console.log(`  Excluded domains: ${config.targets.excludedDomains.join(', ')}`);
}
if (config.crawler.rateLimiting?.enabled) {
    console.log(
        `  Rate limiting: enabled (${config.crawler.rateLimiting.rules.filter(r => r.enabled).length} active rules)`
    );
}

// Override single URL mode if specified via command line or environment
if (singleUrlMode || process.env.SINGLE_URL_MODE === 'true') {
    config.crawler.singleUrlMode = true;
    console.log(`🎯 Single URL mode enabled - will only crawl the specified URL`);
}

// Function to generate random delay between requests
const getRandomDelay = (): number => {
    const min = config.crawler.requestDelayMin ?? 500;
    const max = config.crawler.requestDelayMax ?? 6000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

// PlaywrightCrawler crawls the web using a headless
// browser controlled by the Playwright library.
const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: config.crawler.maxRequestsPerCrawl || undefined,
    maxConcurrency: config.crawler.maxConcurrency,
    requestHandlerTimeoutSecs: config.crawler.requestTimeoutSecs,
    headless: config.crawler.headless,

    // Enhanced browser configuration to avoid bot detection
    launchContext: {
        launchOptions: {
            args: config.crawler.headless
                ? (config.crawler.launchArgs?.headless ?? [])
                : (config.crawler.launchArgs?.visible ?? []),
        },
    },

    // Enhanced fingerprinting and headers
    preNavigationHooks: [
        async (crawlingContext, _gotoOptions): Promise<void> => {
            const { page } = crawlingContext;

            // Set full browser width viewport first
            await page.setViewportSize({ width: 1920, height: 1080 });

            // Set user-agent from rotator and realistic headers
            const currentUserAgent = globalUserAgentRotator.getCurrentUserAgent();
            await page.setExtraHTTPHeaders({
                'User-Agent': currentUserAgent,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                Connection: 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0',
            });
        },
    ],

    // Use the requestHandler to process each of the crawled pages.
    async requestHandler({ request, page, enqueueLinks, log, pushData, response }): Promise<void> {
        const currentUrl = request.loadedUrl || request.url;

        // Check rate limiting before processing
        if (rateLimitingService) {
            const rateLimitStatus = rateLimitingService.canMakeRequest();

            if (rateLimitStatus.isBlocked) {
                const delayMs = rateLimitStatus.nextAllowedTime - Date.now();
                const delaySec = Math.ceil(delayMs / 1000);

                console.log(
                    `⏳ Rate limit reached - waiting ${delaySec} seconds before processing ${currentUrl}`
                );
                console.log(
                    `📊 Blocking rule: ${rateLimitStatus.blockingRule?.description ?? 'Unknown rule'}`
                );

                await Actor.setStatusMessage(`Rate limited - waiting ${delaySec}s...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));

                console.log(`✅ Rate limit wait completed - proceeding with ${currentUrl}`);
            }
        }

        // Update URL status to processing
        urlIndexService.updateUrlStatus(currentUrl, 'processing');

        // Check if URL was already crawled
        if (crawlingMap.has(currentUrl)) {
            const existingEntry = crawlingMap.get(currentUrl);
            if (!existingEntry) return;
            existingEntry.crawlCount++;
            console.log(
                `🔄 URL already crawled ${existingEntry.crawlCount} times: ${currentUrl} (Status: ${existingEntry.status})`
            );

            // Skip if already successfully crawled
            if (existingEntry.status && existingEntry.status >= 200 && existingEntry.status < 400) {
                console.log(`✅ Skipping already successfully crawled URL: ${currentUrl}`);
                return;
            }
        }

        pagesProcessed++;
        const progress = config.crawler.maxRequestsPerCrawl
            ? `${pagesProcessed}/${config.crawler.maxRequestsPerCrawl}`
            : `${pagesProcessed}`;

        await Actor.setStatusMessage(`Processing page ${progress}: ${currentUrl}`);

        // Different scrolling behavior based on headless mode
        if (!config.crawler.headless) {
            // Non-headless mode: Wait for full page load then scroll to middle
            console.log(
                `🌐 Page loaded: ${request.loadedUrl} - waiting for full load then scrolling to middle...`
            );

            // Wait for page to be fully loaded (additional time for non-headless)
            await new Promise(resolve => setTimeout(resolve, 3000));
            console.log('⏰ Waited 3 seconds for full page load...');

            try {
                await page.evaluate((): Promise<void> => {
                    return new Promise<void>(resolve => {
                        // eslint-disable-next-line no-undef
                        const scrollHeight = document.body.scrollHeight;
                        const middlePosition = scrollHeight / 2;

                        console.log(
                            `📜 Scrolling to middle of page (${Math.round(middlePosition)}px)...`
                        );

                        // Smooth scroll to middle
                        // eslint-disable-next-line no-undef
                        window.scrollTo({
                            top: middlePosition,
                            behavior: 'smooth',
                        });

                        // Wait for smooth scroll to complete
                        setTimeout(() => {
                            console.log(
                                `📜 Reached middle of page, staying here for inspection...`
                            );
                            resolve();
                        }, 2000);
                    });
                });

                // Additional wait time for inspection in visible mode
                const waitTime = 5000 + Math.random() * 3000; // 5-8 seconds
                console.log(
                    `📜 Staying at middle position for ${Math.round(waitTime / 1000)} seconds for inspection...`
                );
                await new Promise(resolve => setTimeout(resolve, waitTime));
                console.log('⏰ Continuing with data extraction...');
            } catch (scrollError) {
                console.warn(
                    `⚠️  Middle scrolling failed for ${request.loadedUrl}: ${scrollError instanceof Error ? scrollError.message : String(scrollError)}`
                );
                console.log('⏰ Continuing with data extraction without scrolling...');
            }
        } else {
            // Headless mode: Original bottom scrolling behavior
            console.log(`🌐 Page loaded: ${request.loadedUrl} - scrolling to bottom...`);

            try {
                await page.evaluate((): Promise<void> => {
                    return new Promise<void>(resolve => {
                        let totalHeight = 0;
                        const baseDistance = 50; // Base scroll distance
                        const baseDelay = 800; // Base delay between scrolls (800ms)
                        let scrollCount = 0;

                        const scrollStep = (): void => {
                            // eslint-disable-next-line no-undef
                            const scrollHeight = document.body.scrollHeight;

                            // Random variations to mimic human scrolling
                            const randomDistance = baseDistance + Math.random() * 30 - 15; // 35-65px
                            const randomDelay = baseDelay + Math.random() * 400 - 200; // 600-1000ms

                            // eslint-disable-next-line no-undef
                            window.scrollBy(0, randomDistance);
                            totalHeight += randomDistance;
                            scrollCount++;

                            // Log progress every 5 scrolls
                            if (scrollCount % 5 === 0) {
                                console.log(
                                    `📜 Scroll progress: ${scrollCount} scrolls, ${Math.round(totalHeight)}px scrolled`
                                );
                            }

                            // Add longer breaks every 15 scrolls (more human-like)
                            if (scrollCount % 15 === 0) {
                                console.log(
                                    `⏸️  Taking a 3-second break after ${scrollCount} scrolls...`
                                );
                                setTimeout(() => {
                                    if (totalHeight >= scrollHeight) {
                                        console.log(`📜 Reached bottom, scrolling back to top...`);
                                        // eslint-disable-next-line no-undef
                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                        setTimeout(resolve, 1500); // Wait for smooth scroll
                                    } else {
                                        setTimeout(scrollStep, randomDelay);
                                    }
                                }, 3000);
                            } else {
                                if (totalHeight >= scrollHeight) {
                                    console.log(`📜 Reached bottom, scrolling back to top...`);
                                    // eslint-disable-next-line no-undef
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                    setTimeout(resolve, 1500); // Wait for smooth scroll
                                } else {
                                    setTimeout(scrollStep, randomDelay);
                                }
                            }
                        };

                        // Start scrolling
                        scrollStep();
                    });
                });
            } catch (scrollError) {
                console.warn(
                    `⚠️  Scrolling failed for ${request.loadedUrl}: ${scrollError instanceof Error ? scrollError.message : String(scrollError)}`
                );
                console.log('⏰ Continuing with data extraction without scrolling...');
            }
        }

        // Add human-like mouse movement (for both modes)
        try {
            await page.mouse.move(Math.random() * 800 + 100, Math.random() * 600 + 100);
            await page.mouse.move(Math.random() * 800 + 100, Math.random() * 600 + 100);
        } catch (mouseError) {
            console.warn(
                `⚠️  Mouse movement failed: ${mouseError instanceof Error ? mouseError.message : String(mouseError)}`
            );
        }

        // Add this crawled URL to the sitemap collection
        allCrawledUrls.add(request.loadedUrl || request.url);

        // Update base domain if this is the first request and we got redirected
        if (pagesProcessed === 1 && request.loadedUrl) {
            const actualDomain = new URL(request.loadedUrl).hostname;
            if (actualDomain !== baseDomain) {
                console.log(
                    `🔄 Domain updated from ${baseDomain} to ${actualDomain} (redirect detected)`
                );
                baseDomain = actualDomain;
            }
        }

        const title = await page.title();

        // Log crawler progress every 10 pages
        if (pagesProcessed % 10 === 0) {
            logger.crawlerStats({
                pagesProcessed,
                totalUrls: config.crawler.maxRequestsPerCrawl || totalUrlsDiscovered,
                errorsEncountered,
                currentUrl: request.loadedUrl,
            });
        }

        // Get response information (if enabled)
        const responseData = config.extraction.modules.responseData
            ? {
                  status: response?.status() ?? null,
                  statusText: response?.statusText() ?? null,
                  headers: response?.headers() ?? {},
                  url: request.loadedUrl,
              }
            : undefined;

        // Update crawling map with current URL status
        const currentStatus = response?.status() ?? null;
        const currentStatusText = response?.statusText() ?? null;
        crawlingMap.set(currentUrl, {
            status: currentStatus,
            statusText: currentStatusText,
            timestamp: new Date().toISOString(),
            crawlCount: crawlingMap.has(currentUrl)
                ? (crawlingMap.get(currentUrl)?.crawlCount ?? 0) + 1
                : 1,
        });

        console.log(`📊 Status tracking: ${currentUrl} → ${currentStatus} (${currentStatusText})`);

        // Check for blocked or redirected responses
        if (response?.status() && (response.status() >= 400 || response.status() === 302)) {
            const statusCode = response.status();
            const statusText = response.statusText();

            if (statusCode === 403) {
                consecutive403Errors++;
                console.warn(
                    `🚫 Access denied (403) for ${request.loadedUrl} - likely blocked by anti-bot protection (${consecutive403Errors} consecutive)`
                );

                // Rotate user-agent after 3 consecutive 403s
                if (consecutive403Errors >= 3 && Date.now() - lastUserAgentRotation > 60000) {
                    const newUserAgent = globalUserAgentRotator.getNextUserAgent();
                    console.log(`🔄 Rotating User-Agent due to repeated 403 errors`);

                    // Update the user-agent for future requests
                    await page.setExtraHTTPHeaders({
                        'User-Agent': newUserAgent,
                    });

                    lastUserAgentRotation = Date.now();
                    consecutive403Errors = 0; // Reset counter after rotation
                }

                // If running in visible browser mode, wait 20 seconds before next URL
                if (!config.crawler.headless) {
                    console.log(
                        `⏰ Headless mode is OFF - waiting 20 seconds before processing next URL to avoid detection...`
                    );
                    await new Promise(resolve => setTimeout(resolve, 20000));
                    console.log(`✅ 20-second wait completed, continuing to next URL...`);
                }
            } else if (statusCode === 404) {
                // Reset 403 counter on successful requests
                consecutive403Errors = 0;
                console.warn(`❌ Page not found (404) for ${request.loadedUrl}`);
            } else if (statusCode === 302) {
                console.warn(
                    `🔄 Redirected (302) for ${request.loadedUrl} - possible login required`
                );
            } else {
                console.warn(`⚠️  HTTP ${statusCode} ${statusText} for ${request.loadedUrl}`);
            }

            // Continue with extraction but with limited data
            console.log('📊 Continuing with limited data extraction...');
        }

        // Extract all links (if enabled)
        let allLinks: Array<{
            text: string;
            href: string;
            rel: string;
            link_title: string;
        }> = [];

        // Wait for page to be fully loaded before extracting links
        await page.waitForLoadState('networkidle');
        let internalLinks: Array<{
            text: string;
            href: string;
            rel: string;
            link_title: string;
        }> = [];
        let externalLinks: Array<{
            text: string;
            href: string;
            rel: string;
            link_title: string;
        }> = [];

        if (config.extraction.modules.links) {
            console.log(`🔍 Extracting links from: ${request.loadedUrl}`);

            allLinks = await page.$$eval('a[href]', anchors =>
                anchors.map(a => {
                    const anchor = a as HTMLAnchorElement;
                    return {
                        text: anchor.textContent?.trim() ?? '',
                        href: anchor.href,
                        // Only extract attributes if configured
                        // Attributes can be added here if needed
                        rel: anchor.rel,
                        link_title: anchor.title || '',
                    };
                })
            );

            console.log(`🔗 Found ${allLinks.length} total links on page`);
            logger.infoUrl(currentUrl, `Found ${allLinks.length} total links on page`);

            // Categorize links if enabled
            console.log(
                `🔧 categorizeByDomain setting: ${config.extraction.links.categorizeByDomain}`
            );
            if (config.extraction.links.categorizeByDomain) {
                const categorized = categorizeLinks(
                    allLinks,
                    baseDomain,
                    config.targets.excludedDomains,
                    config.targets.excludedPaths,
                    config.targets.allowedDomains
                );
                internalLinks = categorized.internal;
                externalLinks = categorized.external;

                // Collect internal links for sitemap generation
                internalLinks.forEach(link => {
                    if (link.href && typeof link.href === 'string') {
                        allInternalLinksForSitemap.add(link.href);
                    }
                });

                // Update statistics
                console.log(
                    `📊 Page stats: ${internalLinks.length} internal, ${externalLinks.length} external links`
                );
                seoDataExtracted.totalInternalLinks += internalLinks.length;
                seoDataExtracted.totalExternalLinks += externalLinks.length;
                console.log(
                    `📈 Running totals: ${seoDataExtracted.totalInternalLinks} internal, ${seoDataExtracted.totalExternalLinks} external`
                );
            }
        }

        // Extract SEO metadata (if enabled)
        let googleMetaTags = {};
        let specialLinks = {};
        let hasDataNoSnippet = false;

        if (config.extraction.modules.seoTags) {
            googleMetaTags = await extractGoogleMetaTags(page);
            seoDataExtracted.totalMetaTags += Object.keys(googleMetaTags).length;
        }

        if (config.extraction.modules.specialLinks) {
            specialLinks = await extractSpecialLinks(page);
            hasDataNoSnippet = await detectDataNoSnippet(page);
        }

        // Extract AI-specific metadata (if enabled)
        let jsonLdData: unknown[] = [];
        let microdataItems: unknown[] = [];
        let customMetadata = {};
        let pageMapData = {};
        let contentMetrics = {};

        if (config.extraction.modules.structuredData) {
            jsonLdData = await extractJsonLdStructuredData(page);
            microdataItems = await extractMicrodata(page);
            seoDataExtracted.totalStructuredData += jsonLdData.length + microdataItems.length;
        }

        if (config.extraction.modules.aiMetadata) {
            customMetadata = await extractCustomMetadata(page);
        }

        if (config.extraction.modules.pageMap) {
            pageMapData = await extractPageMapData(page);
        }

        if (config.extraction.modules.contentMetrics) {
            contentMetrics = await extractContentMetrics(page);
        }

        // Extract HTML content (full page + main article body)
        let htmlContent: { full: string; main: string; mainSelector: string } | undefined;
        if (config.extraction.modules.htmlContent) {
            htmlContent = await extractHtmlContent(page);
            console.log(
                `🧩 HTML content extracted: full=${htmlContent.full.length} chars, main=${htmlContent.main.length} chars (selector: ${htmlContent.mainSelector})`
            );
        }

        // Extract image metadata
        let imagesData: unknown[] = [];
        if (config.extraction.modules.images) {
            imagesData = await extractImages(page);
            console.log(`🖼️  Extracted ${imagesData.length} images from ${request.loadedUrl}`);
        }

        // Extract full text content from the page (without HTML code)
        let fullTextContent = '';
        try {
            fullTextContent = await page.evaluate((): string => {
                // Remove script and style elements completely
                // eslint-disable-next-line no-undef
                const scripts = document.querySelectorAll('script, style, noscript');
                scripts.forEach(element => element.remove());

                // Get text content from body, removing extra whitespace

                const bodyText =
                    // eslint-disable-next-line no-undef
                    document.body?.innerText ?? document.documentElement.innerText ?? '';

                // Clean up the text: normalize whitespace, remove extra line breaks
                return bodyText
                    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
                    .replace(/\n\s*\n/g, '\n') // Replace multiple line breaks with single line break
                    .trim(); // Remove leading/trailing whitespace
            });

            console.log(
                `📄 Extracted ${fullTextContent.length} characters of text content from ${request.loadedUrl}`
            );
        } catch (textError) {
            console.warn(
                `⚠️ Failed to extract text content from ${request.loadedUrl}: ${textError instanceof Error ? textError.message : String(textError)}`
            );
            fullTextContent = '';
        }

        log.info(
            `Title of ${request.loadedUrl} is '${title}' (Status: ${responseData?.status ?? 'N/A'})`
        );

        // URL-specific logging
        logger.infoUrl(
            currentUrl,
            `Page processing started - Title: "${title}", Status: ${responseData?.status ?? 'N/A'}`
        );

        // Build scraped data based on configuration
        const scrapedData: Record<string, unknown> = {};

        if (config.extraction.modules.basicData) {
            scrapedData.title = title;
            scrapedData.url = request.loadedUrl;
            scrapedData.fullText = fullTextContent;
            if (config.output.formatting.includeTimestamp) {
                scrapedData.timestamp = new Date().toISOString();
            }
        }

        if (responseData) {
            scrapedData.response = responseData;
        }

        // Add unique encrypted identifier based on response data
        if (scrapedData.timestamp && responseData) {
            scrapedData.response_id = generateUniqueId(responseData, String(scrapedData.timestamp));
            console.log(
                `🔑 Generated response ID: ${scrapedData.response_id} for URL: ${request.loadedUrl}`
            );
        } else {
            console.log(
                `⚠️  Could not generate response ID - timestamp: ${!!scrapedData.timestamp}, responseData: ${!!responseData}`
            );
        }

        // Add unique identifier based on plain text content
        if (scrapedData.timestamp && fullTextContent) {
            scrapedData.content_id = generateContentId(
                fullTextContent,
                String(scrapedData.timestamp)
            );
            console.log(
                `🔑 Generated content ID: ${scrapedData.content_id} for URL: ${request.loadedUrl}`
            );
        } else {
            console.log(
                `⚠️  Could not generate content ID - timestamp: ${!!scrapedData.timestamp}, fullTextContent: ${!!fullTextContent}`
            );
        }

        // Add etag if available
        if (responseData?.headers?.['etag']) {
            scrapedData.etag = responseData.headers['etag'];
        }

        if (config.extraction.modules.seoTags || config.extraction.modules.specialLinks) {
            scrapedData.seo = {
                ...(config.extraction.modules.seoTags && { metaTags: googleMetaTags }),
                ...(config.extraction.modules.specialLinks && {
                    specialLinks: specialLinks,
                    hasDataNoSnippet: hasDataNoSnippet,
                }),
            };
        }

        if (
            config.extraction.modules.structuredData ||
            config.extraction.modules.aiMetadata ||
            config.extraction.modules.pageMap
        ) {
            scrapedData.aiMetadata = {
                ...(config.extraction.modules.structuredData && {
                    structuredData: {
                        jsonLd: jsonLdData,
                        microdata: microdataItems,
                    },
                }),
                ...(config.extraction.modules.aiMetadata && {
                    customMetadata: {
                        ...customMetadata,
                        ...(config.extraction.modules.contentMetrics && contentMetrics),
                    },
                }),
                ...(config.extraction.modules.pageMap && { pageMap: pageMapData }),
            };
        }

        if (config.extraction.modules.links && allLinks.length > 0) {
            scrapedData.links = {
                ...(config.extraction.links.categorizeByDomain && {
                    internal: internalLinks,
                    external: externalLinks,
                }),
                total: allLinks.length,
            };
        }

        if (config.extraction.modules.htmlContent && htmlContent) {
            scrapedData.htmlContent = htmlContent;
        }

        if (config.extraction.modules.images && imagesData.length > 0) {
            scrapedData.images = imagesData;
        }

        // Save results to Apify dataset
        if (config.output.storage.enabled) {
            await pushData(scrapedData);
        }

        // Save data immediately to file during crawling (if enabled)
        if (config.output.storage.realTimeStorage.enabled) {
            try {
                // Also append to continuous JSONL file
                if (config.output.storage.realTimeStorage.saveJsonl) {
                    const domainJsonlFilename = `${storageService.getDomainFilename()}.jsonl`;
                    await storageService.appendToJsonl(scrapedData, domainJsonlFilename);
                }
            } catch (error) {
                console.error(
                    '⚠️ Failed to save data in real-time:',
                    error instanceof Error ? error.message : String(error)
                );
                logger.errorUrl(currentUrl, 'Failed to save data in real-time', error);
            }
        }

        // Log completion of page processing
        logger.infoUrl(
            currentUrl,
            `Page processing completed - ${Object.keys(scrapedData).length} data fields extracted`
        );

        // Extract links from the current page and add them to the crawling queue
        // Only enqueue internal links to stay within the same domain (unless in single URL mode)
        if (!config.crawler.singleUrlMode) {
            await enqueueLinks({
                strategy: 'same-domain',
                // Use transformRequestFunction to filter URLs before they're added to the queue
                transformRequestFunction: originalRequest => {
                    try {
                        const parsedUrl = new URL(originalRequest.url);
                        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
                            console.log(
                                `🚫 Excluding URL from crawling queue due to forbidden protocol: ${originalRequest.url}`
                            );
                            return false;
                        }
                        const hostname = parsedUrl.hostname;

                        // Check if domain is excluded
                        const isDomainExcluded = config.targets.excludedDomains.some(
                            excludedDomain => {
                                // Exact hostname match (with and without www)
                                const normalizeHostname = (hostname: string): string =>
                                    hostname.replace(/^www\./, '');
                                const normalizedHostname = normalizeHostname(hostname);
                                const normalizedExcludedDomain = normalizeHostname(excludedDomain);

                                const matches =
                                    hostname === excludedDomain ||
                                    normalizedHostname === normalizedExcludedDomain ||
                                    hostname.endsWith('.' + excludedDomain) ||
                                    excludedDomain.endsWith('.' + hostname);

                                if (matches) {
                                    console.log(
                                        `🔍 DEBUG: Domain excluded - hostname: ${hostname}, excludedDomain: ${excludedDomain}`
                                    );
                                }

                                return matches;
                            }
                        );

                        // Check if path is excluded
                        const isPathExcluded = config.targets.excludedPaths.some(excludedPath => {
                            const urlPath = parsedUrl.pathname;
                            // Support exact match and prefix match
                            return urlPath === excludedPath || urlPath.startsWith(excludedPath);
                        });

                        // Check if domain is in allowed domains list
                        const allowedDomains =
                            config.targets.allowedDomains.length > 0
                                ? config.targets.allowedDomains
                                : [baseDomain];

                        console.log(
                            `🔍 DEBUG: Checking domain ${hostname} against allowedDomains: [${allowedDomains.join(', ')}]`
                        );

                        const isDomainAllowed = allowedDomains.some(allowedDomain => {
                            const normalizeHostname = (hostname: string): string =>
                                hostname.replace(/^www\./, '');
                            const normalizedHostname = normalizeHostname(hostname);
                            const normalizedAllowedDomain = normalizeHostname(allowedDomain);

                            const matches =
                                normalizedHostname === normalizedAllowedDomain ||
                                hostname === allowedDomain ||
                                normalizedHostname.endsWith('.' + normalizedAllowedDomain) ||
                                normalizedAllowedDomain.endsWith('.' + normalizedHostname);

                            console.log(
                                `🔍 DEBUG: Testing ${hostname} vs ${allowedDomain} - normalized: ${normalizedHostname} vs ${normalizedAllowedDomain} - matches: ${matches}`
                            );

                            return matches;
                        });

                        console.log(
                            `🔍 DEBUG: Final decision for ${originalRequest.url} - isDomainExcluded: ${isDomainExcluded}, isPathExcluded: ${isPathExcluded}, isDomainAllowed: ${isDomainAllowed}`
                        );

                        if (isDomainExcluded) {
                            console.log(
                                `🚫 Excluding URL from crawling queue: ${originalRequest.url} (domain: ${hostname}) - REASON: Domain is in excludedDomains list`
                            );
                            return false; // Return false to skip this URL
                        }

                        if (isPathExcluded) {
                            console.log(
                                `🚫 Excluding URL from crawling queue: ${originalRequest.url} (path: ${parsedUrl.pathname}) - REASON: Path is in excludedPaths list`
                            );
                            return false; // Return false to skip this URL
                        }

                        if (!isDomainAllowed) {
                            console.log(
                                `🌐 Excluding domain not in allowed list: ${originalRequest.url} (domain: ${hostname}) - REASON: Domain is not in allowedDomains list`
                            );
                            return false; // Return false to skip this URL
                        }

                        // Add URL to index when it's accepted for crawling
                        urlIndexService.addUrl(originalRequest.url);

                        return originalRequest; // Return the original request to include it
                    } catch {
                        console.log(
                            `⚠️ Invalid URL in crawling queue filter: ${originalRequest.url}`
                        );
                        return false; // Return false to skip invalid URLs
                    }
                },
            });
        } else {
            console.log(`🎯 Single URL mode: Skipping link discovery for ${request.loadedUrl}`);
        }

        // Record request for rate limiting (after processing)
        if (rateLimitingService) {
            const success = !response || (response.status() >= 200 && response.status() < 400);
            rateLimitingService.recordRequest(currentUrl, success, response?.status());

            // Log rate limiting status every 10 requests
            if (pagesProcessed % 10 === 0) {
                console.log(rateLimitingService.getStatusSummary());
            }
        }

        // Add random delay between requests
        if (config.crawler.requestDelayMin && config.crawler.requestDelayMax) {
            const delay = getRandomDelay();
            console.log(`💤 Random delay: ${delay}ms before next request`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    },

    // Handle failed requests
    async failedRequestHandler({ request, error }): Promise<void> {
        const currentUrl = request.loadedUrl || request.url;
        const errorMessage = error instanceof Error ? error.message : String(error);

        console.error(`❌ Failed to process URL: ${currentUrl}`, errorMessage);

        // Check for user-agent function error and pause browser
        if (errorMessage.includes('page.setUserAgent is not a function')) {
            console.error(
                `🚨 User-Agent function error detected - keeping browser open for 60 seconds for inspection`
            );
            console.log(`⏰ Browser will remain open for debugging - waiting 60 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 60000));
            console.log(`✅ 60-second debugging pause completed`);
        }

        // Check if error is 403-related and rotate user-agent
        if (errorMessage.includes('403') || errorMessage.includes('blocked')) {
            consecutive403Errors++;
            console.warn(
                `🚫 Request blocked (${consecutive403Errors} consecutive) - ${errorMessage}`
            );

            if (consecutive403Errors >= 3 && Date.now() - lastUserAgentRotation > 60000) {
                globalUserAgentRotator.getNextUserAgent();
                console.log(`🔄 Rotating User-Agent due to repeated request failures`);
                lastUserAgentRotation = Date.now();
                consecutive403Errors = 0;
            }
        }

        // Update URL index with failed status
        urlIndexService.updateUrlStatus(currentUrl, 'failed', undefined, errorMessage);

        // Record failed request for rate limiting
        if (rateLimitingService) {
            rateLimitingService.recordRequest(currentUrl, false);
        }

        logger.errorUrl(currentUrl, 'Request failed', error);
        errorsEncountered++;
    },
});

await Actor.setStatusMessage('Preparing crawler and discovering URLs...');
console.log(`🕷️ Starting crawler with base domain: ${baseDomain}`);
console.log(
    `🤖 Initial User-Agent: ${globalUserAgentRotator.getCurrentUserAgent().substring(0, 80)}...`
);

// Track statistics
let totalUrlsDiscovered = 0;
let pagesProcessed = 0;
let errorsEncountered = 0;
let hasRetried403WithHeadlessFalse = false;
let consecutive403Errors = 0;
let lastUserAgentRotation = 0;
const seoDataExtracted = {
    totalMetaTags: 0,
    totalStructuredData: 0,
    totalInternalLinks: 0,
    totalExternalLinks: 0,
};

// Crawling map to prevent duplicate URL crawling and track status codes
const crawlingMap = new Map<
    string,
    {
        status: number | null;
        statusText: string | null;
        timestamp: string;
        crawlCount: number;
    }
>();

// Collect all internal links for sitemap generation
const allInternalLinksForSitemap = new Set<string>();
// Also track all crawled URLs for sitemap
const allCrawledUrls = new Set<string>();

// Helper function to load previous URL index for incremental crawling
async function loadPreviousUrlIndex(domain: string, date: string): Promise<Record<string, any>> {
    try {
        const previousUrlIndexService = new UrlIndexService(domain, date);
        const indexData = previousUrlIndexService.getIndex();

        const urlIndex: Record<string, any> = {};
        Object.values(indexData.urls).forEach(urlData => {
            urlIndex[urlData.url] = {
                status: urlData.status,
                timestamp: urlData.timestamp,
                processedAt: urlData.processedAt,
            };
        });

        console.log(`📋 Loaded ${Object.keys(urlIndex).length} URLs from previous crawl index`);
        return urlIndex;
    } catch (error) {
        console.error(`❌ Error loading previous URL index:`, error);
        return {};
    }
}

// Check if any start URL is a homepage and fetch sitemap URLs (unless in single URL mode)
const urlsToAdd: string[] = [];
for (const url of config.targets.startUrls) {
    if (config.targets.sitemapDiscovery && isHomepage(url) && !config.crawler.singleUrlMode) {
        await Actor.setStatusMessage(`Discovering sitemap for ${url}...`);
        console.log(`🗺️ Detected homepage: ${url}, checking for sitemap...`);

        try {
            const sitemapUrls = await fetchSitemapUrls(url);
            if (sitemapUrls.length > 0) {
                let urlsToProcess: string[] = [];

                // Check if incremental mode is enabled
                if (config.crawler.incrementalMode && config.crawler.incrementalConfig) {
                    console.log(`🔄 Incremental mode enabled - comparing with previous crawl`);

                    // Convert sitemap URLs to ISitemapUrl format
                    const currentSitemapUrls: ISitemapUrl[] = sitemapUrls.map(url => ({ url }));

                    // Determine previous crawl date
                    const previousCrawlDate = config.crawler.incrementalConfig.previousCrawlDate;
                    if (
                        !previousCrawlDate &&
                        config.crawler.incrementalConfig.autoDetectPreviousCrawl
                    ) {
                        // Auto-detect logic would go here
                        // For now, we'll skip incremental if no date is specified
                        console.log(
                            `⚠️ Auto-detection not implemented - specify previousCrawlDate for incremental mode`
                        );
                    }

                    if (previousCrawlDate) {
                        // Load previous crawl data
                        const previousCrawlData = sitemapComparisonService.loadPreviousCrawlData(
                            baseDomain,
                            previousCrawlDate
                        );

                        // Perform comparison
                        const comparisonResult = sitemapComparisonService.compareSitemaps(
                            currentSitemapUrls,
                            previousCrawlData
                        );

                        // Get URLs to crawl based on incremental mode
                        urlsToProcess = sitemapComparisonService.getUrlsToCrawl(
                            comparisonResult,
                            config.crawler.incrementalConfig.mode
                        );

                        console.log(
                            `🎯 Incremental crawling: ${urlsToProcess.length} URLs to process`
                        );
                    } else {
                        // Fallback to full crawl
                        urlsToProcess = sitemapUrls;
                        console.log(`⚠️ No previous crawl date - performing full crawl`);
                    }
                } else {
                    // Standard full crawl
                    urlsToProcess = sitemapUrls;
                    console.log(`📋 Standard crawling: ${urlsToProcess.length} URLs from sitemap`);
                }

                // Always include the homepage URL first
                urlsToAdd.push(url);
                // Then add filtered URLs (avoiding duplicates)
                const uniqueUrls = urlsToProcess.filter(processUrl => processUrl !== url);
                urlsToAdd.push(...uniqueUrls);
                totalUrlsDiscovered += 1 + uniqueUrls.length;

                console.log(
                    `✅ Added homepage + ${uniqueUrls.length} URLs ${config.crawler.incrementalMode ? '(incremental)' : '(full)'}`
                );
                await Actor.setStatusMessage(
                    `Discovered ${sitemapUrls.length} URLs from sitemap + homepage`
                );
            } else {
                console.log(
                    `🔍 DEBUG: No sitemap found. incrementalMode: ${config.crawler.incrementalMode}, previousCrawlDate: ${config.crawler.incrementalConfig?.previousCrawlDate}`
                );
                // No sitemap found - check if incremental mode should use URL index
                if (
                    config.crawler.incrementalMode &&
                    config.crawler.incrementalConfig?.previousCrawlDate
                ) {
                    console.log(
                        `🔄 No sitemap found, but incremental mode enabled - using URL index from previous crawl`
                    );

                    // Load previous URL index
                    const previousUrlIndex = await loadPreviousUrlIndex(
                        baseDomain,
                        config.crawler.incrementalConfig.previousCrawlDate
                    );

                    if (Object.keys(previousUrlIndex).length > 0) {
                        console.log(
                            `📋 Found ${Object.keys(previousUrlIndex).length} URLs from previous crawl index`
                        );

                        // For incremental without sitemap, we'll retry failed URLs and add homepage
                        const failedUrls = Object.entries(previousUrlIndex)
                            .filter(([_, data]: [string, any]) => data.status !== 'completed')
                            .map(([url]) => url);

                        const completedUrls = Object.entries(previousUrlIndex)
                            .filter(([_, data]: [string, any]) => data.status === 'completed')
                            .map(([url]) => url);

                        console.log(
                            `📊 Previous crawl stats: ${completedUrls.length} completed, ${failedUrls.length} failed/incomplete`
                        );
                        console.log(
                            `🔄 Incremental mode: ${failedUrls.length} failed/incomplete URLs will be retried`
                        );

                        // Add homepage first
                        urlsToAdd.push(url);
                        // Add failed URLs for retry (limit to prevent overwhelming)
                        const urlsToRetry = failedUrls.slice(0, 50);
                        urlsToAdd.push(...urlsToRetry);
                        totalUrlsDiscovered += 1 + urlsToRetry.length;

                        console.log(
                            `✅ Incremental crawl: Homepage + ${urlsToRetry.length} retry URLs (${failedUrls.length - urlsToRetry.length} remaining)`
                        );
                    } else {
                        console.log(`⚠️ No previous URL index found - falling back to full crawl`);
                        urlsToAdd.push(url);
                        totalUrlsDiscovered += 1;
                    }
                } else {
                    urlsToAdd.push(url);
                    totalUrlsDiscovered += 1;
                }
            }
        } catch (sitemapError) {
            logger.warn(`Failed to fetch sitemap for ${url}`, sitemapError);
            urlsToAdd.push(url);
            totalUrlsDiscovered += 1;
            errorsEncountered++;
        }
    } else {
        urlsToAdd.push(url);
        totalUrlsDiscovered += 1;
    }
}

// Fetch URLs from HTML sitemap if configured
if (config.targets.htmlSitemapUrl && !config.crawler.singleUrlMode) {
    try {
        await Actor.setStatusMessage(`Fetching HTML sitemap: ${config.targets.htmlSitemapUrl}...`);
        const htmlSitemapUrls = await fetchHtmlSitemapUrls(
            config.targets.htmlSitemapUrl,
            baseDomain
        );

        if (htmlSitemapUrls.length > 0) {
            const existingSet = new Set(urlsToAdd);
            const newUrls = htmlSitemapUrls.filter(u => !existingSet.has(u));
            urlsToAdd.push(...newUrls);
            totalUrlsDiscovered += newUrls.length;
            console.log(
                `🗺️  HTML sitemap added ${newUrls.length} new URLs (${htmlSitemapUrls.length - newUrls.length} duplicates skipped)`
            );
        }
    } catch (htmlSitemapError) {
        logger.warn(
            `Failed to fetch HTML sitemap: ${config.targets.htmlSitemapUrl}`,
            htmlSitemapError
        );
    }
}

// Add initial URLs to the index
console.log(`📋 Adding ${urlsToAdd.length} URLs to index...`);
urlIndexService.addUrls(urlsToAdd);

await Actor.setStatusMessage(`Starting crawl of ${totalUrlsDiscovered} URLs...`);

// Note: Progress tracking is handled within the main request handler

try {
    await crawler.run(urlsToAdd);

    // Check if we had no successful pages but had blocking - retry with headless=false
    if (pagesProcessed === 0 && config.crawler.headless && !hasRetried403WithHeadlessFalse) {
        console.log(
            '🚫 No pages processed and headless mode detected - retrying with headless=false to bypass potential bot detection'
        );
        hasRetried403WithHeadlessFalse = true;

        // Reset for retry
        pagesProcessed = 0;
        allCrawledUrls.clear();
        allInternalLinksForSitemap.clear();

        // Create new crawler instance with headless=false
        const retrycrawler = new PlaywrightCrawler({
            maxRequestsPerCrawl: config.crawler.maxRequestsPerCrawl ?? undefined,
            maxConcurrency: config.crawler.maxConcurrency,
            requestHandlerTimeoutSecs: config.crawler.requestTimeoutSecs,
            headless: false, // Force visible browser

            // Enhanced browser configuration to avoid bot detection
            launchContext: {
                launchOptions: {
                    args: config.crawler.launchArgs?.visible ?? [],
                },
            },

            // TODO: Extract request handler to a reusable function
            // requestHandler: crawler.requestHandler, // Protected property access issue

            // Enhanced fingerprinting and headers
            preNavigationHooks: [
                async (crawlingContext, _gotoOptions): Promise<void> => {
                    const { page } = crawlingContext;
                    await page.setViewportSize({ width: 1920, height: 1080 });
                    await page.setExtraHTTPHeaders({
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        Connection: 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Cache-Control': 'max-age=0',
                    });
                },
            ],
        });

        console.log('🔄 Retrying crawl with visible browser (headless=false)...');
        await Actor.setStatusMessage('Retrying with visible browser to bypass bot detection...');

        await retrycrawler.run(urlsToAdd);
        console.log('✅ Retry with headless=false completed!');
    }

    // Generate sitemap from crawled URLs and discovered internal links
    const allUrls = new Set<string>();

    // Add all actually crawled URLs
    allCrawledUrls.forEach(url => allUrls.add(url));

    // Add discovered internal links
    allInternalLinksForSitemap.forEach(url => allUrls.add(url));

    if (allUrls.size > 0) {
        const sitemapUrls = Array.from(allUrls).sort();
        const sitemapXml = generateSitemapXml(sitemapUrls);

        // Save sitemap to key-value store
        await Actor.setValue('sitemap.xml', sitemapXml, { contentType: 'application/xml' });
        console.log(
            `📄 Generated sitemap with ${sitemapUrls.length} URLs and saved to key-value store`
        );

        // Optionally save a JSON version for easier processing
        await Actor.setValue('sitemap.json', sitemapUrls);
        console.log(`📋 Saved sitemap URLs to sitemap.json (${sitemapUrls.length} URLs)`);
    }

    // Final statistics
    const finalStats = {
        pagesProcessed,
        totalUrlsDiscovered,
        errorsEncountered,
        seoDataExtracted,
    };

    await Actor.setStatusMessage(
        `Crawl completed successfully! Processed ${pagesProcessed} pages.`
    );
    logger.info('Crawl completed successfully', finalStats);

    // End logging session
    logger.endSession();

    // Copy data to domain-specific storage
    await storageService.copyTodomainStorage();

    // Clean up any unwanted default folders
    storageService.cleanupDefaultFolders();

    // Generate crawling map statistics
    const statusCodeStats = new Map<number, number>();
    const duplicateUrls = new Map<string, number>();

    crawlingMap.forEach((entry, url) => {
        if (entry.status) {
            statusCodeStats.set(entry.status, (statusCodeStats.get(entry.status) ?? 0) + 1);
        }
        if (entry.crawlCount > 1) {
            duplicateUrls.set(url, entry.crawlCount);
        }
    });

    // Log final summary
    logger.info('Final Crawl Statistics:', {
        'Pages Processed': pagesProcessed,
        'URLs Discovered': totalUrlsDiscovered,
        'Unique URLs Crawled': crawlingMap.size,
        'Duplicate URLs Detected': duplicateUrls.size,
        'Errors Encountered': errorsEncountered,
        'Status Code Distribution': Object.fromEntries(statusCodeStats),
        'SEO Data': {
            'Meta Tags': seoDataExtracted.totalMetaTags,
            'Structured Data Items': seoDataExtracted.totalStructuredData,
            'Internal Links': seoDataExtracted.totalInternalLinks,
            'External Links': seoDataExtracted.totalExternalLinks,
        },
    });
} catch (error) {
    logger.error('Crawler failed', error);

    // Check if error is related to 403 blocked requests and we haven't retried yet
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (
        errorMessage.includes('403') &&
        config.crawler.headless &&
        !hasRetried403WithHeadlessFalse
    ) {
        console.log(
            '🚫 Detected 403 blocked requests - retrying with headless=false to bypass bot detection'
        );
        hasRetried403WithHeadlessFalse = true;

        // Update config to use non-headless mode
        config.crawler.headless = false;

        // Create new crawler instance with headless=false
        const retrycrawler = new PlaywrightCrawler({
            maxRequestsPerCrawl: config.crawler.maxRequestsPerCrawl ?? undefined,
            maxConcurrency: config.crawler.maxConcurrency,
            requestHandlerTimeoutSecs: config.crawler.requestTimeoutSecs,
            headless: false, // Force visible browser

            // Enhanced browser configuration to avoid bot detection
            launchContext: {
                launchOptions: {
                    args: config.crawler.launchArgs?.visible ?? [],
                },
            },

            // TODO: Extract request handler to a reusable function
            // requestHandler: crawler.requestHandler, // Protected property access issue

            // Enhanced fingerprinting and headers
            preNavigationHooks: [
                async (crawlingContext, _gotoOptions): Promise<void> => {
                    const { page } = crawlingContext;
                    await page.setViewportSize({ width: 1920, height: 1080 });
                    await page.setExtraHTTPHeaders({
                        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Accept-Encoding': 'gzip, deflate, br',
                        Connection: 'keep-alive',
                        'Upgrade-Insecure-Requests': '1',
                        'Sec-Fetch-Dest': 'document',
                        'Sec-Fetch-Mode': 'navigate',
                        'Sec-Fetch-Site': 'none',
                        'Sec-Fetch-User': '?1',
                        'Cache-Control': 'max-age=0',
                    });
                },
            ],
        });

        console.log('🔄 Retrying crawl with visible browser (headless=false)...');
        await Actor.setStatusMessage('Retrying with visible browser to bypass bot detection...');

        try {
            await retrycrawler.run(urlsToAdd);
            console.log('✅ Retry with headless=false was successful!');

            // End logging session
            logger.endSession();

            // Generate sitemap from crawled URLs and discovered internal links
            const allUrls = new Set<string>();
            allCrawledUrls.forEach(url => allUrls.add(url));
            allInternalLinksForSitemap.forEach(url => allUrls.add(url));

            if (allUrls.size > 0) {
                const sitemapUrls = Array.from(allUrls).sort();
                const sitemapXml = generateSitemapXml(sitemapUrls);
                await Actor.setValue('sitemap.xml', sitemapXml, { contentType: 'application/xml' });
                await Actor.setValue('sitemap.json', sitemapUrls);
                console.log(
                    `📄 Generated sitemap with ${sitemapUrls.length} URLs and saved to key-value store`
                );
            }

            await storageService.copyTodomainStorage();
            storageService.cleanupDefaultFolders();
        } catch (retryError) {
            logger.error('Retry with headless=false also failed', retryError);
            logger.endSession();
            await Actor.fail(
                `Both crawl attempts failed. Last error: ${retryError instanceof Error ? retryError.message : 'Unknown error'}`
            );
            process.exit(1);
        }
    } else {
        logger.endSession();
        await Actor.fail(`Crawler failed: ${errorMessage}`);
        process.exit(1);
    }
}

// Display URL Index Summary
console.log('\n📊 URL Index Summary:');
const stats = urlIndexService.getStats();
console.log(`   Total URLs discovered: ${stats.totalUrls}`);
console.log(`   Successfully processed: ${stats.processedUrls}`);
console.log(`   Failed: ${stats.failedUrls}`);
console.log(`   Pending: ${stats.pendingUrls}`);
console.log(
    `   Index file: ${storageConfig.basePath}/${storageConfig.domain}/${storageConfig.dateFolder}/url-index.json`
);

// Export URL index in both formats
const jsonExport = urlIndexService.exportIndex('json');
const csvExport = urlIndexService.exportIndex('csv');
console.log(`   Exported to: ${jsonExport}`);
console.log(`   Exported to: ${csvExport}`);

// Exit Apify Actor
await Actor.exit('Crawl completed successfully');
