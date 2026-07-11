import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import * as fs from 'fs';

jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

// Import dispatch from the mcp-server implementation
import { dispatch } from '../../mcp-server.js';

describe('MCP Server Integration Tests - Marek Persona', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

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
                        description: 'Role seniorního SEO konzultanta Marka pro analýzu technického SEO a GEO.',
                        arguments: [
                            {
                                name: 'domain',
                                description: 'Volitelná doména pro připojení aktuálních auditních dat (např. ludekkvapil.cz)',
                                required: false,
                            },
                        ],
                    },
                ],
            },
        });
    });

    it('should build prompt using MD files in prompts/get', () => {
        mockFs.readFileSync.mockImplementation((filePath: any) => {
            const p = String(filePath);
            if (p.includes('system.md')) return 'SYSTEM_MD_CONTENT';
            if (p.includes('identity.md')) return 'IDENTITY_MD_CONTENT';
            if (p.includes('integrity.md')) return 'INTEGRITY_MD_CONTENT';
            if (p.includes('personality.md')) return 'PERSONALITY_MD_CONTENT';
            return '';
        });

        const response = dispatch('prompts/get', { name: 'seo-consultant-marek' }, 3);
        expect(response).toBeDefined();
        const text = (response as any).result?.messages?.[0]?.content?.text;
        expect(text).toContain('SYSTEM_MD_CONTENT');
        expect(text).toContain('IDENTITY_MD_CONTENT');
        expect(text).toContain('INTEGRITY_MD_CONTENT');
        expect(text).toContain('PERSONALITY_MD_CONTENT');
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
