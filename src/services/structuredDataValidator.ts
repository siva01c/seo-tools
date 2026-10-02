/**
 * Checks JSON-LD blocks (the text of `<script type="application/ld+json">` elements) the way a
 * site owner needs before a rich-result test: does each block parse, does every item say what it
 * is (`@context`, `@type`), and does a common schema.org type carry the properties search engines
 * require of it. Pure — no network, no page; pageCheckService.ts supplies blocks read from a URL.
 *
 * This is a lint, not a schema.org validator: it knows the required properties of the types
 * listed below and nothing about value formats or the rest of the vocabulary.
 */

export type TIssueSeverity = 'error' | 'warning';

export interface IStructuredDataIssue {
    severity: TIssueSeverity;
    /** Where in the block, e.g. `$`, `$[1]`, `$["@graph"][0].offers`. */
    path: string;
    message: string;
}

export interface IStructuredDataBlock {
    index: number;
    valid_json: boolean;
    /** Every `@type` found in the block, in document order, without duplicates. */
    types: string[];
    issues: IStructuredDataIssue[];
}

export interface IStructuredDataReport {
    block_count: number;
    error_count: number;
    warning_count: number;
    /** True when more blocks were given than are checked. */
    truncated: boolean;
    blocks: IStructuredDataBlock[];
}

const MAX_BLOCKS = 50;
const MAX_ISSUES_PER_BLOCK = 50;
const MAX_DEPTH = 12;
const MAX_NAME_CHARS = 100;

// Properties without which the type is not eligible for its rich result (or, for the generic
// types, is not usable at all). One entry in an inner array is enough: [['a', 'b']] reads
// "a or b".
const REQUIRED_PROPERTIES: Record<string, string[][]> = {
    AggregateRating: [['ratingValue'], ['ratingCount', 'reviewCount']],
    Answer: [['text']],
    Article: [['headline']],
    BlogPosting: [['headline']],
    BreadcrumbList: [['itemListElement']],
    Course: [['name'], ['description']],
    Event: [['name'], ['startDate'], ['location']],
    FAQPage: [['mainEntity']],
    HowTo: [['name'], ['step']],
    JobPosting: [['title'], ['description'], ['datePosted'], ['hiringOrganization']],
    ListItem: [['position']],
    LocalBusiness: [['name'], ['address']],
    NewsArticle: [['headline']],
    Offer: [['price', 'priceSpecification']],
    Organization: [['name']],
    Person: [['name']],
    Product: [['name'], ['offers', 'review', 'aggregateRating']],
    Question: [['name'], ['acceptedAnswer', 'suggestedAnswer']],
    Recipe: [['name'], ['image']],
    Review: [['author'], ['reviewRating']],
    SoftwareApplication: [['name']],
    VideoObject: [['name'], ['thumbnailUrl'], ['uploadDate']],
    WebSite: [['name'], ['url']],
};

type TJsonObject = Record<string, unknown>;

function isObject(value: unknown): value is TJsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A name taken from the checked document, cut so that it cannot flood the report. */
function clip(value: string): string {
    return value.length > MAX_NAME_CHARS ? `${value.slice(0, MAX_NAME_CHARS)}…` : value;
}

/** `https://schema.org/Product` and `schema:Product` are the type `Product`. */
function localTypeName(type: string): string {
    return type.replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/i, '');
}

function typeNames(value: unknown): string[] {
    const list = Array.isArray(value) ? value : [value];
    return list.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
}

function isSchemaOrgContext(context: unknown): boolean {
    if (typeof context === 'string') return /^https?:\/\/schema\.org\/?$/i.test(context);
    if (Array.isArray(context)) return context.some(isSchemaOrgContext);
    if (isObject(context)) return isSchemaOrgContext(context['@vocab']);
    return false;
}

