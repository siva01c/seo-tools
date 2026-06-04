export interface IGoogleMetaTags {
    // Core SEO meta tags
    title?: string;
    description?: string;
    keywords?: string;

    // Robots directives
    robots?: string;
    googlebot?: string;
    'googlebot-news'?: string;
    'googlebot-image'?: string;
    bingbot?: string;
    slurp?: string;

    // Technical meta tags
    viewport?: string;
    'content-type'?: string;
    charset?: string;
    'format-detection'?: string;

    // Google-specific
    'google-site-verification'?: string;
    'google-signin-client-id'?: string;
    'google-translate-customization'?: string;

    // Social media (Open Graph)
    'og:title'?: string;
    'og:description'?: string;
    'og:image'?: string;
    'og:image:width'?: string;
    'og:image:height'?: string;
    'og:image:alt'?: string;
    'og:url'?: string;
    'og:type'?: string;
    'og:site_name'?: string;
    'og:locale'?: string;
    'og:updated_time'?: string;

    // Facebook specific
    'fb:app_id'?: string;
    'fb:admins'?: string;

    // Twitter Cards
    'twitter:card'?: string;
    'twitter:title'?: string;
    'twitter:description'?: string;
    'twitter:image'?: string;
    'twitter:image:alt'?: string;
    'twitter:site'?: string;
    'twitter:creator'?: string;
    'twitter:player'?: string;
    'twitter:player:width'?: string;
    'twitter:player:height'?: string;

    // Dublin Core
    'dc.title'?: string;
    'dc.description'?: string;
    'dc.creator'?: string;
    'dc.date'?: string;

    // Apple/iOS specific
    'apple-mobile-web-app-capable'?: string;
    'apple-mobile-web-app-status-bar-style'?: string;
    'apple-mobile-web-app-title'?: string;
    'apple-touch-fullscreen'?: string;

    // Microsoft/IE specific
    'msapplication-navbutton-color'?: string;
    'msapplication-tilecolor'?: string;
    'msapplication-tileimage'?: string;
    'msapplication-config'?: string;
    'msapplication-tooltip'?: string;
    'msapplication-starturl'?: string;

    // Mobile optimization
    'mobile-web-app-capable'?: string;
    'theme-color'?: string;

    // Security and privacy
    referrer?: string;
    'dns-prefetch-control'?: string;

    // Other important meta tags
    author?: string;
    generator?: string;
    copyright?: string;
    language?: string;
    revisit?: string;
    rating?: string;
    distribution?: string;
    'reply-to'?: string;
    web_author?: string;
    'original-source'?: string;
    classification?: string;
    subject?: string;
    summary?: string;
    topic?: string;
    abstract?: string;
    owner?: string;
    url?: string;
    'identifier-URL'?: string;
    directory?: string;
    pagename?: string;
    category?: string;
    coverage?: string;

    // HTTP-equiv tags
    'http-equiv'?: {
        refresh?: string;
        'content-security-policy'?: string;
        'x-ua-compatible'?: string;
        'content-language'?: string;
        'content-type'?: string;
        'default-style'?: string;
        'pics-label'?: string;
    };
}

export interface ISpecialLinks {
    canonical?: string;
    alternate?: Array<{
        href: string;
        hreflang?: string;
        media?: string;
        type?: string;
    }>;
    prev?: string;
    next?: string;
    amphtml?: string;
    manifest?: string;
    icon?: string;
    'apple-touch-icon'?: string;
    'apple-touch-icon-precomposed'?: string;
    shortlink?: string;
    publisher?: string;
    author?: string;
    'dns-prefetch'?: string[];
    preconnect?: string[];
    prefetch?: string[];
    preload?: string[];
    prerender?: string[];
    stylesheet?: string[];
    search?: string;
    edit?: string;
    help?: string;
    license?: string;
    bookmark?: string;
    tag?: string[];
    up?: string;
    first?: string;
    last?: string;
    sidebar?: string;
    pingback?: string;
    webmention?: string;
    micropub?: string;
    hub?: string;
    self?: string;
    service?: string;
    profile?: string;
}

