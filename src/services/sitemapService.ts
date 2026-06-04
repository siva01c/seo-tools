// Node.js 18+ global fetch
declare const fetch: typeof globalThis.fetch;

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
