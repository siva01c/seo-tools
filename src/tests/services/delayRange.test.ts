import { describe, it, expect } from '@jest/globals';
import { normalizeDelayRange } from '../../utils/delayRange.js';

// crawler.yml ships requestTimeoutSecs: 60, so the ceiling in these tests is 30000ms.
const TIMEOUT_SECS = 60;

describe('normalizeDelayRange', () => {
    it('leaves a sane range untouched and warns about nothing', () => {
        const result = normalizeDelayRange(50, 200, TIMEOUT_SECS);
        expect(result).toEqual({ min: 50, max: 200, warnings: [] });
    });

    it('keeps a zero lower bound — 0-3000ms is a legitimate range, not "unset"', () => {
        const result = normalizeDelayRange(0, 3000, TIMEOUT_SECS);
        expect(result.min).toBe(0);
        expect(result.max).toBe(3000);
        expect(result.warnings).toHaveLength(0);
    });

    it('swaps an inverted range instead of silently inverting the semantics', () => {
        // --delay-min=5000 --delay-max=1000 would otherwise make getRandomDelay() multiply by a
        // negative span and return values below the requested minimum.
        const result = normalizeDelayRange(5000, 1000, TIMEOUT_SECS);
        expect(result.min).toBe(1000);
        expect(result.max).toBe(5000);
        expect(result.warnings.join(' ')).toMatch(/inverted/i);
    });

    it('detects inversion against the config value when only one side is overridden', () => {
        // --delay-min=5000 alone, against crawler.yml's requestDelayMax: 200.
        const result = normalizeDelayRange(5000, 200, TIMEOUT_SECS);
        expect(result.min).toBe(200);
        expect(result.max).toBe(5000);
    });

    it('clamps a delay that would outlast the request handler timeout', () => {
        // The delay sleeps inside the handler; 90s against a 60s timeout aborts and retries every
        // page, putting more load on the target rather than less.
        const result = normalizeDelayRange(90000, 90000, TIMEOUT_SECS);
        expect(result.max).toBe(30000);
        expect(result.min).toBe(30000);
        expect(result.warnings.join(' ')).toMatch(/requestHandlerTimeoutSecs/);
    });

    it('never lets the clamped minimum exceed the clamped maximum', () => {
        const result = normalizeDelayRange(45000, 90000, TIMEOUT_SECS);
        expect(result.min).toBeLessThanOrEqual(result.max as number);
        expect(result.max).toBe(30000);
    });

    it('passes undefined bounds through so an unset config stays unset', () => {
        expect(normalizeDelayRange(undefined, undefined, TIMEOUT_SECS)).toEqual({
            min: undefined,
            max: undefined,
            warnings: [],
        });
    });
});