function hasValue(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

class BlockCheck {
    public readonly types: string[] = [];
    public readonly issues: IStructuredDataIssue[] = [];

    public report(severity: TIssueSeverity, path: string, message: string): void {
        if (this.issues.length >= MAX_ISSUES_PER_BLOCK) return;
        this.issues.push({ severity, path, message });
    }

    /** A top-level value of the block: an item, or an array of items. */
    public checkRoot(value: unknown, path: string, depth = 0): void {
        if (Array.isArray(value)) {
            if (depth >= MAX_DEPTH) return;
            value.forEach((entry, i) => this.checkRoot(entry, `${path}[${i}]`, depth + 1));
            return;
        }
        if (!isObject(value)) {
            this.report('error', path, 'Expected a JSON object or an array of objects');
            return;
        }
        if (!hasValue(value['@context'])) {
            this.report('error', path, 'Missing @context');
        } else if (!isSchemaOrgContext(value['@context'])) {
            this.report('warning', path, '@context is not https://schema.org');
        }
        const graph = value['@graph'];
        if (graph === undefined) {
            this.checkItem(value, path, 0);
        } else if (Array.isArray(graph)) {
            // The @context of the block covers every node of its graph.
            graph.forEach((node, i) => {
                const nodePath = `${path}["@graph"][${i}]`;
                if (isObject(node)) this.checkItem(node, nodePath, 0);
                else this.report('error', nodePath, 'Expected a JSON object');
            });
        } else {
            this.report('error', `${path}["@graph"]`, '@graph must be an array');
        }
    }

    private checkItem(item: TJsonObject, path: string, depth: number): void {
        const types = typeNames(item['@type']).map(localTypeName);
        if (types.length === 0) {
            // Needs no type: a reference to a node defined elsewhere ({"@id": "…"}) and a typed
            // or language-tagged literal ({"@value": "…"}).
            const isPlainValue = '@value' in item || Object.keys(item).every(key => key === '@id');
            // An untyped nested object is still read by consumers, as the property's expected
            // type; an untyped top-level item is not read as anything.
            if (depth === 0) this.report('error', path, 'Missing @type');
            else if (!isPlainValue) this.report('warning', path, 'Missing @type');
        }
        for (const type of types) {
            const shown = clip(type);
            if (!this.types.includes(shown)) this.types.push(shown);
            for (const alternatives of REQUIRED_PROPERTIES[type] ?? []) {
                if (alternatives.some(property => hasValue(item[property]))) continue;
                const wanted = alternatives.join(' or ');
                this.report('error', path, `${shown} is missing required property: ${wanted}`);
            }
        }
        if (depth >= MAX_DEPTH) return;
        for (const [key, value] of Object.entries(item)) {
            if (key.startsWith('@')) continue;
            this.checkNested(value, `${path}.${clip(key)}`, depth + 1);
        }
    }

    private checkNested(value: unknown, path: string, depth: number): void {
        if (Array.isArray(value)) {
            // Arrays count as a level too: `[[[…]]]` would otherwise recurse as deep as the text is long.
            if (depth >= MAX_DEPTH) return;
            value.forEach((entry, i) => this.checkNested(entry, `${path}[${i}]`, depth + 1));
        } else if (isObject(value)) {
            this.checkItem(value, path, depth);
        }
    }
}

function checkBlock(raw: string, index: number): IStructuredDataBlock {
    const check = new BlockCheck();
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        check.report('error', '$', `Invalid JSON: ${clip(reason)}`);
        return { index, valid_json: false, types: [], issues: check.issues };
    }
    check.checkRoot(parsed, '$');
    return { index, valid_json: true, types: check.types, issues: check.issues };
}

/** Checks each block on its own; at most MAX_BLOCKS of them. */
export function validateJsonLdBlocks(rawBlocks: string[]): IStructuredDataReport {
    const blocks = rawBlocks.slice(0, MAX_BLOCKS).map(checkBlock);
    const count = (severity: TIssueSeverity): number =>
        blocks.reduce((sum, b) => sum + b.issues.filter(i => i.severity === severity).length, 0);
    return {
        block_count: rawBlocks.length,
        error_count: count('error'),
        warning_count: count('warning'),
        truncated: rawBlocks.length > MAX_BLOCKS,
        blocks,
    };
}
