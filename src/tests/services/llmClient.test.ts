import { describe, it, expect, jest } from '@jest/globals';
import {
    resolveProvider,
    resolveLlmConfig,
    parseLlmJsonResponse,
    generateTitleDescriptionFix,
    stripPiiFromText,
} from '../../services/llmClient.js';

describe('llmClient', () => {
    describe('stripPiiFromText', () => {
        it('redacts email addresses from text', () => {
            const text = 'Contact John Doe at john.doe@example.com for info.';
            expect(stripPiiFromText(text)).toBe('Contact John Doe at [REDACTED_EMAIL] for info.');
        });

        it('redacts phone numbers from text', () => {
            const text = 'Call support at +420 123 456 789 or 555-1234.';
            expect(stripPiiFromText(text)).toBe(
                'Call support at [REDACTED_PHONE] or [REDACTED_PHONE].'
            );
        });

        it('leaves text without PII unchanged', () => {
            const text = 'Clean article title and description content without email or phone.';
            expect(stripPiiFromText(text)).toBe(text);
        });

        it('handles empty or undefined text gracefully', () => {
            expect(stripPiiFromText('')).toBe('');
        });
    });
    describe('resolveProvider', () => {
        it('resolves "ollama" explicitly', () => {
            expect(resolveProvider('ollama')).toBe('ollama');
        });

        it('defaults to "openai" for undefined, empty, or unrecognized values', () => {
            expect(resolveProvider(undefined)).toBe('openai');
            expect(resolveProvider('')).toBe('openai');
            expect(resolveProvider('anthropic')).toBe('openai');
        });
    });

    describe('resolveLlmConfig', () => {
        it('applies openai defaults when LLM_PROVIDER is unset', () => {
            const config = resolveLlmConfig({ LLM_API_KEY: 'sk-test' });
            expect(config).toEqual({
                provider: 'openai',
                apiKey: 'sk-test',
                baseURL: undefined,
                model: 'gpt-4o-mini',
            });
        });

        it('applies ollama defaults and a placeholder API key when LLM_PROVIDER=ollama', () => {
            const config = resolveLlmConfig({ LLM_PROVIDER: 'ollama' });
            expect(config).toEqual({
                provider: 'ollama',
                apiKey: 'ollama',
                baseURL: 'http://localhost:11434/v1',
                model: 'llama3.1',
            });
        });

        it('lets LLM_BASE_URL/LLM_MODEL override the provider defaults', () => {
            const config = resolveLlmConfig({
                LLM_PROVIDER: 'ollama',
                LLM_BASE_URL: 'http://custom-host:9999/v1',
                LLM_MODEL: 'mistral',
            });
            expect(config.baseURL).toBe('http://custom-host:9999/v1');
            expect(config.model).toBe('mistral');
        });

        it('leaves apiKey empty for openai when LLM_API_KEY is unset', () => {
            const config = resolveLlmConfig({});
            expect(config.provider).toBe('openai');
            expect(config.apiKey).toBe('');
        });
    });

    describe('parseLlmJsonResponse', () => {
        it('parses a raw JSON object', () => {
            expect(parseLlmJsonResponse('{"title": "A", "description": "B"}')).toEqual({
                title: 'A',
                description: 'B',
            });
        });

        it('strips a ```json fenced code block before parsing', () => {
            const raw = '```json\n{"title": "A"}\n```';
            expect(parseLlmJsonResponse(raw)).toEqual({ title: 'A' });
        });

        it('strips a bare ``` fenced code block before parsing', () => {
            const raw = '```\n{"description": "B"}\n```';
            expect(parseLlmJsonResponse(raw)).toEqual({ description: 'B' });
        });

        it('omits a key that is present but not a string', () => {
            expect(parseLlmJsonResponse('{"title": 123, "description": "B"}')).toEqual({
                description: 'B',
            });
        });

        it('returns null for unparseable content', () => {
            expect(parseLlmJsonResponse('not json at all')).toBeNull();
        });

        it('returns null for a JSON array (not an object)', () => {
            expect(parseLlmJsonResponse('["title", "description"]')).toBeNull();
        });
    });

    describe('generateTitleDescriptionFix', () => {
        const baseInput = {
            url: 'https://example.com/page',
            currentTitle: 'Bad Title',
            currentDescription: 'Bad description',
            headings: ['Heading One'],
            contentExcerpt: 'Some page content.',
            needsTitleFix: true,
            needsDescriptionFix: true,
            language: 'en' as const,
        };
        const config = { provider: 'openai' as const, apiKey: 'sk-test', model: 'gpt-4o-mini' };

        it('returns the parsed fix on a successful response', async () => {
            const fakeClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({
                            choices: [
                                {
                                    message: {
                                        content:
                                            '{"title": "New Title", "description": "New description"}',
                                    },
                                },
                            ],
                        }),
                    },
                },
            };

            const result = await generateTitleDescriptionFix(fakeClient as any, config, baseInput);
            expect(result).toEqual({ title: 'New Title', description: 'New description' });
        });

        it('returns null when the API call throws', async () => {
            const fakeClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockRejectedValue(new Error('network error')),
                    },
                },
            };

            const result = await generateTitleDescriptionFix(fakeClient as any, config, baseInput);
            expect(result).toBeNull();
        });

        it('returns null when the response has no message content', async () => {
            const fakeClient = {
                chat: {
                    completions: {
                        create: jest.fn().mockResolvedValue({ choices: [{ message: {} }] }),
                    },
                },
            };

            const result = await generateTitleDescriptionFix(fakeClient as any, config, baseInput);
            expect(result).toBeNull();
        });

        it('returns null when the response content is unparseable', async () => {
            const fakeClient = {
                chat: {
                    completions: {
                        create: jest
                            .fn()
                            .mockResolvedValue({ choices: [{ message: { content: 'nonsense' } }] }),
                    },
                },
            };

            const result = await generateTitleDescriptionFix(fakeClient as any, config, baseInput);
            expect(result).toBeNull();
        });
    });
});
