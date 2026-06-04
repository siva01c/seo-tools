#!/usr/bin/env npx tsx

/**
 * Sitemap Comparison Utility
 * Compare current sitemap with previous crawl to identify new/modified content
 */

import { sitemapComparisonService, ISitemapUrl } from '../src/services/sitemapComparison.js';
import { fetchSitemapUrls } from '../src/services/sitemapService.js';
import { storageService } from '../src/services/storageService.js';
import { UrlIndexService } from '../src/services/urlIndexService.js';
import * as path from 'path';

interface IComparisonOptions {
    domain: string;
    previousDate?: string;
    currentUrl?: string;
    mode: 'incremental' | 'new-only' | 'modified-only' | 'all';
    output: 'console' | 'json' | 'list';
    limit?: number;
}

async function parseArguments(): Promise<IComparisonOptions> {
    const args = process.argv.slice(2);

    const options: IComparisonOptions = {
        domain: '',
        mode: 'incremental',
        output: 'console',
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--domain':
            case '-d':
                options.domain = args[++i];
                break;
            case '--previous-date':
            case '-p':
                options.previousDate = args[++i];
                break;
            case '--current-url':
            case '-u':
                options.currentUrl = args[++i];
                break;
            case '--mode':
            case '-m':
                options.mode = args[++i] as any;
                break;
            case '--output':
            case '-o':
                options.output = args[++i] as any;
                break;
            case '--limit':
            case '-l':
                options.limit = parseInt(args[++i]);
                break;
            case '--help':
            case '-h':
                showHelp();
                process.exit(0);
        }
    }

    if (!options.domain) {
        console.error('❌ Domain is required');
        showHelp();
        process.exit(1);
    }

    return options;
}

function showHelp(): void {
    console.log(`
🔍 Sitemap Comparison Utility

Usage: npx tsx scripts/compare-sitemaps.ts [OPTIONS]

Options:
  -d, --domain <domain>          Target domain to analyze (required)
  -p, --previous-date <date>     Previous crawl date (DD-MM-YYYY format)
  -u, --current-url <url>        Current sitemap URL (defaults to domain/sitemap.xml)
  -m, --mode <mode>              Comparison mode (default: incremental)
                                 • incremental: new + modified URLs
                                 • new-only: only new URLs  
                                 • modified-only: only modified URLs
                                 • all: all URLs regardless of status
  -o, --output <format>          Output format (default: console)
                                 • console: human-readable summary
                                 • json: JSON output for scripting
                                 • list: plain URL list
  -l, --limit <number>           Limit number of URLs in output
  -h, --help                     Show this help message

Examples:
  # Compare with automatic previous date detection
  npx tsx scripts/compare-sitemaps.ts --domain example.com

  # Compare with specific previous crawl
  npx tsx scripts/compare-sitemaps.ts --domain example.com --previous-date 12-07-2025

  # Get only new URLs as JSON
  npx tsx scripts/compare-sitemaps.ts --domain example.com --mode new-only --output json

  # Get incremental crawl list for scripting
  npx tsx scripts/compare-sitemaps.ts --domain example.com --output list --limit 100
`);
}

async function findLatestCrawlDate(domain: string): Promise<string | null> {
    try {
        // Look for the most recent crawl date directory
        const config = storageService.getConfig();
        if (!config) {
            console.warn('Storage service not initialized');
            return null;
        }
        const storagePath = path.join(config.basePath, 'datasets', domain);
        const keyValueStorePath = storagePath.replace('/datasets/', '/key_value_stores/');

        // This would require fs.readdir to find latest date folder
        // For now, return null to indicate manual date specification needed
        console.log(`📁 Looking for previous crawls in: ${keyValueStorePath}`);
        return null;
    } catch {
        return null;
    }
}

async function fetchCurrentSitemap(domain: string, currentUrl?: string): Promise<ISitemapUrl[]> {
    try {
        const sitemapUrl = currentUrl ?? `https://${domain}/sitemap.xml`;
        console.log(`🌐 Fetching current sitemap from: ${sitemapUrl}`);

        const urls = await fetchSitemapUrls(sitemapUrl);
        const sitemapUrls: ISitemapUrl[] = urls.map(url => ({
            url,
            lastmod: undefined, // Would be enhanced to extract from sitemap XML
            changefreq: undefined,
            priority: undefined,
        }));

        console.log(`✅ Fetched ${sitemapUrls.length} URLs from current sitemap`);
        return sitemapUrls;
    } catch (error) {
        console.error(`❌ Error fetching current sitemap:`, error);
        return [];
    }
}