export const extractGoogleMetaTags = async (page: any): Promise<IGoogleMetaTags> => {
    const metaTags = await page.$$eval('meta', (metas: HTMLMetaElement[]) => {
        const tags: IGoogleMetaTags = {};
        const httpEquiv: any = {};

        metas.forEach(meta => {
            const name = meta.getAttribute('name')?.toLowerCase();
            const property = meta.getAttribute('property')?.toLowerCase();
            const httpEquivAttr = meta.getAttribute('http-equiv')?.toLowerCase();
            const content = meta.getAttribute('content') ?? '';

            if (name) {
                (tags as any)[name] = content;
            } else if (property) {
                (tags as any)[property] = content;
            } else if (httpEquivAttr) {
                httpEquiv[httpEquivAttr] = content;
            }
        });

        if (Object.keys(httpEquiv).length > 0) {
            tags['http-equiv'] = httpEquiv;
        }

        return tags;
    });

    return metaTags;
};

export const extractSpecialLinks = async (page: any): Promise<ISpecialLinks> => {
    const links = await page.$$eval('link[rel]', (linkElements: HTMLLinkElement[]) => {
        const specialLinks: ISpecialLinks = {};
        const alternates: Array<any> = [];
        const arrayFields = [
            'dns-prefetch',
            'preconnect',
            'prefetch',
            'preload',
            'prerender',
            'stylesheet',
            'tag',
        ];

        linkElements.forEach(link => {
            const rel = link.getAttribute('rel')?.toLowerCase();
            const href = link.getAttribute('href');

            if (!rel || !href) return;

            // Handle array-type relations
            if (arrayFields.includes(rel)) {
                if (!specialLinks[rel as keyof ISpecialLinks]) {
                    (specialLinks as any)[rel] = [];
                }
                (specialLinks as any)[rel].push(href);
                return;
            }

            switch (rel) {
                case 'canonical':
                    specialLinks.canonical = href;
                    break;
                case 'alternate':
                    alternates.push({
                        href,
                        hreflang: link.getAttribute('hreflang'),
                        media: link.getAttribute('media'),
                        type: link.getAttribute('type'),
                    });
                    break;
                case 'prev':
                    specialLinks.prev = href;
                    break;
                case 'next':
                    specialLinks.next = href;
                    break;
                case 'amphtml':
                    specialLinks.amphtml = href;
                    break;
                case 'manifest':
                    specialLinks.manifest = href;
                    break;
                case 'icon':
                    specialLinks.icon = href;
                    break;
                case 'apple-touch-icon':
                    specialLinks['apple-touch-icon'] = href;
                    break;
                case 'apple-touch-icon-precomposed':
                    specialLinks['apple-touch-icon-precomposed'] = href;
                    break;
                case 'shortlink':
                    specialLinks.shortlink = href;
                    break;
                case 'publisher':
                    specialLinks.publisher = href;
                    break;
                case 'author':
                    specialLinks.author = href;
                    break;
                case 'search':
                    specialLinks.search = href;
                    break;
                case 'edit':
                    specialLinks.edit = href;
                    break;
                case 'help':
                    specialLinks.help = href;
                    break;
                case 'license':
                    specialLinks.license = href;
                    break;
                case 'bookmark':
                    specialLinks.bookmark = href;
                    break;
                case 'up':
                    specialLinks.up = href;
                    break;
                case 'first':
                    specialLinks.first = href;
                    break;
                case 'last':
                    specialLinks.last = href;
                    break;
                case 'sidebar':
                    specialLinks.sidebar = href;
                    break;
                case 'pingback':
                    specialLinks.pingback = href;
                    break;
                case 'webmention':
                    specialLinks.webmention = href;
                    break;
                case 'micropub':
                    specialLinks.micropub = href;
                    break;
                case 'hub':
                    specialLinks.hub = href;
                    break;
                case 'self':
                    specialLinks.self = href;
                    break;
                case 'service':
                    specialLinks.service = href;
                    break;
                case 'profile':
                    specialLinks.profile = href;
                    break;
            }
        });

        if (alternates.length > 0) {
            specialLinks.alternate = alternates;
        }

        return specialLinks;
    });

    return links;
};

export const detectDataNoSnippet = async (page: any): Promise<boolean> => {
    const hasDataNoSnippet = await page
        .$eval('body', (body: HTMLElement) => {
            return !!body.querySelector('[data-nosnippet]');
        })
        .catch(() => false);

    return hasDataNoSnippet;
};
