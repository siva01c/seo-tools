/**
 * MCP HTTP server for seo-crawler.
 * Exposes crawl, get_report, and list_reports as JSON-RPC 2.0 tools.
 * Auth: Authorization: Basic <base64(SEO_MCP_TOKEN)>
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';

const PORT = parseInt(process.env.MCP_PORT ?? '3001', 10);
const SEO_MCP_TOKEN = process.env.SEO_MCP_TOKEN ?? '';
const STORAGE_DIR = process.env.APIFY_LOCAL_STORAGE_DIR ?? './storage';

// Active crawl jobs: jobId -> { status, domain, startedAt, log }
const jobs = new Map<
    string,
    { status: string; domain: string; startedAt: string; log: string[] }
>();

// ── Auth ─────────────────────────────────────────────────────────────────────

function checkAuth(req: http.IncomingMessage): boolean {
    if (!SEO_MCP_TOKEN) return true; // token not configured → open (dev only)
    const header = req.headers['authorization'] ?? '';
    if (!header.toLowerCase().startsWith('basic ')) return false;
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    return decoded === SEO_MCP_TOKEN;
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
    {
        name: 'crawl',
        description: 'Start a crawl job for a URL. Returns a job_id to poll with get_report.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Target URL to crawl (e.g. https://example.com)',
                },
                incremental: {
                    type: 'boolean',
                    description: 'Only crawl new/modified pages since last crawl',
                    default: false,
                },
                headless: { type: 'boolean', description: 'Run browser headless', default: true },
            },
            required: ['url'],
            additionalProperties: false,
        },
    },
    {
        name: 'get_report',
        description:
            'Get the crawl report for a domain. Returns latest report metadata and page count.',
        inputSchema: {
            type: 'object',
            properties: {
                domain: {
                    type: 'string',
                    description: 'Domain to get report for (e.g. example.com)',
                },
                job_id: {
                    type: 'string',
                    description: 'Optional job_id to check status of a running crawl',
                },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'list_reports',
        description: 'List all domains that have been crawled and their available report dates.',
        inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
        },
    },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleCrawl(args: Record<string, unknown>): string {
    const url = String(args.url ?? '');
    if (!url) return JSON.stringify({ error: 'url is required' });

    const jobId = crypto.randomUUID();
    let domain: string;
    try {
        domain = new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return JSON.stringify({ error: 'Invalid URL' });
    }

    const crawlArgs = [url];
    if (args.incremental) crawlArgs.push('--incremental');
    if (args.headless !== false) crawlArgs.push('--headless=true');

    jobs.set(jobId, { status: 'running', domain, startedAt: new Date().toISOString(), log: [] });

    const proc = spawn('npx', ['tsx', 'src/main.ts', ...crawlArgs], {
        cwd: '/app',
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    const job = jobs.get(jobId)!;
    proc.stdout.on('data', (d: Buffer) => job.log.push(d.toString()));
    proc.stderr.on('data', (d: Buffer) => job.log.push(d.toString()));
    proc.on('close', code => {
        job.status = code === 0 ? 'done' : `failed (exit ${code})`;
    });

    return JSON.stringify({
        job_id: jobId,
        domain,
        status: 'running',
        message: `Crawl started for ${url}`,
    });
}

function handleGetReport(args: Record<string, unknown>): string {
    // If job_id provided, return job status
    if (args.job_id) {
        const job = jobs.get(String(args.job_id));
        if (!job) return JSON.stringify({ error: 'job_id not found' });
        return JSON.stringify({
            job_id: args.job_id,
            domain: job.domain,
            status: job.status,
            startedAt: job.startedAt,
            lastLog: job.log.slice(-10).join(''),
        });
    }

    const domain = String(args.domain ?? '');
    if (!domain) return JSON.stringify({ error: 'domain or job_id is required' });

    const reportsDir = path.join(STORAGE_DIR, 'reports', domain);
    if (!fs.existsSync(reportsDir)) {
        return JSON.stringify({ error: `No reports found for domain: ${domain}` });
    }

    const dates = fs.readdirSync(reportsDir).sort().reverse();
    const latest = dates[0];
    const reportPath = path.join(reportsDir, latest);
    const files = fs.readdirSync(reportPath);

    // Try to read a summary file if present
    const summaryFile = files.find(f => f.endsWith('.json') || f.endsWith('.jsonl'));
    let pageCount = 0;
    if (summaryFile) {
        const content = fs.readFileSync(path.join(reportPath, summaryFile), 'utf8');
        pageCount = content.split('\n').filter(Boolean).length;
    }

    return JSON.stringify({
        domain,
        latestReport: latest,
        availableDates: dates,
        reportPath: reportPath,
        files,
        pageCount,
    });
}

function handleListReports(): string {
    const reportsDir = path.join(STORAGE_DIR, 'reports');
    if (!fs.existsSync(reportsDir)) {
        return JSON.stringify({ domains: [], message: 'No crawls have been run yet' });
    }

    const domains = fs.readdirSync(reportsDir).map(domain => {
        const domainPath = path.join(reportsDir, domain);
        const dates = fs.readdirSync(domainPath).sort().reverse();
        return { domain, latestCrawl: dates[0] ?? null, totalCrawls: dates.length };
    });

    return JSON.stringify({ domains });
}

// ── JSON-RPC dispatcher ───────────────────────────────────────────────────────

function dispatch(method: string, params: Record<string, unknown>, id: unknown) {
    if (method === 'initialize') {
        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'seo-crawler-mcp', version: '1.0.0' },
            },
        };
    }

    // notifications/initialized is a JSON-RPC notification (no id) — acknowledge silently
    if (method === 'notifications/initialized') {
        return null;
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
        const name = String(params.name ?? '');
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        let text: string;

        if (name === 'crawl') text = handleCrawl(args);
        else if (name === 'get_report') text = handleGetReport(args);
        else if (name === 'list_reports') text = handleListReports();
        else
            return {
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: `Unknown tool: ${name}` },
            };

        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
        const json = JSON.stringify(body);
        res.writeHead(status, {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(json),
        });
        res.end(json);
    };

    if (!checkAuth(req)) {
        return send(401, { error: 'Unauthorized' });
    }

    if (req.method === 'GET' && req.url === '/health') {
        return send(200, { status: 'ok', activeJobs: jobs.size });
    }

    if (req.method !== 'POST' || req.url !== '/mcp/post') {
        return send(404, { error: 'Not found. Use POST /mcp/post' });
    }

    let body = '';
    req.on('data', chunk => {
        body += chunk;
    });
    req.on('end', () => {
        let rpc: { jsonrpc: string; id: unknown; method: string; params?: Record<string, unknown> };
        try {
            rpc = JSON.parse(body);
        } catch {
            return send(400, {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' },
            });
        }
        const result = dispatch(rpc.method, rpc.params ?? {}, rpc.id);
        if (result === null) {
            // JSON-RPC notification — no response body
            res.writeHead(204);
            return res.end();
        }
        return send(200, result);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[mcp-server] SEO crawler MCP server listening on port ${PORT}`);
    console.log(`[mcp-server] Auth: ${SEO_MCP_TOKEN ? 'enabled' : 'DISABLED (set SEO_MCP_TOKEN)'}`);
});
