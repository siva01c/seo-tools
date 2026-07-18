import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import * as path from 'path';

describe('purge-old-data CLI', () => {
    it('accepts --days 0 for immediate DSAR right-to-be-forgotten domain erasure dry-run', () => {
        const scriptPath = path.join(process.cwd(), 'scripts/purge-old-data.ts');
        const cmd = `npx tsx ${scriptPath} --days 0 --dry-run --domain non-existent-domain.test`;
        const output = execSync(cmd, { encoding: 'utf8' });
        expect(output).toContain('Done. 0 date-folder(s) would be removed');
    });
});
