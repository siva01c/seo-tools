import { describe, it, expect } from '@jest/globals';
import { findOrphanedPages } from '../../services/orphanedPagesService.js';

const page = (url: string, internal: string[] = []) => ({
    url,
    title: url,
    links: { internal: internal.map(href => ({ href })) },
});

describe('findOrphanedPages', () => {
    it('lists pages no internal link points to, ignoring trailing slashes', () => {
        const result = findOrphanedPages([
            page('https://example.com/', ['https://example.com/a/']),
            page('https://example.com/a', ['https://example.com/']),
            page('https://example.com/b'),
        ]);

        expect(result.pages.map(p => p.url)).toEqual(['https://example.com/b']);
        expect(result.orphanedHomepages).toEqual([]);
    });

    it('never lists the root page as an orphan, but warns when nothing links to it', () => {
        const result = findOrphanedPages([
            page('https://example.com/'),
            page('https://example.com/a', ['https://example.com/a']),
        ]);

        expect(result.pages.map(p => p.url)).not.toContain('https://example.com/');
        expect(result.orphanedHomepages).toEqual(['https://example.com/']);
    });

    it('warns about an orphaned language homepage such as /cs/', () => {
        const result = findOrphanedPages([
            page('https://example.com/cs/', ['https://example.com/cs/blog/']),
            page('https://example.com/cs/blog/', ['https://example.com/cs/blog/']),
        ]);

        expect(result.orphanedHomepages).toEqual(['https://example.com/cs/']);
    });

    it('does not warn when the homepage is linked', () => {
        const result = findOrphanedPages([
            page('https://example.com/cs/', ['https://example.com/cs/blog/']),
            page('https://example.com/cs/blog/', ['https://example.com/cs/']),
        ]);

        expect(result.orphanedHomepages).toEqual([]);
    });

    it('detects the root page of every domain, not only the first one', () => {
        const result = findOrphanedPages([
            page('https://example.com/', ['https://example.com/']),
            page('https://example.org/'),
        ]);

        expect(result.pages).toEqual([]);
        expect(result.orphanedHomepages).toEqual(['https://example.org/']);
    });
});
