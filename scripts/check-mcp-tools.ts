#!/usr/bin/env tsx

/**
 * Checks that the running MCP server offers exactly the tools defined in src/mcpTools.ts.
 *
 * A container keeps running the image it was created from, so a change in src/ reaches it only
 * after the image is rebuilt and the container recreated (`make mcp-deploy`). Without that, a new
 * tool stays missing and nothing reports it. This script waits for /health, asks the server for
 * tools/list and compares the answer with the code of this checkout.
 *
 * Usage (from the `app` service, which shares the host network):
 *   make mcp-check
 *   npx tsx scripts/check-mcp-tools.ts
 *
 * Environment:
 *   SEO_MCP_URL        base URL of the server (default http://127.0.0.1:$SEO_MCP_HOST_PORT)
 *   SEO_MCP_HOST_PORT  host port the `mcp` service is published on (default 3001)
 *   SEO_MCP_TOKEN      the server's token, sent as Basic auth
 *   SEO_MCP_WAIT_SECS  how long to wait for /health (default 90)
 */

import { TOOL_NAMES } from '../src/mcpTools.js';
import {
    diffToolNames,
    fetchServedToolNames,
    waitForHealth,
} from '../src/services/mcpToolsCheck.js';

const baseUrl =
    process.env.SEO_MCP_URL ?? `http://127.0.0.1:${process.env.SEO_MCP_HOST_PORT ?? '3001'}`;
const token = process.env.SEO_MCP_TOKEN ?? '';
const waitSecs = parseInt(process.env.SEO_MCP_WAIT_SECS ?? '90', 10);

async function check(): Promise<boolean> {
    await waitForHealth(baseUrl, waitSecs * 1000);
    const served = await fetchServedToolNames(baseUrl, token);
    const { missing, unexpected } = diffToolNames(TOOL_NAMES, served);

    if (missing.length === 0 && unexpected.length === 0) {
        console.log(`MCP tools OK: ${served.length} tools served at ${baseUrl}`);
        return true;
    }
    console.error(`MCP server at ${baseUrl} does not serve the tools defined in the code.`);
    if (missing.length > 0) console.error(`  missing:    ${missing.join(', ')}`);
    if (unexpected.length > 0) console.error(`  unexpected: ${unexpected.join(', ')}`);
    console.error('The image is probably stale: rebuild it with `make mcp-deploy`.');
    return false;
}

async function main(): Promise<void> {
    try {
        process.exitCode = (await check()) ? 0 : 1;
    } catch (err) {
        console.error(`MCP tools check failed: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
    }
}

void main();