async function loadPreviousUrlIndex(domain: string, date: string): Promise<Record<string, any>> {
    try {
        const urlIndexService = new UrlIndexService(domain, date);
        const index = urlIndexService.getIndex();
        const allUrls = Object.values(index.urls);

        const urlIndex: Record<string, any> = {};
        for (const urlData of allUrls) {
            urlIndex[urlData.url] = {
                status: urlData.status,
                timestamp: urlData.timestamp,
                lastModified: urlData.lastModified,
            };
        }

        console.log(`📋 Loaded ${Object.keys(urlIndex).length} URLs from previous crawl index`);
        return urlIndex;
    } catch (error) {
        console.error(`❌ Error loading previous URL index:`, error);
        return {};
    }
}

function outputResults(
    urlsToCrawl: string[],
    comparisonResult: any,
    format: string,
    limit?: number
): void {
    const limitedUrls = limit ? urlsToCrawl.slice(0, limit) : urlsToCrawl;

    switch (format) {
        case 'json':
            console.log(
                JSON.stringify(
                    {
                        urlsToCrawl: limitedUrls,
                        summary: comparisonResult.summary,
                        comparison: comparisonResult,
                    },
                    null,
                    2
                )
            );
            break;

        case 'list':
            limitedUrls.forEach(url => console.log(url));
            break;

        case 'console':
        default:
            if (limitedUrls.length > 0) {
                console.log(`\n🎯 URLs to crawl (${limitedUrls.length}):`);
                limitedUrls.slice(0, 10).forEach((url, index) => {
                    console.log(`  ${index + 1}. ${url}`);
                });

                if (limitedUrls.length > 10) {
                    console.log(`  ... and ${limitedUrls.length - 10} more URLs`);
                }
            } else {
                console.log(`\n✅ No URLs need to be crawled - everything is up to date!`);
            }
            break;
    }
}

async function main(): Promise<void> {
    try {
        const options = await parseArguments();

        console.log(`🔍 Starting sitemap comparison for domain: ${options.domain}`);
        console.log(`📋 Mode: ${options.mode}, Output: ${options.output}`);

        // Determine previous crawl date
        let previousDate = options.previousDate;
        if (!previousDate) {
            const foundDate = await findLatestCrawlDate(options.domain);
            if (!foundDate) {
                console.log(
                    `\n⚠️  No previous crawl date specified and auto-detection not available.`
                );
                console.log(`Use --previous-date DD-MM-YYYY to specify a previous crawl date.`);
                console.log(
                    `\nAvailable dates can be found in: ./storage/key_value_stores/${options.domain}/`
                );
                return;
            }
            previousDate = foundDate;
        }

        console.log(`📅 Using previous crawl date: ${previousDate}`);

        // Fetch current sitemap
        const currentSitemapUrls = await fetchCurrentSitemap(options.domain, options.currentUrl);
        if (currentSitemapUrls.length === 0) {
            console.error(`❌ No URLs found in current sitemap`);
            return;
        }

        // Load previous crawl data
        const previousCrawlData = sitemapComparisonService.loadPreviousCrawlData(
            options.domain,
            previousDate
        );

        if (!previousCrawlData) {
            // Enhance previous crawl data with URL index
            const previousUrlIndex = await loadPreviousUrlIndex(options.domain, previousDate);
            if (Object.keys(previousUrlIndex).length > 0) {
                console.log(`📋 Using URL index data as fallback for comparison`);
                // Create minimal crawl data structure
                const fallbackCrawlData = {
                    domain: options.domain,
                    crawlDate: previousDate,
                    timestamp: '',
                    totalUrls: Object.keys(previousUrlIndex).length,
                    sitemapUrls: Object.keys(previousUrlIndex).map(url => ({ url })),
                    urlIndex: previousUrlIndex,
                };

                const comparisonResult = sitemapComparisonService.compareSitemaps(
                    currentSitemapUrls,
                    fallbackCrawlData
                );

                const urlsToCrawl = sitemapComparisonService.getUrlsToCrawl(
                    comparisonResult,
                    options.mode
                );

                outputResults(urlsToCrawl, comparisonResult, options.output, options.limit);
                return;
            }
        }

        // Perform comparison
        const comparisonResult = sitemapComparisonService.compareSitemaps(
            currentSitemapUrls,
            previousCrawlData
        );

        // Get URLs to crawl based on mode
        const urlsToCrawl = sitemapComparisonService.getUrlsToCrawl(comparisonResult, options.mode);

        // Output results
        outputResults(urlsToCrawl, comparisonResult, options.output, options.limit);
    } catch (error) {
        console.error(`❌ Error during sitemap comparison:`, error);
        process.exit(1);
    }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
    void main();
}
