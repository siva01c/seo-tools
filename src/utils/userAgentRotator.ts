/**
 * User-Agent rotation utility for handling 403 blocks
 */

export class UserAgentRotator {
    private currentIndex = 0;
    private userAgents = [
        // Chrome on Windows
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Firefox on Windows
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        // Safari on macOS
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        // Chrome on macOS
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Edge on Windows
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
        // Chrome on Linux
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Firefox on Linux
        'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
        // Chrome on Android
        'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    ];

    getCurrentUserAgent(): string {
        return this.userAgents[this.currentIndex];
    }

    getNextUserAgent(): string {
        this.currentIndex = (this.currentIndex + 1) % this.userAgents.length;
        const newUserAgent = this.userAgents[this.currentIndex];
        console.log(
            `🔄 Rotating to new User-Agent (${this.currentIndex + 1}/${this.userAgents.length}): ${newUserAgent.substring(0, 80)}...`
        );
        return newUserAgent;
    }

    getRandomUserAgent(): string {
        this.currentIndex = Math.floor(Math.random() * this.userAgents.length);
        const userAgent = this.userAgents[this.currentIndex];
        console.log(
            `🎲 Random User-Agent (${this.currentIndex + 1}/${this.userAgents.length}): ${userAgent.substring(0, 80)}...`
        );
        return userAgent;
    }

    getAllUserAgents(): string[] {
        return [...this.userAgents];
    }

    setCustomUserAgents(userAgents: string[]): void {
        if (userAgents.length === 0) {
            throw new Error('User agents array cannot be empty');
        }
        this.userAgents = [...userAgents];
        this.currentIndex = 0;
    }
}

// Global instance for the crawler
export const globalUserAgentRotator = new UserAgentRotator();
