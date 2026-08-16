import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { Marked, type Tokens } from 'marked';

/**
 * Renders a generated SEO audit Markdown report into a print-ready PDF.
 *
 * The .md file stays the canonical artifact on disk (the MCP `get_report` tool and the
 * cached-report branch in mcp-server both read it); the PDF exists because raw Markdown —
 * GFM pipe tables in particular — is unreadable on a phone, and the report is delivered by
 * e-mail.
 *
 * Rendering goes through the Chromium that already ships in the
 * apify/actor-node-playwright-chrome base image, so this costs no extra binary. That image
 * also carries NotoColorEmoji plus the Liberation family, which is what makes the report's
 * ✅/🔴/🟡 severity markers and the Czech diacritics come out as glyphs rather than tofu.
 */

/** Wall-clock budget for one render, including browser startup. Read per call so tests can vary it. */
function pdfTimeoutMs(): number {
    return Number(process.env.SEO_PDF_TIMEOUT_MS ?? 120000);
}

/** How long a shutdown of an already-failed browser may take before it is given up on. */
const BROWSER_CLOSE_TIMEOUT_MS = 10000;

export type TReportLang = 'cs' | 'en';

export interface IPdfRenderOptions {
    /** Drives the few chrome strings (table of contents heading, footer). */
    lang?: TReportLang;
    /** Shown in the PDF footer next to the page numbers. */
    domain?: string;
}

interface ILabels {
    contents: string;
    page: string;
    of: string;
}

const LABELS: Record<TReportLang, ILabels> = {
    cs: { contents: 'Obsah', page: 'strana', of: 'z' },
    en: { contents: 'Contents', page: 'page', of: 'of' },
};

// ── paths & staleness ─────────────────────────────────────────────────────────

/** Sibling of the Markdown report, same basename: seo-audit-07-08-2026-cs.md → …-cs.pdf */
export function pdfPathFor(mdPath: string): string {
    const dir = path.dirname(mdPath);
    const base = path.basename(mdPath, path.extname(mdPath));
    return path.join(dir, `${base}.pdf`);
}

/**
 * A PDF is stale when it is missing or older than the Markdown it was rendered from.
 * seo-audit.ts overwrites the .md in place when a domain is re-audited on the same day,
 * so an mtime comparison — not mere existence — is what keeps the attachment in sync.
 */
export function isPdfStale(mdPath: string, pdfPath: string): boolean {
    if (!fs.existsSync(pdfPath)) return true;
    try {
        return fs.statSync(pdfPath).mtimeMs < fs.statSync(mdPath).mtimeMs;
    } catch {
        return true;
    }
}

/** seo-audit.ts appends `-cs` for Czech reports and nothing for English (scripts/i18n.ts). */
export function langFromReportPath(mdPath: string): TReportLang {
    return /-cs\.md$/i.test(mdPath) ? 'cs' : 'en';
}

// ── Markdown → print HTML ─────────────────────────────────────────────────────

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Stable, diacritics-folded anchor ids ("## 3. Inventář typů stránek" → "3-inventar-typu-stranek"),
 * deduplicated the way GitHub does it. Section 13's backlog headings repeat wording often enough
 * that the counter matters.
 */
class Slugger {
    private seen = new Map<string, number>();

    public slug(text: string): string {
        const base =
            text
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'section';
        const count = this.seen.get(base) ?? 0;
        this.seen.set(base, count + 1);
        return count === 0 ? base : `${base}-${count}`;
    }
}

interface ITocEntry {
    id: string;
    title: string;
}

/**
 * Walks every heading in document order assigning slugs, and keeps the level-2 ones for the
 * table of contents. The render pass below repeats the same walk with a fresh Slugger — same
 * order, same input, so the ids match by construction.
 */
function collectToc(marked: Marked, markdown: string): ITocEntry[] {
    const slugger = new Slugger();
    const toc: ITocEntry[] = [];
    for (const token of marked.lexer(markdown)) {
        if (token.type !== 'heading') continue;
        const heading = token as Tokens.Heading;
        const id = slugger.slug(heading.text);
        if (heading.depth === 2) toc.push({ id, title: heading.text });
    }
    return toc;
}

