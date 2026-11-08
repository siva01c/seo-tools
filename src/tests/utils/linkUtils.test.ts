import { describe, it, expect } from '@jest/globals';
import { categorizeLinks, isSameOrSubdomain } from '../../utils/linkUtils.js';

describe('LinkUtils', () => {
    describe('isSameOrSubdomain', () => {
        it.each([
            ['example.com', 'example.com', true],
            ['www.example.com', 'example.com', true],
            ['example.com', 'www.example.com', true],
            ['courses.example.com', 'example.com', true],
            ['a.courses.example.com', 'courses.example.com', true],
            ['EXAMPLE.com', 'example.COM', true],
            ['example.com', 'courses.example.com', false],
            ['notexample.com', 'example.com', false],
            ['example.com', '', false],
        ])('%s within %s -> %s', (hostname, domain, expected) => {
            expect(isSameOrSubdomain(hostname, domain)).toBe(expected);
        });
    });

    describe('categorizeLinks', () => {
        const baseDomain = 'example.com';

        it('should categorize internal and external links correctly', () => {
            const links = [
                { href: 'https://example.com/page1', text: 'Internal Link 1' },
                { href: 'https://example.com/page2', text: 'Internal Link 2' },
                { href: 'https://external.com/page', text: 'External Link' },
                { href: 'https://another.com/page', text: 'Another External' },
            ];

            const result = categorizeLinks(links, baseDomain);

            expect(result.internal).toHaveLength(2);
            expect(result.external).toHaveLength(2);

            // Check that internal links have isInternal: true
            expect(result.internal[0]).toMatchObject({
                href: 'https://example.com/page1',
                text: 'Internal Link 1',
                isInternal: true,
            });

            // Check that external links have isInternal: false
            expect(result.external[0]).toMatchObject({
                href: 'https://external.com/page',
                text: 'External Link',
                isInternal: false,
            });
        });

        it('should handle relative URLs as internal links', () => {
            const links = [
                { href: '/relative-page', text: 'Relative Link' },
                { href: './relative-page', text: 'Relative Link 2' },
                { href: 'relative-page', text: 'Relative Link 3' },
                { href: 'https://external.com/page', text: 'External Link' },
            ];

            const result = categorizeLinks(links, baseDomain);

            expect(result.internal).toHaveLength(3);
            expect(result.external).toHaveLength(1);
        });

        it('should handle anchor links as internal', () => {
            const links = [
                { href: '#section1', text: 'Anchor Link' },
                { href: 'https://example.com/page#section', text: 'Internal with Anchor' },
                { href: 'https://external.com/page#section', text: 'External with Anchor' },
            ];

            const result = categorizeLinks(links, baseDomain);

            expect(result.internal).toHaveLength(2);
            expect(result.external).toHaveLength(1);
        });

        it('should handle subdomains correctly', () => {
            const links = [
                { href: 'https://blog.example.com/post', text: 'Subdomain Link' },
                { href: 'https://api.example.com/endpoint', text: 'API Subdomain' },
                { href: 'https://example.com/page', text: 'Main Domain' },
                { href: 'https://different.com/page', text: 'Different Domain' },
            ];

            const result = categorizeLinks(links, baseDomain);

            // Based on the implementation, subdomains of example.com should be treated as internal
            expect(result.internal).toHaveLength(3); // blog.example.com, api.example.com, example.com
            expect(result.external).toHaveLength(1); // different.com
        });

        it('excluding a subdomain keeps links of its parent domain internal', () => {
            const links = [
                { href: 'https://example.com/', text: 'Home' },
                { href: 'https://www.example.com/about', text: 'About (www)' },
                { href: 'https://courses.example.com/lesson', text: 'Excluded subdomain' },
                { href: 'https://a.courses.example.com/x', text: 'Below excluded subdomain' },
            ];

            const result = categorizeLinks(links, baseDomain, ['courses.example.com']);

            expect(result.internal.map(l => l.href)).toEqual([
                'https://example.com/',
                'https://www.example.com/about',
            ]);
            expect(result.external.map(l => l.href)).toEqual([
                'https://courses.example.com/lesson',
                'https://a.courses.example.com/x',
            ]);
        });

        it('does not treat a parent domain as allowed when crawling a subdomain', () => {
            const links = [
                { href: 'https://blog.example.com/post', text: 'Same subdomain' },
                { href: 'https://example.com/', text: 'Parent domain' },
            ];

            const result = categorizeLinks(links, 'blog.example.com');

            expect(result.internal.map(l => l.href)).toEqual(['https://blog.example.com/post']);
            expect(result.external.map(l => l.href)).toEqual(['https://example.com/']);
        });

        it('does not match a domain that only shares a suffix without a dot boundary', () => {
            const links = [{ href: 'https://notexample.com/page', text: 'Lookalike' }];

            const result = categorizeLinks(links, baseDomain);

            expect(result.external).toHaveLength(1);
        });

        it('should handle protocol differences correctly', () => {
            const links = [
                { href: 'http://example.com/page', text: 'HTTP Link' },
                { href: 'https://example.com/page', text: 'HTTPS Link' },
                { href: 'ftp://example.com/file', text: 'FTP Link' },
            ];

            const result = categorizeLinks(links, baseDomain);

            expect(result.internal).toHaveLength(3); // All protocols with same domain should be internal
            expect(result.external).toHaveLength(0);
        });

        it('should handle mailto and tel links as external', () => {
            const links = [
                { href: 'mailto:test@example.com', text: 'Email Link' },
                { href: 'tel:+1234567890', text: 'Phone Link' },
                { href: 'https://example.com/page', text: 'Normal Link' },
            ];

            const result = categorizeLinks(links, baseDomain);

            expect(result.internal).toHaveLength(1);
            expect(result.external).toHaveLength(2);
        });

        it('should handle invalid URLs gracefully', () => {
            const links = [
                { href: 'invalid-url', text: 'Invalid URL' },
                { href: '', text: 'Empty URL' },
                { href: 'https://example.com/valid', text: 'Valid URL' },
            ];

            const result = categorizeLinks(links, baseDomain);

            // Invalid URLs should be treated as internal (relative)
            expect(result.internal).toHaveLength(3);
            expect(result.external).toHaveLength(0);
        });

        it('should handle empty links array', () => {
            const result = categorizeLinks([], baseDomain);

            expect(result.internal).toEqual([]);
            expect(result.external).toEqual([]);
        });

        it('should preserve original link properties', () => {
            const links = [
                {
                    href: 'https://example.com/page',
                    text: 'Internal Link',
                    rel: 'nofollow',
                    link_title: 'Link Title',
                },
                {
                    href: 'https://external.com/page',
                    text: 'External Link',
                    target: '_blank',
                },
            ];

            const result = categorizeLinks(links, baseDomain);

            expect(result.internal[0]).toMatchObject({
                href: 'https://example.com/page',
                text: 'Internal Link',
                rel: 'nofollow',
                link_title: 'Link Title',
                isInternal: true,
            });

            expect(result.external[0]).toMatchObject({
                href: 'https://external.com/page',
                text: 'External Link',
                isInternal: false,
            });
        });

        it('should handle case insensitive domain matching', () => {
            const links = [
                { href: 'https://EXAMPLE.COM/page', text: 'Uppercase Domain' },
                { href: 'https://Example.Com/page', text: 'Mixed Case Domain' },
                { href: 'https://example.com/page', text: 'Lowercase Domain' },
            ];

            const result = categorizeLinks(links, baseDomain);

            expect(result.internal).toHaveLength(3);
            expect(result.external).toHaveLength(0);
        });

        it('should handle domains with ports', () => {
            const baseDomainWithPort = 'localhost:3000';
            const links = [
                { href: 'http://localhost:3000/page', text: 'Same Port' },
                { href: 'http://localhost:8080/page', text: 'Different Port' },
                { href: 'http://localhost/page', text: 'No Port' },
            ];

            const result = categorizeLinks(links, baseDomainWithPort);

            // The implementation doesn't handle port matching specifically
            // It compares hostname only, so all localhost links would be external
            // since 'localhost' !== 'localhost:3000'
            expect(result.internal).toHaveLength(0);
            expect(result.external).toHaveLength(3);
        });
    });
});
