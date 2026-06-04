import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { storageService } from '../../services/storageService.js';
import fs from 'fs';
import path from 'path';

// Mock fs and path modules
const mockExistsSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockReaddirSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockRmSync = jest.fn();

jest.mock('fs', () => ({
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    rmSync: mockRmSync,
}));

const mockPathJoin = jest.fn();

jest.mock('path', () => ({
    join: mockPathJoin,
}));

// Mock Apify Actor
jest.mock('apify');

describe('StorageService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('initializeStorage', () => {
        it('should initialize storage with domain-based structure', () => {
            const targetUrl = 'https://example.com/page';

            mockExistsSync.mockReturnValue(false);
            mockMkdirSync.mockImplementation(() => undefined);
            mockPathJoin.mockImplementation((...args) => args.join('/'));

            const config = storageService.initializeStorage(targetUrl);

            expect(config.domain).toBe('example.com');
            expect(config.dateFolder).toMatch(/^\d{2}-\d{2}-\d{4}$/); // DD-MM-YYYY format
            expect(config.storagePath).toContain('example.com');
            expect(config.storagePath).toContain(config.dateFolder);
        });

        it('should handle URLs with subdomains', () => {
            const targetUrl = 'https://blog.example.com/article';

            mockExistsSync.mockReturnValue(false);
            mockMkdirSync.mockImplementation(() => undefined);
            mockPathJoin.mockImplementation((...args) => args.join('/'));

            const config = storageService.initializeStorage(targetUrl);

            expect(config.domain).toBe('blog.example.com');
            expect(config.storagePath).toContain('blog.example.com');
        });

        it('should handle URLs with custom ports', () => {
            const targetUrl = 'http://localhost:3000/test';

            mockExistsSync.mockReturnValue(false);
            mockMkdirSync.mockImplementation(() => undefined);
            mockPathJoin.mockImplementation((...args) => args.join('/'));

            const config = storageService.initializeStorage(targetUrl);

            expect(config.domain).toBe('localhost:3000');
            expect(config.storagePath).toContain('localhost:3000');
        });

        it('should create storage directories', () => {
            const targetUrl = 'https://example.com';

            mockExistsSync.mockReturnValue(false);
            mockMkdirSync.mockImplementation(() => undefined);
            mockPathJoin.mockImplementation((...args) => args.join('/'));

            storageService.initializeStorage(targetUrl);

            expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('example.com'), {
                recursive: true,
            });
        });

        it('should not recreate existing directories', () => {
            const targetUrl = 'https://example.com';

            mockExistsSync.mockReturnValue(true);
            mockPathJoin.mockImplementation((...args) => args.join('/'));

            storageService.initializeStorage(targetUrl);

            expect(fs.mkdirSync).not.toHaveBeenCalled();
        });
    });

    describe('getCurrentDateFolder', () => {
        it('should return date in DD-MM-YYYY format', () => {
            const dateFolder = storageService.getCurrentDateFolder();

            expect(dateFolder).toMatch(/^\d{2}-\d{2}-\d{4}$/);

            // Verify it's today's date
            const today = new Date();
            const expectedDate = `${today.getDate().toString().padStart(2, '0')}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getFullYear()}`;

            expect(dateFolder).toBe(expectedDate);
        });
    });

    describe('configureApifyStorage', () => {
        it('should configure Apify storage environment variables', async () => {
            const mockSetEnv = jest.fn();
            jest.doMock('apify', () => ({
                Actor: {
                    setEnv: mockSetEnv,
                    getEnv: jest.fn().mockReturnValue({}),
                },
            }));

            // Mock storage config
            storageService.storageConfig = {
                domain: 'example.com',
                dateFolder: '14-07-2025',
                storagePath: './storage/example.com/14-07-2025',
                datasetPath: './storage/example.com/14-07-2025/datasets',
                keyValueStorePath: './storage/example.com/14-07-2025/key_value_stores',
                requestQueuePath: './storage/example.com/14-07-2025/request_queues',
            };

            await storageService.configureApifyStorage();

            expect(mockSetEnv).toHaveBeenCalledWith(
                'APIFY_LOCAL_STORAGE_DIR',
                expect.stringContaining('example.com')
            );
            expect(mockSetEnv).toHaveBeenCalledWith('APIFY_DEFAULT_DATASET_ID', 'default');
        });
    });

    describe('copyTodomainStorage', () => {
        it('should copy data from default storage to domain storage', async () => {
            mockExistsSync.mockReturnValue(true);
            mockReaddirSync.mockReturnValue(['file1.json', 'file2.json'] as any);
            mockReadFileSync.mockReturnValue('{"test": "data"}');
            mockWriteFileSync.mockImplementation(() => {});
            mockPathJoin.mockImplementation((...args) => args.join('/'));

            // Mock storage config
            storageService.storageConfig = {
                domain: 'example.com',
                dateFolder: '14-07-2025',
                storagePath: './storage/example.com/14-07-2025',
                datasetPath: './storage/example.com/14-07-2025/datasets',
                keyValueStorePath: './storage/example.com/14-07-2025/key_value_stores',
                requestQueuePath: './storage/example.com/14-07-2025/request_queues',
            };

            await storageService.copyTodomainStorage();

            expect(fs.readFileSync).toHaveBeenCalled();
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('should handle missing default storage gracefully', async () => {
            mockExistsSync.mockReturnValue(false);

            // Mock storage config
            storageService.storageConfig = {
                domain: 'example.com',
                dateFolder: '14-07-2025',
                storagePath: './storage/example.com/14-07-2025',
                datasetPath: './storage/example.com/14-07-2025/datasets',
                keyValueStorePath: './storage/example.com/14-07-2025/key_value_stores',
                requestQueuePath: './storage/example.com/14-07-2025/request_queues',
            };

            // Should not throw
            await expect(storageService.copyTodomainStorage()).resolves.not.toThrow();
        });
    });

    describe('cleanupDefaultFolders', () => {
        it('should remove default storage folders if they exist', () => {
            mockExistsSync.mockReturnValue(true);
            mockRmSync.mockImplementation(() => {});
            mockPathJoin.mockImplementation((...args) => args.join('/'));

            storageService.cleanupDefaultFolders();

            expect(fs.rmSync).toHaveBeenCalledWith(
                expect.stringContaining('storage/datasets/default'),
                { recursive: true, force: true }
            );
        });

        it('should handle missing default folders gracefully', () => {
            mockExistsSync.mockReturnValue(false);

            // Should not throw
            expect(() => storageService.cleanupDefaultFolders()).not.toThrow();
        });
    });
});
