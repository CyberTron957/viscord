export class RateLimiter {
    private connectionAttempts: Map<string, number[]> = new Map();
    private messageAttempts: Map<string, number[]> = new Map();

    /**
     * Generic rate limit check
     */
    private checkLimit(
        attemptsMap: Map<string, number[]>,
        key: string,
        limit: number,
        type: string
    ): boolean {
        const now = Date.now();
        const attempts = attemptsMap.get(key) || [];

        // Remove attempts older than 1 minute
        const recentAttempts = attempts.filter(time => now - time < 60000);

        if (recentAttempts.length >= limit) {
            console.warn(`${type} rate limit exceeded for: ${key}`);
            return false;
        }

        recentAttempts.push(now);
        attemptsMap.set(key, recentAttempts);
        return true;
    }

    // Connection rate limit: max 5 connections per minute per IP
    checkConnectionLimit(ip: string): boolean {
        return this.checkLimit(this.connectionAttempts, ip, 5, 'Connection');
    }

    // Message rate limit: max 60 messages per minute per user (1 per second)
    checkMessageLimit(userId: string): boolean {
        return this.checkLimit(this.messageAttempts, userId, 60, 'Message');
    }

    // Cleanup old entries (run periodically)
    cleanup(): void {
        const now = Date.now();
        const cutoff = 120000; // 2 minutes

        for (const [key, attempts] of this.connectionAttempts.entries()) {
            const recent = attempts.filter(time => now - time < cutoff);
            if (recent.length === 0) {
                this.connectionAttempts.delete(key);
            } else {
                this.connectionAttempts.set(key, recent);
            }
        }

        for (const [key, attempts] of this.messageAttempts.entries()) {
            const recent = attempts.filter(time => now - time < cutoff);
            if (recent.length === 0) {
                this.messageAttempts.delete(key);
            } else {
                this.messageAttempts.set(key, recent);
            }
        }
    }
}

export const rateLimiter = new RateLimiter();

// Cleanup every 5 minutes
setInterval(() => rateLimiter.cleanup(), 5 * 60 * 1000);
