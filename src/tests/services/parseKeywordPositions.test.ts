import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { parseKeywordPositions } from '../../../scripts/parse-keyword-positions.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Exercises the real filesystem inside an isolated temp directory, matching storageService.test.ts:
// jest.mock('fs', ...) does not intercept ESM imports under the ts-jest ESM preset, so mocking fs
// here would silently test nothing. parseKeywordPositions resolves its path relative to cwd.
describe('parseKeywordPositions', () => {
    const DOMAIN = 'example.com';

    // Tab-separated, mirroring the real SEMO export. Columns:
    // 0 keywords | 1 keyword | 2 naposledy | 3 hledanost_seznam | 4 hledanost_google
    // 5 pozice_google | 6 pozice_google_minule | 7 pozice_seznam | 8 pozice_seznam_minule
    // 9 URL_google | 10 URL_seznam | 11 hvezdicka | 12 stitek_0
    const HEADER =
        'keywords\tkeyword\tnaposledy\thledanost_seznam\thledanost_google\tpozice_google\t' +
        'pozice_google_minule\tpozice_seznam\tpozice_seznam_minule\tURL_google\tURL_seznam\t' +
        'hvezdicka\tstitek_0';

    const row = (cols: Partial<Record<number, string>>): string => {
        const out = Array(13).fill('');
        for (const [i, v] of Object.entries(cols)) out[Number(i)] = v as string;
        return out.join('\t');
    };

    let tmpDir: string;
    let originalCwd: string;

    const writeExport = (lines: string[], fileName = 'lkv-semo-keywords.csv'): void => {
        const dir = path.join(tmpDir, 'storage', 'external_datasources', DOMAIN);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fileName), lines.join('\n'));
    };

    beforeEach(() => {
        originalCwd = process.cwd();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyword-positions-test-'));
        process.chdir(tmpDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('when no export is present', () => {
        it('returns an empty array if the domain directory does not exist', () => {
            expect(parseKeywordPositions(DOMAIN)).toEqual([]);
        });

        it('returns an empty array if the directory holds no csv/tsv file', () => {
            const dir = path.join(tmpDir, 'storage', 'external_datasources', DOMAIN);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'notes.txt'), 'not an export');

            expect(parseKeywordPositions(DOMAIN)).toEqual([]);
        });

        it('returns an empty array for a header-only export', () => {
            writeExport([HEADER]);

            expect(parseKeywordPositions(DOMAIN)).toEqual([]);
        });
    });

    describe('locating the export', () => {
        it('finds the export regardless of its file name', () => {
            writeExport(
                [HEADER, row({ 1: 'drupal praha', 5: '3' })],
                'whatever-client-named-it.csv'
            );

            const result = parseKeywordPositions(DOMAIN);

            expect(result).toHaveLength(1);
            expect(result[0].keyword).toBe('drupal praha');
        });

        it('accepts a .tsv extension', () => {
            writeExport([HEADER, row({ 1: 'drupal brno', 5: '7' })], 'export.tsv');

            expect(parseKeywordPositions(DOMAIN)[0].positionGoogle).toBe(7);
        });

        it('picks deterministically when several exports are present', () => {
            writeExport([HEADER, row({ 1: 'from-a' })], 'a-export.csv');
            writeExport([HEADER, row({ 1: 'from-b' })], 'b-export.csv');

            expect(parseKeywordPositions(DOMAIN)[0].keyword).toBe('from-a');
        });
    });

    describe('column semantics', () => {
        it('reads signed deltas from the misleadingly named "minule" columns', () => {
            // "pozice_google_minule" reads as "previous position" but holds a change value.
            writeExport([
                HEADER,
                row({ 1: 'improved', 5: '2', 6: '+58', 7: '5', 8: '+3' }),
                row({ 1: 'declined', 5: '6', 6: '-4', 7: '11', 8: '-9' }),
            ]);

            const [improved, declined] = parseKeywordPositions(DOMAIN);

            expect(improved.changeGoogle).toBe(58);
            expect(improved.changeSeznam).toBe(3);
            expect(declined.changeGoogle).toBe(-4);
            expect(declined.changeSeznam).toBe(-9);
        });

        it('maps search volume Seznam-first, Google-second', () => {
            writeExport([HEADER, row({ 1: 'volumes', 3: '140', 4: '90' })]);

            const [kw] = parseKeywordPositions(DOMAIN);

            expect(kw.searchVolumeSeznam).toBe(140);
            expect(kw.searchVolumeGoogle).toBe(90);
        });

        it('maps positions, URLs and tag to the right columns', () => {
            writeExport([
                HEADER,
                row({
                    1: 'full row',
                    2: '2026-07-28',
                    5: '1',
                    7: '5',
                    9: 'https://example.com/',
                    10: 'https://example.com/cs/',
                    12: 'drupal',
                }),
            ]);

            const [kw] = parseKeywordPositions(DOMAIN);

            expect(kw).toMatchObject({
                keyword: 'full row',
                lastChecked: '2026-07-28',
                positionGoogle: 1,
                positionSeznam: 5,
                urlGoogle: 'https://example.com/',
                urlSeznam: 'https://example.com/cs/',
                tag: 'drupal',
            });
        });
    });

    describe('unranked and missing values', () => {
        it('treats the "60+" bucket as unranked', () => {
            writeExport([HEADER, row({ 1: 'unranked', 5: '60+', 7: '60+' })]);

            const [kw] = parseKeywordPositions(DOMAIN);

            expect(kw.positionGoogle).toBeNull();
            expect(kw.positionSeznam).toBeNull();
        });

        it('reports a missing delta as null rather than zero', () => {
            // Zero would read as "held its position", which is a different claim from "no prior data".
            writeExport([HEADER, row({ 1: 'no prior', 5: '1', 6: '' })]);

            expect(parseKeywordPositions(DOMAIN)[0].changeGoogle).toBeNull();
        });

        it('defaults absent search volume to zero', () => {
            writeExport([HEADER, row({ 1: 'no volume' })]);

            const [kw] = parseKeywordPositions(DOMAIN);

            expect(kw.searchVolumeGoogle).toBe(0);
            expect(kw.searchVolumeSeznam).toBe(0);
        });
    });

    describe('malformed rows', () => {
        it('skips rows with too few columns', () => {
            writeExport([HEADER, 'short\trow', row({ 1: 'intact', 5: '4' })]);

            const result = parseKeywordPositions(DOMAIN);

            expect(result).toHaveLength(1);
            expect(result[0].keyword).toBe('intact');
        });

        it('skips rows with a blank keyword', () => {
            writeExport([HEADER, row({ 5: '4' }), row({ 1: 'intact' })]);

            const result = parseKeywordPositions(DOMAIN);

            expect(result).toHaveLength(1);
            expect(result[0].keyword).toBe('intact');
        });
    });
});
