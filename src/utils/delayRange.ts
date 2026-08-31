/**
 * Sanity-check the inter-request delay bounds before the crawler uses them.
 *
 * The delay is slept *inside* the Crawlee request handler, so both bounds have to make sense
 * relative to each other and to `requestHandlerTimeoutSecs`:
 *
 *  - An inverted pair (min > max) makes `Math.random() * (max - min + 1) + min` return values
 *    below min — the range silently means the opposite of what was asked for.
 *  - A delay close to the handler timeout turns every page into a timeout plus a retry, which
 *    puts *more* load on the target, not less — the exact failure mode the load-shaping flags
 *    exist to avoid.
 *
 * Runs on the effective pair (CLI override or `crawler.yml` value), not just on the flags that
 * were passed: overriding only `--delay-min` can invert the range against the YAML max just as
 * easily as passing both.
 */
export interface INormalizedDelayRange {
    min?: number;
    max?: number;
    /** Human-readable notes about every adjustment made, for the caller to log. */
    warnings: string[];
}

/** Largest share of the request-handler timeout a single delay may consume. */
const DELAY_TIMEOUT_BUDGET = 0.5;

export function normalizeDelayRange(
    min: number | undefined,
    max: number | undefined,
    requestHandlerTimeoutSecs: number
): INormalizedDelayRange {
    const warnings: string[] = [];
    let lo = min;
    let hi = max;

    if (lo !== undefined && hi !== undefined && lo > hi) {
        warnings.push(
            `Request delay range is inverted (min ${lo}ms > max ${hi}ms) — swapping the two.`
        );
        [lo, hi] = [hi, lo];
    }

    const ceiling = Math.max(
        1,
        Math.floor(requestHandlerTimeoutSecs * 1000 * DELAY_TIMEOUT_BUDGET)
    );

    if (hi !== undefined && hi > ceiling) {
        warnings.push(
            `Max request delay ${hi}ms exceeds half of requestHandlerTimeoutSecs ` +
                `(${requestHandlerTimeoutSecs}s) — clamping to ${ceiling}ms so the handler is not ` +
                `aborted as a timeout and retried. Lower --concurrency or use --max-requests for a ` +
                `gentler crawl instead.`
        );
        hi = ceiling;
    }

    if (lo !== undefined && lo > ceiling) {
        lo = ceiling;
    }
    if (lo !== undefined && hi !== undefined && lo > hi) {
        lo = hi;
    }

    return { min: lo, max: hi, warnings };
}
