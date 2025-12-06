import Redis from 'ioredis';

// Configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_PREFIX = process.env.REDIS_PREFIX || 'viscord:';
const USE_REDIS = process.env.USE_REDIS !== 'false'; // Default to true

// TTL constants
const SESSION_TTL = 60; // 60 seconds for resume tokens
const PRESENCE_TTL = 45; // 45 seconds for presence (refresh every 30s via heartbeat)
const FRIEND_CACHE_TTL = 300; // 5 minutes for friend list cache

export interface SessionData {
    userId: string;
    username: string;
    githubId?: number;
    subscribedChannels: string[];
    connectedAt: number;
}

export interface UserPresence {
    username: string;
    status: string;
    activity: string;
    project: string;
    language: string;
    lastSeen: number;
}

class RedisService {
    private client: Redis | null = null;
    private subscriber: Redis | null = null;
    private isConnected: boolean = false;
    private messageHandlers: Map<string, ((message: string) => void)[]> = new Map();

    async connect(): Promise<boolean> {
        if (!USE_REDIS) {
            console.log('Redis disabled via USE_REDIS=false');
            return false;
        }

        try {
            this.client = new Redis(REDIS_URL, {
                retryStrategy: (times) => {
                    if (times > 3) {
                        console.error('Redis connection failed after 3 attempts');
                        return null; // Stop retrying
                    }
                    return Math.min(times * 200, 2000);
                },
                maxRetriesPerRequest: 3,
                lazyConnect: true
            });

            this.subscriber = new Redis(REDIS_URL, {
                retryStrategy: (times) => {
                    if (times > 3) return null;
                    return Math.min(times * 200, 2000);
                },
                maxRetriesPerRequest: 3,
                lazyConnect: true
            });

            await this.client.connect();
            await this.subscriber.connect();

            this.isConnected = true;
            console.log('Redis connected successfully');

            // Set up message handler for subscriptions
            this.subscriber.on('message', (channel, message) => {
                const handlers = this.messageHandlers.get(channel);
                if (handlers) {
                    handlers.forEach(handler => handler(message));
                }
            });

            this.client.on('error', (err) => {
                console.error('Redis client error:', err);
                this.isConnected = false;
            });

            this.subscriber.on('error', (err) => {
                console.error('Redis subscriber error:', err);
            });

            return true;
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
            this.isConnected = false;
            return false;
        }
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.quit();
            this.client = null;
        }
        if (this.subscriber) {
            await this.subscriber.quit();
            this.subscriber = null;
        }
        this.isConnected = false;
    }

    get connected(): boolean {
        return this.isConnected && this.client !== null;
    }

    // --- Session Management ---

    async setSession(sessionId: string, data: SessionData): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}session:${sessionId}`;
        await this.client.setex(key, SESSION_TTL, JSON.stringify(data));
    }

    async getSession(sessionId: string): Promise<SessionData | null> {
        if (!this.client) return null;
        const key = `${REDIS_PREFIX}session:${sessionId}`;
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }

    async deleteSession(sessionId: string): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}session:${sessionId}`;
        await this.client.del(key);
    }

    async extendSession(sessionId: string): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}session:${sessionId}`;
        await this.client.expire(key, SESSION_TTL);
    }

    // --- Resume Token ---

    async setResumeToken(token: string, sessionData: SessionData): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}resume:${token}`;
        await this.client.setex(key, SESSION_TTL, JSON.stringify(sessionData));
    }

    async getResumeToken(token: string): Promise<SessionData | null> {
        if (!this.client) return null;
        const key = `${REDIS_PREFIX}resume:${token}`;
        const data = await this.client.get(key);
        if (data) {
            // Delete after retrieval (one-time use)
            await this.client.del(key);
            return JSON.parse(data);
        }
        return null;
    }

    // --- User Presence ---

    async setUserOnline(userId: string, presence: UserPresence): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}presence:${userId}`;
        await this.client.setex(key, PRESENCE_TTL, JSON.stringify(presence));
    }

    async setUserOffline(userId: string): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}presence:${userId}`;
        await this.client.del(key);
    }

    async getUserPresence(userId: string): Promise<UserPresence | null> {
        if (!this.client) return null;
        const key = `${REDIS_PREFIX}presence:${userId}`;
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }

    async refreshPresence(userId: string): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}presence:${userId}`;
        await this.client.expire(key, PRESENCE_TTL);
    }

    // --- Last Seen (Write-Behind) ---

    async setLastSeen(userId: string, timestamp: number): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}lastseen:${userId}`;
        await this.client.set(key, timestamp.toString());
    }

    async getLastSeen(userId: string): Promise<number | null> {
        if (!this.client) return null;
        const key = `${REDIS_PREFIX}lastseen:${userId}`;
        const data = await this.client.get(key);
        return data ? parseInt(data, 10) : null;
    }

    async getAllLastSeen(): Promise<Map<string, number>> {
        if (!this.client) return new Map();
        const pattern = `${REDIS_PREFIX}lastseen:*`;
        const keys = await this.client.keys(pattern);
        const result = new Map<string, number>();

        for (const key of keys) {
            const userId = key.replace(`${REDIS_PREFIX}lastseen:`, '');
            const value = await this.client.get(key);
            if (value) {
                result.set(userId, parseInt(value, 10));
            }
        }

        return result;
    }

    async clearLastSeen(userId: string): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}lastseen:${userId}`;
        await this.client.del(key);
    }

    // --- Friend Cache (Read-Through) ---

    async cacheFriendList(userId: string, friends: string[]): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}friends:${userId}`;
        await this.client.setex(key, FRIEND_CACHE_TTL, JSON.stringify(friends));
    }

    async getCachedFriendList(userId: string): Promise<string[] | null> {
        if (!this.client) return null;
        const key = `${REDIS_PREFIX}friends:${userId}`;
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }

    async invalidateFriendCache(userId: string): Promise<void> {
        if (!this.client) return;
        const key = `${REDIS_PREFIX}friends:${userId}`;
        await this.client.del(key);
    }

    // --- Pub/Sub ---

    async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
        if (!this.subscriber) return;

        const fullChannel = `${REDIS_PREFIX}${channel}`;

        if (!this.messageHandlers.has(fullChannel)) {
            this.messageHandlers.set(fullChannel, []);
            await this.subscriber.subscribe(fullChannel);
        }

        this.messageHandlers.get(fullChannel)!.push(handler);
    }

    async unsubscribe(channel: string): Promise<void> {
        if (!this.subscriber) return;
        const fullChannel = `${REDIS_PREFIX}${channel}`;
        this.messageHandlers.delete(fullChannel);
        await this.subscriber.unsubscribe(fullChannel);
    }

    async publish(channel: string, message: object): Promise<void> {
        if (!this.client) return;
        const fullChannel = `${REDIS_PREFIX}${channel}`;
        await this.client.publish(fullChannel, JSON.stringify(message));
    }

    // --- Utility ---

    async ping(): Promise<boolean> {
        if (!this.client) return false;
        try {
            const result = await this.client.ping();
            return result === 'PONG';
        } catch {
            return false;
        }
    }
}

// Export singleton instance
export const redisService = new RedisService();
