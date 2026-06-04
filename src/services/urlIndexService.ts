import * as fs from 'fs';
import * as path from 'path';
import { generateUrlBasedId } from '../utils/idGenerator.js';

export interface IUrlIndexEntry {
    id: string;
    url: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    storageFileName?: string; // JSON file name in storage
    timestamp: string;
    addedAt: string;
    processedAt?: string;
    retryCount: number;
    error?: string;
    domain: string;
    dateFolder: string;
    lastModified?: string;
}

export interface IUrlIndex {
    metadata: {
        domain: string;
        dateFolder: string;
        totalUrls: number;
        processedUrls: number;
        failedUrls: number;
        pendingUrls: number;
        lastUpdated: string;
    };
    urls: Record<string, IUrlIndexEntry>; // URL -> Entry mapping
    byId: Record<string, IUrlIndexEntry>; // ID -> Entry mapping
    byStatus: {
        pending: string[];
        processing: string[];
        completed: string[];
        failed: string[];
    };
}

export class UrlIndexService {
    private index: IUrlIndex;
    private indexPath: string;
    private domain: string;
    private dateFolder: string;

    constructor(domain: string, dateFolder: string, basePath: string = './storage') {
        this.domain = domain;
        this.dateFolder = dateFolder;
        // Use proper Apify storage structure: storage/key_value_stores/domain/date/url-index.json
        this.indexPath = path.join(
            basePath,
            'key_value_stores',
            domain,
            dateFolder,
            'url-index.json'
        );

        this.index = this.loadIndex();
    }

    private loadIndex(): IUrlIndex {
        try {
            if (fs.existsSync(this.indexPath)) {
                const data = fs.readFileSync(this.indexPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.warn('Failed to load URL index, creating new one:', error);
        }

        // Create new index
        return {
            metadata: {
                domain: this.domain,
                dateFolder: this.dateFolder,
                totalUrls: 0,
                processedUrls: 0,
                failedUrls: 0,
                pendingUrls: 0,
                lastUpdated: new Date().toISOString(),
            },
            urls: {},
            byId: {},
            byStatus: {
                pending: [],
                processing: [],
                completed: [],
                failed: [],
            },
        };
    }

    private saveIndex(): void {
        try {
            // Ensure directory exists
            const dir = path.dirname(this.indexPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Update metadata
            this.index.metadata.lastUpdated = new Date().toISOString();
            this.updateCounts();

            // Save to file
            fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
        } catch (error) {
            console.error('Failed to save URL index:', error);
        }
    }

    private updateCounts(): void {
        this.index.metadata.totalUrls = Object.keys(this.index.urls).length;
        this.index.metadata.processedUrls = this.index.byStatus.completed.length;
        this.index.metadata.failedUrls = this.index.byStatus.failed.length;
        this.index.metadata.pendingUrls = this.index.byStatus.pending.length;
    }

    public addUrl(url: string): string {
        // Check if URL already exists
        if (this.index.urls[url]) {
            return this.index.urls[url].id;
        }

        // Generate unique ID
        const id = generateUrlBasedId(url, new Date().toISOString());

        // Create entry
        const entry: IUrlIndexEntry = {
            id,
            url,
            status: 'pending',
            timestamp: new Date().toISOString(),
            addedAt: new Date().toISOString(),
            retryCount: 0,
            domain: this.domain,
            dateFolder: this.dateFolder,
        };

        // Add to index
        this.index.urls[url] = entry;
        this.index.byId[id] = entry;
        this.index.byStatus.pending.push(url);

        this.saveIndex();
        return id;
    }

    public addUrls(urls: string[]): string[] {
        const ids: string[] = [];
        for (const url of urls) {
            ids.push(this.addUrl(url));
        }
        return ids;
    }

    public updateUrlStatus(
        url: string,
        status: IUrlIndexEntry['status'],
        storageFileName?: string,
        error?: string
    ): void {
        const entry = this.index.urls[url];
        if (!entry) {
            console.warn(`URL not found in index: ${url}`);
            return;
        }

        // Remove from old status array
        const oldStatusArray = this.index.byStatus[entry.status];
        const oldIndex = oldStatusArray.indexOf(url);
        if (oldIndex > -1) {
            oldStatusArray.splice(oldIndex, 1);
        }

        // Update entry
        entry.status = status;
        entry.timestamp = new Date().toISOString();

        if (status === 'completed' || status === 'failed') {
            entry.processedAt = new Date().toISOString();
        }

        if (storageFileName) {
            entry.storageFileName = storageFileName;
        }

        if (error) {
            entry.error = error;
        }

        if (status === 'failed') {
            entry.retryCount++;
        }

        // Add to new status array
        this.index.byStatus[status].push(url);

        this.saveIndex();
    }

    public getUrlById(id: string): IUrlIndexEntry | undefined {
        return this.index.byId[id];
    }

    public getUrlByUrl(url: string): IUrlIndexEntry | undefined {
        return this.index.urls[url];
    }

    public getUrlsByStatus(status: IUrlIndexEntry['status']): IUrlIndexEntry[] {
        return this.index.byStatus[status].map(url => this.index.urls[url]);
    }

    public getPendingUrls(): IUrlIndexEntry[] {
        return this.getUrlsByStatus('pending');
    }

    public getProcessedUrls(): IUrlIndexEntry[] {
        return this.getUrlsByStatus('completed');
    }

    public getFailedUrls(): IUrlIndexEntry[] {
        return this.getUrlsByStatus('failed');
    }

    public getIndex(): IUrlIndex {
        this.updateCounts();
        return this.index;
    }

    public getStats(): IUrlIndex['metadata'] {
        this.updateCounts();
        return this.index.metadata;
    }

    public exportIndex(format: 'json' | 'csv' = 'json'): string {
        const exportPath = path.join(path.dirname(this.indexPath), `url-index-export.${format}`);

        if (format === 'json') {
            fs.writeFileSync(exportPath, JSON.stringify(this.index, null, 2));
        } else if (format === 'csv') {
            const entries = Object.values(this.index.urls);
            const csvHeader =
                'ID,URL,Status,StorageFileName,AddedAt,ProcessedAt,RetryCount,Error\n';
            const csvRows = entries
                .map(entry =>
                    [
                        entry.id,
                        entry.url,
                        entry.status,
                        entry.storageFileName ?? '',
                        entry.addedAt,
                        entry.processedAt ?? '',
                        entry.retryCount,
                        entry.error ?? '',
                    ].join(',')
                )
                .join('\n');

            fs.writeFileSync(exportPath, csvHeader + csvRows);
        }

        return exportPath;
    }

    public searchUrls(query: string, field: 'url' | 'status' | 'domain' = 'url'): IUrlIndexEntry[] {
        const entries = Object.values(this.index.urls);
        return entries.filter(entry => {
            const value = entry[field]?.toString().toLowerCase() ?? '';
            return value.includes(query.toLowerCase());
        });
    }

    public getUrlsForRetry(maxRetries: number = 3): IUrlIndexEntry[] {
        return this.getFailedUrls().filter(entry => entry.retryCount < maxRetries);
    }

    public clearIndex(): void {
        this.index = {
            metadata: {
                domain: this.domain,
                dateFolder: this.dateFolder,
                totalUrls: 0,
                processedUrls: 0,
                failedUrls: 0,
                pendingUrls: 0,
                lastUpdated: new Date().toISOString(),
            },
            urls: {},
            byId: {},
            byStatus: {
                pending: [],
                processing: [],
                completed: [],
                failed: [],
            },
        };
        this.saveIndex();
    }
}
