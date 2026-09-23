/**
 * Normalised SEO findings for machine consumers, such as a scheduled audit workflow.
 *
 * The report scripts (`report:seo-issues`, `report:404`) write one JSON file per check into
 * storage/reports/<domain>/<DD-MM-YYYY>/. This service reads them back and folds ~1000 per-page
 * entries into a few dozen groups — one per (check, kind) — each with a severity, a stable
 * fingerprint for deduplication, and the URL delta against the previous report folder that has
 * findings. It never touches the crawler; it only reads what the scripts wrote.
 */
import * as fs from 'fs';
import * as path from 'path';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export interface IFindingGroup {
    fingerprint: string;
    check: string;
    kind: string;
    severity: Severity;
    count: number;
    urls: string[];
    newUrls: string[];
    resolvedUrls: string[];
    urlsTruncated: boolean;
}

export interface IFindingsResult {
    domain: string;
    reportDate: string;
    previousReportDate: string | null;
    totals: Record<Severity, number>;
    groups: IFindingGroup[];
    resolvedGroups: { fingerprint: string; check: string; kind: string; severity: Severity }[];
}

type RawEntry = { url: string; kind: string };

// File prefix -> check name. The date and language suffix after the prefix vary between
// script versions (YYYY-MM-DD vs DD-MM-YYYY, optional -cs), so files are matched by prefix.
const CHECK_FILES: { prefix: string; check: string }[] = [
    { prefix: '404-link-report-', check: 'broken_link' },
    { prefix: 'title-issues-', check: 'title' },
    { prefix: 'meta-description-', check: 'meta_description' },
    { prefix: 'h1-issues-', check: 'h1' },
    { prefix: 'jsonld-issues-', check: 'jsonld' },
    { prefix: 'og-completeness-', check: 'open_graph' },
    { prefix: 'twitter-card-missing-', check: 'twitter_card' },
    { prefix: 'orphaned-pages-', check: 'orphaned_page' },
    { prefix: 'redirect-3xx-', check: 'redirect_3xx' },
    { prefix: 'redirect-classification-', check: 'redirect_class' },
];

// Mirrors the priorities of ai/skills/weekly-seo-audit: missing/duplicate titles and broken
// links are critical, structural problems high, length/metadata polish medium or low.
const SEVERITY: Record<string, Severity> = {
    'broken_link:*': 'critical',
    'title:missing': 'critical',
    'title:duplicate': 'critical',
    'title:*': 'high',
    'meta_description:missing': 'critical',
    'meta_description:*': 'medium',
    'h1:missing': 'high',
    'h1:multiple': 'high',
    'h1:duplicate': 'medium',
    'h1:*': 'low',
    'orphaned_page:*': 'high',
    'jsonld:*': 'medium',
    'open_graph:*': 'medium',
    'redirect_3xx:*': 'medium',
    'twitter_card:*': 'low',
    'redirect_class:*': 'low',
};

export const severityOf = (check: string, kind: string): Severity =>
    SEVERITY[`${check}:${kind}`] ?? SEVERITY[`${check}:*`] ?? 'low';

const MAX_URLS_PER_GROUP = 50;

// Hostname-shaped only: this value becomes a path segment under storage/reports.
const DOMAIN_RE =
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export const isValidDomain = (domain: string): boolean => DOMAIN_RE.test(domain);

const parseDateFolder = (name: string): number | null => {
    const m = name.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
};

const findingFiles = (dir: string): Map<string, string> => {
    const byCheck = new Map<string, string>();
    // Unsuffixed (English) files sort before their -cs twins, so they win.
    const files = fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => a.length - b.length || a.localeCompare(b));
    for (const file of files) {
        const spec = CHECK_FILES.find(c => file.startsWith(c.prefix));
        if (spec && !byCheck.has(spec.check)) byCheck.set(spec.check, path.join(dir, file));
    }
    return byCheck;
};

