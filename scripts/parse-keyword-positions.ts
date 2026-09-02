import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ddmmyyyyToSortKey } from './page-records.js';

export interface IKeywordPosition {
    keyword: string;
    lastChecked: string;
    searchVolumeGoogle: number;
    searchVolumeSeznam: number;
    positionGoogle: number | null;
    changeGoogle: number | null;
    positionSeznam: number | null;
    changeSeznam: number | null;
    urlGoogle: string;
    urlSeznam: string;
    tag: string;
}

/** First .csv/.tsv in a directory, sorted for determinism when more than one is present. */
function firstExportIn(dir: string): string | null {
    const candidate = readdirSync(dir)
        .filter(f => /\.(csv|tsv)$/i.test(f))
        .sort()[0];
    return candidate ? join(dir, candidate) : null;
}

/**
 * Locate the keyword export for a domain in storage/external_datasources/<domain>/.
 *
 * The file name is not fixed: exports are dropped in per client and carry whatever name
 * the export tool gave them, so any .csv/.tsv is treated as the export.
 *
 * Exports are date-partitioned as <domain>/<DD-MM-YYYY>/, the same as datasets/ and reports/,
 * so successive exports accumulate instead of overwriting each other and the newest one wins.
 * That folder layout is why this used to find nothing: the function only looked for loose files
 * in the domain directory, so an export sitting in its date folder was invisible and the audit
 * silently skipped its keyword section.
 *
 * A loose file directly in the domain directory still works, and takes second place — dates
 * are the convention, but an export dropped in by hand should not be ignored.
 */
function findExportFile(domain: string): string | null {
    const domainDir = join('storage', 'external_datasources', domain);
    if (!existsSync(domainDir)) return null;

    // Sort on the YYYY-MM-DD key, not the folder name: 01-09-2026 is newer than 07-08-2026
    // but sorts before it as a string.
    const dateFolders = readdirSync(domainDir)
        .filter(name => /^\d{2}-\d{2}-\d{4}$/.test(name))
        .filter(name => statSync(join(domainDir, name)).isDirectory())
        .sort((a, b) => ddmmyyyyToSortKey(a).localeCompare(ddmmyyyyToSortKey(b)));

    for (const folder of [...dateFolders].reverse()) {
        const found = firstExportIn(join(domainDir, folder));
        if (found) return found;
    }

    return firstExportIn(domainDir);
}

/**
 * Parse the keyword position export for a domain.
 *
 * Source: SEMOR.cz (https://www.semor.cz/) — export the domain's keyword positions
 * there and drop the file into storage/external_datasources/<domain>/.
 *
 * Despite the .csv extension the export is tab-separated, which is why it is split on \t.
 * Note the two counterintuitive parts of the format, both verified against a real export:
 * the `pozice_*_minule` ("previous position") columns actually hold signed deltas
 * (`+58`, `-4`), and search volume is Seznam-first (column 3) then Google (column 4).
 *
 * Returns an empty array when no export exists, which makes the report section opt-in.
 */
export function parseKeywordPositions(domain: string): IKeywordPosition[] {
    const csvPath = findExportFile(domain);
    if (!csvPath) return [];

    // Split on newlines and drop blank ones rather than trimming the whole file: a row whose
    // trailing columns are empty ends in tabs, and .trim() would strip those off the final row,
    // leaving it short of 13 columns and silently dropping it. Tolerates CRLF line endings.
    const lines = readFileSync(csvPath, 'utf-8')
        .split(/\r?\n/)
        .filter(line => line.trim() !== '');
    if (lines.length < 2) return [];

    const results: IKeywordPosition[] = [];

    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split('\t');
        if (cols.length < 13) continue;

        const keyword = cols[1]?.trim();
        if (!keyword) continue;

        const lastChecked = cols[2]?.trim() ?? '';

        const parseVolume = (v: string): number => {
            const n = parseInt(v, 10);
            return isNaN(n) ? 0 : n;
        };

        const parsePosition = (v: string): number | null => {
            const trimmed = v.trim();
            if (trimmed === '' || trimmed === '60+') return null;
            const n = parseInt(trimmed, 10);
            return isNaN(n) ? null : n;
        };

        const parseChange = (v: string): number | null => {
            const trimmed = v.trim();
            if (trimmed === '') return null;
            const n = parseInt(trimmed, 10);
            return isNaN(n) ? null : n;
        };

        results.push({
            keyword,
            lastChecked,
            searchVolumeGoogle: parseVolume(cols[4]),
            searchVolumeSeznam: parseVolume(cols[3]),
            positionGoogle: parsePosition(cols[5]),
            changeGoogle: parseChange(cols[6]),
            positionSeznam: parsePosition(cols[7]),
            changeSeznam: parseChange(cols[8]),
            urlGoogle: cols[9]?.trim() ?? '',
            urlSeznam: cols[10]?.trim() ?? '',
            tag: cols[12]?.trim() ?? '',
        });
    }

    return results;
}
