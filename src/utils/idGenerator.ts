import { createHash } from 'crypto';

/**
 * Generate a unique encrypted identifier based on response data
 * @param response - The response object containing URL, status, and headers
 * @param timestamp - The timestamp when the data was processed
 * @returns A unique encrypted identifier
 */
export const generateUniqueId = (response: Record<string, unknown>, timestamp: string): string => {
    // Create a unique string from response data
    const headers = (response.headers as Record<string, unknown>) ?? {};
    const responseData = {
        url: response.url,
        status: response.status,
        timestamp,
        // Use select headers for uniqueness while avoiding sensitive data
        headers: {
            'content-type': headers['content-type'] ?? null,
            'last-modified': headers['last-modified'] ?? null,
            etag: headers['etag'] ?? null,
        },
    };

    // Convert to JSON string and create SHA-256 hash
    const dataString = JSON.stringify(responseData);
    const hash = createHash('sha256').update(dataString).digest('hex');

    // Return first 16 characters for a shorter but still unique identifier
    return hash.substring(0, 16);
};

/**
 * Generate a unique identifier based on URL and timestamp only
 * @param url - The URL being processed
 * @param timestamp - The timestamp when the data was processed
 * @returns A unique identifier
 */
export const generateUrlBasedId = (url: string, timestamp: string): string => {
    const dataString = `${url}::${timestamp}`;
    const hash = createHash('sha256').update(dataString).digest('hex');
    return hash.substring(0, 16);
};

/**
 * Generate a unique identifier based on plain text content
 * @param content - The plain text content from the page
 * @param timestamp - The timestamp when the data was processed
 * @returns A unique content-based identifier
 */
export const generateContentId = (content: string, timestamp: string): string => {
    // Create a unique string from content data
    const contentData = {
        content: content.trim(),
        timestamp,
        // Add content length for additional uniqueness
        contentLength: content.length,
    };

    // Convert to JSON string and create SHA-256 hash
    const dataString = JSON.stringify(contentData);
    const hash = createHash('sha256').update(dataString).digest('hex');

    // Return first 16 characters for a shorter but still unique identifier
    return hash.substring(0, 16);
};
