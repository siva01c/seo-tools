export interface ILinkData {
    text: string;
    href: string;
    attributes: Record<string, unknown>;
    rel: string;
    link_title: string;
    isInternal: boolean;
}

export const categorizeLinks = (
    links: Array<{
        text: string;
        href: string;
        attributes?: Record<string, unknown>;
        rel: string;
        link_title: string;
    }>,
    baseDomain: string,
    excludedDomains: string[] = [],
    excludedPaths: string[] = [],
    allowedDomains: string[] = []
): { internal: ILinkData[]; external: ILinkData[] } => {
    const internal: ILinkData[] = [];
    const external: ILinkData[] = [];

    console.log(`🔗 Categorizing ${links.length} links for domain: ${baseDomain}`);
    if (excludedDomains.length > 0) {
        console.log(`🚫 Excluded domains: ${excludedDomains.join(', ')}`);
    }
    if (excludedPaths.length > 0) {
        console.log(`🚫 Excluded paths: ${excludedPaths.join(', ')}`);
    }

    // Log first few links for debugging
    if (links.length > 0) {
        console.log(
            `📋 Sample links found:`,
            links.slice(0, 5).map(l => l.href)
        );
    }

    links.forEach(link => {
        try {
            const url = new URL(link.href);
            // Normalize domains by removing 'www.' prefix for comparison
            const normalizeHostname = (hostname: string): string => hostname.replace(/^www\./, '');
            const normalizedLinkDomain = normalizeHostname(url.hostname);
            const normalizedBaseDomain = normalizeHostname(baseDomain);

            // Check if domain is excluded
            const isDomainExcluded = excludedDomains.some(excludedDomain => {
                const normalizedExcludedDomain = normalizeHostname(excludedDomain);
                return (
                    url.hostname === excludedDomain ||
                    normalizedLinkDomain === normalizedExcludedDomain ||
                    url.hostname.endsWith('.' + excludedDomain) ||
                    excludedDomain.endsWith('.' + url.hostname)
                );
            });

            // Check if path is excluded
            const isPathExcluded = excludedPaths.some(excludedPath => {
                const urlPath = url.pathname;
                // Support exact match and prefix match
                return urlPath === excludedPath || urlPath.startsWith(excludedPath);
            });

            const isExcluded = isDomainExcluded || isPathExcluded;

            // Use allowedDomains if provided, otherwise fall back to baseDomain logic
            const domainsToCheck = allowedDomains.length > 0 ? allowedDomains : [baseDomain];

            const isDomainAllowed = domainsToCheck.some(allowedDomain => {
                const normalizedAllowedDomain = normalizeHostname(allowedDomain);
                return (
                    normalizedLinkDomain === normalizedAllowedDomain ||
                    url.hostname === allowedDomain ||
                    normalizedLinkDomain.endsWith('.' + normalizedAllowedDomain) ||
                    normalizedAllowedDomain.endsWith('.' + normalizedLinkDomain)
                );
            });

            const isInternal = !isExcluded && isDomainAllowed;

            // Debug specific domains
            if (url.hostname.includes(baseDomain)) {
                console.log(`🔍 DEBUG: Checking external link ${link.href}`);
                console.log(
                    `  - Link domain: ${url.hostname} -> normalized: ${normalizedLinkDomain}`
                );
                console.log(
                    `  - Base domain: ${baseDomain} -> normalized: ${normalizedBaseDomain}`
                );
                console.log(`  - Is internal: ${isInternal}`);
            }

            const linkData: ILinkData = {
                text: link.text,
                href: link.href,
                attributes: link.attributes ?? {},
                rel: link.rel,
                link_title: link.link_title,
                isInternal,
            };

            if (isInternal) {
                internal.push(linkData);
            } else {
                external.push(linkData);
                if (isDomainExcluded) {
                    console.log(`🚫 Excluded link found: ${link.href} (domain: ${url.hostname})`);
                } else if (isPathExcluded) {
                    console.log(`🚫 Excluded link found: ${link.href} (path: ${url.pathname})`);
                } else {
                    console.log(`📤 External link found: ${link.href} (domain: ${url.hostname})`);
                }
            }
        } catch {
            // Invalid URL, treat as internal (relative link)
            console.log(`⚠️ Invalid URL treated as internal: ${link.href}`);
            const linkData: ILinkData = {
                text: link.text,
                href: link.href,
                attributes: link.attributes ?? {},
                rel: link.rel,
                link_title: link.link_title,
                isInternal: true,
            };
            internal.push(linkData);
        }
    });

    console.log(
        `📊 Link categorization complete: ${internal.length} internal, ${external.length} external`
    );
    return { internal, external };
};
