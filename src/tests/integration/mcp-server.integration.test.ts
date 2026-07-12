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
                                    'Volitelná doména pro připojení aktuálních auditních dat (např. ludekkvapil.cz)',
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
