// import { Actor } from 'apify'; // Currently unused
import fs from 'fs';
import path from 'path';

export class Logger {
    private static instance: Logger;
    private logLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';
    private enableFileLogging: boolean = false;
    private logFile: string = 'crawler.log';
    private currentDomain: string = '';
    private currentDateFolder: string = '';
    private storagePath: string = './storage';
    private sessionLogFile: string = '';

    private constructor() {}

    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    public configure(config: {
        logLevel: 'debug' | 'info' | 'warn' | 'error';
        enableFileLogging: boolean;
        logFile: string;
        domain?: string;
        dateFolder?: string;
        storagePath?: string;
    }): void {
        this.logLevel = config.logLevel;
        this.enableFileLogging = config.enableFileLogging;
        this.logFile = config.logFile;
        if (config.domain) this.currentDomain = config.domain;
        if (config.dateFolder) this.currentDateFolder = config.dateFolder;
        if (config.storagePath) this.storagePath = config.storagePath;

        // Create session-specific log file
        if (this.enableFileLogging && this.currentDomain && this.currentDateFolder) {
            this.createSessionLogFile();
        }
    }

    public setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
        this.logLevel = level;
    }

    private shouldLog(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
        const levels = ['debug', 'info', 'warn', 'error'];
        const currentIndex = levels.indexOf(this.logLevel);
        const messageIndex = levels.indexOf(level);
        return messageIndex >= currentIndex;
    }

    private async writeToFile(message: string): Promise<void> {
        if (!this.enableFileLogging) return;

        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${message}\n`;

        try {
            // Write to main log file in logs directory
            const mainLogPath = path.join(this.storagePath, 'logs', this.logFile);
            // Ensure logs directory exists
            const logsDir = path.join(this.storagePath, 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            await fs.promises.appendFile(mainLogPath, logEntry);

            // Write to session-specific log file
            if (this.sessionLogFile) {
                await fs.promises.appendFile(this.sessionLogFile, logEntry);
            }
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    private createSessionLogFile(): void {
        if (!this.currentDomain || !this.currentDateFolder) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sessionLogFileName = `crawl-session-${timestamp}.log`;

        const sessionLogDir = path.join(
            this.storagePath,
            'logs',
            this.currentDomain,
            this.currentDateFolder
        );

        this.sessionLogFile = path.join(sessionLogDir, sessionLogFileName);

        // Ensure directory exists
        try {
            fs.mkdirSync(sessionLogDir, { recursive: true });
            // Write session header
            const sessionHeader = `=== CRAWLING SESSION STARTED ===\nDomain: ${this.currentDomain}\nDate: ${this.currentDateFolder}\nSession Started: ${new Date().toISOString()}\n===================================\n\n`;
            fs.writeFileSync(this.sessionLogFile, sessionHeader);
        } catch (error) {
            console.error('Failed to create session log file:', error);
            this.sessionLogFile = '';
        }
    }

    private async logMessage(
        level: 'debug' | 'info' | 'warn' | 'error',
        message: string,
        data?: unknown
    ): Promise<void> {
        if (!this.shouldLog(level)) return;

        const emoji = {
            debug: '🐛',
            info: 'ℹ️',
            warn: '⚠️',
            error: '❌',
        }[level];

        const formattedMessage = `${emoji} ${level.toUpperCase()}: ${message}`;
        const dataStr = data ? ` ${JSON.stringify(data)}` : '';
        const fullMessage = formattedMessage + dataStr;

        // Console output
        const consoleMethod =
            level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        consoleMethod(fullMessage);

        // File output
        await this.writeToFile(fullMessage);
    }

    public debug(message: string, data?: unknown): void {
        void this.logMessage('debug', message, data);
    }

    public info(message: string, data?: unknown): void {
        void this.logMessage('info', message, data);
    }

    public warn(message: string, data?: unknown): void {
        void this.logMessage('warn', message, data);
    }

    public error(message: string, error?: Error | unknown): void {
        void this.logMessage('error', message, error);
    }

    // URL-specific logging methods - now just add URL to message
    public debugUrl(url: string, message: string, data?: unknown): void {
        void this.logMessage('debug', `[${url}] ${message}`, data);
    }

    public infoUrl(url: string, message: string, data?: unknown): void {
        void this.logMessage('info', `[${url}] ${message}`, data);
    }

    public warnUrl(url: string, message: string, data?: unknown): void {
        void this.logMessage('warn', `[${url}] ${message}`, data);
    }

    public errorUrl(url: string, message: string, error?: Error | unknown): void {
        void this.logMessage('error', `[${url}] ${message}`, error);
    }

    public endSession(): void {
        if (this.sessionLogFile) {
            const sessionFooter = `\n===================================\nSession Ended: ${new Date().toISOString()}\n=== CRAWLING SESSION COMPLETED ===\n`;
            try {
                fs.appendFileSync(this.sessionLogFile, sessionFooter);
            } catch (error) {
                console.error('Failed to write session footer:', error);
            }
        }
    }

    public crawlerStats(stats: {
        pagesProcessed: number;
        totalUrls?: number;
        errorsEncountered?: number;
        currentUrl?: string;
    }): void {
        const progress = stats.totalUrls
            ? `${stats.pagesProcessed}/${stats.totalUrls}`
            : `${stats.pagesProcessed}`;

        this.info(
            `Crawler Progress: ${progress} pages processed${stats.errorsEncountered ? `, ${stats.errorsEncountered} errors` : ''}`
        );

        if (stats.currentUrl) {
            this.debug(`Currently processing: ${stats.currentUrl}`);
        }
    }

    public seoDataStats(stats: {
        metaTagsFound: number;
        structuredDataItems: number;
        internalLinks: number;
        externalLinks: number;
        url: string;
    }): void {
        this.debug(`SEO Data extracted from ${stats.url}:`, {
            metaTags: stats.metaTagsFound,
            structuredData: stats.structuredDataItems,
            internalLinks: stats.internalLinks,
            externalLinks: stats.externalLinks,
        });
    }

    public configInfo(config: Record<string, unknown> | any): void {
        const targets = config.targets as Record<string, unknown> | undefined;
        const crawler = config.crawler as Record<string, unknown> | undefined;
        const startUrls = targets?.startUrls;
        const startUrlsLength = Array.isArray(startUrls) ? startUrls.length : 0;

        this.info('Configuration loaded:', {
            startUrls: startUrlsLength,
            maxRequests: crawler?.maxRequestsPerCrawl ?? 'unlimited',
            concurrency: crawler?.maxConcurrency ?? 2,
            sitemapDiscovery: targets?.sitemapDiscovery ?? false,
        });
    }
}
