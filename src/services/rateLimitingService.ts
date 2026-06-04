/**
 * Advanced Rate Limiting Service
 * Supports multiple time windows (1-5 hours) with configurable request limits
 */

import { readFileSync, existsSync, promises as fsPromises } from 'fs';
import { join, dirname } from 'path';

export interface IRateLimitConfig {
    enabled: boolean;
    rules: IRateLimitRule[];
    persistData: boolean;
    dataFile?: string;
}

export interface IRateLimitRule {
    windowHours: number; // Time window in hours (1-5)
    maxRequests: number; // Maximum requests in this window
    enabled: boolean; // Enable/disable this rule
    description?: string; // Human-readable description
}

export interface IRequestRecord {
    timestamp: number;
    url: string;
    success: boolean;
    statusCode?: number;
}

export interface IRateLimitStatus {
    rule: IRateLimitRule;
    currentCount: number;
    remaining: number;
    windowStart: number;
    windowEnd: number;
    nextResetTime: number;
    isBlocked: boolean;
}

export interface IRateLimitSummary {
    isBlocked: boolean;
    blockingRule?: IRateLimitRule;
    nextAllowedTime: number;
    allRuleStatuses: IRateLimitStatus[];
    totalRequests: {
        last1Hour: number;
        last2Hours: number;
        last3Hours: number;
        last4Hours: number;
        last5Hours: number;
    };
}

export class RateLimitingService {
    private config: IRateLimitConfig;
    private requests: IRequestRecord[] = [];
    private dataFilePath: string;
    private lastCleanup: number = 0;
    private isSaving = false;
    private pendingSave = false;

    constructor(config: IRateLimitConfig, domain: string = 'default') {
        this.config = config;

        // Set up data file path for persistence
        this.dataFilePath =
            config.dataFile ?? join('./storage', 'rate-limiting', `${domain}-requests.json`);

        // Load existing data if persistence is enabled
        if (config.persistData) {
            this.loadRequestHistory();
        }

        // Clean up old records on startup
        this.cleanupOldRecords();
    }

    /**
     * Check if a request can be made according to all rate limiting rules
     */
    canMakeRequest(): IRateLimitSummary {
        this.cleanupOldRecords();

        const now = Date.now();
        const summary: IRateLimitSummary = {
            isBlocked: false,
            nextAllowedTime: now,
            allRuleStatuses: [],
            totalRequests: this.getTotalRequests(),
        };

        // Check each rule
        for (const rule of this.config.rules) {
            if (!rule.enabled) continue;

            const status = this.checkRule(rule, now);
            summary.allRuleStatuses.push(status);

            if (status.isBlocked) {
                summary.isBlocked = true;
                summary.blockingRule = rule;
                summary.nextAllowedTime = Math.max(summary.nextAllowedTime, status.nextResetTime);
            }
        }

        return summary;
    }

    /**
     * Record a request (call this after making a request)
     */
    recordRequest(url: string, success: boolean, statusCode?: number): void {
        const record: IRequestRecord = {
            timestamp: Date.now(),
            url,
            success,
            statusCode,
        };

        this.requests.push(record);

        // Persist data if enabled
        if (this.config.persistData) {
            this.saveRequestHistory();
        }

        // Periodic cleanup
        if (Date.now() - this.lastCleanup > 300000) {
            // Every 5 minutes
            this.cleanupOldRecords();
        }
    }

    /**
     * Get detailed status for a specific rule
     */
    private checkRule(rule: IRateLimitRule, now: number): IRateLimitStatus {
        const windowMs = rule.windowHours * 60 * 60 * 1000;
        const windowStart = now - windowMs;

        // Count requests in this window
        const requestsInWindow = this.requests.filter(
            req => req.timestamp >= windowStart && req.timestamp <= now
        );

        const currentCount = requestsInWindow.length;
        const remaining = Math.max(0, rule.maxRequests - currentCount);
        const isBlocked = currentCount >= rule.maxRequests;

        // Calculate when the window resets (when oldest request expires)
        let nextResetTime = now;
        if (requestsInWindow.length > 0) {
            const oldestRequest = Math.min(...requestsInWindow.map(r => r.timestamp));
            nextResetTime = oldestRequest + windowMs;
        }

        return {
            rule,
            currentCount,
            remaining,
            windowStart,
            windowEnd: now,
            nextResetTime,
            isBlocked,
        };
    }

    /**
     * Get total requests for common time windows
     */
    private getTotalRequests() {
        const now = Date.now();
        const hour = 60 * 60 * 1000;

        return {
            last1Hour: this.requests.filter(r => r.timestamp >= now - hour).length,
            last2Hours: this.requests.filter(r => r.timestamp >= now - 2 * hour).length,
            last3Hours: this.requests.filter(r => r.timestamp >= now - 3 * hour).length,
            last4Hours: this.requests.filter(r => r.timestamp >= now - 4 * hour).length,
            last5Hours: this.requests.filter(r => r.timestamp >= now - 5 * hour).length,
        };
    }

    /**
     * Calculate optimal delay before next request
     */
    getOptimalDelay(): number {
        if (!this.config.enabled) return 0;

        const summary = this.canMakeRequest();

        if (!summary.isBlocked) {
            // No blocking, but add small delay to distribute requests evenly
            return this.calculateEvenDistributionDelay();
        }

        // Calculate delay until next allowed time
        return Math.max(0, summary.nextAllowedTime - Date.now());
    }

