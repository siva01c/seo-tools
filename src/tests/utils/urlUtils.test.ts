import { describe, it, expect } from '@jest/globals';
import { isHomepage } from '../../utils/urlUtils.js';

describe('UrlUtils', () => {
    describe('isHomepage', () => {
        it('should identify basic homepage URLs', () => {
            expect(isHomepage('https://example.com')).toBe(true);
            expect(isHomepage('https://example.com/')).toBe(true);
            expect(isHomepage('http://example.com')).toBe(true);
            expect(isHomepage('http://example.com/')).toBe(true);
        });

        it('should identify homepage URLs with www', () => {
            expect(isHomepage('https://www.example.com')).toBe(true);
            expect(isHomepage('https://www.example.com/')).toBe(true);
            expect(isHomepage('http://www.example.com')).toBe(true);
            expect(isHomepage('http://www.example.com/')).toBe(true);
        });

        it('should identify homepage URLs with ports', () => {
            expect(isHomepage('http://localhost:3000')).toBe(true);
            expect(isHomepage('http://localhost:3000/')).toBe(true);
            expect(isHomepage('https://example.com:8080')).toBe(true);
            expect(isHomepage('https://example.com:8080/')).toBe(true);
        });

        it('should identify homepage URLs with subdomains', () => {
            expect(isHomepage('https://blog.example.com')).toBe(true);
            expect(isHomepage('https://blog.example.com/')).toBe(true);
            expect(isHomepage('https://api.example.com')).toBe(true);
            expect(isHomepage('https://shop.example.com/')).toBe(true);
        });

        it('should NOT identify non-homepage URLs', () => {
            expect(isHomepage('https://example.com/page')).toBe(false);
            expect(isHomepage('https://example.com/about')).toBe(false);
            expect(isHomepage('https://example.com/products/item')).toBe(false);
            expect(isHomepage('https://www.example.com/contact')).toBe(false);
        });

        it('should NOT identify URLs with query parameters as homepage', () => {
            expect(isHomepage('https://example.com?param=value')).toBe(false);
            expect(isHomepage('https://example.com/?utm_source=google')).toBe(false);
            expect(isHomepage('https://example.com/?page=1')).toBe(false);
        });

        it('should NOT identify URLs with hash fragments as homepage', () => {
            expect(isHomepage('https://example.com#section')).toBe(false);
            expect(isHomepage('https://example.com/#hero')).toBe(false);
            // Note: empty hash fragments are normalized away by URL constructor
            expect(isHomepage('https://example.com/#')).toBe(true);
        });

        it('should handle URLs with both query and hash', () => {
            expect(isHomepage('https://example.com?param=value#section')).toBe(false);
            expect(isHomepage('https://example.com/?utm=google#top')).toBe(false);
        });

        it('should handle edge cases', () => {
            // Empty strings and invalid URLs
            expect(isHomepage('')).toBe(false);
            expect(isHomepage('not-a-url')).toBe(false);
            expect(isHomepage('ftp://example.com')).toBe(false); // Non-HTTP protocols

            // URLs with unusual but valid paths - these get normalized to homepage
            expect(isHomepage('https://example.com/.')).toBe(true); // Normalized to root by URL constructor
            expect(isHomepage('https://example.com/./')).toBe(true); // Also normalized to root
        });

        it('should handle URL objects', () => {
            const url1 = new URL('https://example.com');
            const url2 = new URL('https://example.com/');
            const url3 = new URL('https://example.com/page');

            expect(isHomepage(url1.href)).toBe(true);
            expect(isHomepage(url2.href)).toBe(true);
            expect(isHomepage(url3.href)).toBe(false);
        });

        it('should be case insensitive for protocols and domains', () => {
            expect(isHomepage('HTTPS://EXAMPLE.COM')).toBe(true);
            expect(isHomepage('HTTP://EXAMPLE.COM/')).toBe(true);
            expect(isHomepage('https://EXAMPLE.COM/PAGE')).toBe(false);
        });

        it('should handle URLs with default ports', () => {
            expect(isHomepage('https://example.com:443')).toBe(true);
            expect(isHomepage('https://example.com:443/')).toBe(true);
            expect(isHomepage('http://example.com:80')).toBe(true);
            expect(isHomepage('http://example.com:80/')).toBe(true);
        });

        it('should handle international domain names', () => {
            expect(isHomepage('https://例え.テスト')).toBe(true);
            expect(isHomepage('https://例え.テスト/')).toBe(true);
            expect(isHomepage('https://例え.テスト/page')).toBe(false);
        });

        it('should handle very long domain names', () => {
            const longDomain = 'a'.repeat(60) + '.com';
            expect(isHomepage(`https://${longDomain}`)).toBe(true);
            expect(isHomepage(`https://${longDomain}/`)).toBe(true);
            expect(isHomepage(`https://${longDomain}/page`)).toBe(false);
        });
    });
});
