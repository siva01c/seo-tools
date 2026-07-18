/**
 * Shared "is this URL safe to request right now" check. Used both by mcp-server.ts (once, when
 * a crawl is submitted) and by main.ts's PlaywrightCrawler preNavigationHooks (again,
 * immediately before every actual navigation).
 *
 * The single submission-time check alone is not sufficient: mcp-server.ts spawns the crawler as
 * a separate child process, and Playwright/Crawlee does its own DNS resolution when it actually
 * connects, seconds to minutes later. An attacker who controls DNS for the submitted domain can
 * pass the initial check with a public IP, then rebind the record to a private address (DNS
 * rebinding) before the crawler's real request goes out — bypassing the check entirely
 * (ASVS 1.3.6). Re-running this check in a preNavigationHook, immediately before each
 * page.goto(), shrinks that window from minutes to milliseconds.
 */
import * as net from 'net';
import { lookup } from 'dns/promises';

export function isPrivateIp(ip: string): boolean {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 100 && b >= 64 && b <= 127) ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 198 && (b === 18 || b === 19)) ||
            a >= 224
        );
    }
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('::ffff:')) {
        const mapped = lower.slice('::ffff:'.length);
        return net.isIPv4(mapped) ? isPrivateIp(mapped) : true;
    }
    // fc00::/7 (ULA) and fe80::/10 (link-local)
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

/** Returns an error message if `rawUrl` must not be requested right now, or null if it's safe. */
export async function checkUrlIsSafeToRequest(rawUrl: string): Promise<string | null> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return 'Invalid URL format';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Only http(s) URLs are allowed';
    }
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) {
        return isPrivateIp(host) ? 'Target resolves to a private address' : null;
    }
    let addresses: Array<{ address: string }>;
    try {
        addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
        return `Cannot resolve hostname: ${host}`;
    }
    if (addresses.length === 0 || addresses.some(a => isPrivateIp(a.address))) {
        return 'Target resolves to a private address';
    }
    return null;
}
