import { describe, it, expect } from '@jest/globals';
import { isPrivateIp, checkUrlIsSafeToRequest } from '../../services/ssrfGuard.js';

describe('ssrfGuard', () => {
    describe('isPrivateIp', () => {
        it('flags loopback, RFC1918, link-local, and CGNAT ranges', () => {
            expect(isPrivateIp('127.0.0.1')).toBe(true);
            expect(isPrivateIp('10.0.0.1')).toBe(true);
            expect(isPrivateIp('172.16.0.1')).toBe(true);
            expect(isPrivateIp('172.31.255.255')).toBe(true);
            expect(isPrivateIp('192.168.1.1')).toBe(true);
            expect(isPrivateIp('169.254.169.254')).toBe(true); // cloud metadata endpoint
            expect(isPrivateIp('100.64.0.1')).toBe(true); // CGNAT
            expect(isPrivateIp('198.18.0.1')).toBe(true); // benchmarking range
            expect(isPrivateIp('0.0.0.0')).toBe(true);
            expect(isPrivateIp('224.0.0.1')).toBe(true); // multicast+
        });

        it('does not flag public IPv4 addresses', () => {
            expect(isPrivateIp('8.8.8.8')).toBe(false);
            expect(isPrivateIp('172.15.255.255')).toBe(false); // just outside 172.16/12
            expect(isPrivateIp('172.32.0.0')).toBe(false); // just outside 172.16/12
            expect(isPrivateIp('1.1.1.1')).toBe(false);
        });

        it('flags IPv6 loopback, ULA, and link-local addresses', () => {
            expect(isPrivateIp('::1')).toBe(true);
            expect(isPrivateIp('::')).toBe(true);
            expect(isPrivateIp('fc00::1')).toBe(true);
            expect(isPrivateIp('fd12:3456::1')).toBe(true);
            expect(isPrivateIp('fe80::1')).toBe(true);
        });

        it('unwraps IPv4-mapped IPv6 addresses and checks the mapped address', () => {
            expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
            expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
        });

        it('does not flag public IPv6 addresses', () => {
            expect(isPrivateIp('2001:4860:4860::8888')).toBe(false); // Google DNS
        });
    });

    describe('checkUrlIsSafeToRequest', () => {
        it('rejects malformed URLs', async () => {
            expect(await checkUrlIsSafeToRequest('not a url')).toBe('Invalid URL format');
        });

        it('rejects non-http(s) protocols', async () => {
            expect(await checkUrlIsSafeToRequest('file:///etc/passwd')).toBe(
                'Only http(s) URLs are allowed'
            );
            expect(await checkUrlIsSafeToRequest('ftp://example.com')).toBe(
                'Only http(s) URLs are allowed'
            );
        });

        it('rejects literal private IP targets without needing DNS', async () => {
            expect(await checkUrlIsSafeToRequest('http://127.0.0.1/')).toBe(
                'Target resolves to a private address'
            );
            expect(await checkUrlIsSafeToRequest('http://169.254.169.254/latest/meta-data/')).toBe(
                'Target resolves to a private address'
            );
            expect(await checkUrlIsSafeToRequest('http://[::1]/')).toBe(
                'Target resolves to a private address'
            );
        });

        it('allows literal public IP targets', async () => {
            expect(await checkUrlIsSafeToRequest('http://8.8.8.8/')).toBeNull();
        });

        it('rejects a hostname that resolves to loopback (e.g. "localhost")', async () => {
            // Resolved via the OS resolver (hosts file / NSS), not a real DNS query — safe in CI.
            expect(await checkUrlIsSafeToRequest('http://localhost/')).toBe(
                'Target resolves to a private address'
            );
        });
    });
});
