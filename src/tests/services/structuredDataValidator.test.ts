import { describe, it, expect } from '@jest/globals';
import { validateJsonLdBlocks } from '../../services/structuredDataValidator.js';

const CONTEXT = 'https://schema.org';

function check(document: unknown) {
    const report = validateJsonLdBlocks([JSON.stringify(document)]);
    return report.blocks[0];
}

describe('structuredDataValidator', () => {
    it('accepts a complete item and lists its types', () => {
        const report = validateJsonLdBlocks([
            JSON.stringify({
                '@context': CONTEXT,
                '@type': 'Product',
                name: 'Kettle',
                offers: { '@type': 'Offer', price: 19.9, priceCurrency: 'EUR' },
            }),
        ]);

        expect(report).toEqual({
            block_count: 1,
            error_count: 0,
            warning_count: 0,
            truncated: false,
            blocks: [{ index: 0, valid_json: true, types: ['Product', 'Offer'], issues: [] }],
        });
    });

    it('reports a block that does not parse and keeps checking the others', () => {
        const valid = JSON.stringify({ '@context': CONTEXT, '@type': 'Person', name: 'Ada' });

        const report = validateJsonLdBlocks(['{ "@type": "Product", ', valid, '']);

        expect(report.block_count).toBe(3);
        expect(report.error_count).toBe(2);
        expect(report.blocks.map(block => block.valid_json)).toEqual([false, true, false]);
        expect(report.blocks[0].issues).toHaveLength(1);
        expect(report.blocks[0].issues[0]).toMatchObject({ severity: 'error', path: '$' });
        expect(report.blocks[0].issues[0].message).toMatch(/^Invalid JSON: /);
        expect(report.blocks[1].issues).toEqual([]);
    });

    it('reports a missing @context and a missing @type', () => {
        expect(check({ '@type': 'Person', name: 'Ada' }).issues).toEqual([
            { severity: 'error', path: '$', message: 'Missing @context' },
        ]);
        expect(check({ '@context': CONTEXT, name: 'Ada' }).issues).toEqual([
            { severity: 'error', path: '$', message: 'Missing @type' },
        ]);
    });

    it('accepts the usual spellings of the schema.org context', () => {
        const contexts = [
            'http://schema.org',
            'https://schema.org/',
            ['https://schema.org', { ex: 'https://example.com/ns#' }],
            { '@vocab': 'https://schema.org/' },
        ];
        for (const context of contexts) {
            const block = check({ '@context': context, '@type': 'Person', name: 'Ada' });
            expect(block.issues).toEqual([]);
        }

        const foreign = check({ '@context': 'https://example.com/ns', '@type': 'Thing' });
        expect(foreign.issues).toEqual([
            { severity: 'warning', path: '$', message: '@context is not https://schema.org' },
        ]);
    });

    it('reports missing required properties, with alternatives', () => {
        const block = check({ '@context': CONTEXT, '@type': 'Product', name: '  ' });

        expect(block.issues.map(issue => issue.message)).toEqual([
            'Product is missing required property: name',
            'Product is missing required property: offers or review or aggregateRating',
        ]);

        const rated = check({
            '@context': CONTEXT,
            '@type': 'Product',
            name: 'Kettle',
            aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 12 },
        });
        expect(rated.issues).toEqual([]);
    });

    it('checks nested items and says where they are', () => {
        const block = check({
            '@context': CONTEXT,
            '@type': 'FAQPage',
            mainEntity: [
                {
                    '@type': 'Question',
                    name: 'Does it whistle?',
                    acceptedAnswer: { '@type': 'Answer', text: 'Yes.' },
                },
                { '@type': 'Question', name: 'Is it dishwasher safe?' },
            ],
        });

        expect(block.types).toEqual(['FAQPage', 'Question', 'Answer']);
        expect(block.issues).toEqual([
            {
                severity: 'error',
                path: '$.mainEntity[1]',
                message: 'Question is missing required property: acceptedAnswer or suggestedAnswer',
            },
        ]);
    });

    it('checks every node of an @graph under the context of the block', () => {
        const block = check({
            '@context': CONTEXT,
            '@graph': [
                { '@type': 'WebSite', name: 'Shop', url: 'https://shop.example.com/' },
                { '@type': 'Organization' },
                'not a node',
            ],
        });

        expect(block.types).toEqual(['WebSite', 'Organization']);
        expect(block.issues).toEqual([
            {
                severity: 'error',
                path: '$["@graph"][1]',
                message: 'Organization is missing required property: name',
            },
            { severity: 'error', path: '$["@graph"][2]', message: 'Expected a JSON object' },
        ]);
    });

    it('checks each item of a top-level array', () => {
        const block = check([
            { '@context': CONTEXT, '@type': 'Person', name: 'Ada' },
            { '@type': 'Person', name: 'Grace' },
            42,
        ]);

        expect(block.issues).toEqual([
            { severity: 'error', path: '$[1]', message: 'Missing @context' },
            {
                severity: 'error',
                path: '$[2]',
                message: 'Expected a JSON object or an array of objects',
            },
        ]);
    });

    it('reads a type given as an IRI, a prefixed name or a list', () => {
        const iri = check({ '@context': CONTEXT, '@type': 'https://schema.org/Organization' });
        expect(iri.types).toEqual(['Organization']);
        expect(iri.issues).toHaveLength(1);

        const several = check({
            '@context': CONTEXT,
            '@type': ['schema:LocalBusiness', 'Organization'],
            name: 'Cafe',
        });
        expect(several.types).toEqual(['LocalBusiness', 'Organization']);
        expect(several.issues.map(issue => issue.message)).toEqual([
            'LocalBusiness is missing required property: address',
        ]);
    });

    it('only warns about an untyped nested object and accepts references and literals', () => {
        const block = check({
            '@context': CONTEXT,
            '@type': 'Article',
            headline: 'News',
            publisher: { '@id': 'https://example.com/#org' },
            datePublished: { '@value': '2026-01-01', '@type': 'Date' },
            description: { '@value': 'Short', '@language': 'en' },
            author: { name: 'Ada' },
        });

        expect(block.issues).toEqual([
            { severity: 'warning', path: '$.author', message: 'Missing @type' },
        ]);
    });

    it('leaves types it does not know alone', () => {
        const block = check({ '@context': CONTEXT, '@type': 'MedicalCondition' });

        expect(block.types).toEqual(['MedicalCondition']);
        expect(block.issues).toEqual([]);
    });

    it('bounds what a hostile document can put into the report', () => {
        const longName = 'T'.repeat(500);
        const flood = Array.from({ length: 200 }, () => ({ '@type': 'Person' }));

        const named = check({ '@context': CONTEXT, '@type': longName });
        expect(named.types[0].length).toBeLessThanOrEqual(101);

        const flooded = check({ '@context': CONTEXT, '@graph': flood });
        expect(flooded.issues).toHaveLength(50);

        const many = validateJsonLdBlocks(Array.from({ length: 60 }, () => '{}'));
        expect(many.block_count).toBe(60);
        expect(many.blocks).toHaveLength(50);
        expect(many.truncated).toBe(true);
    });

    it('survives a document nested deeper than it is willing to follow', () => {
        let nested: Record<string, unknown> = { '@type': 'Person', name: 'Leaf' };
        for (let i = 0; i < 40; i++) nested = { '@type': 'Person', name: 'N', knows: nested };

        const block = check({ '@context': CONTEXT, ...nested });

        expect(block.valid_json).toBe(true);
        expect(block.issues).toEqual([]);
    });
});
