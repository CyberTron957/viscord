"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = exports.RateLimiter = void 0;
class RateLimiter {
    constructor() {
        this.connectionAttempts = new Map();
        this.messageAttempts = new Map();
    }
    /**
     * Generic rate limit check
     */
    checkLimit(attemptsMap, key, limit, type) {
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
    checkConnectionLimit(ip) {
        return this.checkLimit(this.connectionAttempts, ip, 5, 'Connection');
    }
    // Message rate limit: max 60 messages per minute per user (1 per second)
    checkMessageLimit(userId) {
        return this.checkLimit(this.messageAttempts, userId, 60, 'Message');
    }
    // Cleanup old entries (run periodically)
    cleanup() {
        const now = Date.now();
        const cutoff = 120000; // 2 minutes
        for (const [key, attempts] of this.connectionAttempts.entries()) {
            const recent = attempts.filter(time => now - time < cutoff);
            if (recent.length === 0) {
                this.connectionAttempts.delete(key);
            }
            else {
                this.connectionAttempts.set(key, recent);
            }
        }
        for (const [key, attempts] of this.messageAttempts.entries()) {
            const recent = attempts.filter(time => now - time < cutoff);
            if (recent.length === 0) {
                this.messageAttempts.delete(key);
            }
            else {
                this.messageAttempts.set(key, recent);
            }
        }
    }
}
exports.RateLimiter = RateLimiter;
exports.rateLimiter = new RateLimiter();
// Cleanup every 5 minutes
setInterval(() => exports.rateLimiter.cleanup(), 5 * 60 * 1000);
