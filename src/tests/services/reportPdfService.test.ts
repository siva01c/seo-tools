import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    isPdfStale,
    langFromReportPath,
    pdfPathFor,
    renderMarkdownToHtml,
} from '../../services/reportPdfService.js';

// Covers everything up to the browser: renderMarkdownToHtml is deliberately pure so the print
// layout can be asserted without launching Chromium. The real render is exercised by
// src/tests/integration/reportPdf.integration.test.ts, which is opt-in.
describe('reportPdfService', () => {
    describe('pdfPathFor', () => {
        it('places the PDF next to the Markdown with the same basename', () => {
            expect(
                pdfPathFor(path.join('storage', 'reports', 'a.cz', '07-08-2026', 'r-cs.md'))
            ).toBe(path.join('storage', 'reports', 'a.cz', '07-08-2026', 'r-cs.pdf'));
        });
    });

    describe('langFromReportPath', () => {
        it('reads the -cs suffix seo-audit.ts appends for Czech reports', () => {
            expect(langFromReportPath('seo-audit-07-08-2026-cs.md')).toBe('cs');
            expect(langFromReportPath('seo-audit-07-08-2026.md')).toBe('en');
        });
    });

    // Exercises the real filesystem in a temp directory, matching parseKeywordPositions.test.ts:
    // jest.mock('fs', ...) does not intercept ESM imports under the ts-jest ESM preset.
    describe('isPdfStale', () => {
        let tmpDir: string;
        let mdPath: string;
        let pdfPath: string;

        beforeEach(() => {
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-pdf-test-'));
            mdPath = path.join(tmpDir, 'report-cs.md');
            pdfPath = pdfPathFor(mdPath);
            fs.writeFileSync(mdPath, '# report\n');
        });

        afterEach(() => {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('is stale when no PDF exists yet', () => {
            expect(isPdfStale(mdPath, pdfPath)).toBe(true);
        });

        it('is fresh when the PDF is newer than the Markdown', () => {
            fs.writeFileSync(pdfPath, 'pdf');
            const now = Date.now();
            fs.utimesSync(mdPath, new Date(now - 10000), new Date(now - 10000));
            fs.utimesSync(pdfPath, new Date(now), new Date(now));
            expect(isPdfStale(mdPath, pdfPath)).toBe(false);
        });

        // seo-audit.ts overwrites the .md in place when a domain is re-audited the same day.
        it('is stale when the Markdown was regenerated after the PDF', () => {
            fs.writeFileSync(pdfPath, 'pdf');
            const now = Date.now();
            fs.utimesSync(pdfPath, new Date(now - 10000), new Date(now - 10000));
            fs.utimesSync(mdPath, new Date(now), new Date(now));
            expect(isPdfStale(mdPath, pdfPath)).toBe(true);
        });
    });

    describe('renderMarkdownToHtml', () => {
        const report = [
            '# SEO audit — example.com',
            '',
            '**Vygenerováno:** 2026-08-07',
            '',
            '---',
            '',
            '## 1. Manažerské shrnutí',
            '',
            '| Metrika | Počet |',
            '|--------|-------|',
            '| Stránky | 187 |',
            '',
            '## 2. Rozsah auditu',
            '',
            '- ✅ Všechny stránky mají meta popis',
            '',
            '## 3. Inventář typů stránek',
            '',
            '- [ ] Ověřit JSON-LD',
        ].join('\n');

        it('renders GFM tables with a header group so long tables repeat their header', () => {
            const html = renderMarkdownToHtml(report, { lang: 'cs' });
            expect(html).toContain('<table>');
            expect(html).toContain('<thead>');
            expect(html).toContain('<th>Metrika</th>');
            expect(html).toContain('thead { display: table-header-group; }');
        });

        it('emits A4 print rules and a page break before every section', () => {
            const html = renderMarkdownToHtml(report);
            expect(html).toContain('@page { size: A4; margin: 14mm 12mm 16mm; }');
            expect(html).toMatch(/h2 \{[^}]*page-break-before: always;/);
        });

        it('gives every heading a diacritics-folded id and builds a matching contents list', () => {
            const html = renderMarkdownToHtml(report, { lang: 'cs' });
            expect(html).toContain('<h2 id="1-manazerske-shrnuti">');
            expect(html).toContain('<h2 id="3-inventar-typu-stranek">');

            const toc = /<nav class="toc">[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
            expect(toc).toContain('>Obsah</h2>');
            expect(toc).toContain('href="#1-manazerske-shrnuti"');
            expect(toc).toContain('href="#2-rozsah-auditu"');
            expect(toc).toContain('href="#3-inventar-typu-stranek"');
            // The headings carry their own numbering, so the list must not add a second one.
            expect(toc).not.toContain('<ol>');
        });

        it('keeps the report title above the contents rather than on its own page', () => {
            const html = renderMarkdownToHtml(report, { lang: 'cs' });
            expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('<nav class="toc">'));
            expect(html.indexOf('<nav class="toc">')).toBeLessThan(html.indexOf('<h2 id="1-'));
        });

        it('localises the contents heading', () => {
            expect(renderMarkdownToHtml(report, { lang: 'en' })).toContain('>Contents</h2>');
        });

        it('preserves emoji severity markers and Czech diacritics', () => {
            const html = renderMarkdownToHtml(report, { lang: 'cs' });
            expect(html).toContain('✅ Všechny stránky mají meta popis');
            expect(html).toContain('Manažerské shrnutí');
            expect(html).toContain("'Noto Color Emoji'");
        });

        // Report sections quote crawled <title>/meta text verbatim, so that text is
        // attacker-controlled: it comes off whatever site was audited.
        it('escapes raw HTML coming from crawled page content', () => {
            const html = renderMarkdownToHtml(
                ['## 3. Inventář', '', '- `/evil/` — <script>alert(1)</script> <img src=x>'].join(
                    '\n'
                )
            );
            expect(html).not.toContain('<script>alert(1)</script>');
            expect(html).not.toContain('<img src=x>');
            expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        });

        it('renders Markdown without a title block unchanged', () => {
            const html = renderMarkdownToHtml('## Only a section\n\ntext\n');
            expect(html).toContain('<h2 id="only-a-section">Only a section</h2>');
            expect(html).toContain('<p>text</p>');
        });
    });
});
