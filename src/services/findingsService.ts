/**
 * Normalised SEO findings for machine consumers, such as a scheduled audit workflow.
 *
 * The report scripts (`report:seo-issues`, `report:404`) write one JSON file per check into
 * storage/reports/<domain>/<DD-MM-YYYY>/. Those files can be huge — duplicate groups list every
 * sibling URL on every entry, so a large site reaches 100+ MB per file. They are therefore read
 * once, off the server process, by `scripts/build-findings.ts`, which folds them into a compact
 * `findings.json`: one group per (check, kind) with its URLs, plus the list of checks it could
 * actually read. That file is written last and atomically, so its presence is also the marker
 * that the folder is complete; `getFindings` reads nothing else.
 */
import * as fs from 'fs';
import * as path from 'path';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export const FINDINGS_FILE = 'findings.json';
export const FINDINGS_SCHEMA_VERSION = 1;

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
    /** The previous report could not read this check, so newUrls/resolvedUrls are not a diff. */
    previousCheckMissing: boolean;
}

export interface IFindingsResult {
    domain: string;
    reportDate: string;
    previousReportDate: string | null;
    /** Checks this report read successfully; the others are in checksMissing. */
    checksPresent: string[];
    checksMissing: string[];
    totals: Record<Severity, number>;
    groups: IFindingGroup[];
    resolvedGroups: { fingerprint: string; check: string; kind: string; severity: Severity }[];
}

