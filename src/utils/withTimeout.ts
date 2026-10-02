/**
 * Rejects with `<label> timed out after <ms>ms` unless `work` settles first. The work itself is
 * not cancelled — the caller owns tearing down whatever it started (a browser, a request).
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
