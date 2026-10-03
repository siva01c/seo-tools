import { describe, it, expect } from '@jest/globals';

// Import dispatch from the mcp-server implementation
import { dispatch } from '../../mcp-server.js';

describe('MCP Server Integration Tests - Marek Persona', () => {
    it('should advertise prompts and resources capabilities in initialize', () => {
        const response = dispatch('initialize', {}, 1);
        expect(response).toEqual({
            jsonrpc: '2.0',
            id: 1,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: {},
                    prompts: {},
                    resources: {},
                },
                serverInfo: { name: 'seo-tools-mcp', version: '1.0.0' },
            },
        });
    });

    it('should return prompt list including Marek persona', () => {
        const response = dispatch('prompts/list', {}, 2);
        expect(response).toEqual({
            jsonrpc: '2.0',
            id: 2,
            result: {
                prompts: [
                    {
                        name: 'seo-consultant-marek',
                        description:
                            'Role seniorního SEO konzultanta Marka pro analýzu technického SEO a GEO.',
                        arguments: [
                            {
                                name: 'domain',
                                description:
                                    'Volitelná doména pro připojení aktuálních auditních dat (např. example.com)',
                                required: false,
                            },
                        ],
                    },
                ],
            },
        });
    });

    it('should build prompt by reading the real ai/persona MD files', () => {
        // getMarekSystemPrompt() reads from ai/persona/ relative to process.cwd() and
        // swallows read errors per-file, so this exercises the real repo content rather
        // than a mock (jest.mock('fs', ...) does not intercept ESM imports under the
        // ts-jest ESM preset used by this project).
        const response = dispatch('prompts/get', { name: 'seo-consultant-marek' }, 3);
        expect(response).toBeDefined();
        const text = (response as any).result?.messages?.[0]?.content?.text;
        expect(text).toContain('Marek');
        expect(text.length).toBeGreaterThan(0);
    });

    it('should return error for invalid prompt name in prompts/get', () => {
        const response = dispatch('prompts/get', { name: 'invalid-name' }, 4);
        expect(response).toEqual({
            jsonrpc: '2.0',
            id: 4,
            error: { code: -32602, message: 'Prompt not found: invalid-name' },
        });
    });
});

// Only the paths that end before a browser is started; what the page load itself does is
// covered by src/tests/services/pageFetchService.test.ts.
describe('MCP Server Integration Tests - fetch_page', () => {
    const callFetchPage = async (args: Record<string, unknown>) => {
        const params = { name: 'fetch_page', arguments: args };
        const response: any = await dispatch('tools/call', params, 9);
        expect(response.id).toBe(9);
        return JSON.parse(response.result.content[0].text);
    };

    it('is listed in tools/list with url as its only required argument', async () => {
        const response: any = await dispatch('tools/list', {}, 5);
        const tool = response.result.tools.find((t: any) => t.name === 'fetch_page');

        expect(tool).toBeDefined();
        expect(tool.inputSchema.required).toEqual(['url']);
        const { properties } = tool.inputSchema;
        expect(Object.keys(properties)).toEqual(['url', 'max_chars', 'wait_for']);
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(properties.wait_for.enum).toEqual(['load', 'networkidle']);
        // Callers are told up front that what comes back is not to be obeyed.
        expect(tool.description).toMatch(/untrusted/i);
    });

    it('requires a url', async () => {
        expect(await callFetchPage({})).toEqual({ error: 'url is required' });
        expect(await callFetchPage({ url: 'not a url' })).toEqual({ error: 'Invalid URL' });
    });

    it('rejects an unknown wait_for and a max_chars that is not a positive integer', async () => {
        const url = 'https://example.com/';

        const badWait = await callFetchPage({ url, wait_for: 'domcontentloaded' });
        expect(badWait.error).toBe('wait_for must be one of: load, networkidle');
        for (const maxChars of [0, -5, 1.5, '100']) {
            const badMax = await callFetchPage({ url, max_chars: maxChars });
            expect(badMax.error).toBe('max_chars must be a positive integer');
        }
    });

    it('refuses private addresses and non-http schemes', async () => {
        const loopback = await callFetchPage({ url: 'http://127.0.0.1:3001/health' });
        expect(loopback.error).toBe('Target resolves to a private address');

        const metadata = await callFetchPage({ url: 'http://169.254.169.254/latest/' });
        expect(metadata.error).toBe('Target resolves to a private address');

        const localhost = await callFetchPage({ url: 'http://localhost/' });
        expect(localhost.error).toBe('Crawling this domain is not permitted');

        const file = await callFetchPage({ url: 'file:///etc/passwd' });
        expect(file.error).toBe('Only http(s) URLs are allowed');
    });

    it('limits how often one host can be fetched', async () => {
        // 10.255.255.1 is refused by the SSRF guard without any network access, so the calls
        // are cheap; refused calls count towards the limit too.
        const url = 'http://10.255.255.1/';
        const errors: string[] = [];
        for (let i = 0; i < 61; i++) {
            errors.push((await callFetchPage({ url })).error);
        }

        const refused = Array(60).fill('Target resolves to a private address');
        expect(errors.slice(0, 60)).toEqual(refused);
        expect(errors[60]).toBe('Too many page fetches for 10.255.255.1, try again later');
    });
});

