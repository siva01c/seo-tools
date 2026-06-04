#!/usr/bin/env tsx

import { UrlIndexService } from '../src/services/urlIndexService.js';
import * as fs from 'fs';
import * as path from 'path';

interface IQueryOptions {
    domain?: string;
    date?: string;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    search?: string;
    format?: 'json' | 'csv' | 'table';
    basePath?: string;
    command?: 'stats' | 'list' | 'search' | 'export' | 'retry';
    maxRetries?: number;
}

function parseArgs(): IQueryOptions {
    const args = process.argv.slice(2);
    const options: IQueryOptions = {
        basePath: './storage',
        format: 'table',
        command: 'stats',
        maxRetries: 3,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--help' || arg === '-h') {
            showHelp();
            process.exit(0);
        } else if (arg === '--domain' || arg === '-d') {
            options.domain = args[++i];
        } else if (arg === '--date') {
            options.date = args[++i];
        } else if (arg === '--status' || arg === '-s') {
            options.status = args[++i] as IQueryOptions['status'];
        } else if (arg === '--search' || arg === '-q') {
            options.search = args[++i];
        } else if (arg === '--format' || arg === '-f') {
            options.format = args[++i] as IQueryOptions['format'];
        } else if (arg === '--path' || arg === '-p') {
            options.basePath = args[++i];
        } else if (arg === '--max-retries') {
            options.maxRetries = parseInt(args[++i]);
        } else if (arg.startsWith('--')) {
            console.error(`Unknown option: ${arg}`);
            process.exit(1);
        } else {
            options.command = arg as IQueryOptions['command'];
        }
    }

    return options;
}

function showHelp(): void {
    console.log(`
URL Index Query Tool

Usage: tsx scripts/query-url-index.ts [command] [options]

Commands:
  stats     Show URL index statistics (default)
  list      List URLs by status
  search    Search URLs by content
  export    Export URL index to file
  retry     Show URLs that can be retried

Options:
  -d, --domain <domain>     Domain to query (if not provided, lists all domains)
  --date <date>             Date folder (DD-MM-YYYY format)
  -s, --status <status>     Filter by status (pending|processing|completed|failed)
  -q, --search <query>      Search query
  -f, --format <format>     Output format (json|csv|table) [default: table]
  -p, --path <path>         Storage base path [default: ./storage]
  --max-retries <num>       Max retries for retry command [default: 3]
  -h, --help                Show this help

Examples:
  tsx scripts/query-url-index.ts stats
  tsx scripts/query-url-index.ts list --status completed
  tsx scripts/query-url-index.ts search --search "about"
  tsx scripts/query-url-index.ts export --format csv
  tsx scripts/query-url-index.ts retry --max-retries 5
  tsx scripts/query-url-index.ts stats --domain example.com --date 16-07-2025
`);
}

function findDomainFolders(basePath: string): Array<{ domain: string; date: string }> {
    const folders: Array<{ domain: string; date: string }> = [];

    try {
        const domains = fs.readdirSync(basePath).filter(item => {
            const itemPath = path.join(basePath, item);
            return fs.statSync(itemPath).isDirectory();
        });

        for (const domain of domains) {
            const domainPath = path.join(basePath, domain);
            const dates = fs.readdirSync(domainPath).filter(item => {
                const itemPath = path.join(domainPath, item);
                return fs.statSync(itemPath).isDirectory();
            });

            for (const date of dates) {
                const indexPath = path.join(domainPath, date, 'url-index.json');
                if (fs.existsSync(indexPath)) {
                    folders.push({ domain, date });
                }
            }
        }
    } catch (error) {
        console.error('Error scanning storage folders:', error);
    }

    return folders;
}

