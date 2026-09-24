import { describe, it, expect } from '@jest/globals';
import { findBareEqualsFlags } from '../../utils/cliFlags.js';

describe('findBareEqualsFlags', () => {
    it('accepts the --name=<value> form', () => {
        expect(
            findBareEqualsFlags(['https://example.com', '--max-requests=15', '--headless=true'])
        ).toEqual([]);
    });

    it('ignores flags that take their value as the next argument', () => {
        expect(
            findBareEqualsFlags(['https://example.com', '--exclude-domains', 'cdn.example.com'])
        ).toEqual([]);
    });

    it('reports --max-requests passed with a space and suggests the fix', () => {
        const errors = findBareEqualsFlags(['https://example.com', '--max-requests', '15']);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('--max-requests=15');
    });

    it('reports every malformed flag, with a placeholder when no value follows', () => {
        const errors = findBareEqualsFlags(['--concurrency', '--rate-limit', 'moderate']);
        expect(errors).toHaveLength(2);
        expect(errors.join('\n')).toContain('--concurrency=<value>');
        expect(errors.join('\n')).toContain('--rate-limit=moderate');
    });
});