    /**
     * Calculate delay to distribute requests evenly across time windows
     */
    private calculateEvenDistributionDelay(): number {
        const enabledRules = this.config.rules.filter(r => r.enabled);
        if (enabledRules.length === 0) return 0;

        // Find the most restrictive rule (highest requests per hour)
        const mostRestrictive = enabledRules.reduce((prev, current) => {
            const prevRate = prev.maxRequests / prev.windowHours;
            const currentRate = current.maxRequests / current.windowHours;
            return currentRate < prevRate ? current : prev;
        });

        // Calculate delay to spread requests evenly
        const requestsPerHour = mostRestrictive.maxRequests / mostRestrictive.windowHours;
        const millisecondsPerRequest = (60 * 60 * 1000) / requestsPerHour;

        // Add some randomization (±20%) to avoid thundering herd
        const randomFactor = 0.8 + Math.random() * 0.4;
        return Math.round(millisecondsPerRequest * randomFactor);
    }

    /**
     * Get human-readable status summary
     */
    getStatusSummary(): string {
        if (!this.config.enabled) {
            return '⚡ Rate limiting disabled';
        }

        const summary = this.canMakeRequest();
        const totals = summary.totalRequests;

        let status = `📊 Rate Limit Status:\n`;
        status += `├── Last hour: ${totals.last1Hour} requests\n`;
        status += `├── Last 2 hours: ${totals.last2Hours} requests\n`;
        status += `├── Last 3 hours: ${totals.last3Hours} requests\n`;
        status += `└── Last 5 hours: ${totals.last5Hours} requests\n\n`;

        if (summary.isBlocked && summary.blockingRule) {
            const waitTime = Math.ceil((summary.nextAllowedTime - Date.now()) / 1000 / 60);
            status += `🚫 BLOCKED by ${summary.blockingRule.windowHours}h rule (${summary.blockingRule.maxRequests} max)\n`;
            status += `⏰ Next request allowed in: ${waitTime} minutes\n`;
        } else {
            status += `✅ Requests allowed\n`;
            const delay = this.getOptimalDelay();
            if (delay > 0) {
                status += `⏱️ Recommended delay: ${Math.ceil(delay / 1000)}s\n`;
            }
        }

        return status;
    }

    /**
     * Clean up old request records to save memory
     */
    private cleanupOldRecords(): void {
        const now = Date.now();
        const maxWindowMs = Math.max(...this.config.rules.map(r => r.windowHours)) * 60 * 60 * 1000;
        const cutoffTime = now - maxWindowMs - 60 * 60 * 1000; // Keep 1 extra hour

        this.requests = this.requests.filter(req => req.timestamp >= cutoffTime);
        this.lastCleanup = now;
    }

    /**
     * Load request history from file
     */
    private loadRequestHistory(): void {
        try {
            if (existsSync(this.dataFilePath)) {
                const data = JSON.parse(readFileSync(this.dataFilePath, 'utf-8'));
                this.requests = data.requests ?? [];
                console.log(
                    `📋 Loaded ${this.requests.length} request records from ${this.dataFilePath}`
                );
            }
        } catch (error) {
            console.warn(`⚠️ Could not load rate limit data: ${error}`);
            this.requests = [];
        }
    }

    private saveRequestHistory(): void {
        void this.saveRequestHistoryAsync();
    }

    private async saveRequestHistoryAsync(): Promise<void> {
        if (this.isSaving) {
            this.pendingSave = true;
            return;
        }
        this.isSaving = true;
        try {
            // Ensure directory exists
            const dir = dirname(this.dataFilePath);
            if (!existsSync(dir)) {
                await fsPromises.mkdir(dir, { recursive: true });
            }

            const data = {
                lastUpdated: new Date().toISOString(),
                requests: [...this.requests],
            };

            await fsPromises.writeFile(this.dataFilePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.warn(`⚠️ Could not save rate limit data: ${error}`);
        } finally {
            this.isSaving = false;
            if (this.pendingSave) {
                this.pendingSave = false;
                void this.saveRequestHistoryAsync();
            }
        }
    }

    /**
     * Reset all request history (useful for testing)
     */
    reset(): void {
        this.requests = [];
        if (this.config.persistData && existsSync(this.dataFilePath)) {
            this.saveRequestHistory();
        }
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig: IRateLimitConfig): void {
        this.config = newConfig;
        this.cleanupOldRecords();
    }
}

// Factory function for common rate limiting configurations
export function createRateLimitConfig(
    maxRequests: number,
    windowHours: number,
    description?: string
): IRateLimitConfig {
    return {
        enabled: true,
        persistData: true,
        rules: [
            {
                windowHours,
                maxRequests,
                enabled: true,
                description: description ?? `${maxRequests} requests per ${windowHours} hour(s)`,
            },
        ],
    };
}

// Preset configurations
export const rateLimitPresets = {
    conservative: createRateLimitConfig(100, 1, 'Conservative: 100 requests per hour'),
    moderate: createRateLimitConfig(200, 2, 'Moderate: 200 requests per 2 hours'),
    aggressive: createRateLimitConfig(500, 3, 'Aggressive: 500 requests per 3 hours'),
    bulk: createRateLimitConfig(1000, 5, 'Bulk: 1000 requests per 5 hours'),

    // Multi-rule configurations
    tiered: {
        enabled: true,
        persistData: true,
        rules: [
            { windowHours: 1, maxRequests: 120, enabled: true, description: '120 per hour' },
            { windowHours: 3, maxRequests: 300, enabled: true, description: '300 per 3 hours' },
            { windowHours: 5, maxRequests: 600, enabled: true, description: '600 per 5 hours' },
        ],
    } as IRateLimitConfig,
};
