import OpenAI from 'openai';

export type LlmProvider = 'openai' | 'ollama';

const PROVIDER_DEFAULTS: Record<LlmProvider, { baseURL: string | undefined; model: string }> = {
    openai: { baseURL: undefined, model: 'gpt-4o-mini' },
    ollama: { baseURL: 'http://localhost:11434/v1', model: 'llama3.1' },
};

export const resolveProvider = (raw: string | undefined): LlmProvider =>
    raw === 'ollama' ? 'ollama' : 'openai';

export interface ILlmClientConfig {
    provider: LlmProvider;
    apiKey: string;
    baseURL?: string;
    model: string;
}

/** Resolves the effective LLM client config from environment variables, applying
 * provider-specific defaults for baseURL/model when not explicitly overridden. Ollama does not
 * require a real API key, but the OpenAI SDK requires a non-empty string. */
export const resolveLlmConfig = (
    env: Record<string, string | undefined> = process.env
): ILlmClientConfig => {
    const provider = resolveProvider(env.LLM_PROVIDER);
    const defaults = PROVIDER_DEFAULTS[provider];
    return {
        provider,
        apiKey: env.LLM_API_KEY ?? (provider === 'ollama' ? 'ollama' : ''),
        baseURL: env.LLM_BASE_URL ?? defaults.baseURL,
        model: env.LLM_MODEL ?? defaults.model,
    };
};

export const createLlmClient = (config: ILlmClientConfig): OpenAI =>
    new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });

export interface ITitleDescriptionFixInput {
    url: string;
    currentTitle?: string;
    currentDescription?: string;
    headings: string[]; // H1/H2 text, most-relevant-first
    contentExcerpt: string; // bounded excerpt of the page's main text content
    needsTitleFix: boolean;
    needsDescriptionFix: boolean;
    language: 'cs' | 'en';
}

export interface ITitleDescriptionFixResult {
    title?: string;
    description?: string;
}

const SYSTEM_PROMPT = `You are an SEO copywriter. Given a web page's current title/meta
description and real content, write replacement text that fixes length problems while staying
grounded in the actual page content. Rules:
- Title: 30-60 characters, and must fit within roughly 579px at Arial 16px (as a rough guide,
  keep it under ~58 average-width characters; prefer shorter over longer when in doubt).
- Meta description: 70-160 characters, and must fit within roughly 919px at Arial 16px (as a
  rough guide, keep it under ~140 average-width characters; prefer shorter over longer).
- Write in the same language as the page content (given to you explicitly).
- Do not invent facts not supported by the page's headings/content excerpt.
- Respond with ONLY a raw JSON object, no markdown code fences, no commentary:
  {"title": "...", "description": "..."} — omit a key entirely if it wasn't requested.`;

const buildUserPrompt = (input: ITitleDescriptionFixInput): string => {
    const parts: string[] = [
        `URL: ${input.url}`,
        `Language: ${input.language}`,
        `Current title: ${input.currentTitle ?? '(missing)'}`,
        `Current meta description: ${input.currentDescription ?? '(missing)'}`,
        `Headings: ${input.headings.join(' | ') || '(none)'}`,
        `Content excerpt: ${input.contentExcerpt}`,
        '',
        'Requested fixes:',
    ];
    if (input.needsTitleFix) parts.push('- Generate a new "title"');
    if (input.needsDescriptionFix) parts.push('- Generate a new "description"');
    return parts.join('\n');
};

/** Strips a ```json ... ``` fence (or bare ``` fence) that some models wrap responses in
 * despite being asked for raw JSON, then parses it. Returns null on unparseable output rather
 * than throwing, so callers can skip-and-log instead of crashing a batch run. */
export const parseLlmJsonResponse = (raw: string): ITitleDescriptionFixResult | null => {
    const stripped = raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    try {
        const parsed: unknown = JSON.parse(stripped);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
        const result: ITitleDescriptionFixResult = {};
        if ('title' in parsed && typeof (parsed as { title: unknown }).title === 'string') {
            result.title = (parsed as { title: string }).title;
        }
        if (
            'description' in parsed &&
            typeof (parsed as { description: unknown }).description === 'string'
        ) {
            result.description = (parsed as { description: string }).description;
        }
        return result;
    } catch {
        return null;
    }
};

/** Calls the configured LLM to generate a corrected title/description for one page. Returns null
 * on any failure (timeout, network error, unparseable response) so callers can skip that page
 * rather than aborting the whole batch. */
export const generateTitleDescriptionFix = async (
    client: OpenAI,
    config: ILlmClientConfig,
    input: ITitleDescriptionFixInput,
    timeoutMs = 30000
): Promise<ITitleDescriptionFixResult | null> => {
    try {
        const response = await client.chat.completions.create(
            {
                model: config.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: buildUserPrompt(input) },
                ],
                temperature: 0.3,
            },
            { timeout: timeoutMs }
        );
        const content = response.choices[0]?.message?.content;
        if (!content) return null;
        return parseLlmJsonResponse(content);
    } catch (error) {
        console.warn(`LLM fix generation failed for ${input.url}:`, error);
        return null;
    }
};