function printStylesheet(): string {
    // A4 at 10pt with the inventory tables dropped to 8pt: section 3 of a real report is a
    // 6-column table with one row per crawled page (187 on ludekkvapil.cz), so fixed layout
    // plus word-break is what stops long URLs from blowing the columns apart.
    return `
:root { color-scheme: light; }
@page { size: A4; margin: 14mm 12mm 16mm; }
body {
    margin: 0;
    color: #1a1a1a;
    background: #fff;
    font-size: 10pt;
    line-height: 1.45;
    /* Emoji last so it only ever supplies the pictographs, never the Latin text. */
    font-family: 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif, 'Noto Color Emoji';
    -webkit-print-color-adjust: exact;
}
h1 { font-size: 20pt; margin: 0 0 4mm; }
h2 {
    font-size: 14pt;
    margin: 0 0 3mm;
    padding-bottom: 1.5mm;
    border-bottom: 1.5pt solid #1a1a1a;
    page-break-before: always;
}
h3 { font-size: 11.5pt; margin: 5mm 0 2mm; }
h4 { font-size: 10pt; margin: 4mm 0 2mm; }
h1, h2, h3, h4 { page-break-after: avoid; }
p, ul, ol { margin: 0 0 2.5mm; }
li { margin-bottom: 0.8mm; }
hr { border: 0; border-top: 0.5pt solid #d0d0d0; margin: 4mm 0; }
a { color: inherit; text-decoration: none; }
code {
    font-family: 'Liberation Mono', 'DejaVu Sans Mono', monospace;
    font-size: 0.88em;
    background: #f2f2f2;
    padding: 0 0.6mm;
    border-radius: 1pt;
    word-break: break-all;
}
table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
    margin: 0 0 3mm;
}
th, td {
    border: 0.5pt solid #cfcfcf;
    padding: 1mm 1.2mm;
    text-align: left;
    vertical-align: top;
    word-break: break-word;
    overflow-wrap: anywhere;
}
th { background: #ededed; font-weight: bold; }
/* Repeat the header row on every page a long table spills onto. */
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
td code { font-size: 7.5pt; background: none; padding: 0; }
blockquote {
    margin: 0 0 3mm;
    padding-left: 3mm;
    border-left: 2pt solid #d0d0d0;
    color: #555;
}
.toc h2 { page-break-before: avoid; }
/* The section headings already carry their own "1.", "2." numbering. */
.toc ul { list-style: none; padding-left: 0; }
.toc li { margin-bottom: 1.2mm; }
`.trim();
}

/**
 * Markdown → a single self-contained HTML document. Pure and synchronous, so the layout can be
 * unit-tested without ever launching a browser.
 *
 * Raw HTML is escaped rather than passed through: the report embeds crawled <title>/meta text
 * verbatim (see section 3 and the per-page issue list), and that text is attacker-controlled by
 * definition — it comes off whatever site was audited.
 */
export function renderMarkdownToHtml(markdown: string, options: IPdfRenderOptions = {}): string {
    const labels = LABELS[options.lang ?? 'cs'];
    const marked = new Marked({ gfm: true, breaks: false, async: false });
    const toc = collectToc(marked, markdown);
    const slugger = new Slugger();

    marked.use({
        renderer: {
            heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token) {
                const heading = token as Tokens.Heading;
                const id = slugger.slug(heading.text);
                const body = this.parser.parseInline(heading.tokens);
                return `<h${heading.depth} id="${id}">${body}</h${heading.depth}>\n`;
            },
            html(token) {
                return escapeHtml((token as Tokens.HTML).text);
            },
        },
    });

    // Split off the report's own title block (h1 + meta + rule) so the table of contents can sit
    // under it on the first page instead of pushing it onto page 2. Every `## ` section that
    // follows starts its own page anyway.
    const firstSection = markdown.startsWith('# ') ? markdown.search(/^## /m) : -1;
    const coverMd = firstSection > 0 ? markdown.slice(0, firstSection) : '';
    const bodyMd = firstSection > 0 ? markdown.slice(firstSection) : markdown;

    // Parsed cover-first so the shared slugger walks headings in document order.
    const coverHtml = coverMd ? (marked.parse(coverMd) as string) : '';
    const bodyHtml = marked.parse(bodyMd) as string;

    const tocHtml =
        toc.length > 1
            ? `<nav class="toc"><h2>${escapeHtml(labels.contents)}</h2><ul>` +
              toc
                  .map(entry => `<li><a href="#${entry.id}">${escapeHtml(entry.title)}</a></li>`)
                  .join('') +
              '</ul></nav>\n'
            : '';

    return [
        '<!DOCTYPE html>',
        `<html lang="${options.lang ?? 'cs'}"><head><meta charset="utf-8">`,
        `<title>${escapeHtml(options.domain ?? 'SEO audit')}</title>`,
        `<style>${printStylesheet()}</style>`,
        '</head><body>',
        coverHtml,
        tocHtml,
        bodyHtml,
        '</body></html>',
    ].join('\n');
}