// As above: only what is decided before a browser would be started.
describe('MCP Server Integration Tests - check_url and validate_structured_data', () => {
    const call = async (name: string, args: Record<string, unknown>) => {
        const response: any = await dispatch('tools/call', { name, arguments: args }, 11);
        expect(response.id).toBe(11);
        return JSON.parse(response.result.content[0].text);
    };

    it('lists both tools in tools/list', async () => {
        const response: any = await dispatch('tools/list', {}, 10);
        const byName = (name: string) => response.result.tools.find((t: any) => t.name === name);

        const checkUrl = byName('check_url');
        expect(checkUrl.inputSchema.required).toEqual(['url']);
        expect(Object.keys(checkUrl.inputSchema.properties)).toEqual(['url', 'wait_for']);
        expect(checkUrl.inputSchema.additionalProperties).toBe(false);
        expect(checkUrl.description).toMatch(/untrusted/i);

        const validate = byName('validate_structured_data');
        expect(Object.keys(validate.inputSchema.properties)).toEqual([
            'url',
            'json_ld',
            'wait_for',
        ]);
        expect(validate.inputSchema.required).toBeUndefined();
        expect(validate.inputSchema.additionalProperties).toBe(false);
    });

    it('check_url validates its arguments and refuses private addresses', async () => {
        expect(await call('check_url', {})).toEqual({ error: 'url is required' });
        expect(await call('check_url', { url: 'not a url' })).toEqual({ error: 'Invalid URL' });
        const badWait = await call('check_url', { url: 'https://example.com/', wait_for: 'x' });
        expect(badWait.error).toBe('wait_for must be one of: load, networkidle');

        const loopback = await call('check_url', { url: 'http://127.0.0.2/' });
        expect(loopback.error).toBe('Target resolves to a private address');
        const file = await call('check_url', { url: 'file:///etc/passwd' });
        expect(file.error).toBe('Only http(s) URLs are allowed');
    });

    it('validate_structured_data validates JSON-LD given as text without a request', async () => {
        const jsonLd = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Event',
            name: 'Meetup',
        });

        const result = await call('validate_structured_data', { json_ld: jsonLd });

        expect(result.page).toBeUndefined();
        expect(result.block_count).toBe(1);
        expect(result.blocks[0].types).toEqual(['Event']);
        expect(result.blocks[0].issues.map((issue: any) => issue.message)).toEqual([
            'Event is missing required property: startDate',
            'Event is missing required property: location',
        ]);

        const broken = await call('validate_structured_data', { json_ld: '{ "@type": ' });
        expect(broken.blocks[0].valid_json).toBe(false);
    });

    it('validate_structured_data needs exactly one of url and json_ld', async () => {
        const none = await call('validate_structured_data', {});
        expect(none.error).toBe('url or json_ld is required');
        const both = await call('validate_structured_data', {
            url: 'https://example.com/',
            json_ld: '{}',
        });
        expect(both.error).toBe('Pass either url or json_ld, not both');
        for (const jsonLd of ['', '   ', 42, {}]) {
            const bad = await call('validate_structured_data', { json_ld: jsonLd });
            expect(bad.error).toBe('json_ld must be a non-empty string');
        }

        const internal = await call('validate_structured_data', { url: 'http://10.9.8.7/' });
        expect(internal.error).toBe('Target resolves to a private address');
    });

    it('shares the per-host limit with fetch_page', async () => {
        const url = 'http://10.255.255.2/';
        const tools = ['fetch_page', 'check_url', 'validate_structured_data'];
        const errors: string[] = [];
        for (let i = 0; i < 61; i++) {
            errors.push((await call(tools[i % tools.length], { url })).error);
        }

        expect(errors[59]).toBe('Target resolves to a private address');
        expect(errors[60]).toBe('Too many page fetches for 10.255.255.2, try again later');
    });
});
