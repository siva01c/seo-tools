#!/usr/bin/env tsx
/**
 * check-broken-links.ts
 *
 * Import-validation broken-link checker.
 *
 * Unlike report-404s.ts (which only surfaces status===404 among pages the
 * crawler actually visited), this script reads the crawled inventory and then
 * ACTIVELY PROBES every referenced URL:
 *   - internal links  (links.internal[].href)
 *   - external links  (links.external[].href)
 *   - images          (images[].src, images[].srcset, images[].sources[].srcset)
 *
 * Each unique target is fetched (HEAD, falling back to GET) and any 4xx/5xx or
 * network failure is reported, grouped by the page(s) that reference it.
 *
 * Usage:
 *   npx tsx scripts/check-broken-links.ts --domain example.com
 *   [--concurrency 10] [--timeout 20000] [--skip-external] [--output <file.json>]
 *   [--status 403]
 *
 * --status <code> narrows the report to targets returning exactly that HTTP status
 * (e.g. 403). It also folds in any crawled page whose own response status equals the
 * code but which no page links to (so it was never probed). Output is named
 * "<code>-report-<date>.json/.csv". Without --status, all 4xx/5xx + network errors are
 * reported as before.
 */

import {
    createReadStream,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

type Link = { href?: string; text?: string };
type ImgSource = { srcset?: string };
type Image = { src?: string; srcset?: string; sources?: ImgSource[]; alt?: string };
type Page = {
    url: string;
    title?: string;
    response?: { status?: number };
    links?: { internal?: Link[]; external?: Link[] };
    images?: Image[];
    _metadata?: { crawlDate?: string };
};

type RefKind = 'internal-link' | 'external-link' | 'image';
type Referrer = { pageUrl: string; pageTitle?: string; text?: string; kind: RefKind };
type Target = { url: string; kinds: Set<RefKind>; referrers: Referrer[] };
type ProbeResult = {
    url: string;
    status: number | null; // null = network-level failure
    statusText?: string;
    method: string;
    error?: string;
    redirectedTo?: string;
    reverified?: boolean;
    kinds: RefKind[];
    referrers: Referrer[];
};

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
    const i = args.findIndex(a => a === `--${name}`);
    if (i >= 0) return args[i + 1];
    const pref = `--${name}=`;
    const direct = args.find(a => a.startsWith(pref));
    return direct ? direct.slice(pref.length) : undefined;
};
const hasFlag = (name: string): boolean => args.some(a => a === `--${name}`);

const domainArg = getArg('domain');
const concurrency = Math.max(1, parseInt(getArg('concurrency') ?? '10', 10));
const timeoutMs = Math.max(1000, parseInt(getArg('timeout') ?? '20000', 10));
const skipExternal = hasFlag('skip-external');
const outputArg = getArg('output');
// Optional: report only targets returning this exact HTTP status (e.g. 403).
// When unset, behaviour is unchanged (all 4xx/5xx + network errors are reported).
const statusArg = getArg('status');
const onlyStatus = statusArg !== undefined ? parseInt(statusArg, 10) : null;
// Optional: read this exact JSONL instead of resolving one (use for large per-date
// files the merge step can't concatenate, or to pick a specific crawl date).
const fileArg = getArg('file');

const storageRoot = './storage/datasets';
const reportsRoot = './storage/reports';

if (!existsSync(storageRoot)) {
    console.error(`Storage root not found: ${storageRoot}`);
    process.exit(1);
}

const toDomainFile = (domain: string): string =>
    join(storageRoot, domain, `${domain.replace(/\./g, '_')}.jsonl`);

const ddmmyyyyToSortKey = (date: string): string => {
    const [dd, mm, yyyy] = date.split('-');
    return `${yyyy}-${mm}-${dd}`;
};

const getLatestDatasetDate = (domain: string): string => {
    const domainPath = join(storageRoot, domain);
    const folders = readdirSync(domainPath)
        .filter(n => /^\d{2}-\d{2}-\d{4}$/.test(n))
        .sort((a, b) => ddmmyyyyToSortKey(a).localeCompare(ddmmyyyyToSortKey(b)));
    return folders.at(-1) ?? new Date().toISOString().slice(0, 10);
};

// Resolve a per-domain JSONL: prefer merged file, fall back to latest date's crawl-data.jsonl
const resolveJsonl = (domain: string): string | undefined => {
    const merged = toDomainFile(domain);
    if (existsSync(merged)) return merged;
    const domainPath = join(storageRoot, domain);
    if (!existsSync(domainPath)) return undefined;
    const latest = getLatestDatasetDate(domain);
    const perDate = join(domainPath, latest, 'crawl-data.jsonl');
    return existsSync(perDate) ? perDate : undefined;
};

