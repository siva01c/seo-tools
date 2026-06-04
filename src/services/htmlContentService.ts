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