/** Report folders for a domain that contain findings, newest first. */
export const findingDates = (reportsRoot: string, domain: string): string[] => {
    const dir = path.join(reportsRoot, domain);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .map(name => ({ name, ts: parseDateFolder(name) }))
        .filter((d): d is { name: string; ts: number } => d.ts !== null)
        .filter(d => findingFiles(path.join(dir, d.name)).size > 0)
        .sort((a, b) => b.ts - a.ts)
        .map(d => d.name);
};

const entriesOf = (check: string, data: unknown): RawEntry[] => {
    const obj = (data ?? {}) as Record<string, unknown>;
    // 404 report v1 is a bare array, v2 wraps it in `entries`; the rest use `issues` or `pages`.
    const list = (
        Array.isArray(data) ? data : (obj.entries ?? obj.issues ?? obj.pages ?? [])
    ) as Record<string, unknown>[];
    return list
        .map(e => {
            const url = String(e.url ?? e.target ?? '');
            let kind: string;
            if (check === 'broken_link') kind = `status_${String(e.status ?? 404)}`;
            else if (check === 'open_graph') kind = 'incomplete';
            else if (check === 'twitter_card' || check === 'orphaned_page') kind = 'missing';
            else if (check === 'redirect_class') kind = String(e.category ?? 'other');
            else if (check === 'redirect_3xx') kind = `status_${String(e.status ?? '3xx')}`;
            else kind = String(e.issue ?? 'issue');
            return { url, kind };
        })
        .filter(e => e.url !== '');
};

const readGroups = (
    dir: string
): Map<string, { check: string; kind: string; urls: Set<string> }> => {
    const groups = new Map<string, { check: string; kind: string; urls: Set<string> }>();
    for (const [check, file] of findingFiles(dir)) {
        let data: unknown;
        try {
            data = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            continue; // a half-written or corrupt file must not sink the whole result
        }
        for (const { url, kind } of entriesOf(check, data)) {
            const key = `${check}:${kind}`;
            if (!groups.has(key)) groups.set(key, { check, kind, urls: new Set() });
            groups.get(key)!.urls.add(url);
        }
    }
    return groups;
};

const capped = (urls: string[]): string[] => urls.slice(0, MAX_URLS_PER_GROUP);

/**
 * Findings for `domain` from the newest report folder (or `date`), diffed against the next
 * older folder with findings. Returns null when the domain has no findings at all.
 */
export const getFindings = (
    reportsRoot: string,
    domain: string,
    date?: string
): IFindingsResult | null => {
    const dates = findingDates(reportsRoot, domain);
    const idx = date ? dates.indexOf(date) : 0;
    if (dates.length === 0 || idx < 0) return null;

    const reportDate = dates[idx];
    const previousReportDate = dates[idx + 1] ?? null;
    const current = readGroups(path.join(reportsRoot, domain, reportDate));
    const previous = previousReportDate
        ? readGroups(path.join(reportsRoot, domain, previousReportDate))
        : new Map<string, { check: string; kind: string; urls: Set<string> }>();

    const totals: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const groups: IFindingGroup[] = [];
    for (const [key, g] of current) {
        const severity = severityOf(g.check, g.kind);
        const urls = [...g.urls].sort();
        const before = previous.get(key)?.urls ?? new Set<string>();
        totals[severity] += urls.length;
        groups.push({
            fingerprint: `seo:${domain}:${key}`,
            check: g.check,
            kind: g.kind,
            severity,
            count: urls.length,
            urls: capped(urls),
            // Without a previous run everything is new — the first audit reports all of it.
            newUrls: capped(urls.filter(u => !before.has(u))),
            resolvedUrls: capped([...before].filter(u => !g.urls.has(u)).sort()),
            urlsTruncated: urls.length > MAX_URLS_PER_GROUP,
        });
    }
    groups.sort(
        (a, b) =>
            SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
            b.count - a.count ||
            a.fingerprint.localeCompare(b.fingerprint)
    );

    const resolvedGroups = [...previous]
        .filter(([key]) => !current.has(key))
        .map(([key, g]) => ({
            fingerprint: `seo:${domain}:${key}`,
            check: g.check,
            kind: g.kind,
            severity: severityOf(g.check, g.kind),
        }));

    return { domain, reportDate, previousReportDate, totals, groups, resolvedGroups };
};
