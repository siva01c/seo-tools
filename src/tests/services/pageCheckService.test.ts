import { describe, it, expect } from '@jest/globals';
import {
    checkUrl,
    validatePageStructuredData,
    validateStructuredDataText,
} from '../../services/pageCheckService.js';
import { PageFetchRefusedError } from '../../services/pageFetchService.js';
import { PRIVATE_REASON, harness } from '../helpers/fakePage.js';

const PRODUCT_LD = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Kettle',
    offers: { '@type': 'Offer', price: '19.90', priceCurrency: 'EUR' },
});

const PAGE_HTML = `<!DOCTYPE html><html><head>
<title>  Kettles
  and teapots </title>
<meta name="Description" content="  All kettles   in one place. ">
<meta name="robots" content="index, follow">
<link rel="stylesheet" href="/site.css">
<link rel="canonical" href="https://shop.example.com/kettles">
<script type="application/ld+json">${PRODUCT_LD}</script>
<script type="application/ld+json">{ "@context": "https://schema.org", "@type": </script>
<script>window.notStructuredData = {};</script>
</head><body>
<h1>Kettles</h1>
<h2>Electric</h2><h3>With a   thermostat</h3><h2>Stovetop</h2><h2>  </h2><h4>Not reported</h4>
</body></html>`;

const PAGE_URL = 'https://shop.example.com/kettles?sort=price';

describe('pageCheckService', () => {
    describe('checkUrl', () => {
        it('returns the on-page SEO basics of a page', async () => {
            const headers = { 'content-type': 'text/html', 'x-robots-tag': 'noarchive' };
            const h = harness({ [PAGE_URL]: { html: PAGE_HTML, headers } });

            const result = await checkUrl({ url: PAGE_URL }, h.deps);

            expect(result).toEqual({
                url: PAGE_URL,
                final_url: PAGE_URL,
                status: 200,
                title: 'Kettles and teapots',
                meta_description: 'All kettles in one place.',
                meta_robots: 'index, follow',
                x_robots_tag: 'noarchive',
                canonical: 'https://shop.example.com/kettles',
                headings: {
                    h1: ['Kettles'],
                    h2: ['Electric', 'Stovetop'],
                    h3: ['With a thermostat'],
                },
                notice: expect.stringMatching(/untrusted/i),
            });
            expect(h.closed()).toBe(1);
        });

        it('reports what a page lacks as null and empty lists', async () => {
            const url = 'https://example.com/bare';
            const html = '<html><head></head><body><p>Nothing here.</p></body></html>';
            const h = harness({ [url]: { status: 404, html } });

            const result = await checkUrl({ url }, h.deps);

            expect(result.status).toBe(404);
            expect(result.title).toBe('');
            expect(result.meta_description).toBeNull();
            expect(result.meta_robots).toBeNull();
            expect(result.x_robots_tag).toBeNull();
            expect(result.canonical).toBeNull();
            expect(result.headings).toEqual({ h1: [], h2: [], h3: [] });
        });

        it('reports the page a redirect ends on', async () => {
            const from = 'https://shop.example.com/old';
            const h = harness({
                [from]: { status: 301, headers: { location: PAGE_URL } },
                [PAGE_URL]: { html: PAGE_HTML },
            });

            const result = await checkUrl({ url: from }, h.deps);

            expect(result.url).toBe(from);
            expect(result.final_url).toBe(PAGE_URL);
            expect(result.headings.h1).toEqual(['Kettles']);
        });

        it('refuses a private address without starting a browser', async () => {
            const h = harness({});

            const attempt = checkUrl({ url: 'http://127.0.0.1/admin' }, h.deps);

            await expect(attempt).rejects.toBeInstanceOf(PageFetchRefusedError);
            await expect(attempt).rejects.toThrow(PRIVATE_REASON);
            expect(h.opened()).toBe(0);
        });

        it('refuses a redirect to a private address without requesting it', async () => {
            const from = 'https://example.com/go';
            const internal = 'http://10.0.0.5/admin';
            const h = harness({
                [from]: { status: 302, headers: { location: internal } },
                [internal]: { html: '<html><head><title>internal</title></head></html>' },
            });

            const attempt = checkUrl({ url: from }, h.deps);

            const message = `Redirect to ${internal} refused: ${PRIVATE_REASON}`;
            await expect(attempt).rejects.toThrow(message);
            expect(h.page.fetched).toEqual([from]);
        });

        it('refuses a URL disallowed by robots.txt', async () => {
            const robots = { 'https://shop.example.com': 'User-agent: *\nDisallow: /kettles' };
            const h = harness({ [PAGE_URL]: { html: PAGE_HTML } }, robots);

            const attempt = checkUrl({ url: PAGE_URL }, h.deps);

            await expect(attempt).rejects.toBeInstanceOf(PageFetchRefusedError);
            await expect(attempt).rejects.toThrow('Disallowed by robots.txt');
            expect(h.page.fetched).toEqual([]);
        });

        it('refuses a response over the size limit', async () => {
            const h = harness({ [PAGE_URL]: { html: PAGE_HTML } });

            const attempt = checkUrl({ url: PAGE_URL }, { ...h.deps, maxBodyBytes: 100 });

            await expect(attempt).rejects.toBeInstanceOf(PageFetchRefusedError);
            await expect(attempt).rejects.toThrow('Response larger than 100 bytes');
        });
    });

    describe('validatePageStructuredData', () => {
        it('validates every JSON-LD block of the page and nothing else', async () => {
            const h = harness({ [PAGE_URL]: { html: PAGE_HTML } });

            const result = await validatePageStructuredData({ url: PAGE_URL }, h.deps);

            expect(result.page).toEqual({
                url: PAGE_URL,
                final_url: PAGE_URL,
                status: 200,
                notice: expect.stringMatching(/untrusted/i),
            });
            expect(result.block_count).toBe(2);
            expect(result.blocks[0]).toEqual({
                index: 0,
                valid_json: true,
                types: ['Product', 'Offer'],
                issues: [],
            });
            expect(result.blocks[1].valid_json).toBe(false);
            expect(result.error_count).toBe(1);
        });

        it('reports a page without structured data as zero blocks', async () => {
            const url = 'https://example.com/plain';
            const h = harness({ [url]: { html: '<html><body><h1>Plain</h1></body></html>' } });

            const result = await validatePageStructuredData({ url }, h.deps);

            expect(result.block_count).toBe(0);
            expect(result.blocks).toEqual([]);
        });

        it('applies the same refusals as a page check', async () => {
            const robots = { 'https://shop.example.com': 'User-agent: *\nDisallow: /' };
            const h = harness({ [PAGE_URL]: { html: PAGE_HTML } }, robots);

            const disallowed = validatePageStructuredData({ url: PAGE_URL }, h.deps);
            await expect(disallowed).rejects.toThrow('Disallowed by robots.txt');

            const internal = validatePageStructuredData({ url: 'http://10.1.2.3/' }, h.deps);
            await expect(internal).rejects.toThrow(PRIVATE_REASON);
            expect(h.opened()).toBe(0);
        });
    });

    describe('validateStructuredDataText', () => {
        it('validates the text as one block, without a page', () => {
            const result = validateStructuredDataText(PRODUCT_LD);

            expect(result.page).toBeUndefined();
            expect(result.block_count).toBe(1);
            expect(result.error_count).toBe(0);
            expect(result.blocks[0].types).toEqual(['Product', 'Offer']);
        });
    });
});
