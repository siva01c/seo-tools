import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureReportPdf, pdfPathFor } from '../../services/reportPdfService.js';

// Opt-in: this launches a real Chromium, which is the one thing the rest of the suite avoids.
// The image the container is built from ships the browser, so it does run in CI if asked:
//   SEO_PDF_INTEGRATION=1 npm test -- reportPdf
const enabled = process.env.SEO_PDF_INTEGRATION === '1';
const maybeDescribe = enabled ? describe : describe.skip;

maybeDescribe('reportPdfService (real Chromium render)', () => {
    let tmpDir: string;
    let mdPath: string;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-pdf-integration-'));
        mdPath = path.join(tmpDir, 'seo-audit-07-08-2026-cs.md');
        fs.writeFileSync(
            mdPath,
            [
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
                '| 🔴 Stránky s kritickými problémy | 0 |',
                '',
                '## 2. Rozsah auditu',
                '',
                '- ✅ Všechny stránky mají meta popis',
            ].join('\n')
        );
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('writes a real PDF next to the Markdown', async () => {
        const pdfPath = await ensureReportPdf(mdPath, { domain: 'example.com' });

        expect(pdfPath).toBe(pdfPathFor(mdPath));
        const buffer = fs.readFileSync(pdfPath);
        expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(buffer.length).toBeGreaterThan(1000);
        // Nothing may be left behind by the write-then-rename.
        expect(fs.existsSync(`${pdfPath}.tmp`)).toBe(false);
    }, 180000);

    it('reuses the cached PDF instead of rendering again', async () => {
        const pdfPath = await ensureReportPdf(mdPath, { domain: 'example.com' });
        const before = fs.statSync(pdfPath).mtimeMs;

        await ensureReportPdf(mdPath, { domain: 'example.com' });

        expect(fs.statSync(pdfPath).mtimeMs).toBe(before);
    }, 180000);
});
