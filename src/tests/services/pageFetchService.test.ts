import { describe, it, expect } from '@jest/globals';
// A transitive dependency (crawlee ships it), used here only to give the fake page a real DOM.
import { load } from 'cheerio';
import type { Page } from 'playwright';
import {
    PageFetchRefusedError,
    fetchPage,
    normaliseText,
    type IFetchPageDeps,
} from '../../services/pageFetchService.js';
import { parseRobotsTxt, type IRobotsRules } from '../../services/robotsService.js';

// Everything up to the browser: the page below is a fake that drives the service's own route
// handler the way Playwright would — one routed request per navigation, a 3xx answered by
// route.fetch() instead of being followed. The real Chromium run is the opt-in
// src/tests/integration/fetchPage.integration.test.ts.

interface IFakeResponse {
    status?: number;
    headers?: Record<string, string>;
    html?: string;
    /** What the DOM looks like once the network went idle, for pages that render with JS. */
    htmlWhenIdle?: string;
}

type TSite = Record<string, IFakeResponse>;
type TRouteHandler = (route: unknown) => Promise<void>;
type TEvaluate = (element: unknown, arg: unknown) => unknown;

const PRIVATE_REASON = 'Target resolves to a private address';
const PRIVATE_URL = /^https?:\/\/(10\.|127\.)/;

class FakePage {
    public readonly fetched: string[] = [];
    public readonly waitedFor: string[] = [];
    private handler: TRouteHandler | null = null;
    private currentUrl = 'about:blank';
    private dom = load('');
    private readonly frame = {};

    constructor(private readonly site: TSite) {}

    public mainFrame() {
        return this.frame;
    }

    public async route(_pattern: string, handler: TRouteHandler) {
        this.handler = handler;
    }

    public async goto(url: string, options: { waitUntil: string }) {
        this.waitedFor.push(options.waitUntil);
        const fulfilled: IFakeResponse[] = [];
        const route = {
            request: () => ({
                url: () => url,
                method: () => 'GET',
                isNavigationRequest: () => true,
                resourceType: () => 'document',
                frame: () => this.frame,
            }),
            fetch: async (overrides: { url?: string } = {}) => {
                const target = overrides.url ?? url;
                this.fetched.push(target);
                const entry = this.site[target];
                if (!entry) throw new Error(`net::ERR_NAME_NOT_RESOLVED at ${target}`);
                return {
                    status: () => entry.status ?? 200,
                    headers: () => entry.headers ?? { 'content-type': 'text/html' },
                    entry,
                };
            },
            // Either the fetched response, or a document made up by the handler.
            fulfill: async (answer: { response?: { entry: IFakeResponse }; body?: string }) => {
                fulfilled.push(answer.response?.entry ?? { html: answer.body });
            },
            abort: async () => undefined,
        };
        await this.handler?.(route);
        const [entry] = fulfilled;
        if (!entry) throw new Error(`net::ERR_ABORTED at ${url}`);
        const idle = options.waitUntil === 'networkidle';
        this.dom = load((idle && entry.htmlWhenIdle) || entry.html || '');
        this.currentUrl = url;
        return null;
    }

    public url() {
        return this.currentUrl;
    }

    public async title() {
        return this.dom('title').first().text();
    }

    public locator(selector: string) {
        const $ = this.dom;
        const node = $(selector).first();
        const element = {
            // Matched against the whole document and then narrowed to descendants, which is
            // what the DOM does and cheerio's own find() does not.
            querySelectorAll: (nonContent: string) => {
                const all = $(nonContent).toArray();
                const inside = all.filter(found => node.find(found).length > 0);
                return inside.map(found => ({ remove: () => $(found).remove() }));
            },
            get innerText() {
                return node.text();
            },
        };
        const first = {
            count: async () => node.length,
            innerHTML: async () => node.html() ?? '',
            evaluate: async (fn: TEvaluate, arg: unknown) => fn(element, arg),
        };
        return { ...first, first: () => first };
    }
}

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

interface IHarness {
    page: FakePage;
    deps: Partial<IFetchPageDeps>;
    opened: () => number;
    closed: () => number;
    robotsRequests: string[];
}

function harness(site: TSite, robots: Record<string, string> = {}): IHarness {
    const page = new FakePage(site);
    let opened = 0;
    let closed = 0;
    const robotsRequests: string[] = [];
    return {
        page,
        robotsRequests,
        opened: () => opened,
        closed: () => closed,
        deps: {
            timeoutMs: 5000,
            checkUrl: async url => {
                return PRIVATE_URL.test(url) ? PRIVATE_REASON : null;
            },
            fetchRobots: async (origin): Promise<IRobotsRules> => {
                robotsRequests.push(origin);
                return parseRobotsTxt(robots[origin] ?? '');
            },
            openPage: async () => {
                opened++;
                return {
                    page: page as unknown as Page,
                    close: async () => {
                        closed++;
                    },
                };
            },
        },
    };
}

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
