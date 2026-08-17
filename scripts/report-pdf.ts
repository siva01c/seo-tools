import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ensureReportPdf, pdfPathFor } from '../src/services/reportPdfService.js';

/**
 * Renders the PDF for an already-generated Markdown audit report.
 *
 * The server renders PDFs lazily at e-mail time, so this exists for two other cases: eyeballing
 * the typography without triggering a crawl, and backfilling PDFs for reports that predate the
 * feature.
 *
 *   npx tsx scripts/report-pdf.ts --md storage/reports/example.com/07-08-2026/seo-audit-…-cs.md
 *   npx tsx scripts/report-pdf.ts --domain example.com [--date 07-08-2026] [--force]
 */

function getArg(args: string[], name: string): string | undefined {
    const flag = args.find(a => a.startsWith(`--${name}=`));
    if (flag) return flag.split('=').slice(1).join('=');
    const idx = args.indexOf(`--${name}`);
    if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
    return undefined;
}

/** Newest first, matching getSortedDateFolders() in mcp-server.ts. */
function listReportDates(domain: string): string[] {
    const reportsDir = join('storage', 'reports', domain);
    if (!existsSync(reportsDir)) return [];
    return readdirSync(reportsDir)
        .filter(d => /^\d{2}-\d{2}-\d{4}$/.test(d))
        .sort((a, b) => {
            const toIso = (d: string): string => `${d.slice(6)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
            return toIso(b).localeCompare(toIso(a));
        });
}

function resolveMdPath(domain: string, dateArg?: string): string | null {
    const dates = dateArg ? [dateArg] : listReportDates(domain);
    for (const date of dates) {
        const dir = join('storage', 'reports', domain, date);
        if (!existsSync(dir)) continue;
        const file = readdirSync(dir).find(f => f.endsWith('.md'));
        if (file) return join(dir, file);
    }
    return null;
}

const args = process.argv.slice(2);
const mdArg = getArg(args, 'md');
const domainArg = getArg(args, 'domain');
const dateArg = getArg(args, 'date');
const force = args.includes('--force');

const main = async (): Promise<void> => {
    if (!mdArg && !domainArg) {
        console.error(
            '❌ Usage: npx tsx scripts/report-pdf.ts --md <report.md>\n' +
                '          npx tsx scripts/report-pdf.ts --domain <domain> [--date DD-MM-YYYY] [--force]'
        );
        process.exit(1);
    }

    const mdPath = mdArg ?? resolveMdPath(domainArg as string, dateArg);
    if (!mdPath || !existsSync(mdPath)) {
        console.error(`❌ No Markdown report found${mdPath ? `: ${mdPath}` : ''}`);
        process.exit(1);
    }

    // ensureReportPdf caches on mtime; --force re-renders an up-to-date PDF anyway.
    if (force && existsSync(pdfPathFor(mdPath))) {
        const { unlinkSync } = await import('fs');
        unlinkSync(pdfPathFor(mdPath));
    }

    const domain = domainArg ?? mdPath.split(/[\\/]/).at(-3);
    console.log(`📄 Rendering PDF for ${mdPath}`);
    const pdfPath = await ensureReportPdf(mdPath, { domain });
    console.log(`✅ ${pdfPath}`);
};

main().catch(err => {
    console.error('❌ PDF render failed:', err);
    process.exit(1);
});
