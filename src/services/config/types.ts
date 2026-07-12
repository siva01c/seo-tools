export interface ICrawlerConfig {
    targets: ITargetConfig;
    crawler: ICrawlerSettings;
    extraction: IExtractionConfig;
    output: IOutputConfig;
    logging: ILoggingConfig;
    errorHandling: IErrorHandlingConfig;
    performance: IPerformanceConfig;
}

export interface ITargetConfig {
    startUrls: string[];
    allowedDomains: string[];
    excludedDomains: string[];
    excludedPaths: string[];
    sitemapDiscovery: boolean;
    htmlSitemapUrl?: string;
    respectRobotsTxt: boolean;
}

export interface ICrawlerSettings {
    maxRequestsPerCrawl: number;
    maxConcurrency: number;
    requestTimeoutSecs: number;
    headless: boolean;
    requestDelay: number;
    requestDelayMin?: number;
    requestDelayMax?: number;
    singleUrlMode: boolean;
    incrementalMode: boolean;
    incrementalConfig?: {
        previousCrawlDate?: string;
        mode: 'incremental' | 'new-only' | 'modified-only' | 'all';
        autoDetectPreviousCrawl: boolean;
        maxAgeThresholdDays: number;
    };
    rateLimiting?: {
        enabled: boolean;
        rules: IRateLimitRule[];
        persistData: boolean;
        preset?: 'conservative' | 'moderate' | 'aggressive' | 'bulk' | 'tiered';
    };
    launchArgs?: {
        headless: string[];
        visible: string[];
    };
}

export interface IRateLimitRule {
    windowHours: number; // Time window in hours (1-5)
    maxRequests: number; // Maximum requests in this window
    enabled: boolean; // Enable/disable this rule
    description?: string; // Human-readable description
}

export interface IExtractionConfig {
    modules: IExtractionModules;
    links: ILinkExtractionConfig;
    customFields: string[];
}

export interface IExtractionModules {
    basicData: boolean;
    responseData: boolean;
    links: boolean;
    seoTags: boolean;
    specialLinks: boolean;
    structuredData: boolean;
    aiMetadata: boolean;
    contentMetrics: boolean;
    pageMap: boolean;
    htmlContent: boolean;
    images: boolean;
}

export interface ILinkExtractionConfig {
    extractAttributes: boolean;
    categorizeByDomain: boolean;
}

export interface IOutputConfig {
    files: IOutputFiles;
    storage: IOutputStorageConfig;
    formatting: IFormattingConfig;
}

export interface IOutputFiles {
    scrapedData: string;
    sitemap: string;
}

export interface IOutputStorageConfig {
    enabled: boolean;
    path: string;
    realTimeStorage: {
        enabled: boolean;
        saveIndividualFiles: boolean;
        saveJsonl: boolean;
        jsonlFilename: string;
    };
}

export interface IFormattingConfig {
    prettyPrint: boolean;
    includeTimestamp: boolean;
}

export interface ILoggingConfig {
    level: 'debug' | 'info' | 'warn' | 'error';
    enableConsole: boolean;
    enableFileLogging: boolean;
    logFile: string;
    sessionLogs: boolean;
    events: ILoggingEvents;
}

export interface ILoggingEvents {
    pageProcessed: boolean;
    errorEncountered: boolean;
    sitemapDiscovered: boolean;
    linksCategorized: boolean;
}

export interface IErrorHandlingConfig {
    continueOnError: boolean;
    retryCount: number;
    retryDelay: number;
    skipOnTimeout: boolean;
}

export interface IPerformanceConfig {
    skipHeavyExtraction: boolean;
    batchSize: number;
    clearPageData: boolean;
}
