// Node.js 18+ global fetch
declare const fetch: typeof globalThis.fetch;

export interface ISitemapValidationIssue {
    sitemapUrl: string;
    message: string;
}

export interface ISitemapValidationResult {
    sitemapUrl: string;
    reachable: boolean;
    statusCode: number | null;
    wellFormed: boolean;
    urlCount: number;
    invalidLastmodCount: number;
    futureLastmodCount: number;
    issues: ISitemapValidationIssue[];
}

/**
 * Validates a single sitemap XML document (not a sitemap index): fetches it, checks basic
 * well-formedness (balanced <urlset>/</urlset>, since fetchSitemapUrls() only uses regex
 * extraction and would otherwise silently return zero/partial results on malformed XML), and
 * sanity-checks any <lastmod> values found (parseable, not in the future).
 */
export const validateSitemap = async (sitemapUrl: string): Promise<ISitemapValidationResult> => {
    const issues: ISitemapValidationIssue[] = [];
    const result: ISitemapValidationResult = {
        sitemapUrl,
        reachable: false,
        statusCode: null,
        wellFormed: false,
        urlCount: 0,
        invalidLastmodCount: 0,
        futureLastmodCount: 0,
        issues,
    };

    let xml: string;
    try {
        const response = await fetch(sitemapUrl, {
            signal: AbortSignal.timeout(10000),
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (compatible; SEO-Crawler/1.0; +https://crawler.example.com)',
                Accept: 'application/xml,text/xml,*/*',
            },
        });
        result.statusCode = response.status;
        result.reachable = response.ok;
        if (!response.ok) {
            issues.push({ sitemapUrl, message: `Sitemap returned HTTP ${response.status}` });
            return result;
        }
        xml = await response.text();
    } catch (error) {
        issues.push({
            sitemapUrl,
            message: `Failed to fetch sitemap: ${error instanceof Error ? error.message : String(error)}`,
        });
        return result;
    }

    const isIndex = xml.includes('<sitemapindex');
    const rootTag = isIndex ? 'sitemapindex' : 'urlset';
    const opens = (xml.match(new RegExp(`<${rootTag}[\\s>]`, 'g')) ?? []).length;
    const closes = (xml.match(new RegExp(`</${rootTag}>`, 'g')) ?? []).length;
    result.wellFormed = opens > 0 && opens === closes;
    if (!result.wellFormed) {
        issues.push({ sitemapUrl, message: `Malformed XML: unbalanced <${rootTag}> tags` });
    }

    const urlMatches = xml.match(/<url>[\s\S]*?<\/url>/g) ?? [];
    result.urlCount = urlMatches.length;

    const now = Date.now();
    for (const entry of urlMatches) {
        const lastmodMatch = entry.match(/<lastmod>(.*?)<\/lastmod>/);
        if (!lastmodMatch) continue;
        const raw = lastmodMatch[1].trim();
        const parsed = Date.parse(raw);
        if (Number.isNaN(parsed)) {
            result.invalidLastmodCount++;
        } else if (parsed > now) {
            result.futureLastmodCount++;
        }
    }
    if (result.invalidLastmodCount > 0) {
        issues.push({
            sitemapUrl,
            message: `${result.invalidLastmodCount} <lastmod> value(s) are not parseable dates`,
        });
    }
    if (result.futureLastmodCount > 0) {
        issues.push({
            sitemapUrl,
            message: `${result.futureLastmodCount} <lastmod> value(s) are in the future`,
        });
    }

    return result;
};