function formatTable(data: Array<Record<string, unknown>>, headers: string[]): void {
    if (data.length === 0) {
        console.log('No data to display');
        return;
    }

    // Calculate column widths
    const widths: Record<string, number> = {};
    headers.forEach(header => {
        widths[header] = Math.max(
            header.length,
            ...data.map(row => String(row[header] ?? '').length)
        );
    });

    // Print header
    const headerRow = headers.map(h => h.padEnd(widths[h])).join(' | ');
    console.log(headerRow);
    console.log(headers.map(h => '-'.repeat(widths[h])).join('-|-'));

    // Print data rows
    data.forEach(row => {
        const dataRow = headers.map(h => String(row[h] ?? '').padEnd(widths[h])).join(' | ');
        console.log(dataRow);
    });
}

function main(): void {
    const options = parseArgs();

    // Find available domain/date combinations
    const folders = findDomainFolders(options.basePath ?? './storage');

    if (folders.length === 0) {
        console.log('No URL index files found in storage');
        return;
    }

    // Filter by domain/date if specified
    let targetFolders = folders;
    if (options.domain) {
        targetFolders = folders.filter(f => f.domain === options.domain);
    }
    if (options.date) {
        targetFolders = folders.filter(f => f.date === options.date);
    }

    if (targetFolders.length === 0) {
        console.log('No matching URL index files found');
        return;
    }

    // Process each target folder
    targetFolders.forEach(({ domain, date }) => {
        console.log(`\n📊 URL Index for ${domain} (${date}):`);

        const urlIndexService = new UrlIndexService(domain, date, options.basePath);

        switch (options.command) {
            case 'stats': {
                const stats = urlIndexService.getStats();
                console.log(`   Total URLs: ${stats.totalUrls}`);
                console.log(`   Processed: ${stats.processedUrls}`);
                console.log(`   Failed: ${stats.failedUrls}`);
                console.log(`   Pending: ${stats.pendingUrls}`);
                console.log(`   Last Updated: ${stats.lastUpdated}`);
                break;
            }

            case 'list': {
                const urls = options.status
                    ? urlIndexService.getUrlsByStatus(options.status)
                    : Object.values(urlIndexService.getIndex().urls);

                if (options.format === 'json') {
                    console.log(JSON.stringify(urls, null, 2));
                } else if (options.format === 'csv') {
                    const csvHeader =
                        'ID,URL,Status,StorageFile,AddedAt,ProcessedAt,RetryCount,Error';
                    console.log(csvHeader);
                    urls.forEach(url => {
                        const row = [
                            url.id,
                            url.url,
                            url.status,
                            url.storageFileName ?? '',
                            url.addedAt,
                            url.processedAt ?? '',
                            url.retryCount,
                            url.error ?? '',
                        ].join(',');
                        console.log(row);
                    });
                } else {
                    formatTable(urls as unknown as Array<Record<string, unknown>>, [
                        'id',
                        'url',
                        'status',
                        'storageFileName',
                        'retryCount',
                    ]);
                }
                break;
            }

            case 'search': {
                if (!options.search) {
                    console.error('Search query required for search command');
                    process.exit(1);
                }

                const searchResults = urlIndexService.searchUrls(options.search);
                if (options.format === 'json') {
                    console.log(JSON.stringify(searchResults, null, 2));
                } else {
                    formatTable(searchResults as unknown as Array<Record<string, unknown>>, [
                        'id',
                        'url',
                        'status',
                        'storageFileName',
                    ]);
                }
                break;
            }

            case 'export': {
                const exportPath = urlIndexService.exportIndex(
                    options.format === 'csv' ? 'csv' : 'json'
                );
                console.log(`   Exported to: ${exportPath}`);
                break;
            }

            case 'retry': {
                const retryUrls = urlIndexService.getUrlsForRetry(options.maxRetries);
                console.log(`   URLs available for retry: ${retryUrls.length}`);

                if (options.format === 'json') {
                    console.log(JSON.stringify(retryUrls, null, 2));
                } else {
                    formatTable(retryUrls as unknown as Array<Record<string, unknown>>, [
                        'id',
                        'url',
                        'retryCount',
                        'error',
                    ]);
                }
                break;
            }

            default:
                console.error(`Unknown command: ${options.command}`);
                process.exit(1);
        }
    });
}

// Only run if this is the main module (for ESM compatibility)
if (process.argv[1] === new URL(import.meta.url).pathname) {
    main();
}
