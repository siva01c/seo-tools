import * as path from 'path';
import * as fs from 'fs';

export interface IStorageConfig {
    basePath: string;
    domain: string;
    dateFolder: string;
}

export class StorageService {
    private static instance: StorageService | null = null;
    private config: IStorageConfig | null = null;

    private constructor() {}

    public static getInstance(): StorageService {
        StorageService.instance ??= new StorageService();
        return StorageService.instance;
    }

    public initializeStorage(
        targetUrl: string,
        basePath: string = './storage',
        customDateFolder?: string | null
    ): IStorageConfig {
        const domain = this.extractDomain(targetUrl);
        const dateFolder = customDateFolder || this.getCurrentDateFolder();

        this.config = {
            basePath,
            domain,
            dateFolder,
        };

        // Create domain and date-specific storage directories
        this.createStorageDirectories();

        return this.config;
    }

    private extractDomain(url: string): string {
        try {
            const parsedUrl = new URL(url);
            // Remove 'www.' prefix if present for cleaner storage names
            return parsedUrl.hostname.replace(/^www\./, '');
        } catch {
            console.warn(`Failed to parse URL: ${url}, using fallback domain`);
            return 'default';
        }
    }

    private getCurrentDateFolder(): string {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        return `${day}-${month}-${year}`;
    }