export const generateSitemapXml = (urls: string[]): string => {
    const now = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    const urlEntries = urls
        .map(url => {
            return `  <url>
    <loc>${url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
        })
        .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
};

export const generateSitemapFromInternalLinks = (
    allInternalLinks: string[],
    baseUrl: string
): string[] => {
    const uniqueUrls = new Set<string>();

    // Add the base URL
    uniqueUrls.add(baseUrl);

    // Add all unique internal links
    allInternalLinks.forEach(link => {
        try {
            const url = new URL(link, baseUrl);
            if (url.hostname === new URL(baseUrl).hostname) {
                uniqueUrls.add(url.toString());
            }
        } catch {
            // Skip invalid URLs
        }
    });

    return Array.from(uniqueUrls);
};

export const fetchSitemapUrls = async (baseUrl: string): Promise<string[]> => {
    const allUrls: string[] = [];
    const processedSitemaps = new Set<string>();

    const processSitemap = async (sitemapUrl: string): Promise<void> => {
        if (processedSitemaps.has(sitemapUrl)) return;
        processedSitemaps.add(sitemapUrl);

        try {
            console.log(`Fetching sitemap: ${sitemapUrl}`);
            const response = await fetch(sitemapUrl, {
                signal: AbortSignal.timeout(10000), // 10 second timeout
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (compatible; SEO-Crawler/1.0; +https://crawler.example.com)',
                    Accept: 'application/xml,text/xml,*/*',
                },
            });

            if (!response.ok) {
                console.log(`Could not fetch sitemap: ${sitemapUrl}`);
                return;
            }

            const xml = await response.text();

            // Check if this is a sitemap index (contains other sitemaps)
            if (xml.includes('<sitemapindex') || xml.includes('<sitemap>')) {
                const sitemapMatches = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g);
                if (sitemapMatches) {
                    console.log(`Found sitemap index with ${sitemapMatches.length} child sitemaps`);
                    for (const sitemapEntry of sitemapMatches) {
                        const locMatch = sitemapEntry.match(/<loc>(.*?)<\/loc>/);
                        if (locMatch) {
                            const childSitemapUrl = locMatch[1].trim();
                            await processSitemap(childSitemapUrl);
                        }
                    }
                    return;
                }
            }

            // Process regular sitemap (extract URLs)
            const urlMatches = xml.match(/<url>[\s\S]*?<\/url>/g);
            if (urlMatches) {
                const urls = urlMatches
                    .map(urlEntry => {
                        const locMatch = urlEntry.match(/<loc>(.*?)<\/loc>/);
                        return locMatch ? locMatch[1].trim() : null;
                    })
                    .filter(Boolean) as string[];

                allUrls.push(...urls);
                console.log(`Extracted ${urls.length} URLs from ${sitemapUrl}`);
            }
        } catch (error) {
            console.log(`Error processing sitemap ${sitemapUrl}:`, error);
        }
    };

    try {
        const mainSitemapUrl = new URL('/sitemap.xml', baseUrl).toString();
        await processSitemap(mainSitemapUrl);

        console.log(`Total URLs found across all sitemaps: ${allUrls.length}`);
        return allUrls;
    } catch (error) {
        console.log('Error fetching sitemaps:', error);
        return [];
    }
};

/**
 * Pure helper: given the URL list already extracted from each individual (leaf) sitemap,
 * inverts them into a url -> [sitemapUrl, ...] map so callers can spot URLs listed in more than
 * one distinct sitemap file. Takes plain data (no fetch) so it's unit-testable without mocking
 * the network. Each sitemap's own URL list is deduplicated first — a URL repeated multiple times
 * within a single sitemap file is a different issue (a malformed/duplicated sitemap entry) and
 * must not be reported here as "listed in multiple sitemaps".
 */
export const invertSitemapUrlLists = (
    sitemapUrlLists: { sitemapUrl: string; urls: string[] }[]
): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const { sitemapUrl, urls } of sitemapUrlLists) {
        for (const url of new Set(urls)) {
            const list = map.get(url) ?? [];
            list.push(sitemapUrl);
            map.set(url, list);
        }
    }
    return map;
};

/**
 * Fetches every sitemap reachable from baseUrl's sitemap index (or a single sitemap if there's
 * no index) and maps each URL to the list of sitemaps it appears in — used to detect URLs
 * duplicated across multiple sitemaps.
 */
export const mapUrlsAcrossSitemaps = async (baseUrl: string): Promise<Map<string, string[]>> => {
    const perSitemapUrls: { sitemapUrl: string; urls: string[] }[] = [];
    const processedSitemaps = new Set<string>();

    const processSitemap = async (sitemapUrl: string): Promise<void> => {
        if (processedSitemaps.has(sitemapUrl)) return;
        processedSitemaps.add(sitemapUrl);

        try {
            const response = await fetch(sitemapUrl, {
                signal: AbortSignal.timeout(10000),
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (compatible; SEO-Crawler/1.0; +https://crawler.example.com)',
                    Accept: 'application/xml,text/xml,*/*',
                },
            });
            if (!response.ok) return;

            const xml = await response.text();

            if (xml.includes('<sitemapindex') || xml.includes('<sitemap>')) {
                const sitemapMatches = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/g);
                if (sitemapMatches) {
                    for (const sitemapEntry of sitemapMatches) {
                        const locMatch = sitemapEntry.match(/<loc>(.*?)<\/loc>/);
                        if (locMatch) {
                            await processSitemap(locMatch[1].trim());
                        }
                    }
                    return;
                }
            }

            const urlMatches = xml.match(/<url>[\s\S]*?<\/url>/g);
            if (urlMatches) {
                const urls = urlMatches
                    .map(urlEntry => {
                        const locMatch = urlEntry.match(/<loc>(.*?)<\/loc>/);
                        return locMatch ? locMatch[1].trim() : null;
                    })
                    .filter(Boolean) as string[];
                perSitemapUrls.push({ sitemapUrl, urls });
            }
        } catch (error) {
            console.log(`Error processing sitemap ${sitemapUrl}:`, error);
        }
    };

    try {
        const mainSitemapUrl = new URL('/sitemap.xml', baseUrl).toString();
        await processSitemap(mainSitemapUrl);
    } catch (error) {
        console.log('Error fetching sitemaps:', error);
    }

    return invertSitemapUrlLists(perSitemapUrls);
};

export const fetchHtmlSitemapUrls = async (
    htmlSitemapUrl: string,
    baseDomain: string
): Promise<string[]> => {
    console.log(`🗺️  Fetching HTML sitemap: ${htmlSitemapUrl}`);

    try {
        const response = await fetch(htmlSitemapUrl, {
            signal: AbortSignal.timeout(15000),
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (compatible; SEO-Crawler/1.0; +https://crawler.example.com)',
                Accept: 'text/html,application/xhtml+xml,*/*',
            },
        });

        if (!response.ok) {
            console.log(`❌ Could not fetch HTML sitemap: ${htmlSitemapUrl} (${response.status})`);
            return [];
        }

        const html = await response.text();

        // Extract all href links from the HTML
        const hrefRegex = /href=["']([^"']+)["']/gi;
        const discovered = new Set<string>();
        let match: RegExpExecArray | null;

        while ((match = hrefRegex.exec(html)) !== null) {
            const raw = match[1].trim();
            if (
                !raw ||
                raw.startsWith('#') ||
                raw.startsWith('mailto:') ||
                raw.startsWith('javascript:')
            ) {
                continue;
            }

            try {
                // Resolve relative URLs against the sitemap URL
                const resolved = new URL(raw, htmlSitemapUrl).toString();
                const resolvedHostname = new URL(resolved).hostname;

                // Only include URLs that belong to the target domain
                if (
                    resolvedHostname === baseDomain ||
                    resolvedHostname.endsWith(`.${baseDomain}`)
                ) {
                    // Skip the sitemap page itself and common non-content URLs
                    if (
                        resolved !== htmlSitemapUrl &&
                        !resolved.includes('sitemap') &&
                        !resolved.includes('mailto:')
                    ) {
                        discovered.add(resolved);
                    }
                }
            } catch {
                // Skip invalid URLs
            }
        }

        const urls = Array.from(discovered);
        console.log(`✅ HTML sitemap: discovered ${urls.length} URLs from ${htmlSitemapUrl}`);
        return urls;
    } catch (error) {
        console.log(`❌ Error fetching HTML sitemap ${htmlSitemapUrl}:`, error);
        return [];
    }
};
