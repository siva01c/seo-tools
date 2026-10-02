import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { PageFetchRefusedError, fetchPage } from '../../services/pageFetchService.js';

// Opt-in, like the PDF render test: this launches a real Chromium against a local HTTP server,
// to prove the route handler behaves in a real browser the way the fake page in
// src/tests/services/pageFetchService.test.ts assumes.
//   SEO_FETCH_PAGE_INTEGRATION=1 npm test -- fetchPage
const enabled = process.env.SEO_FETCH_PAGE_INTEGRATION === '1';
const maybeDescribe = enabled ? describe : describe.skip;

const FILLER = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. ';

const ARTICLE = `<!DOCTYPE html><html><head><title>Real page</title>
<style>p { color: red; }</style></head><body>
<nav>Top navigation</nav>
<main><h1>Heading</h1><p>First paragraph. ${FILLER}</p><p style="display:none">Hidden text</p>
<script>window.marker = 'script-text';</script></main>
<footer>Footer text</footer></body></html>`;

// Renders its content from an XHR that only starts after the load event.
const SPA = `<!DOCTYPE html><html><head><title>App</title></head><body><div id="app"></div>
<script>
window.addEventListener('load', () => {
    setTimeout(async () => {
        const data = await (await fetch('/data.json')).json();
        document.getElementById('app').innerHTML = '<main><h1>' + data.heading + '</h1><p>' +
            data.body + '</p></main>';
    }, 300);
});
</script></body></html>`;

maybeDescribe('pageFetchService (real Chromium)', () => {
    let server: http.Server;
    let base: string;
    const hits: string[] = [];

    // The local server is a loopback address, which the real SSRF guard refuses — so the guard
    // is stubbed to treat this one server as public and one of its paths as "internal".
    const checkUrl = async (url: string): Promise<string | null> => {
        return new URL(url).pathname.startsWith('/internal') ? 'Target is internal' : null;
    };
    const deps = { checkUrl, timeoutMs: 60000 };

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            const path = req.url ?? '/';
            hits.push(path);
            const html = (body: string): void => {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(body);
            };
            const redirect = (location: string): void => {
                res.writeHead(302, { Location: location });
                res.end();
            };
            if (path === '/robots.txt') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                return res.end('User-agent: *\nDisallow: /private/\n');
            }
            if (path === '/article' || path === '/private/page') return html(ARTICLE);
            if (path === '/internal/secret') return html('<main>internal secret</main>');
            if (path === '/moved') return redirect('/article');
            if (path === '/to-internal') return redirect('/internal/secret');
            if (path === '/to-private') return redirect('/private/page');
            if (path === '/spa') return html(SPA);
            if (path === '/data.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ heading: 'Rendered heading', body: FILLER }));
            }
            if (path === '/with-internal-script') {
                return html(`<html><body><main><p>${FILLER}${FILLER}</p></main>
                    <script src="/internal/script.js"></script></body></html>`);
            }
            res.writeHead(404, { 'Content-Type': 'text/html' });
            return res.end(`<html><body><main><h1>Missing</h1><p>${FILLER}${FILLER}</p></main>`);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
    });

    it('returns the visible main text of a page', async () => {
        const result = await fetchPage({ url: `${base}/article` }, deps);

        expect(result.status).toBe(200);
        expect(result.final_url).toBe(`${base}/article`);
        expect(result.title).toBe('Real page');
        expect(result.content_selector).toBe('main');
        expect(result.text).toMatch(/^Heading\n+First paragraph\./);
        expect(result.text).not.toContain('Hidden text');
        expect(result.text).not.toContain('script-text');
        expect(result.text).not.toContain('Top navigation');
        expect(result.truncated).toBe(false);
    }, 120000);

    it('follows a redirect explicitly and reports the final URL', async () => {
        const result = await fetchPage({ url: `${base}/moved`, maxChars: 7 }, deps);

        expect(result.final_url).toBe(`${base}/article`);
        expect(result.text).toBe('Heading');
        expect(result.truncated).toBe(true);
    }, 120000);

    it('never requests a refused redirect target', async () => {
        hits.length = 0;

        const attempt = fetchPage({ url: `${base}/to-internal` }, deps);

        await expect(attempt).rejects.toBeInstanceOf(PageFetchRefusedError);
        await expect(attempt).rejects.toThrow('Target is internal');
        expect(hits).toContain('/to-internal');
        expect(hits).not.toContain('/internal/secret');
    }, 120000);

    it('applies robots.txt to the URL and to a redirect target', async () => {
        hits.length = 0;

        const direct = fetchPage({ url: `${base}/private/page` }, deps);
        await expect(direct).rejects.toThrow('Disallowed by robots.txt');
        const redirected = fetchPage({ url: `${base}/to-private` }, deps);
        await expect(redirected).rejects.toThrow('Disallowed by robots.txt');

        expect(hits).not.toContain('/private/page');
    }, 120000);

    it('renders a JavaScript page when asked to wait for the network to go idle', async () => {
        const onIdle = await fetchPage({ url: `${base}/spa`, waitFor: 'networkidle' }, deps);
        expect(onIdle.text).toContain('Rendered heading');
    }, 120000);

    it('blocks a subresource on a refused address but still returns the page', async () => {
        hits.length = 0;

        const result = await fetchPage({ url: `${base}/with-internal-script` }, deps);

        expect(result.text).toContain('Lorem ipsum');
        expect(hits).not.toContain('/internal/script.js');
    }, 120000);

    it('returns an error page with its status', async () => {
        const result = await fetchPage({ url: `${base}/nope` }, deps);

        expect(result.status).toBe(404);
        expect(result.text).toContain('Missing');
    }, 120000);
});
