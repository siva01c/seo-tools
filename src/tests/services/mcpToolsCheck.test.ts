import { describe, it, expect, afterEach } from '@jest/globals';
import * as http from 'http';
import type { AddressInfo } from 'net';

import { diffToolNames, fetchServedToolNames } from '../../services/mcpToolsCheck.js';
import { TOOL_NAMES } from '../../mcpTools.js';
import { dispatch } from '../../mcp-server.js';

describe('diffToolNames', () => {
    it('reports nothing when the served tools match the code, in any order', () => {
        expect(diffToolNames(['crawl', 'fetch_page'], ['fetch_page', 'crawl'])).toEqual({
            missing: [],
            unexpected: [],
        });
    });

    it('reports tools the code defines but the running server does not serve', () => {
        // The failure this check exists for: a container left running on an image built
        // before fetch_page and check_url were added.
        const expected = ['crawl', 'get_report', 'fetch_page', 'check_url'];
        const served = ['crawl', 'get_report'];

        expect(diffToolNames(expected, served)).toEqual({
            missing: ['fetch_page', 'check_url'],
            unexpected: [],
        });
    });

    it('reports tools the running server serves but the code no longer defines', () => {
        expect(diffToolNames(['crawl'], ['crawl', 'old_tool'])).toEqual({
            missing: [],
            unexpected: ['old_tool'],
        });
    });
});

describe('TOOL_NAMES', () => {
    it('is exactly what the server answers to tools/list', () => {
        const response: any = dispatch('tools/list', {}, 1);
        const served = response.result.tools.map((tool: { name: string }) => tool.name);

        expect(served).toEqual(TOOL_NAMES);
        expect(TOOL_NAMES).toEqual(expect.arrayContaining(['fetch_page', 'check_url']));
    });
});

describe('fetchServedToolNames', () => {
    let server: http.Server | undefined;

    afterEach(async () => {
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        server = undefined;
    });

    // A stand-in for a running MCP server: records what it was sent, answers with `reply`.
    const startServer = async (reply: { status: number; body: unknown }) => {
        const seen: { path?: string; authorization?: string; body?: any } = {};
        server = http.createServer((req, res) => {
            let raw = '';
            req.on('data', chunk => (raw += chunk));
            req.on('end', () => {
                seen.path = req.url;
                seen.authorization = req.headers.authorization;
                seen.body = raw ? JSON.parse(raw) : undefined;
                res.writeHead(reply.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(reply.body));
            });
        });
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()));
        const { port } = server.address() as AddressInfo;
        return { baseUrl: `http://127.0.0.1:${port}`, seen };
    };

    it('asks the server for tools/list with the token and returns the tool names', async () => {
        const { baseUrl, seen } = await startServer({
            status: 200,
            body: {
                jsonrpc: '2.0',
                id: 1,
                result: { tools: [{ name: 'crawl' }, { name: 'fetch_page' }] },
            },
        });

        const names = await fetchServedToolNames(baseUrl, 'secret-token');

        expect(names).toEqual(['crawl', 'fetch_page']);
        expect(seen.path).toBe('/mcp/post');
        expect(seen.authorization).toBe(`Basic ${Buffer.from('secret-token').toString('base64')}`);
        expect(seen.body).toMatchObject({ jsonrpc: '2.0', method: 'tools/list' });
    });

    it('sends no Authorization header when no token is configured', async () => {
        const { baseUrl, seen } = await startServer({
            status: 200,
            body: { jsonrpc: '2.0', id: 1, result: { tools: [] } },
        });

        expect(await fetchServedToolNames(baseUrl, '')).toEqual([]);
        expect(seen.authorization).toBeUndefined();
    });

    it('fails with the HTTP status when the server refuses the request', async () => {
        const { baseUrl } = await startServer({ status: 401, body: { error: 'Unauthorized' } });

        await expect(fetchServedToolNames(baseUrl, 'wrong')).rejects.toThrow(/401/);
    });

    it('fails when the answer is a JSON-RPC error instead of a tool list', async () => {
        const { baseUrl } = await startServer({
            status: 200,
            body: { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } },
        });

        await expect(fetchServedToolNames(baseUrl, 'token')).rejects.toThrow(/Method not found/);
    });
});
