// A transitive dependency (crawlee ships it), used here only to give the fake page a real DOM.
import { load } from 'cheerio';
import type { Page } from 'playwright';
import type { IFetchPageDeps } from '../../services/pageFetchService.js';
import { parseRobotsTxt, type IRobotsRules } from '../../services/robotsService.js';

// Everything up to the browser: the page below is a fake that drives pageFetchService's own route
// handler the way Playwright would — one routed request per navigation, a 3xx answered by
// route.fetch() instead of being followed. The real Chromium run is the opt-in
// src/tests/integration/fetchPage.integration.test.ts.

export interface IFakeResponse {
    status?: number;
    headers?: Record<string, string>;
    html?: string;
    /** What the DOM looks like once the network went idle, for pages that render with JS. */
    htmlWhenIdle?: string;
}

export type TSite = Record<string, IFakeResponse>;
type TRouteHandler = (route: unknown) => Promise<void>;
type TEvaluate = (element: unknown, arg: unknown) => unknown;

export const PRIVATE_REASON = 'Target resolves to a private address';
const PRIVATE_URL = /^https?:\/\/(10\.|127\.)/;

export class FakePage {
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
                    body: async () => Buffer.from(entry.html ?? ''),
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
        const all = $(selector);
        const node = all.first();
        const element = {
            // Matched against the whole document and then narrowed to descendants, which is
            // what the DOM does and cheerio's own find() does not.
            querySelectorAll: (nonContent: string) => {
                const found = $(nonContent).toArray();
                const inside = found.filter(candidate => node.find(candidate).length > 0);
                return inside.map(candidate => ({ remove: () => $(candidate).remove() }));
            },
            get innerText() {
                return node.text();
            },
        };
        const first = {
            count: async () => node.length,
            innerHTML: async () => node.html() ?? '',
            getAttribute: async (name: string) => node.attr(name) ?? null,
            evaluate: async (fn: TEvaluate, arg: unknown) => fn(element, arg),
        };
        return {
            ...first,
            first: () => first,
            // html(), not text(): the text of a <script> is its raw content.
            allTextContents: async () =>
                all.toArray().map(found => {
                    const item = $(found);
                    return found.tagName === 'script' ? (item.html() ?? '') : item.text();
                }),
        };
    }
}

export interface IHarness {
    page: FakePage;
    deps: Partial<IFetchPageDeps>;
    opened: () => number;
    closed: () => number;
    robotsRequests: string[];
}

/** A fake site plus the robots.txt of its origins; addresses in 10/8 and 127/8 are "private". */
export function harness(site: TSite, robots: Record<string, string> = {}): IHarness {
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
