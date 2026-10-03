import { describe, it, expect } from '@jest/globals';
import {
    PageFetchRefusedError,
    fetchPage,
    normaliseText,
} from '../../services/pageFetchService.js';
import { PRIVATE_REASON, harness } from '../helpers/fakePage.js';

// The page is the fake of ../helpers/fakePage.ts; the real Chromium run is the opt-in
// src/tests/integration/fetchPage.integration.test.ts.

const FILLER = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ';

const ARTICLE_HTML = `<!DOCTYPE html><html><head><title>API reference</title>
<style>body { color: red; }</style></head><body>
<header><a href="/">Site logo</a></header>
<nav><a href="/pricing">Pricing link</a></nav>
<main>
  <nav>Breadcrumb trail</nav>
  <h1>Getting started</h1>
  <p>Call the endpoint with a token. ${FILLER}</p>
  <script>window.tracking = 'secret-script-text';</script>
  <aside>Related articles</aside>
</main>
<footer>Footer copyright</footer>
</body></html>`;

const DOCS_URL = 'https://docs.example.com/api';

describe('pageFetchService', () => {
    describe('normaliseText', () => {
        it('collapses runs of spaces and blank lines but keeps paragraph breaks', () => {
            const raw = `  One   two${String.fromCharCode(0xa0)}three \r\n\n\n\n\tFour  \n`;

            expect(normaliseText(raw)).toBe('One two three\n\nFour');
        });
    });

    describe('fetchPage', () => {
        it('returns the main text without navigation, scripts and styles', async () => {
            const h = harness({ [DOCS_URL]: { html: ARTICLE_HTML } });

            const result = await fetchPage({ url: DOCS_URL }, h.deps);

            expect(result.url).toBe(DOCS_URL);
            expect(result.final_url).toBe(DOCS_URL);
            expect(result.status).toBe(200);
            expect(result.title).toBe('API reference');
            expect(result.content_selector).toBe('main');
            expect(result.text).toContain('Getting started');
            expect(result.text).toContain('Call the endpoint with a token.');
            for (const noise of [
                'Breadcrumb trail',
                'Pricing link',
                'Site logo',
                'secret-script-text',
                'Related articles',
                'Footer copyright',
                'color: red',
            ]) {
                expect(result.text).not.toContain(noise);
            }
            expect(result.truncated).toBe(false);
            expect(result.total_chars).toBe(result.text.length);
            expect(result.notice).toMatch(/untrusted/i);
            expect(h.page.waitedFor).toEqual(['load']);
            expect(h.closed()).toBe(1);
        });

        it('drops the site chrome when it falls back to body', async () => {
            const html = `<html><head><title>Plain</title></head><body>
                <header>Top banner</header><div>Body copy only.</div>
                <footer>Bottom line</footer></body></html>`;
            const h = harness({ 'https://example.com/': { html } });

            const result = await fetchPage({ url: 'https://example.com/' }, h.deps);

            expect(result.content_selector).toBe('body');
            expect(result.text).toBe('Body copy only.');
        });

        it('reads a JavaScript-rendered page once the network is idle', async () => {
            const url = 'https://app.example.com/';
            const html = `<html><head><title>App</title></head><body>
                <div id="app"></div></body></html>`;
            const htmlWhenIdle = `<html><head><title>App</title></head><body><div id="app">
                <main><h1>Rendered dashboard</h1><p>${FILLER}${FILLER}</p></main></div>
                </body></html>`;
            const site = { [url]: { html, htmlWhenIdle } };

            const onLoad = harness(site);
            const early = await fetchPage({ url }, onLoad.deps);
            expect(early.text).toBe('');

            const onIdle = harness(site);
            const late = await fetchPage({ url, waitFor: 'networkidle' }, onIdle.deps);
            expect(onIdle.page.waitedFor).toEqual(['networkidle']);
            expect(late.text).toContain('Rendered dashboard');
        });

        it('follows a redirect to a public address and reports the final URL', async () => {
            const from = 'https://example.com/old';
            const to = 'https://example.com/new';
            const h = harness({
                [from]: { status: 301, headers: { location: '/new' } },
                [to]: { html: ARTICLE_HTML },
            });

            const result = await fetchPage({ url: from }, h.deps);

            expect(result.url).toBe(from);
            expect(result.final_url).toBe(to);
            expect(result.status).toBe(200);
            expect(h.page.fetched).toEqual([from, to]);
        });

        it('refuses a redirect to an internal address without requesting it', async () => {
            const from = 'https://example.com/go';
            const internal = 'http://10.0.0.5/admin';
            const h = harness({
                [from]: { status: 302, headers: { location: internal } },
                [internal]: { html: '<html><body>internal secrets</body></html>' },
            });

            const attempt = fetchPage({ url: from }, h.deps);

            await expect(attempt).rejects.toBeInstanceOf(PageFetchRefusedError);
            const message = `Redirect to ${internal} refused: ${PRIVATE_REASON}`;
            await expect(attempt).rejects.toThrow(message);
            expect(h.page.fetched).toEqual([from]);
            expect(h.closed()).toBe(1);
        });

        it('refuses an internal address before starting a browser', async () => {
            const h = harness({});

            const attempt = fetchPage({ url: 'http://127.0.0.1/' }, h.deps);

            await expect(attempt).rejects.toThrow(PRIVATE_REASON);
            expect(h.opened()).toBe(0);
            expect(h.robotsRequests).toEqual([]);
        });

        it('refuses a page disallowed by robots.txt before starting a browser', async () => {
            const url = 'https://example.com/private/report';
            const robots = { 'https://example.com': 'User-agent: *\nDisallow: /private/' };
            const h = harness({ [url]: { html: ARTICLE_HTML } }, robots);

            const attempt = fetchPage({ url }, h.deps);

            await expect(attempt).rejects.toBeInstanceOf(PageFetchRefusedError);
            await expect(attempt).rejects.toThrow('Disallowed by robots.txt');
            expect(h.opened()).toBe(0);
            expect(h.page.fetched).toEqual([]);
        });

        it('applies the robots.txt of a redirect target on another origin', async () => {
            const from = 'https://example.com/go';
            const to = 'https://other.example.org/members/';
            const robots = { 'https://other.example.org': 'User-agent: *\nDisallow: /members/' };
            const site = {
                [from]: { status: 302, headers: { location: to } },
                [to]: { html: ARTICLE_HTML },
            };
            const h = harness(site, robots);

            const attempt = fetchPage({ url: from }, h.deps);

            const message = `Redirect to ${to} refused: Disallowed by robots.txt`;
            await expect(attempt).rejects.toThrow(message);
            expect(h.page.fetched).toEqual([from]);
            // One robots.txt per origin, although the first URL is checked twice.
            expect(h.robotsRequests).toEqual(['https://example.com', 'https://other.example.org']);
        });

        it('gives up on a redirect loop', async () => {
            const h = harness({
                'https://example.com/a': { status: 302, headers: { location: '/b' } },
                'https://example.com/b': { status: 302, headers: { location: '/a' } },
            });

            const attempt = fetchPage({ url: 'https://example.com/a' }, h.deps);

            await expect(attempt).rejects.toThrow('Too many redirects');
            expect(h.page.fetched).toHaveLength(6);
        });

        it('refuses content that is not a web page', async () => {
            const url = 'https://example.com/file.pdf';
            const h = harness({ [url]: { headers: { 'content-type': 'application/pdf' } } });

            const attempt = fetchPage({ url }, h.deps);

            await expect(attempt).rejects.toThrow('Unsupported content type: application/pdf');
        });

        it('refuses a page larger than the body limit', async () => {
            const url = 'https://example.com/huge';
            const site = { [url]: { html: `<html><body>${'x'.repeat(2000)}</body></html>` } };

            const measured = fetchPage({ url }, { ...harness(site).deps, maxBodyBytes: 1000 });
            await expect(measured).rejects.toBeInstanceOf(PageFetchRefusedError);
            await expect(measured).rejects.toThrow('Response larger than 1000 bytes');

            // The declared length alone is enough.
            const headers = { 'content-type': 'text/html', 'content-length': '5000' };
            const declaring = { [url]: { headers, html: '<html><body>short</body></html>' } };
            const declared = fetchPage({ url }, { ...harness(declaring).deps, maxBodyBytes: 1000 });
            await expect(declared).rejects.toThrow('Response larger than 1000 bytes');

            const allowed = await fetchPage({ url }, { ...harness(site).deps, maxBodyBytes: 5000 });
            expect(allowed.status).toBe(200);
        });

        it('cuts the text at max_chars and says so', async () => {
            const site = { [DOCS_URL]: { html: ARTICLE_HTML } };

            const full = await fetchPage({ url: DOCS_URL }, harness(site).deps);
            const cut = await fetchPage({ url: DOCS_URL, maxChars: 15 }, harness(site).deps);

            expect(cut.text).toBe('Getting started');
            expect(cut.truncated).toBe(true);
            expect(cut.total_chars).toBe(full.text.length);
        });

        it('returns the page of an error status as it is', async () => {
            const url = 'https://example.com/missing';
            const html = `<html><head><title>Not found</title></head><body><main>
                <h1>Page not found</h1><p>${FILLER}${FILLER}</p></main></body></html>`;
            const h = harness({ [url]: { status: 404, html } });

            const result = await fetchPage({ url }, h.deps);

            expect(result.status).toBe(404);
            expect(result.text).toContain('Page not found');
        });

        it('closes the browser and reports a load that fails', async () => {
            const h = harness({});

            const attempt = fetchPage({ url: 'https://gone.example.com/' }, h.deps);

            await expect(attempt).rejects.toThrow('net::ERR_ABORTED');
            expect(h.closed()).toBe(1);
        });
    });
});
