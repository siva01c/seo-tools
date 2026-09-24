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

export function stripPiiFromText(text: string): string {
    if (!text) return text;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex =
        /(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}|\b\d{3}[\s-]\d{4}\b/g;
    return text.replace(emailRegex, '[REDACTED_EMAIL]').replace(phoneRegex, '[REDACTED_PHONE]');
}

const buildUserPrompt = (input: ITitleDescriptionFixInput): string => {
    const cleanUrl = input.url;
    const cleanTitle = stripPiiFromText(input.currentTitle ?? '(missing)');
    const cleanDesc = stripPiiFromText(input.currentDescription ?? '(missing)');
    const cleanHeadings = input.headings.map(h => stripPiiFromText(h)).join(' | ') || '(none)';
    const cleanExcerpt = stripPiiFromText(input.contentExcerpt);

    const parts: string[] = [
        `URL: ${cleanUrl}`,
        `Language: ${input.language}`,
        `Current title: ${cleanTitle}`,
        `Current meta description: ${cleanDesc}`,
        `Headings: ${cleanHeadings}`,
        `Content excerpt: ${cleanExcerpt}`,
        '',
        'Requested fixes:',
    ];
    if (input.needsTitleFix) parts.push('- Generate a new "title"');
    if (input.needsDescriptionFix) parts.push('- Generate a new "description"');
    return parts.join('\n');
};

/** Strips a ```json ... ``` fence (or bare ``` fence) that some models wrap responses in despite
 * being asked for raw JSON. */
export const stripJsonFence = (raw: string): string =>
    raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

/** Strips a ```json ... ``` fence (or bare ``` fence) that some models wrap responses in
 * despite being asked for raw JSON, then parses it. Returns null on unparseable output rather
 * than throwing, so callers can skip-and-log instead of crashing a batch run. */
export const parseLlmJsonResponse = (raw: string): ITitleDescriptionFixResult | null => {
    const stripped = stripJsonFence(raw);
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

// ── Cross-language page matching ─────────────────────────────────────────────

export interface IPageMatchCandidate {
    /** Path on the target site, used verbatim as the answer key. */
    path: string;
    title?: string;
    description?: string;
}

export interface IPageMatchInput {
    /** Path of the source page being matched, for logging and prompt context. */
    sourcePath: string;
    sourceTitle?: string;
    sourceDescription?: string;
    /** Bounded excerpt of the source page's main text content. */
    contentExcerpt: string;
    candidates: IPageMatchCandidate[];
}

export interface IPageMatchResult {
    /** Target path the model picked, or null when it found no counterpart. */
    path: string | null;
    confidence: 'high' | 'medium' | 'low';
    reason?: string;
}

const PAGE_MATCH_SYSTEM_PROMPT = `You match a page from an English website to its translated
counterpart on a Czech website. The two sites share content but use translated titles and URL
slugs, so match on meaning, not on wording. Rules:
- Pick a candidate only if it is the SAME page — the same product, the same case study, the same
  article — not merely a related or same-category page.
- Product model codes (e.g. CAF, XR-200, KX-160) are decisive: they are not
  translated, so a shared code is strong evidence and a conflicting code rules a candidate out.
- Much of the English site has no Czech counterpart at all. Answering null is expected and
  correct in that case — never stretch to the nearest topic.
- confidence: "high" when a model code or an unambiguous title/topic match settles it, "medium"
  when the topic matches but wording differs enough to leave doubt, "low" when it is a guess.
- reason: one short clause, in English, naming what decided it.
- Respond with ONLY a raw JSON object, no markdown code fences, no commentary:
  {"path": "/some/path", "confidence": "high", "reason": "..."} or {"path": null}`;

const buildPageMatchPrompt = (input: IPageMatchInput): string => {
    const candidates = input.candidates
        .map(c => {
            const title = stripPiiFromText(c.title ?? '(no title)');
            const description = c.description ? ` — ${stripPiiFromText(c.description)}` : '';
            return `${c.path} | ${title}${description}`;
        })
        .join('\n');

    return `English page to match:
PATH: ${input.sourcePath}
TITLE: ${stripPiiFromText(input.sourceTitle ?? '(missing)')}
META DESCRIPTION: ${stripPiiFromText(input.sourceDescription ?? '(missing)')}
CONTENT EXCERPT: ${stripPiiFromText(input.contentExcerpt)}

Czech candidate pages (path | title — description):
${candidates}

Which candidate path is the Czech version of the English page above, if any?`;
};

/** Parses a page-match response. Returns null on unparseable output, and a result with
 * `path: null` when the model reported no counterpart — those are different answers, so callers
 * can tell a failed call apart from a deliberate "no match". */
export const parsePageMatchResponse = (raw: string): IPageMatchResult | null => {
    try {
        const parsed: unknown = JSON.parse(stripJsonFence(raw));
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
        const record = parsed as Record<string, unknown>;
        if (!('path' in record)) return null;
        const path =
            typeof record.path === 'string' && record.path.trim() !== '' ? record.path : null;
        const rawConfidence = record.confidence;
        const confidence =
            rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low'
                ? rawConfidence
                : 'low';
        return {
            path,
            confidence,
            reason: typeof record.reason === 'string' ? record.reason : undefined,
        };
    } catch {
        return null;
    }
};

/** Calls the configured LLM to pick the translated counterpart of one page from a candidate list.
 * Returns null on any failure (timeout, network error, unparseable response) so callers can skip
 * that page rather than aborting the whole batch. */
export const matchTranslatedPage = async (
    client: OpenAI,
    config: ILlmClientConfig,
    input: IPageMatchInput,
    timeoutMs = 60000
): Promise<IPageMatchResult | null> => {
    if (input.candidates.length === 0) return { path: null, confidence: 'high' };
    try {
        const response = await client.chat.completions.create(
            {
                model: config.model,
                messages: [
                    { role: 'system', content: PAGE_MATCH_SYSTEM_PROMPT },
                    { role: 'user', content: buildPageMatchPrompt(input) },
                ],
                temperature: 0,
            },
            { timeout: timeoutMs }
        );
        const content = response.choices[0]?.message?.content;
        if (!content) return null;
        return parsePageMatchResponse(content);
    } catch (error) {
        console.warn(`LLM page match failed for ${input.sourcePath}:`, error);
        return null;
    }
};
