import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { storageService } from '../../services/storageService.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// These tests exercise the real filesystem inside an isolated temp directory
// (jest.mock('fs', ...) does not intercept ESM imports under the ts-jest ESM preset,
// so mocking fs here would silently test nothing).
describe('StorageService', () => {
    let tmpDir: string;
    let originalCwd: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-service-test-'));
        process.chdir(tmpDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        delete process.env.APIFY_LOCAL_STORAGE_DIR;
        delete process.env.APIFY_DEFAULT_DATASET_ID;
        delete process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
        delete process.env.APIFY_DEFAULT_REQUEST_QUEUE_ID;
    });

    describe('initializeStorage', () => {
        it('should initialize storage with domain-based structure', () => {
            const config = storageService.initializeStorage('https://example.com/page');

            expect(config.domain).toBe('example.com');
            expect(config.dateFolder).toMatch(/^\d{2}-\d{2}-\d{4}$/);
            expect(config.basePath).toBe('./storage');
        });

        it('should handle URLs with subdomains', () => {
            const config = storageService.initializeStorage('https://blog.example.com/article');

            expect(config.domain).toBe('blog.example.com');
        });

        it('should handle URLs with custom ports', () => {
            // extractDomain() uses URL.hostname, which excludes the port
            const config = storageService.initializeStorage('http://localhost:3000/test');

            expect(config.domain).toBe('localhost');
        });

        it('should create storage directories', () => {
            storageService.initializeStorage('https://example.com', './storage', '01-01-2026');

            for (const type of ['datasets', 'key_value_stores', 'request_queues', 'logs']) {
                const dir = path.join('storage', type, 'example.com', '01-01-2026');
                expect(fs.existsSync(dir)).toBe(true);
            }
        });

        it('should not recreate existing directories', () => {
            const dir = path.join('storage', 'datasets', 'example.com', '01-01-2026');
            fs.mkdirSync(dir, { recursive: true });
            const statBefore = fs.statSync(dir);

            storageService.initializeStorage('https://example.com', './storage', '01-01-2026');

            const statAfter = fs.statSync(dir);
            expect(statAfter.birthtimeMs).toBe(statBefore.birthtimeMs);
        });
    });

    describe('getCurrentDateFolder (via initializeStorage default)', () => {
        it('should return date in DD-MM-YYYY format matching today', () => {
            const config = storageService.initializeStorage('https://example.com');

            expect(config.dateFolder).toMatch(/^\d{2}-\d{2}-\d{4}$/);

            const today = new Date();
            const expectedDate = `${today.getDate().toString().padStart(2, '0')}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getFullYear()}`;
            expect(config.dateFolder).toBe(expectedDate);
        });
    });

    describe('configureApifyStorage', () => {
        it('should configure Apify storage environment variables', () => {
            storageService.initializeStorage('https://example.com', './storage', '14-07-2025');

            storageService.configureApifyStorage();

            expect(process.env.APIFY_LOCAL_STORAGE_DIR).toBe('./storage');
            expect(process.env.APIFY_DEFAULT_DATASET_ID).toBe('example.com/14-07-2025');
            expect(process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID).toBe('example.com/14-07-2025');
        });
    });

    describe('copyTodomainStorage', () => {
        it('should copy data from default storage to domain storage', async () => {
            storageService.initializeStorage('https://example.com', './storage', '14-07-2025');

            const defaultDatasetPath = path.join(
                'storage',
                'datasets',
                'example.com',
                '14-07-2025',
                'default'
            );
            fs.mkdirSync(defaultDatasetPath, { recursive: true });
            fs.writeFileSync(path.join(defaultDatasetPath, 'file1.json'), '{"test":"data"}');

            await storageService.copyTodomainStorage();

            const copiedPath = path.join(
                'storage',
                'datasets',
                'example.com',
                '14-07-2025',
                'file1.json'
            );
            expect(fs.existsSync(copiedPath)).toBe(true);
            expect(fs.readFileSync(copiedPath, 'utf8')).toBe('{"test":"data"}');
        });

        it('should handle missing default storage gracefully', async () => {
            storageService.initializeStorage('https://example.com', './storage', '14-07-2025');

            await expect(storageService.copyTodomainStorage()).resolves.not.toThrow();
        });
    });

    describe('cleanupDefaultFolders', () => {
        it('should remove default storage folders if they exist', () => {
            storageService.initializeStorage('https://example.com', './storage', '14-07-2025');

            const defaultDir = path.join('storage', 'datasets', 'default');
            fs.mkdirSync(defaultDir, { recursive: true });

            storageService.cleanupDefaultFolders();

            expect(fs.existsSync(defaultDir)).toBe(false);
        });

        it('should handle missing default folders gracefully', () => {
            storageService.initializeStorage('https://example.com', './storage', '14-07-2025');

            expect(() => storageService.cleanupDefaultFolders()).not.toThrow();
        });
    });
});
