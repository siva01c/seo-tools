export interface IStructuredData {
    jsonLd: any[];
    microdata: IMicrodataItem[];
    rdfa: IRdfaData[];
}

export interface IMicrodataItem {
    type: string[];
    properties: Record<string, any>;
}

export interface IRdfaData {
    type: string;
    properties: Record<string, any>;
}

export interface ICustomMetadata {
    // Content categorization
    department?: string;
    category?: string;
    tags?: string[];
    section?: string;

    // Content attributes
    rating?: number;
    difficulty?: string;
    audience?: string;
    language?: string;

    // DateTime metadata
    datePublished?: string;
    dateModified?: string;
    dateCreated?: string;
    lastReviewed?: string;
    expiryDate?: string;

    // Author and ownership
    author?: string;
    contributor?: string;
    publisher?: string;
    editor?: string;

    // Content metrics
    readingTime?: string;
    wordCount?: number;
    pageViews?: string;

    // AI-specific metadata
    contentType?: string;
    priority?: string;
    boost?: number;

    // Custom fields for AI indexing
    [key: string]: any;
}

export interface IPageMapData {
    attributes: Record<string, string>;
    dataObjects: Array<{
        type: string;
        attributes: Record<string, any>;
    }>;
}

export const extractJsonLdStructuredData = async (page: any): Promise<any[]> => {
    const jsonLdData = await page.$$eval(
        'script[type="application/ld+json"]',
        (scripts: HTMLScriptElement[]) => {
            return scripts
                .map(script => {
                    try {
                        return JSON.parse(script.textContent ?? '');
                    } catch (error) {
                        console.warn('Failed to parse JSON-LD:', error);
                        return null;
                    }
                })
                .filter(Boolean);
        }
    );

    return jsonLdData;
};

export const extractMicrodata = async (page: any): Promise<IMicrodataItem[]> => {
    const microdataItems = await page.$$eval('[itemscope]', (elements: HTMLElement[]) => {
        return elements.map(element => {
            const types = element.getAttribute('itemtype')?.split(' ') ?? [];
            const properties: Record<string, any> = {};

            // Extract itemprops within this scope
            const propElements = element.querySelectorAll('[itemprop]');
            propElements.forEach(propEl => {
                const prop = propEl.getAttribute('itemprop');
                if (!prop) return;

                let value: any;
                const tagName = propEl.tagName.toLowerCase();

                if (tagName === 'meta') {
                    value = (propEl as HTMLMetaElement).content;
                } else if (tagName === 'time') {
                    value = (propEl as HTMLTimeElement).dateTime || propEl.textContent;
                } else if (tagName === 'img') {
                    value = (propEl as HTMLImageElement).src;
                } else if (tagName === 'a') {
                    value = (propEl as HTMLAnchorElement).href;
                } else {
                    value = propEl.textContent?.trim();
                }

                if (properties[prop]) {
                    if (Array.isArray(properties[prop])) {
                        properties[prop].push(value);
                    } else {
                        properties[prop] = [properties[prop], value];
                    }
                } else {
                    properties[prop] = value;
                }
            });

            return {
                type: types,
                properties,
            };
        });
    });

    return microdataItems;
};