// ── HTML → PDF ────────────────────────────────────────────────────────────────

function footerTemplate(labels: ILabels, domain?: string): string {
    const left = domain ? `${escapeHtml(domain)} · ` : '';
    return (
        `<div style="width:100%;font-size:7pt;color:#666;padding:0 12mm;` +
        `font-family:'Liberation Sans',Arial,sans-serif;text-align:right;">` +
        `${left}${escapeHtml(labels.page)} <span class="pageNumber"></span> ` +
        `${escapeHtml(labels.of)} <span class="totalPages"></span></div>`
    );
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * The whole render — browser startup included — must fit inside the timeout, and the browser has
 * to be gone before this function settles. Timing out around the outside instead would abandon a
 * live Chromium: the queue below would release and start a second one, which is exactly the
 * memory guard failing in the slow/hung case it exists for.
 */
async function renderHtmlToPdf(html: string, options: IPdfRenderOptions): Promise<Buffer> {
    const labels = LABELS[options.lang ?? 'cs'];
    const deadline = Date.now() + pdfTimeoutMs();
    const remaining = (): number => Math.max(1, deadline - Date.now());

    // page.pdf() is Chromium-headless-only, so this launches its own browser rather than
    // reusing anything from the crawler (which deliberately runs headed under Xvfb).
    // launch() enforces its own timeout and kills whatever it started, so it needs no race.
    const browser = await chromium.launch({
        headless: true,
        timeout: remaining(),
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    try {
        // No JS and no network: the document is fully inlined, so anything that tried to run or
        // phone home could only have come from crawled page content.
        const context = await browser.newContext({ javaScriptEnabled: false });
        const page = await context.newPage();
        page.setDefaultTimeout(remaining());
        await page.route('**/*', route => route.abort());
        await page.setContent(html, { waitUntil: 'load', timeout: remaining() });
        // page.pdf() takes no timeout option of its own, so it is the one call that needs an
        // explicit race — kept inside the try so the finally below still runs first.
        const pdf = page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '14mm', right: '12mm', bottom: '16mm', left: '12mm' },
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: footerTemplate(labels, options.domain),
        });
        return await withTimeout(pdf, remaining(), 'page.pdf()');
    } finally {
        // Bounded too: a Chromium wedged badly enough to ignore close() must not hold the render
        // queue shut forever. close() kills the process after its own grace period, so this
        // only ever fires in the pathological case.
        await withTimeout(browser.close(), BROWSER_CLOSE_TIMEOUT_MS, 'browser.close()').catch(err =>
            console.error('[reportPdf] Chromium did not shut down cleanly:', err)
        );
    }
}

// ── public entry point ────────────────────────────────────────────────────────

/**
 * Renders are serialised to one at a time. The VPS container is capped at 1.5 G with
 * SEO_MAX_CONCURRENT_CRAWLS=2 and no swap (docs/memory-optimization.md), so two audits
 * finishing together must not hold two Chromium instances at once.
 */
let renderChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = renderChain.then(work, work);
    renderChain = result.catch(() => undefined);
    return result;
}

/**
 * Returns the path to the PDF for a Markdown report, rendering it only when missing or stale.
 * Throws if the render fails — callers decide whether to fall back to the Markdown.
 */
export async function ensureReportPdf(
    mdPath: string,
    options: IPdfRenderOptions = {}
): Promise<string> {
    const pdfPath = pdfPathFor(mdPath);
    if (!isPdfStale(mdPath, pdfPath)) return pdfPath;

    return await enqueue(async () => {
        // Re-check: a concurrent request for the same domain may have rendered it while this
        // call was waiting its turn in the queue.
        if (!isPdfStale(mdPath, pdfPath)) return pdfPath;

        const started = Date.now();
        const markdown = fs.readFileSync(mdPath, 'utf8');
        const renderOptions: IPdfRenderOptions = {
            lang: options.lang ?? langFromReportPath(mdPath),
            domain: options.domain,
        };
        const html = renderMarkdownToHtml(markdown, renderOptions);
        // renderHtmlToPdf owns the timeout itself, so the queue is not released until its
        // browser is actually gone.
        const buffer = await renderHtmlToPdf(html, renderOptions);

        // Write through a temp file so an interrupted render can never leave a truncated PDF
        // that looks fresh to isPdfStale().
        const tmpPath = `${pdfPath}.tmp`;
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, pdfPath);

        console.log(
            `[reportPdf] Rendered ${path.basename(pdfPath)} ` +
                `(${Math.round(buffer.length / 1024)} kB) in ${Date.now() - started}ms`
        );
        return pdfPath;
    });
}
