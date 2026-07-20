import { describe, it, expect } from '@jest/globals';
import { parseRobotsTxt, isAllowedByRobots } from '../../services/robotsService.js';

describe('robotsService', () => {
    describe('parseRobotsTxt', () => {
        it('parses Disallow/Allow rules from a User-agent: * group', () => {
            const content = `
User-agent: *
Disallow: /admin
Disallow: /cart
Allow: /admin/public
Sitemap: https://example.com/sitemap.xml
`;
            const rules = parseRobotsTxt(content);
            expect(rules.disallow).toEqual(['/admin', '/cart']);
            expect(rules.allow).toEqual(['/admin/public']);
            expect(rules.sitemaps).toEqual(['https://example.com/sitemap.xml']);
        });

        it('ignores groups for other user-agents', () => {
            const content = `
User-agent: Googlebot
Disallow: /only-for-googlebot

User-agent: *
Disallow: /for-everyone
`;
            const rules = parseRobotsTxt(content);
            expect(rules.disallow).toEqual(['/for-everyone']);
        });

        it('ignores groups for other user-agents that follow the * group', () => {
            const content = `
User-agent: *
Allow: /

User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /
`;
            const rules = parseRobotsTxt(content);
            expect(rules.disallow).toEqual([]);
            expect(rules.allow).toEqual(['/']);
        });

        it('applies shared rules when several User-agent lines open one group', () => {
            const content = `
User-agent: Googlebot
User-agent: *
Disallow: /shared

User-agent: Bingbot
Disallow: /bing-only
`;
            const rules = parseRobotsTxt(content);
            expect(rules.disallow).toEqual(['/shared']);
        });

        it('matches a group naming our own user-agent token', () => {
            const content = `
User-agent: SEO-Crawler
Disallow: /no-crawler
`;
            const rules = parseRobotsTxt(content, 'SEO-Crawler');
            expect(rules.disallow).toEqual(['/no-crawler']);
        });

        it('ignores comments and blank lines', () => {
            const content = `
# This is a comment
User-agent: *
# Another comment
Disallow: /secret

Disallow: /private # inline comment
`;
            const rules = parseRobotsTxt(content);
            expect(rules.disallow).toEqual(['/secret', '/private']);
        });

        it('returns empty rules for empty content', () => {
            const rules = parseRobotsTxt('');
            expect(rules).toEqual({ disallow: [], allow: [], sitemaps: [] });
        });
    });

    describe('isAllowedByRobots', () => {
        it('allows everything when there are no disallow rules', () => {
            expect(
                isAllowedByRobots('https://example.com/anything', {
                    disallow: [],
                    allow: [],
                    sitemaps: [],
                })
            ).toBe(true);
        });

        it('disallows a URL matching a Disallow prefix', () => {
            const rules = { disallow: ['/admin'], allow: [], sitemaps: [] };
            expect(isAllowedByRobots('https://example.com/admin/settings', rules)).toBe(false);
        });

        it('allows a URL not matching any Disallow prefix', () => {
            const rules = { disallow: ['/admin'], allow: [], sitemaps: [] };
            expect(isAllowedByRobots('https://example.com/products', rules)).toBe(true);
        });

        it('lets a more specific Allow rule override a Disallow rule', () => {
            const rules = { disallow: ['/admin'], allow: ['/admin/public'], sitemaps: [] };
            expect(isAllowedByRobots('https://example.com/admin/public/page', rules)).toBe(true);
            expect(isAllowedByRobots('https://example.com/admin/private', rules)).toBe(false);
        });

        it('treats an invalid URL as allowed (fail open)', () => {
            const rules = { disallow: ['/admin'], allow: [], sitemaps: [] };
            expect(isAllowedByRobots('not a url', rules)).toBe(true);
        });
    });
});
