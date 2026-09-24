/**
 * Flags that main.ts reads only in the `--name=<value>` form.
 *
 * Other flags (`--exclude-domains`, `--date`, `--incremental-date`, …) take their value as the
 * next argument, so `--max-requests 15` looks natural — but the parser matches on
 * `startsWith('--max-requests=')`, never sees it, and the crawl runs uncapped. That is the one
 * mistake where "ignored" means "crawled the whole site", so main.ts refuses to start instead.
 */
export const EQUALS_ONLY_FLAGS = [
    'headless',
    'rate-limit',
    'max-requests',
    'concurrency',
    'delay-min',
    'delay-max',
    'max-retries',
] as const;

/**
 * Return one message per equals-only flag passed without `=` (e.g. `--max-requests 15`).
 * Empty when every such flag is well-formed.
 */
export function findBareEqualsFlags(args: readonly string[]): string[] {
    return EQUALS_ONLY_FLAGS.filter(flag => args.includes(`--${flag}`)).map(flag => {
        const next = args[args.indexOf(`--${flag}`) + 1];
        const example = next && !next.startsWith('-') ? next : '<value>';
        return (
            `--${flag} needs the --${flag}=<value> form ` +
            `(got "--${flag} ${example}"); use --${flag}=${example}`
        );
    });
}