/** The compact per-folder index `build-findings` writes. */
export interface IFindingsIndex {
    schema_version: number;
    domain: string;
    reportDate: string;
    generatedAt: string;
    checks: string[];
    groups: { check: string; kind: string; urls: string[] }[];
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

export const ALL_CHECKS = CHECK_FILES.map(c => c.check);

// Mirrors the priorities of the weekly SEO audit playbook: missing/duplicate titles and broken
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

/**
 * The one spelling of a domain used for storage paths, by `crawl` and `get_findings` alike:
 * lowercase, no trailing root dot, no leading `www.`.
 */
export const normaliseDomain = (host: string): string =>
    host
        .trim()
        .toLowerCase()
        .replace(/\.$/, '')
        .replace(/^www\./, '');

const parseDateFolder = (name: string): number | null => {
    const m = name.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
};

const findingFiles = (dir: string): Map<string, string> => {
    const byCheck = new Map<string, string>();
    // Unsuffixed (English) files sort before their -cs twins, so they win.
    const files = fs
        .readdirSync(dir)
        .filter(f => f.endsWith('.json') && f !== FINDINGS_FILE)
        .sort((a, b) => a.length - b.length || a.localeCompare(b));
    for (const file of files) {
        const spec = CHECK_FILES.find(c => file.startsWith(c.prefix));
        if (spec && !byCheck.has(spec.check)) byCheck.set(spec.check, path.join(dir, file));
    }
    return byCheck;
};

export const entriesOf = (check: string, data: unknown): RawEntry[] => {
    const obj = (data ?? {}) as Record<string, unknown>;
    // 404 report v1 is a bare array, v2 wraps it in `entries`; the rest use `issues` or `pages`.
    const list = (
        Array.isArray(data) ? data : (obj.entries ?? obj.issues ?? obj.pages ?? [])
    ) as Record<string, unknown>[];
    if (!Array.isArray(list)) return [];
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

/**
 * Reads the raw per-check files of one report folder into a compact index. Meant for
 * `scripts/build-findings.ts` — it parses files of any size, so never call it while serving a
 * request. A check whose file is missing or unreadable is left out of `checks`, so nobody later
 * mistakes its absence for "everything was fixed".
 */
export const buildFindingsIndex = (
    dir: string,
    domain: string,
    reportDate: string
): IFindingsIndex => {
    const groups = new Map<string, { check: string; kind: string; urls: Set<string> }>();
    const checks: string[] = [];
    for (const [check, file] of findingFiles(dir)) {
        let data: unknown;
        try {
            data = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            continue; // half-written or corrupt: the check counts as not read
        }
        checks.push(check);
        for (const { url, kind } of entriesOf(check, data)) {
            const key = `${check}:${kind}`;
            if (!groups.has(key)) groups.set(key, { check, kind, urls: new Set() });
            groups.get(key)?.urls.add(url);
        }
    }
    return {
        schema_version: FINDINGS_SCHEMA_VERSION,
        domain,
        reportDate,
        generatedAt: new Date().toISOString(),
        checks: checks.sort(),
        groups: [...groups.values()]
            .map(g => ({ check: g.check, kind: g.kind, urls: [...g.urls].sort() }))
            .sort((a, b) => `${a.check}:${a.kind}`.localeCompare(`${b.check}:${b.kind}`)),
    };
};

/** Writes the index atomically (temp file + rename): its presence marks the folder complete. */
export const writeFindingsIndex = (dir: string, index: IFindingsIndex): void => {
    const target = path.join(dir, FINDINGS_FILE);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(index));
    fs.renameSync(tmp, target);
};

// Report folders never change once their index exists, so an index is parsed once per mtime.
const indexCache = new Map<string, { mtimeMs: number; index: IFindingsIndex }>();

const readIndex = (dir: string): IFindingsIndex | null => {
    const file = path.join(dir, FINDINGS_FILE);
    let mtimeMs: number;
    try {
        mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
        return null;
    }
    const cached = indexCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.index;
    try {
        const index = JSON.parse(fs.readFileSync(file, 'utf8')) as IFindingsIndex;
        if (index.schema_version !== FINDINGS_SCHEMA_VERSION || !Array.isArray(index.groups)) {
            return null;
        }
        indexCache.set(file, { mtimeMs, index });
        return index;
    } catch {
        return null;
    }
};

/** Report folders for a domain with a complete findings index, newest first. */
export const findingDates = (reportsRoot: string, domain: string): string[] => {
    const dir = path.join(reportsRoot, domain);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .map(name => ({ name, ts: parseDateFolder(name) }))
        .filter((d): d is { name: string; ts: number } => d.ts !== null)
        .filter(d => fs.existsSync(path.join(dir, d.name, FINDINGS_FILE)))
        .sort((a, b) => b.ts - a.ts)
        .map(d => d.name);
};

const capped = (urls: string[]): string[] => urls.slice(0, MAX_URLS_PER_GROUP);

/**
 * Findings for `domain` from the newest complete report folder (or `date`), diffed against the
 * next older complete one. Only checks both reports could read are diffed: a check missing from
 * either side never yields "resolved". Returns null when the domain has no complete report.
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
    const current = readIndex(path.join(reportsRoot, domain, reportDate));
    if (!current) return null;
    const previousReportDate = dates[idx + 1] ?? null;
    const previous = previousReportDate
        ? readIndex(path.join(reportsRoot, domain, previousReportDate))
        : null;

    const prevChecks = new Set(previous?.checks ?? []);
    const prevGroups = new Map(
        (previous?.groups ?? []).map(g => [`${g.check}:${g.kind}`, new Set(g.urls)])
    );
    const currentKeys = new Set(current.groups.map(g => `${g.check}:${g.kind}`));

    const totals: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const groups: IFindingGroup[] = current.groups.map(g => {
        const key = `${g.check}:${g.kind}`;
        const severity = severityOf(g.check, g.kind);
        const comparable = previous !== null && prevChecks.has(g.check);
        const before = prevGroups.get(key) ?? new Set<string>();
        const now = new Set(g.urls);
        totals[severity] += g.urls.length;
        return {
            fingerprint: `seo:${domain}:${key}`,
            check: g.check,
            kind: g.kind,
            severity,
            count: g.urls.length,
            urls: capped(g.urls),
            // Without a comparable previous report everything counts as new.
            newUrls: capped(comparable ? g.urls.filter(u => !before.has(u)) : g.urls),
            resolvedUrls: comparable ? capped([...before].filter(u => !now.has(u)).sort()) : [],
            urlsTruncated: g.urls.length > MAX_URLS_PER_GROUP,
            previousCheckMissing: previous !== null && !comparable,
        };
    });
    groups.sort(
        (a, b) =>
            SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
            b.count - a.count ||
            a.fingerprint.localeCompare(b.fingerprint)
    );

    const currentChecks = new Set(current.checks);
    const resolvedGroups = (previous?.groups ?? [])
        .filter(g => currentChecks.has(g.check) && !currentKeys.has(`${g.check}:${g.kind}`))
        .map(g => ({
            fingerprint: `seo:${domain}:${g.check}:${g.kind}`,
            check: g.check,
            kind: g.kind,
            severity: severityOf(g.check, g.kind),
        }));

    return {
        domain,
        reportDate,
        previousReportDate,
        checksPresent: [...current.checks],
        checksMissing: ALL_CHECKS.filter(c => !currentChecks.has(c)),
        totals,
        groups,
        resolvedGroups,
    };
};
