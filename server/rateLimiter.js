"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = exports.RateLimiter = void 0;
class RateLimiter {
    constructor() {
        this.connectionAttempts = new Map();
        this.messageAttempts = new Map();
    }
    // Connection rate limit: max 5 connections per minute per IP
    checkConnectionLimit(ip) {
        const now = Date.now();
        const attempts = this.connectionAttempts.get(ip) || [];
        // Remove attempts older than 1 minute
        const recentAttempts = attempts.filter(time => now - time < 60000);
        if (recentAttempts.length >= 5) {
            console.warn(`Rate limit exceeded for IP: ${ip}`);
            return false;
        }
        recentAttempts.push(now);
        this.connectionAttempts.set(ip, recentAttempts);
        return true;
    }
    // Message rate limit: max 60 messages per minute per user (1 per second)
    checkMessageLimit(userId) {
        const now = Date.now();
        const attempts = this.messageAttempts.get(userId) || [];
        // Remove attempts older than 1 minute
        const recentAttempts = attempts.filter(time => now - time < 60000);
        if (recentAttempts.length >= 60) {
            console.warn(`Message rate limit exceeded for user: ${userId}`);
            return false;
        }
        recentAttempts.push(now);
        this.messageAttempts.set(userId, recentAttempts);
        return true;
    }
    // Cleanup old entries (run periodically)
    cleanup() {
        const now = Date.now();
        const cutoff = 120000; // 2 minutes
        for (const [ip, attempts] of this.connectionAttempts.entries()) {
            const recent = attempts.filter(time => now - time < cutoff);
            if (recent.length === 0) {
                this.connectionAttempts.delete(ip);
            }
            else {
                this.connectionAttempts.set(ip, recent);
            }
        }
        for (const [userId, attempts] of this.messageAttempts.entries()) {
            const recent = attempts.filter(time => now - time < cutoff);
            if (recent.length === 0) {
                this.messageAttempts.delete(userId);
            }
            else {
                this.messageAttempts.set(userId, recent);
            }
        }
    }
}
exports.RateLimiter = RateLimiter;
exports.rateLimiter = new RateLimiter();
// Cleanup every 5 minutes
setInterval(() => exports.rateLimiter.cleanup(), 5 * 60 * 1000);
