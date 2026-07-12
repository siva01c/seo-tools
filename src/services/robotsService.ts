// Node.js 18+ global fetch
declare const fetch: typeof globalThis.fetch;

export interface IRobotsRules {
    disallow: string[];
    allow: string[];
    sitemaps: string[];
}

const EMPTY_RULES: IRobotsRules = { disallow: [], allow: [], sitemaps: [] };

/**
 * Fetches and parses /robots.txt for the given base URL, extracting the rules
 * that apply to our crawler. We match `User-agent: *` and any group naming
 * our own UA token, unioning their Disallow/Allow rules (most permissive
 * common interpretation when multiple matching groups exist).
 */
export const fetchRobotsRules = async (
    baseUrl: string,
    userAgentToken = 'SEO-Crawler'
): Promise<IRobotsRules> => {
    let robotsUrl: string;
    try {
        robotsUrl = new URL('/robots.txt', baseUrl).toString();
    } catch {
        return EMPTY_RULES;
    }

    try {
        console.log(`🤖 Fetching robots.txt: ${robotsUrl}`);
        const response = await fetch(robotsUrl, {
            signal: AbortSignal.timeout(10000),
            headers: {
                'User-Agent': `Mozilla/5.0 (compatible; ${userAgentToken}/1.0; +https://crawler.example.com)`,
                Accept: 'text/plain,*/*',
            },
        });

        if (!response.ok) {
            console.log(`🤖 No robots.txt found (${response.status}) — treating as unrestricted`);
            return EMPTY_RULES;
        }

        const body = await response.text();
        return parseRobotsTxt(body, userAgentToken);
    } catch (error) {
        console.log(`🤖 Error fetching robots.txt for ${baseUrl}:`, error);
        return EMPTY_RULES;
    }
};

/**
 * Parses robots.txt content, returning the union of rules from the
 * `User-agent: *` group and any group matching userAgentToken (case-insensitive).
 */
export const parseRobotsTxt = (content: string, userAgentToken = 'SEO-Crawler'): IRobotsRules => {
    const rules: IRobotsRules = { disallow: [], allow: [], sitemaps: [] };
    const lines = content.split(/\r?\n/);

    let currentAgents: string[] = [];
    let groupApplies = false;

    const targetToken = userAgentToken.toLowerCase();

    for (const rawLine of lines) {
        const line = rawLine.split('#')[0].trim();
        if (!line) continue;

        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) continue;

        const field = line.slice(0, separatorIndex).trim().toLowerCase();
        const value = line.slice(separatorIndex + 1).trim();

        if (field === 'user-agent') {
            // A new User-agent line after we've already seen directives starts a new group
            if (currentAgents.length === 0 || groupApplies === undefined) {
                currentAgents = [value.toLowerCase()];
            } else {
                currentAgents.push(value.toLowerCase());
            }
            groupApplies = currentAgents.some(
                agent => agent === '*' || agent === targetToken || targetToken.includes(agent)
            );
            continue;
        }

        if (field === 'sitemap') {
            if (value) rules.sitemaps.push(value);
            continue;
        }

        if (!groupApplies) continue;

        if (field === 'disallow') {
            if (value) rules.disallow.push(value);
        } else if (field === 'allow') {
            if (value) rules.allow.push(value);
        } else {
            // New directive type (e.g. crawl-delay) ends implicit adjacency but doesn't
            // affect group membership — ignored, not tracked for our purposes.
        }
    }

    return rules;
};

/**
 * Checks whether a URL's path is allowed under the given robots rules, using
 * the standard longest-match-wins precedence (an Allow rule that is a longer,
 * more specific match than a Disallow rule wins, and vice versa).
 */
export const isAllowedByRobots = (url: string, rules: IRobotsRules): boolean => {
    if (rules.disallow.length === 0) return true;

    let pathAndQuery: string;
    try {
        const parsed = new URL(url);
        pathAndQuery = parsed.pathname + parsed.search;
    } catch {
        return true;
    }

    let bestMatchLength = -1;
    let bestMatchAllowed = true;

    const consider = (pattern: string, allowed: boolean) => {
        if (!pattern) return;
        if (pathAndQuery.startsWith(pattern) && pattern.length > bestMatchLength) {
            bestMatchLength = pattern.length;
            bestMatchAllowed = allowed;
        }
    };

    for (const pattern of rules.disallow) consider(pattern, false);
    for (const pattern of rules.allow) consider(pattern, true);

    return bestMatchAllowed;
};
