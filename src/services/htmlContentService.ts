import type { Page } from 'playwright';

export interface IHtmlContent {
    full: string;
    main: string;
    mainSelector: string;
}

// CSS selectors to try in order for main content detection
const MAIN_CONTENT_SELECTORS = [
    'main',
    'article',
    '[role="main"]',
    '#content',
    '.content',
    '#main-content',
    '.main-content',
    '.article',
    '.page-content',
    '#main',
    '.main',
    '.entry-content',
    '.post-content',
];

export const extractFullHtml = async (page: Page): Promise<string> => {
    try {
        return await page.content();
    } catch (error) {
        console.warn(
            `⚠️ Failed to extract full HTML: ${error instanceof Error ? error.message : String(error)}`
        );
        return '';
    }
};

export const extractMainContentHtml = async (
    page: Page
): Promise<{ html: string; selector: string }> => {
    for (const selector of MAIN_CONTENT_SELECTORS) {
        try {
            const element = page.locator(selector).first();
            const count = await element.count();
            if (count > 0) {
                const html = await element.innerHTML();
                if (html && html.trim().length > 100) {
                    return { html, selector };
                }
            }
        } catch {
            // selector not found or failed, try next
        }
    }

    // Fallback: return body innerHTML
    try {
        const bodyHtml = await page.locator('body').innerHTML();
        return { html: bodyHtml, selector: 'body' };
    } catch (error) {
        console.warn(
            `⚠️ Failed to extract body HTML: ${error instanceof Error ? error.message : String(error)}`
        );
        return { html: '', selector: '' };
    }
};

// Removed from the main content element before its text is read: code and markup that is not
// prose, and the site chrome that surrounds the content. `header`/`footer` are matched only as
// direct children of <body> — inside an <article> they usually hold the title and byline.
const NON_CONTENT_SELECTOR = [
    'script',
    'style',
    'noscript',
    'template',
    'svg',
    'iframe',
    'nav',
    'aside',
    '[role="navigation"]',
    '[role="banner"]',
    '[role="contentinfo"]',
    'body > header',
    'body > footer',
].join(', ');

/**
 * Readable text of the main content element (same selector cascade as extractMainContentHtml),
 * without navigation, scripts and styles. `innerText` is layout-aware, so block elements become
 * line breaks and text hidden by CSS is left out.
 *
 * Mutates the page's DOM — call it last, on a page that is about to be discarded.
 */
export const extractMainContentText = async (
    page: Page
): Promise<{ text: string; selector: string }> => {
    const { selector } = await extractMainContentHtml(page);
    if (!selector) return { text: '', selector: '' };
    try {
        // Kept free of named inner functions: under tsx, esbuild wraps those in a `__name()`
        // helper that does not exist inside the browser.
        const text = await page
            .locator(selector)
            .first()
            .evaluate((element, nonContent) => {
                element.querySelectorAll(nonContent).forEach(node => node.remove());
                return (element as HTMLElement).innerText ?? '';
            }, NON_CONTENT_SELECTOR);
        return { text, selector };
    } catch (error) {
        console.warn(
            `⚠️ Failed to extract main content text: ${error instanceof Error ? error.message : String(error)}`
        );
        return { text: '', selector: '' };
    }
};

export const extractHtmlContent = async (page: Page): Promise<IHtmlContent> => {
    const [full, mainResult] = await Promise.all([
        extractFullHtml(page),
        extractMainContentHtml(page),
    ]);

    return {
        full,
        main: mainResult.html,
        mainSelector: mainResult.selector,
    };
};