    private createStorageDirectories(): void {
        if (!this.config) return;

        const { basePath, domain, dateFolder } = this.config;

        // Create domain/date-specific directories: storage/datasets/domain/DD-MM-YYYY/
        const datasetPath = path.join(basePath, 'datasets', domain, dateFolder);
        const keyValuePath = path.join(basePath, 'key_value_stores', domain, dateFolder);
        const requestQueuePath = path.join(basePath, 'request_queues', domain, dateFolder);
        const logsPath = path.join(basePath, 'logs', domain, dateFolder);

        // Ensure directories exist
        [datasetPath, keyValuePath, requestQueuePath, logsPath].forEach(dirPath => {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`Created storage directory: ${dirPath}`);
            }
        });
    }

    public getStoragePath(
        type: 'datasets' | 'key_value_stores' | 'request_queues' | 'logs' = 'datasets'
    ): string {
        if (!this.config) {
            throw new Error('Storage not initialized. Call initializeStorage() first.');
        }

        if (type === 'logs') {
            return path.join(
                this.config.basePath,
                'logs',
                this.config.domain,
                this.config.dateFolder
            );
        }

        return path.join(this.config.basePath, type, this.config.domain, this.config.dateFolder);
    }

    public getDomainPath(): string {
        if (!this.config) {
            throw new Error('Storage not initialized. Call initializeStorage() first.');
        }

        // Return the key-value store path for URL index storage
        return path.join(
            this.config.basePath,
            'key_value_stores',
            this.config.domain,
            this.config.dateFolder
        );
    }

    public getConfig(): IStorageConfig | null {
        return this.config;
    }

    public getDomain(): string {
        if (!this.config) {
            throw new Error('Storage not initialized. Call initializeStorage() first.');
        }
        return this.config.domain;
    }

    // Convert domain to safe filename format
    public getDomainFilename(): string {
        if (!this.config) {
            throw new Error('Storage not initialized. Call initializeStorage() first.');
        }
        // Convert domain to safe filename: example.com -> example_com
        return this.config.domain.replace(/\./g, '_');
    }

    // Save scraped data immediately to file during crawling
    public async saveDataRealTime(data: any, filename?: string): Promise<void> {
        if (!this.config) {
            throw new Error('Storage not initialized. Call initializeStorage() first.');
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const dataFileName = filename ?? `scraped-data-${timestamp}.json`;
        const datasetPath = this.getStoragePath('datasets');

        // Ensure dataset directory exists
        if (!fs.existsSync(datasetPath)) {
            fs.mkdirSync(datasetPath, { recursive: true });
        }

        const filePath = path.join(datasetPath, dataFileName);

        try {
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
            console.log(`💾 Saved data to: ${filePath}`);
        } catch (error) {
            console.error(`❌ Failed to save data to ${filePath}:`, error);
            throw error;
        }
    }

    // Append scraped data to a continuous JSONL file during crawling
    public async appendToJsonl(data: any, filename: string = 'crawl-data.jsonl'): Promise<void> {
        if (!this.config) {
            throw new Error('Storage not initialized. Call initializeStorage() first.');
        }

        const datasetPath = this.getStoragePath('datasets');

        // Ensure dataset directory exists
        if (!fs.existsSync(datasetPath)) {
            fs.mkdirSync(datasetPath, { recursive: true });
        }

        const filePath = path.join(datasetPath, filename);

        try {
            const jsonLine = JSON.stringify(data) + '\n';
            await fs.promises.appendFile(filePath, jsonLine);
            console.log(`📝 Appended data to: ${filePath}`);
        } catch (error) {
            console.error(`❌ Failed to append data to ${filePath}:`, error);
            throw error;
        }
    }

    // Configure Apify to use domain-specific storage paths
    public configureApifyStorage(): void {
        if (!this.config) {
            throw new Error('Storage not initialized. Call initializeStorage() first.');
        }

        // Set Apify storage to use the base storage path
        // Apify will create the structure: storage/datasets/default/, storage/key_value_stores/default/, etc.
        // But we want: storage/datasets/domain/date/, storage/key_value_stores/domain/date/, etc.
        const basePath = this.config.basePath;

        // Set Apify storage environment variables to point to base storage path
        process.env.APIFY_LOCAL_STORAGE_DIR = basePath;
        process.env.APIFY_DEFAULT_DATASET_ID = `${this.config.domain}/${this.config.dateFolder}`;
        process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID = `${this.config.domain}/${this.config.dateFolder}`;
        process.env.APIFY_DEFAULT_REQUEST_QUEUE_ID = `${this.config.domain}/${this.config.dateFolder}`;

        // Prevent creation of default folders at project root
        process.env.APIFY_PURGE_ON_START = 'false';
        process.env.APIFY_PERSIST_STORAGE = 'true';

        console.log(`🗂️ Configured Apify storage for domain: ${this.config.domain}`);
        console.log(`📅 Date folder: ${this.config.dateFolder}`);
        console.log(`📁 Storage path: ${basePath}`);
        console.log(`🔧 APIFY_LOCAL_STORAGE_DIR set to: ${process.env.APIFY_LOCAL_STORAGE_DIR}`);
    }

    // Clean up any unwanted default storage folders
    public cleanupDefaultFolders(): void {
        const unwantedPaths = [
            path.join(this.config?.basePath ?? './storage', 'datasets', 'default'),
            path.join(this.config?.basePath ?? './storage', 'key_value_stores', 'default'),
            path.join(this.config?.basePath ?? './storage', 'request_queues', 'default'),
        ];

        unwantedPaths.forEach(folderPath => {
            if (fs.existsSync(folderPath)) {
                try {
                    fs.rmSync(folderPath, { recursive: true, force: true });
                    console.log(`🗑️ Removed unwanted folder: ${folderPath}`);
                } catch (error) {
                    console.warn(`⚠️ Failed to remove folder: ${folderPath}`, error);
                }
            }
        });
    }

    // Copy data from default storage to domain-specific storage
    public async copyTodomainStorage(): Promise<void> {
        if (!this.config) return;

        const fs = await import('fs');
        const path = await import('path');

        // Use the current domain's storage paths (already configured via APIFY_LOCAL_STORAGE_DIR)
        const defaultDatasetPath = path.join(
            this.config.basePath,
            'datasets',
            this.config.domain,
            this.config.dateFolder,
            'default'
        );
        const defaultKvsPath = path.join(
            this.config.basePath,
            'key_value_stores',
            this.config.domain,
            this.config.dateFolder,
            'default'
        );

        const domainDatasetPath = this.getStoragePath('datasets');
        const domainKvsPath = this.getStoragePath('key_value_stores');

        // Ensure destination directories exist
        if (!fs.existsSync(domainDatasetPath)) {
            fs.mkdirSync(domainDatasetPath, { recursive: true });
        }
        if (!fs.existsSync(domainKvsPath)) {
            fs.mkdirSync(domainKvsPath, { recursive: true });
        }

        // Copy dataset files
        try {
            if (fs.existsSync(defaultDatasetPath)) {
                const files = fs.readdirSync(defaultDatasetPath);
                for (const file of files) {
                    const srcPath = path.join(defaultDatasetPath, file);
                    const destPath = path.join(domainDatasetPath, file);
                    if (fs.statSync(srcPath).isFile()) {
                        fs.copyFileSync(srcPath, destPath);
                    }
                }
                console.log(`📁 Copied ${files.length} dataset files to domain storage`);
            }
        } catch (error) {
            console.warn('Failed to copy dataset files:', error);
        }

        // Copy key-value store files
        try {
            if (fs.existsSync(defaultKvsPath)) {
                const files = fs.readdirSync(defaultKvsPath);
                for (const file of files) {
                    const srcPath = path.join(defaultKvsPath, file);
                    const destPath = path.join(domainKvsPath, file);
                    if (fs.statSync(srcPath).isFile()) {
                        fs.copyFileSync(srcPath, destPath);
                    }
                }
                console.log(`🗝️ Copied ${files.length} key-value store files to domain storage`);
            }
        } catch (error) {
            console.warn('Failed to copy key-value store files:', error);
        }
    }
}

// Export a singleton instance
export const storageService = StorageService.getInstance();