const domainsToProcess = (() => {
    if (domainArg) return [domainArg];
    return readdirSync(storageRoot).filter(d => resolveJsonl(d));
})();

// --- URL helpers ---------------------------------------------------------
const normalize = (raw: string, base: string): string | null => {
    try {
        const u = new URL(raw, base);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        u.hash = '';
        return u.toString();
    } catch {
        return null;
    }
};

// Extract the first (usually largest/last is fine — we just need a real URL) candidates from a srcset
const srcsetUrls = (srcset: string | undefined, base: string): string[] => {
    if (!srcset) return [];
    return srcset
        .split(',')
        .map(part => part.trim().split(/\s+/)[0])
        .filter(Boolean)
        .map(u => normalize(u, base))
        .filter((u): u is string => !!u);
};

const isInternal = (target: string, pageHost: string): boolean => {
    try {
        const norm = (h: string): string => h.replace(/^www\./, '');
        return norm(new URL(target).hostname) === norm(pageHost);
    } catch {
        return false;
    }
};

// --- Probe ---------------------------------------------------------------
const probe = async (
    url: string
): Promise<{
    status: number | null;
    statusText?: string;
    method: string;
    error?: string;
    redirectedTo?: string;
}> => {
    const attempt = async (
        method: 'HEAD' | 'GET'
    ): Promise<{
        status: number | null;
        statusText?: string;
        method: string;
        error?: string;
        redirectedTo?: string;
    }> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, {
                method,
                redirect: 'follow',
                signal: controller.signal,
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 (broken-link-validator)',
                    Accept: '*/*',
                },
            });
            return {
                status: res.status,
                statusText: res.statusText,
                method,
                redirectedTo: res.redirected ? res.url : undefined,
            };
        } catch (e) {
            return { status: null, method, error: e instanceof Error ? e.message : String(e) };
        } finally {
            clearTimeout(timer);
        }
    };

    const r = await attempt('HEAD');
    // Many servers mishandle HEAD (405/501) or return network error; retry with GET.
    if (r.status === null || r.status === 405 || r.status === 501 || r.status === 403) {
        const g = await attempt('GET');
        // Prefer GET result unless it's strictly worse and HEAD had a real status
        if (g.status !== null) return g;
        if (r.status !== null) return r;
        return g;
    }
    return r;
};

