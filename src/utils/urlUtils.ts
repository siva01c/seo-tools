export const isHomepage = (url: string): boolean => {
    try {
        const urlObj = new URL(url);
        // Homepage should be HTTP/HTTPS and have root path AND no query parameters or hash
        const isHttpProtocol = urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
        const isRootPath = urlObj.pathname === '/' || urlObj.pathname === '';
        const hasNoQuery = urlObj.search === '';
        const hasNoHash = urlObj.hash === '';

        return isHttpProtocol && isRootPath && hasNoQuery && hasNoHash;
    } catch {
        return false;
    }
};