export const extractCustomMetadata = async (page: any): Promise<ICustomMetadata> => {
    const customMeta = await page.$$eval('meta', (metas: HTMLMetaElement[]) => {
        const metadata: ICustomMetadata = {};

        // Define custom metadata fields to extract
        const customFields = [
            'department',
            'category',
            'section',
            'tags',
            'rating',
            'difficulty',
            'audience',
            'language',
            'datePublished',
            'dateModified',
            'dateCreated',
            'lastReviewed',
            'expiryDate',
            'author',
            'contributor',
            'publisher',
            'editor',
            'readingTime',
            'wordCount',
            'pageViews',
            'contentType',
            'priority',
            'boost',
        ];

        metas.forEach(meta => {
            const name = meta.getAttribute('name')?.toLowerCase();
            const property = meta.getAttribute('property')?.toLowerCase();
            const content = meta.getAttribute('content');

            if (!content) return;

            const key = name ?? property;
            if (key && customFields.includes(key)) {
                // Handle special cases
                if (key === 'tags' && content.includes(',')) {
                    metadata.tags = content.split(',').map(tag => tag.trim());
                } else if (key === 'rating') {
                    metadata.rating = parseFloat(content) || undefined;
                } else if (key === 'wordCount') {
                    metadata.wordCount = parseInt(content) || undefined;
                } else if (key === 'boost') {
                    metadata.boost = parseFloat(content) || undefined;
                } else {
                    (metadata as any)[key] = content;
                }
            }

            // Also capture any meta tags starting with 'ai-' or 'search-'
            if (key && (key.startsWith('ai-') || key.startsWith('search-'))) {
                (metadata as any)[key] = content;
            }
        });

        return metadata;
    });

    return customMeta;
};

export const extractPageMapData = async (page: any): Promise<IPageMapData> => {
    const pageMapData = await page.$$eval('meta[name^="pagemap-"]', (metas: HTMLMetaElement[]) => {
        const attributes: Record<string, string> = {};
        const dataObjects: Array<any> = [];

        metas.forEach(meta => {
            const name = meta.getAttribute('name');
            const content = meta.getAttribute('content');

            if (name && content) {
                const key = name.replace('pagemap-', '');
                attributes[key] = content;
            }
        });

        return {
            attributes,
            dataObjects,
        };
    });

    return pageMapData;
};

export const extractContentMetrics = async (page: any): Promise<Partial<ICustomMetadata>> => {
    const metrics = await page.evaluate(() => {
        // Calculate word count
        // eslint-disable-next-line no-undef
        const textContent = document.body.textContent ?? '';
        const wordCount = textContent.trim().split(/\s+/).length;

        // Estimate reading time (average 200 words per minute)
        const readingTime = Math.ceil(wordCount / 200);

        // Extract heading structure for content analysis
        // eslint-disable-next-line no-undef
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
            level: parseInt(h.tagName.substring(1)),
            text: h.textContent?.trim() ?? '',
        }));

        return {
            wordCount,
            readingTime: `${readingTime} min`,
            headingStructure: headings,
        };
    });

    return metrics;
};

export interface IImageSource {
    srcset: string;
    media?: string;
    type?: string;
}

export interface IImageData {
    src: string;
    alt: string;
    title: string;
    width: string;
    height: string;
    srcset: string;
    loading: string;
    classList: string[];
    sources: IImageSource[];
}

export const extractImages = async (page: any): Promise<IImageData[]> => {
    const images = await page.evaluate(() => {
        // eslint-disable-next-line no-undef
        const imgElements = Array.from(document.querySelectorAll('img'));

        return imgElements.map(img => {
            // Collect <source> siblings from parent <picture> element if present
            const sources: Array<{ srcset: string; media?: string; type?: string }> = [];
            const picture = img.closest('picture');
            if (picture) {
                const sourceEls = Array.from(picture.querySelectorAll('source'));
                sourceEls.forEach(source => {
                    sources.push({
                        srcset: source.getAttribute('srcset') ?? '',
                        ...(source.getAttribute('media') && {
                            media: source.getAttribute('media') ?? undefined,
                        }),
                        ...(source.getAttribute('type') && {
                            type: source.getAttribute('type') ?? undefined,
                        }),
                    });
                });
            }

            return {
                src: img.getAttribute('src') ?? img.src ?? '',
                alt: img.getAttribute('alt') ?? '',
                title: img.getAttribute('title') ?? '',
                width: img.getAttribute('width') ?? '',
                height: img.getAttribute('height') ?? '',
                srcset: img.getAttribute('srcset') ?? '',
                loading: img.getAttribute('loading') ?? '',
                classList: Array.from(img.classList),
                sources,
            };
        });
    });

    return images as IImageData[];
};
