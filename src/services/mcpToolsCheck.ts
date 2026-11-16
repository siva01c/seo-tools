/**
 * Compares the tools a running MCP server offers with the tools defined in the code.
 *
 * A container keeps serving the image it was created from: when the image is not rebuilt after
 * a change in src/, new tools silently stay missing. scripts/check-mcp-tools.ts uses this to
 * catch that right after a deploy.
 */

export interface IToolDiff {
    /** Defined in the code, not served by the running server. */
    missing: string[];
    /** Served by the running server, no longer defined in the code. */
    unexpected: string[];
}

export function diffToolNames(expected: readonly string[], served: readonly string[]): IToolDiff {
    return {
        missing: expected.filter(name => !served.includes(name)),
        unexpected: served.filter(name => !expected.includes(name)),
    };
}

/** Basic auth with the token as the whole credential, as the server's checkAuth expects. */
function authHeaders(token: string): Record<string, string> {
    return token ? { Authorization: `Basic ${Buffer.from(token).toString('base64')}` } : {};
}

/** Asks the server at `baseUrl` for tools/list and returns the tool names in its answer. */
export async function fetchServedToolNames(baseUrl: string, token: string): Promise<string[]> {
    const response = await fetch(new URL('/mcp/post', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    if (!response.ok) {
        throw new Error(`tools/list failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
        result?: { tools?: { name: string }[] };
        error?: { message?: string };
    };
    if (body.error) {
        throw new Error(`tools/list failed: ${body.error.message ?? 'unknown error'}`);
    }
    const tools = body.result?.tools;
    if (!Array.isArray(tools)) {
        throw new Error('tools/list answer has no tool list');
    }
    return tools.map(tool => tool.name);
}

/** Polls GET /health until the server answers 200 or `timeoutMs` has passed. */
export async function waitForHealth(
    baseUrl: string,
    timeoutMs: number,
    intervalMs = 1000
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
        try {
            const response = await fetch(new URL('/health', baseUrl));
            if (response.ok) return;
            lastError = `HTTP ${response.status}`;
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error(`MCP server at ${baseUrl} not healthy after ${timeoutMs} ms (${lastError})`);
}