const runPool = async <T, R>(
    items: T[],
    limit: number,
    fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> => {
    const results: R[] = new Array(items.length);
    let next = 0;
    let done = 0;
    const total = items.length;
    const workers = Array.from({ length: Math.min(limit, total) }, async () => {
        while (true) {
            const i = next++;
            if (i >= total) break;
            results[i] = await fn(items[i], i);
            done++;
            if (done % 25 === 0 || done === total) {
                process.stdout.write(`\r   probed ${done}/${total}   `);
            }
        }
    });
    await Promise.all(workers);
    process.stdout.write('\n');
    return results;
};

const ensureDir = (dir: string): void => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

// --- Main ----------------------------------------------------------------
const run = async (): Promise<void> => {
    for (const domain of domainsToProcess) {
        const file = fileArg ?? resolveJsonl(domain);
        if (!file || !existsSync(file)) {
            console.warn(`Skipping ${domain}: no JSONL found${file ? ` at ${file}` : ''}`);
            continue;
        }
        console.log(`\n🔍 ${domain}\n   source: ${file}`);

        // Build target map: normalized URL -> {kinds, referrers}
        const targets = new Map<string, Target>();
        const add = (
            rawUrl: string,
            base: string,
            kind: RefKind,
            ref: Omit<Referrer, 'kind'>
        ): void => {
            const norm = normalize(rawUrl, base);
            if (!norm) return;
            const t = targets.get(norm) ?? { url: norm, kinds: new Set<RefKind>(), referrers: [] };
            t.kinds.add(kind);
            t.referrers.push({ ...ref, kind });
            targets.set(norm, t);
        };

        // Stream the JSONL line-by-line. A full crawl with HTML content can exceed
        // Node's max string length (~512MB), so readFileSync-as-string is not safe;
        // we parse one record at a time and retain only links/images (not htmlContent).
        let pagesCount = 0;
        let firstUrl: string | undefined;
        const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.trim()) continue;
            let page: Page;
            try {
                page = JSON.parse(line);
            } catch {
                continue;
            }
            pagesCount++;
            firstUrl ??= page.url;
            const base = page.url;
            for (const l of page.links?.internal ?? []) {
                if (l.href)
                    add(l.href, base, 'internal-link', {
                        pageUrl: page.url,
                        pageTitle: page.title,
                        text: l.text,
                    });
            }
            if (!skipExternal) {
                for (const l of page.links?.external ?? []) {
                    if (l.href)
                        add(l.href, base, 'external-link', {
                            pageUrl: page.url,
                            pageTitle: page.title,
                            text: l.text,
                        });
                }
            }
            for (const img of page.images ?? []) {
                if (img.src)
                    add(img.src, base, 'image', {
                        pageUrl: page.url,
                        pageTitle: page.title,
                        text: img.alt,
                    });
                for (const u of srcsetUrls(img.srcset, base))
                    add(u, base, 'image', {
                        pageUrl: page.url,
                        pageTitle: page.title,
                        text: img.alt,
                    });
                for (const s of img.sources ?? [])
                    for (const u of srcsetUrls(s.srcset, base))
                        add(u, base, 'image', {
                            pageUrl: page.url,
                            pageTitle: page.title,
                            text: img.alt,
                        });
            }
        }

        console.log(`   pages crawled: ${pagesCount}`);

        const allTargets = [...targets.values()];
        // Internal/external is judged against the crawled domain, NOT the first record's
        // url: some sites (e.g. a staging mirror) emit production canonical URLs in
        // page.url, which would otherwise misclassify the real internal host as external.
        const pageHost = (() => {
            try {
                return new URL(/^https?:\/\//.test(domain) ? domain : `https://${domain}`).hostname;
            } catch {
                return firstUrl ? new URL(firstUrl).hostname : domain;
            }
        })();

        const internalCount = allTargets.filter(t => isInternal(t.url, pageHost)).length;
        console.log(
            `   unique targets: ${allTargets.length} (internal ${internalCount}, external ${allTargets.length - internalCount}) | concurrency ${concurrency}`
        );

        const probed = await runPool(allTargets, concurrency, async t => {
            const r = await probe(t.url);
            const result: ProbeResult = {
                url: t.url,
                status: r.status,
                statusText: r.statusText,
                method: r.method,
                error: r.error,
                redirectedTo: r.redirectedTo,
                kinds: [...t.kinds],
                referrers: t.referrers,
            };
            return result;
        });

        // Auto re-verify network-level failures sequentially. Servers that drop
        // connections under concurrency (e.g. this site's :18443 endpoint) produce
        // false "fetch failed" results; a calm sequential retry corrects them.
        const netFails = probed.filter(p => p.status === null);
        if (netFails.length) {
            console.log(
                `   re-verifying ${netFails.length} network-error target(s) sequentially...`
            );
            let recovered = 0;
            for (const p of netFails) {
                const r = await probe(p.url);
                if (r.status !== null) {
                    p.status = r.status;
                    p.statusText = r.statusText;
                    p.method = `${r.method}(reverify)`;
                    p.error = undefined;
                    p.reverified = true;
                    if (r.status < 400) recovered++;
                }
            }
            console.log(
                `   re-verify: ${recovered} recovered to <400, ${netFails.length - recovered} still failing`
            );
        }

        const isBroken = (p: ProbeResult): boolean => p.status === null || p.status >= 400;
        const matches =
            onlyStatus !== null ? (p: ProbeResult): boolean => p.status === onlyStatus : isBroken;
        const broken = probed.filter(matches);

        // In --status mode, also fold in pages the crawler itself hit with this status.
        // These FAILED requests never become dataset records (no links/images to probe),
        // so they live only in the url-index, with an `error` like
        // "... received <code> status code". Guarantees "all files returning <code>" is
        // complete even for pages no other page links to.
        if (onlyStatus !== null) {
            const reportedUrls = new Set(broken.map(b => b.url));
            const idxPath = join(
                './storage/key_value_stores',
                domain,
                getLatestDatasetDate(domain),
                'url-index.json'
            );
            if (existsSync(idxPath)) {
                let foldedIn = 0;
                try {
                    const idx = JSON.parse(readFileSync(idxPath, 'utf8')) as {
                        urls?: Record<string, { url?: string; status?: string; error?: string }>;
                    };
                    for (const info of Object.values(idx.urls ?? {})) {
                        const code = info.error?.match(/received (\d+) status code/)?.[1];
                        if (!code || parseInt(code, 10) !== onlyStatus) continue;
                        const norm = normalize(info.url ?? '', `https://${domain}`);
                        if (!norm || reportedUrls.has(norm)) continue;
                        if (skipExternal && !isInternal(norm, pageHost)) continue;
                        reportedUrls.add(norm);
                        broken.push({
                            url: norm,
                            status: onlyStatus,
                            method: 'crawl-record',
                            kinds: ['internal-link'],
                            referrers: [
                                {
                                    pageUrl: norm,
                                    text: '(crawled directly)',
                                    kind: 'internal-link',
                                },
                            ],
                        });
                        foldedIn++;
                    }
                } catch {
                    /* ignore malformed index */
                }
                if (foldedIn)
                    console.log(
                        `   folded in ${foldedIn} page(s) the crawler hit with ${onlyStatus} (from url-index)`
                    );
            }
        }

        broken.sort((a, b) => (b.status ?? 999) - (a.status ?? 999) || a.url.localeCompare(b.url));

        // status distribution
        const dist = new Map<string, number>();
        for (const p of probed) {
            const key =
                p.status === null
                    ? `ERR:${(p.error ?? 'unknown').split(':')[0]}`
                    : String(p.status);
            dist.set(key, (dist.get(key) ?? 0) + 1);
        }

        const brokenInternalLinks = broken.filter(
            b => b.kinds.includes('internal-link') && isInternal(b.url, pageHost)
        );
        const brokenImages = broken.filter(b => b.kinds.includes('image'));
        const brokenExternal = broken.filter(
            b => !isInternal(b.url, pageHost) && !b.kinds.includes('image')
        );

        // --- Report ---
        console.log(`\n   ── status distribution ──`);
        [...dist.entries()].sort().forEach(([k, v]) => console.log(`     ${k.padEnd(12)} ${v}`));

        const reportLabel = onlyStatus !== null ? `HTTP ${onlyStatus}` : 'BROKEN';
        console.log(`\n   ── ${reportLabel} (${broken.length}) ──`);
        console.log(`     internal links : ${brokenInternalLinks.length}`);
        console.log(`     images         : ${brokenImages.length}`);
        console.log(`     external links : ${brokenExternal.length}`);

        const reportDir = outputArg
            ? undefined
            : join(reportsRoot, domain, getLatestDatasetDate(domain));
        if (reportDir) ensureDir(reportDir);
        const reportBase = onlyStatus !== null ? `${onlyStatus}-report` : 'broken-links';
        const outPath =
            outputArg ?? join(reportDir!, `${reportBase}-${getLatestDatasetDate(domain)}.json`);

        const report = {
            domain,
            generatedFrom: file,
            pagesCrawled: pagesCount,
            uniqueTargets: allTargets.length,
            statusDistribution: Object.fromEntries([...dist.entries()].sort()),
            summary: {
                broken: broken.length,
                brokenInternalLinks: brokenInternalLinks.length,
                brokenImages: brokenImages.length,
                brokenExternalLinks: brokenExternal.length,
            },
            broken: broken.map(b => ({
                target: b.url,
                status: b.status,
                statusText: b.statusText,
                error: b.error,
                method: b.method,
                kinds: b.kinds,
                referrerCount: b.referrers.length,
                referrers: b.referrers,
            })),
        };
        writeFileSync(outPath, JSON.stringify(report, null, 2));

        // CSV
        const csvPath = outPath.replace(/\.json$/, '.csv');
        const rows = [
            ['target', 'status', 'kind', 'method', 'error', 'ref_page', 'link_text'].join(','),
        ];
        const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
        for (const b of broken) {
            for (const r of b.referrers) {
                rows.push(
                    [
                        b.url,
                        b.status ?? 'ERR',
                        r.kind,
                        b.method,
                        b.error ?? '',
                        r.pageUrl,
                        r.text ?? '',
                    ]
                        .map(esc)
                        .join(',')
                );
            }
        }
        writeFileSync(csvPath, rows.join('\n') + '\n');

        console.log(`\n   ✅ JSON: ${outPath}`);
        console.log(`   ✅ CSV : ${csvPath}`);

        // Print broken internal links + images inline (the import-critical ones)
        const critical = [...brokenInternalLinks, ...brokenImages];
        if (critical.length) {
            console.log(`\n   ── import-critical broken references (internal links + images) ──`);
            for (const b of critical) {
                console.log(`     [${b.status ?? b.error}] ${b.kinds.join('/')}  ${b.url}`);
                const sample = b.referrers.slice(0, 3);
                for (const r of sample)
                    console.log(
                        `        ↳ on ${r.pageUrl}${r.text ? `  ("${r.text.slice(0, 60)}")` : ''}`
                    );
                if (b.referrers.length > 3)
                    console.log(`        ↳ … +${b.referrers.length - 3} more page(s)`);
            }
        } else {
            console.log(`\n   ✅ No broken internal links or images detected.`);
        }
    }
};

run().catch(error => {
    console.error(error);
    process.exit(1);
});
