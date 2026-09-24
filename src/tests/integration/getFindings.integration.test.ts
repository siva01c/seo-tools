import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// mcp-server reads its storage root once, at import, so the env has to be set first.
const storage = mkdtempSync(join(tmpdir(), 'get-findings-'));
process.env.APIFY_LOCAL_STORAGE_DIR = storage;
const { dispatch } = await import('../../mcp-server.js');
const { buildFindingsIndex, writeFindingsIndex } = await import(
    '../../services/findingsService.js'
);

type ToolResult = { result: { content: { text: string }[] } };
const call = (args: Record<string, unknown>) =>
    JSON.parse(
        (dispatch('tools/call', { name: 'get_findings', arguments: args }, 1) as ToolResult).result
            .content[0].text
    );

describe('get_findings tool', () => {
    beforeAll(() => {
        const dir = join(storage, 'reports', 'example.com', '28-08-2026');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'title-issues-28-08-2026.json'),
            JSON.stringify({ issues: [{ url: 'https://example.com/a', issue: 'duplicate' }] })
        );
        writeFindingsIndex(dir, buildFindingsIndex(dir, 'example.com', '28-08-2026'));
    });

    afterAll(() => rmSync(storage, { recursive: true, force: true }));

    it('is listed with a required domain', () => {
        const list = dispatch('tools/list', {}, 1) as {
            result: { tools: { name: string; inputSchema: { required?: string[] } }[] };
        };
        const tool = list.result.tools.find(t => t.name === 'get_findings');
        expect(tool?.inputSchema.required).toEqual(['domain']);
    });

    it('normalises the domain like crawl does', () => {
        for (const domain of ['example.com', 'WWW.Example.com', 'example.com.']) {
            expect(call({ domain }).groups[0].fingerprint).toBe('seo:example.com:title:duplicate');
        }
    });

    it('rejects a domain that is not a hostname', () => {
        for (const domain of ['../etc', '', 'localhost', '[2001:db8::1]']) {
            expect(call({ domain }).error).toBe('Invalid domain');
        }
    });

    it('rejects a malformed date and explains an unknown one', () => {
        expect(call({ domain: 'example.com', date: '2026-08-28' }).error).toBe(
            'date must be DD-MM-YYYY'
        );
        expect(call({ domain: 'example.com', date: '01-01-2020' }).error).toBe(
            'No findings for example.com on 01-01-2020'
        );
    });

    it('explains a domain without any complete report', () => {
        expect(call({ domain: 'other.example' }).error).toMatch(/run crawl with generate_findings/);
    });
});
