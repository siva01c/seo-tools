/**
 * Smart sitemap comparison service for incremental crawling
 * Compares current sitemap with previous crawl data to identify new/modified content
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface ISitemapUrl {
    url: string;
    lastmod?: string;
    changefreq?: string;
    priority?: string;
}

export interface IComparisonResult {
    newUrls: string[];
    modifiedUrls: string[];
    unchangedUrls: string[];
    removedUrls: string[];
    summary: {
        total: number;
        new: number;
        modified: number;
        unchanged: number;
        removed: number;
    };
}

export interface ICrawlMetadata {
    domain: string;
    crawlDate: string;
    timestamp: string;
    totalUrls: number;
    sitemapUrls: ISitemapUrl[];
    urlIndex: Record<
        string,
        {
            status: string;
            timestamp?: string;
            lastModified?: string;
        }
    >;
}

export class SitemapComparisonService {
    constructor(private storagePath: string = './storage') {}

    /**
     * Load previous crawl metadata from storage
     */
    loadPreviousCrawlData(domain: string, date: string): ICrawlMetadata | null {
        try {
            const metadataPath = join(
                this.storagePath,
                'key_value_stores',
                domain,
                date,
                'crawl-metadata.json'
            );

            if (!existsSync(metadataPath)) {
                console.log(`❌ No previous crawl metadata found at: ${metadataPath}`);
                return null;
            }

            const data = JSON.parse(readFileSync(metadataPath, 'utf-8'));
            console.log(
                `✅ Loaded previous crawl metadata: ${data.totalUrls} URLs from ${data.crawlDate}`
            );
            return data;
        } catch (error) {
            console.error(`❌ Error loading previous crawl data:`, error);
            return null;
        }
    }

    /**
     * Compare current sitemap with previous crawl data
     */
    compareSitemaps(
        currentSitemapUrls: ISitemapUrl[],
        previousCrawlData: ICrawlMetadata | null
    ): IComparisonResult {
        const result: IComparisonResult = {
            newUrls: [],
            modifiedUrls: [],
            unchangedUrls: [],
            removedUrls: [],
            summary: {
                total: currentSitemapUrls.length,
                new: 0,
                modified: 0,
                unchanged: 0,
                removed: 0,
            },
        };

        if (!previousCrawlData) {
            // No previous data - all URLs are new
            result.newUrls = currentSitemapUrls.map(item => item.url);
            result.summary.new = result.newUrls.length;
            console.log(
                `📋 No previous crawl data - treating all ${result.newUrls.length} URLs as new`
            );
            return result;
        }

        // Create lookup maps for efficient comparison
        const previousSitemapMap = new Map<string, ISitemapUrl>();
        const previousUrlIndexMap = new Map<string, any>();

        previousCrawlData.sitemapUrls.forEach(item => {
            previousSitemapMap.set(item.url, item);
        });

        Object.entries(previousCrawlData.urlIndex).forEach(([url, data]) => {
            previousUrlIndexMap.set(url, data);
        });

        // Compare current sitemap with previous data
        for (const currentItem of currentSitemapUrls) {
            const { url } = currentItem;
            const previousSitemapItem = previousSitemapMap.get(url);
            const previousUrlData = previousUrlIndexMap.get(url);

            if (!previousSitemapItem && !previousUrlData) {
                // Completely new URL
                result.newUrls.push(url);
            } else if (this.isUrlModified(currentItem, previousSitemapItem, previousUrlData)) {
                // URL exists but has been modified
                result.modifiedUrls.push(url);
            } else {
                // URL unchanged
                result.unchangedUrls.push(url);
            }
        }

        // Find removed URLs (in previous but not in current)
        for (const [previousUrl] of previousSitemapMap) {
            const stillExists = currentSitemapUrls.some(item => item.url === previousUrl);
            if (!stillExists) {
                result.removedUrls.push(previousUrl);
            }
        }

        // Update summary
        result.summary.new = result.newUrls.length;
        result.summary.modified = result.modifiedUrls.length;
        result.summary.unchanged = result.unchangedUrls.length;
        result.summary.removed = result.removedUrls.length;

        this.logComparisonSummary(result);
        return result;
    }

    /**
     * Determine if a URL has been modified since last crawl
     */
    private isUrlModified(
        currentItem: ISitemapUrl,
        previousSitemapItem?: ISitemapUrl,
        previousUrlData?: any
    ): boolean {
        // Check lastmod date from sitemap
        if (currentItem.lastmod && previousSitemapItem?.lastmod) {
            const currentDate = new Date(currentItem.lastmod);
            const previousDate = new Date(previousSitemapItem.lastmod);

            if (currentDate > previousDate) {
                return true; // Content modified based on sitemap lastmod
            }
        }

        // Check if URL was not successfully crawled before
        if (previousUrlData?.status !== 'completed') {
            return true; // Treat failed/incomplete URLs as modified (retry them)
        }

        // Check if significant time has passed (configurable threshold)
        if (previousUrlData?.timestamp) {
            const lastCrawlDate = new Date(previousUrlData.timestamp);
            const daysSinceLastCrawl =
                (Date.now() - lastCrawlDate.getTime()) / (1000 * 60 * 60 * 24);

            // Consider URLs modified if they haven't been crawled in over 30 days
            if (daysSinceLastCrawl > 30) {
                return true;
            }
        }

        return false; // No modification detected
    }

    /**
     * Generate URLs to crawl based on comparison result and mode
     */
    getUrlsToCrawl(
        comparisonResult: IComparisonResult,
        mode: 'incremental' | 'new-only' | 'modified-only' | 'all' = 'incremental'
    ): string[] {
        switch (mode) {
            case 'incremental':
                return [...comparisonResult.newUrls, ...comparisonResult.modifiedUrls];
            case 'new-only':
                return comparisonResult.newUrls;
            case 'modified-only':
                return comparisonResult.modifiedUrls;
            case 'all':
                return [
                    ...comparisonResult.newUrls,
                    ...comparisonResult.modifiedUrls,
                    ...comparisonResult.unchangedUrls,
                ];
            default:
                return [...comparisonResult.newUrls, ...comparisonResult.modifiedUrls];
        }
    }

    /**
     * Save current crawl metadata for future comparisons
     */
    saveCrawlMetadata(
        domain: string,
        date: string,
        sitemapUrls: ISitemapUrl[],
        urlIndex: Record<string, any>
    ): void {
        try {
            const metadata: ICrawlMetadata = {
                domain,
                crawlDate: date,
                timestamp: new Date().toISOString(),
                totalUrls: sitemapUrls.length,
                sitemapUrls,
                urlIndex,
            };

            const metadataPath = join(
                this.storagePath,
                'key_value_stores',
                domain,
                date,
                'crawl-metadata.json'
            );

            // This would be written by the main crawler
            console.log(`💾 Crawl metadata prepared for saving to: ${metadataPath}`);
            console.log(
                `📊 Metadata contains ${metadata.totalUrls} sitemap URLs and ${Object.keys(metadata.urlIndex).length} crawled URLs`
            );
        } catch (error) {
            console.error(`❌ Error preparing crawl metadata:`, error);
        }
    }

    /**
     * Log comparison summary
     */
    private logComparisonSummary(result: IComparisonResult): void {
        console.log('\n📊 Sitemap Comparison Summary:');
        console.log(`├── 🆕 New URLs: ${result.summary.new}`);
        console.log(`├── 🔄 Modified URLs: ${result.summary.modified}`);
        console.log(`├── ✅ Unchanged URLs: ${result.summary.unchanged}`);
        console.log(`├── 🗑️  Removed URLs: ${result.summary.removed}`);
        console.log(`└── 📋 Total current URLs: ${result.summary.total}`);

        const urlsToCrawl = result.summary.new + result.summary.modified;
        const percentage =
            result.summary.total > 0
                ? ((urlsToCrawl / result.summary.total) * 100).toFixed(1)
                : '0';

        console.log(
            `\n🎯 Incremental crawl will process ${urlsToCrawl} URLs (${percentage}% of total)`
        );
    }
}

// Global instance for use across the application
export const sitemapComparisonService = new SitemapComparisonService();
