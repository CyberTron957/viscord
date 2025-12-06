"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const rest_1 = require("@octokit/rest");
const database_1 = require("./database");
const rateLimiter_1 = require("./rateLimiter");
const redisService_1 = require("./redisService");
const http_1 = __importDefault(require("http"));
const crypto_1 = __importDefault(require("crypto"));
const PORT = parseInt(process.env.PORT || '8080');
const USE_LEGACY_BROADCAST = process.env.USE_LEGACY_BROADCAST === 'true';
const server = http_1.default.createServer();
const wss = new ws_1.WebSocketServer({ server });
const clients = new Map();
function validateGitHubToken(token) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const octokit = new rest_1.Octokit({ auth: token });
            const { data } = yield octokit.users.getAuthenticated();
            const followersResponse = yield octokit.users.listFollowersForAuthenticatedUser({ per_page: 100 });
            const followingResponse = yield octokit.users.listFollowedByAuthenticatedUser({ per_page: 100 });
            const followers = followersResponse.data.map(u => u.id);
            const following = followingResponse.data.map(u => u.id);
            console.log(`[DEBUG] Validated ${data.login}: ${followers.length} followers, ${following.length} following`);
            return {
                id: data.id,
                login: data.login,
                avatar_url: data.avatar_url,
                followers,
                following
            };
        }
        catch (error) {
            console.error('GitHub token validation failed:', error);
            return null;
        }
    });
}
function canUserSee(viewerGithubId, targetClientData) {
    if (!targetClientData.preferences || !targetClientData.githubId) {
        return true; // No preferences or not GitHub user = visible to all
    }
    const visibilityMode = targetClientData.preferences.visibility_mode;
    switch (visibilityMode) {
        case 'invisible':
            return false; // No one can see
        case 'everyone':
            return true;
        case 'followers':
            return viewerGithubId !== undefined && targetClientData.followers.includes(viewerGithubId);
        case 'following':
            return viewerGithubId !== undefined && targetClientData.following.includes(viewerGithubId);
        case 'close-friends':
            if (!viewerGithubId || !targetClientData.githubId) {
                return false;
            }
            const closeFriends = database_1.dbService.getCloseFriends(targetClientData.githubId);
            return closeFriends.includes(viewerGithubId);
        default:
            return true;
    }
}
function filterUserData(clientData) {
    const filtered = {
        username: clientData.username,
        avatar: clientData.avatar,
        status: clientData.status,
        activity: clientData.activity,
        project: clientData.project,
        language: clientData.language
    };
    // Apply share preferences
    if (clientData.preferences) {
        if (!clientData.preferences.share_project) {
            filtered.project = '';
        }
        if (!clientData.preferences.share_language) {
            filtered.language = '';
        }
        if (!clientData.preferences.share_activity) {
            filtered.activity = 'Hidden';
        }
    }
    return filtered;
}
// Read-through cache for manual connections
function getCachedManualConnections(username) {
    return __awaiter(this, void 0, void 0, function* () {
        // Try Redis cache first
        if (redisService_1.redisService.connected) {
            const cached = yield redisService_1.redisService.getCachedFriendList(username);
            if (cached) {
                return cached;
            }
        }
        // Cache miss - query database and cache result
        const connections = database_1.dbService.getManualConnections(username);
        // Store in Redis cache
        if (redisService_1.redisService.connected) {
            yield redisService_1.redisService.cacheFriendList(username, connections);
        }
        return connections;
    });
}
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    // Rate limiting: connection attempts
    if (!rateLimiter_1.rateLimiter.checkConnectionLimit(clientIp)) {
        ws.close(1008, 'Rate limit exceeded');
        return;
    }
    console.log(`Client connected from ${clientIp}`);
    ws.on('message', (message) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            // Security: Enforce message size limit (16KB)
            if (message.toString().length > 16 * 1024) {
                console.warn(`Message too large from ${clientIp}`);
                ws.close(1009, 'Message too large');
                return;
            }
            const data = JSON.parse(message.toString());
            // Handle heartbeat messages first (high priority, no rate limiting)
            if (data.t === 'hb' || data.type === 'heartbeat') {
                const clientData = clients.get(ws);
                if (clientData) {
                    clientData.isAlive = true;
                    clientData.lastHeartbeat = Date.now();
                }
                // Echo back heartbeat acknowledgment
                ws.send(JSON.stringify({ t: 'hb', ts: data.ts, ack: true }));
                return;
            }
            const clientData = clients.get(ws);
            // Rate limiting: messages
            if (clientData && clientData.githubId) {
                if (!rateLimiter_1.rateLimiter.checkMessageLimit(clientData.githubId.toString())) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
                    return;
                }
            }
            if (data.type === 'login') {
                let newClientData;
                let isResumedSession = false;
                // Check for session resumption (graceful reconnection)
                if (data.resumeToken && redisService_1.redisService.connected) {
                    const resumedSession = yield redisService_1.redisService.getResumeToken(data.resumeToken);
                    if (resumedSession && resumedSession.username === data.username) {
                        console.log(`Session resumed for ${data.username}`);
                        isResumedSession = true;
                        // Session is restored - no need to notify friends of reconnection
                    }
                }
                if (data.token) {
                    const githubUser = yield validateGitHubToken(data.token);
                    if (githubUser) {
                        console.log(`GitHub user logged in: ${githubUser.login}`);
                        // Save/update user in database
                        database_1.dbService.upsertUser(githubUser.id, githubUser.login, githubUser.avatar_url);
                        // Save relationships
                        const relationships = [
                            ...githubUser.followers.map(id => ({ id, type: 'follower' })),
                            ...githubUser.following.map(id => ({ id, type: 'following' }))
                        ];
                        database_1.dbService.upsertRelationships(githubUser.id, relationships);
                        // Get user preferences
                        let preferences = database_1.dbService.getUserPreferences(githubUser.id);
                        // Sync visibility mode from client if provided
                        if (data.visibilityMode) {
                            database_1.dbService.updateUserPreferences(githubUser.id, {
                                visibility_mode: data.visibilityMode
                            });
                            preferences = database_1.dbService.getUserPreferences(githubUser.id);
                        }
                        newClientData = {
                            sessionId: data.sessionId || `session_${Date.now()}_${Math.random()}`,
                            githubId: githubUser.id,
                            username: githubUser.login,
                            avatar: githubUser.avatar_url,
                            followers: githubUser.followers,
                            following: githubUser.following,
                            status: 'Online',
                            activity: 'Idle',
                            project: '',
                            language: '',
                            preferences,
                            isAlive: true,
                            lastHeartbeat: Date.now()
                        };
                        // Check for friend matches
                        for (const [existingWs, existingClient] of clients.entries()) {
                            if (existingClient.githubId && existingClient.githubId !== githubUser.id) {
                                const isMutual = newClientData.followers.includes(existingClient.githubId) ||
                                    newClientData.following.includes(existingClient.githubId);
                                if (isMutual && existingWs.readyState === ws_1.WebSocket.OPEN) {
                                    // Check if existing user can see the new user
                                    if (canUserSee(existingClient.githubId, newClientData)) {
                                        existingWs.send(JSON.stringify({
                                            type: 'friendJoined',
                                            user: {
                                                username: newClientData.username,
                                                avatar: newClientData.avatar
                                            }
                                        }));
                                        console.log(`Notified ${existingClient.username} about ${newClientData.username}`);
                                    }
                                }
                            }
                        }
                    }
                    else {
                        newClientData = {
                            sessionId: data.sessionId || `session_${Date.now()}_${Math.random()}`,
                            username: data.username,
                            followers: [],
                            following: [],
                            status: 'Online',
                            activity: 'Idle',
                            project: '',
                            language: '',
                            isAlive: true,
                            lastHeartbeat: Date.now()
                        };
                    }
                }
                else {
                    newClientData = {
                        sessionId: data.sessionId || `session_${Date.now()}_${Math.random()}`,
                        username: data.username,
                        followers: [],
                        following: [],
                        status: 'Online',
                        activity: 'Idle',
                        project: '',
                        language: '',
                        isAlive: true,
                        lastHeartbeat: Date.now()
                    };
                }
                clients.set(ws, newClientData);
                // Issue a resume token for graceful reconnection
                if (redisService_1.redisService.connected) {
                    const resumeToken = crypto_1.default.randomUUID();
                    newClientData.resumeToken = resumeToken;
                    // Store session data for potential resumption
                    yield redisService_1.redisService.setResumeToken(resumeToken, {
                        userId: ((_a = newClientData.githubId) === null || _a === void 0 ? void 0 : _a.toString()) || newClientData.username,
                        username: newClientData.username,
                        githubId: newClientData.githubId,
                        subscribedChannels: [],
                        connectedAt: Date.now()
                    });
                    // Send resume token to client
                    ws.send(JSON.stringify({ t: 'token', token: resumeToken }));
                }
                // Only broadcast if this is a new session (not a resumed one)
                // This prevents "user online" flapping during brief disconnections
                if (!isResumedSession) {
                    scheduleBroadcast();
                }
            }
            else if (data.type === 'statusUpdate') {
                if (clientData) {
                    clientData.status = data.status || clientData.status;
                    clientData.activity = data.activity || clientData.activity;
                    clientData.project = data.project || clientData.project;
                    clientData.language = data.language || clientData.language;
                    // Publish delta update via Redis Pub/Sub (if available)
                    if (redisService_1.redisService.connected && !USE_LEGACY_BROADCAST) {
                        // Publish status change to user's presence channel
                        // Subscribers (friends) will receive only this user's update
                        yield redisService_1.redisService.publish(`presence:${clientData.username}`, {
                            t: 'u', // Delta update
                            id: clientData.username,
                            s: clientData.status,
                            a: clientData.activity,
                            p: ((_b = clientData.preferences) === null || _b === void 0 ? void 0 : _b.share_project) ? clientData.project : '',
                            l: ((_c = clientData.preferences) === null || _c === void 0 ? void 0 : _c.share_language) ? clientData.language : '',
                            ts: Date.now()
                        });
                        // Also update Redis presence
                        if (clientData.githubId) {
                            yield redisService_1.redisService.setUserOnline(clientData.githubId.toString(), {
                                username: clientData.username,
                                status: clientData.status,
                                activity: clientData.activity,
                                project: clientData.project,
                                language: clientData.language,
                                lastSeen: Date.now()
                            });
                        }
                    }
                    // Still do legacy broadcast for backward compatibility
                    scheduleBroadcast();
                }
            }
            else if (data.type === 'updatePreferences') {
                if (clientData && clientData.githubId) {
                    database_1.dbService.updateUserPreferences(clientData.githubId, data.preferences);
                    clientData.preferences = database_1.dbService.getUserPreferences(clientData.githubId);
                    ws.send(JSON.stringify({ type: 'preferencesUpdated', preferences: clientData.preferences }));
                    scheduleBroadcast(); // Re-broadcast with new privacy settings
                }
            }
            else if (data.type === 'createInvite') {
                if (clientData) {
                    const code = database_1.dbService.createInviteCode(clientData.username, 48); // 48 hours
                    ws.send(JSON.stringify({
                        type: 'inviteCreated',
                        code: code,
                        expiresIn: '48 hours'
                    }));
                    console.log(`Invite code created: ${code} by ${clientData.username}`);
                }
            }
            else if (data.type === 'acceptInvite') {
                if (clientData && data.code) {
                    const success = database_1.dbService.acceptInviteCode(data.code, clientData.username);
                    if (success) {
                        const invite = database_1.dbService.getInviteCode(data.code);
                        ws.send(JSON.stringify({
                            type: 'inviteAccepted',
                            success: true,
                            friendUsername: invite === null || invite === void 0 ? void 0 : invite.creator_username
                        }));
                        // Notify the creator
                        for (const [otherWs, otherClient] of clients.entries()) {
                            if (otherClient.username === (invite === null || invite === void 0 ? void 0 : invite.creator_username) && otherWs.readyState === ws_1.WebSocket.OPEN) {
                                otherWs.send(JSON.stringify({
                                    type: 'friendJoined',
                                    user: {
                                        username: clientData.username,
                                        avatar: clientData.avatar
                                    },
                                    via: 'invite'
                                }));
                            }
                        }
                        console.log(`Invite ${data.code} accepted by ${clientData.username}`);
                        // Invalidate Redis friend cache for both users
                        if (redisService_1.redisService.connected && (invite === null || invite === void 0 ? void 0 : invite.creator_username)) {
                            yield redisService_1.redisService.invalidateFriendCache(clientData.username);
                            yield redisService_1.redisService.invalidateFriendCache(invite.creator_username);
                        }
                        scheduleBroadcast(); // Refresh for both users
                    }
                    else {
                        ws.send(JSON.stringify({
                            type: 'inviteAccepted',
                            success: false,
                            error: 'Invalid, expired, or already used invite code'
                        }));
                    }
                }
            }
            else if (data.type === 'createAlias') {
                // Create username alias (guest -> GitHub)
                if (data.githubUsername && data.guestUsername && data.githubId) {
                    database_1.dbService.createAlias(data.githubUsername, data.guestUsername, data.githubId);
                    console.log(`Created alias: ${data.guestUsername} -> ${data.githubUsername}`);
                    ws.send(JSON.stringify({
                        type: 'aliasCreated',
                        success: true
                    }));
                }
            }
            else if (data.type === 'removeConnection') {
                // Remove manual connection
                if (clientData && data.username) {
                    const resolvedClient = database_1.dbService.resolveUsername(clientData.username);
                    const resolvedTarget = database_1.dbService.resolveUsername(data.username);
                    database_1.dbService.removeManualConnection(resolvedClient, resolvedTarget);
                    console.log(`Removed manual connection: ${resolvedClient} <-> ${resolvedTarget}`);
                    // Invalidate offline user cache to ensure the removed user doesn't appear
                    invalidateOfflineCache();
                    // Invalidate Redis friend cache for both users
                    if (redisService_1.redisService.connected) {
                        yield redisService_1.redisService.invalidateFriendCache(resolvedClient);
                        yield redisService_1.redisService.invalidateFriendCache(resolvedTarget);
                    }
                    ws.send(JSON.stringify({
                        type: 'connectionRemoved',
                        success: true,
                        username: data.username
                    }));
                    // Broadcast update to refresh user lists
                    scheduleBroadcast();
                }
            }
        }
        catch (e) {
            console.error('Error parsing message', e);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    }));
    ws.on('close', () => {
        const clientData = clients.get(ws);
        if (clientData) {
            const username = clientData.username;
            const githubId = clientData.githubId;
            // Fast path: Write to Redis immediately (if available)
            if (redisService_1.redisService.connected && githubId) {
                redisService_1.redisService.setLastSeen(githubId.toString(), Date.now());
                redisService_1.redisService.setUserOffline(githubId.toString());
            }
            // Also write to SQLite immediately for consistency
            // (In production, this could be batched, but for reliability we do both)
            if (githubId) {
                database_1.dbService.updateLastSeen(githubId);
            }
            console.log(`User ${username} disconnected`);
        }
        clients.delete(ws);
        // Broadcast immediately (debounced to 2 seconds)
        // This will now include the user as offline since last_seen was just updated
        scheduleBroadcast();
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
// --- Performance Optimizations ---
// 1. Broadcast Debouncing: Wait 2 seconds before broadcasting to batch updates
let broadcastTimer = null;
let broadcastPending = false;
function scheduleBroadcast() {
    if (broadcastTimer) {
        // Already scheduled, just mark as pending
        broadcastPending = true;
        return;
    }
    broadcastTimer = setTimeout(() => {
        broadcastUpdate();
        broadcastTimer = null;
        // If another broadcast was requested during debounce, schedule it
        if (broadcastPending) {
            broadcastPending = false;
            scheduleBroadcast();
        }
    }, 2000); // 2 second debounce
}
const offlineUserCache = new Map();
const OFFLINE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
// Clear the offline user cache (call when connections change)
function invalidateOfflineCache() {
    offlineUserCache.clear();
}
function getCachedOfflineUsers(githubId, followers, following) {
    const cached = offlineUserCache.get(githubId);
    // Return cached if still valid
    if (cached && Date.now() - cached.timestamp < OFFLINE_CACHE_TTL) {
        return cached.users;
    }
    // Fetch from DB
    const dbFollowers = database_1.dbService.getFollowers(githubId);
    const dbFollowing = database_1.dbService.getFollowing(githubId);
    const closeFriends = database_1.dbService.getCloseFriends(githubId);
    const allRelatedIds = [...new Set([...dbFollowers, ...dbFollowing, ...closeFriends])];
    const offlineUsers = [];
    for (const relatedId of allRelatedIds) {
        const dbUser = database_1.dbService.getUser(relatedId);
        if (dbUser) {
            const timeSinceLastSeen = Date.now() - dbUser.last_seen;
            if (timeSinceLastSeen < 7 * 24 * 60 * 60 * 1000) {
                offlineUsers.push({
                    username: dbUser.username,
                    avatar: dbUser.avatar,
                    status: 'Offline',
                    activity: 'Offline',
                    project: '',
                    language: '',
                    lastSeen: dbUser.last_seen
                });
            }
        }
    }
    // Cache the result
    offlineUserCache.set(githubId, { users: offlineUsers, timestamp: Date.now() });
    return offlineUsers;
}
// 3. Batch Database Writes: Don't write last_seen on every disconnect
const pendingLastSeenWrites = new Map();
function scheduleLastSeenUpdate(githubId) {
    pendingLastSeenWrites.set(githubId, Date.now());
}
// Flush pending writes every 30 seconds
setInterval(() => {
    if (pendingLastSeenWrites.size > 0) {
        console.log(`Flushing ${pendingLastSeenWrites.size} last_seen updates`);
        for (const [githubId, timestamp] of pendingLastSeenWrites) {
            database_1.dbService.updateLastSeen(githubId);
        }
        pendingLastSeenWrites.clear();
    }
}, 30000);
function broadcastUpdate() {
    // First, aggregate all sessions per user (handle multiple windows)
    const userSessions = new Map();
    for (const clientData of clients.values()) {
        const sessions = userSessions.get(clientData.username) || [];
        sessions.push(clientData);
        userSessions.set(clientData.username, sessions);
    }
    // Create aggregated user data (most active status wins)
    const aggregatedUsers = new Map();
    for (const [username, sessions] of userSessions.entries()) {
        // Pick the most "active" session
        const mostActive = sessions.reduce((prev, curr) => {
            // Priority: Debugging > Coding > Reading > Idle
            const activityPriority = {
                'Debugging': 4,
                'Coding': 3,
                'Reading': 2,
                'Idle': 1,
                'Hidden': 0
            };
            const prevPriority = activityPriority[prev.activity] || 0;
            const currPriority = activityPriority[curr.activity] || 0;
            return currPriority > prevPriority ? curr : prev;
        });
        aggregatedUsers.set(username, mostActive);
    }
    for (const [receiverWs, receiverData] of clients.entries()) {
        if (receiverWs.readyState !== ws_1.WebSocket.OPEN) {
            continue;
        }
        // Build user list visible to this receiver
        const visibleUsers = [];
        for (const clientData of aggregatedUsers.values()) {
            // Don't include self
            if (clientData.username === receiverData.username) {
                continue;
            }
            // Check privacy: can receiver see this user?
            // Include manual connections as well as GitHub relationships
            // Resolve usernames through aliases to handle guest->GitHub transitions
            const resolvedReceiver = database_1.dbService.resolveUsername(receiverData.username);
            const resolvedClient = database_1.dbService.resolveUsername(clientData.username);
            const isManuallyConnected = database_1.dbService.isManuallyConnected(resolvedReceiver, resolvedClient) ||
                database_1.dbService.isManuallyConnected(receiverData.username, clientData.username);
            if (isManuallyConnected || canUserSee(receiverData.githubId, clientData)) {
                visibleUsers.push(filterUserData(clientData));
            }
        }
        // Include recently disconnected users (offline with last seen)
        // Use cached offline users instead of querying DB every time
        if (receiverData.githubId) {
            const cachedOffline = getCachedOfflineUsers(receiverData.githubId, receiverData.followers, receiverData.following);
            // Filter out users who are already in visible (online) list
            for (const offlineUser of cachedOffline) {
                const alreadyVisible = visibleUsers.some(u => u.username === offlineUser.username);
                if (!alreadyVisible) {
                    visibleUsers.push(offlineUser);
                }
            }
        }
        // Also check manual connections for offline users
        if (receiverData.username) {
            const resolvedReceiver = database_1.dbService.resolveUsername(receiverData.username);
            const manualConnections = database_1.dbService.getManualConnections(resolvedReceiver);
            for (const connectedUsername of manualConnections) {
                // Skip if already visible
                if (visibleUsers.some(u => u.username === connectedUsername)) {
                    continue;
                }
                // Check if user is offline (not in current clients)
                const isOnline = Array.from(aggregatedUsers.values()).some(u => u.username === connectedUsername);
                if (!isOnline) {
                    // Try to get from database if they have a GitHub account
                    const resolvedUsername = database_1.dbService.resolveUsername(connectedUsername);
                    // Try to find user in database
                    const allUsers = database_1.dbService.getAllUsers();
                    const offlineUser = allUsers.find((u) => u.username === resolvedUsername || u.username === connectedUsername);
                    if (offlineUser) {
                        const timeSinceLastSeen = Date.now() - offlineUser.last_seen;
                        if (timeSinceLastSeen < 7 * 24 * 60 * 60 * 1000) {
                            visibleUsers.push({
                                username: offlineUser.username,
                                avatar: offlineUser.avatar || '',
                                status: 'Offline',
                                activity: 'Offline',
                                project: '',
                                language: '',
                                lastSeen: offlineUser.last_seen
                            });
                        }
                    }
                }
            }
        }
        receiverWs.send(JSON.stringify({
            type: 'userList',
            users: visibleUsers
        }));
    }
}
// --- Heartbeat System ---
// Application-level ping/pong to detect dead connections faster than TCP timeouts
const HEARTBEAT_INTERVAL = 30000; // Send ping every 30 seconds
const HEARTBEAT_TIMEOUT = 10000; // Consider dead if no response in 10 seconds
const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    for (const [ws, clientData] of clients.entries()) {
        // Check if client responded to last heartbeat
        if (!clientData.isAlive) {
            // Missed heartbeat - connection is dead
            console.log(`Heartbeat timeout for ${clientData.username}, terminating connection`);
            ws.terminate();
            continue;
        }
        // Mark as not alive, will be set back to true when pong received
        clientData.isAlive = false;
        // Send heartbeat ping
        if (ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(JSON.stringify({ t: 'hb', ts: now }));
        }
    }
}, HEARTBEAT_INTERVAL);
// --- Server Startup ---
function startServer() {
    return __awaiter(this, void 0, void 0, function* () {
        // Initialize Redis (optional - will fall back to legacy mode if unavailable)
        if (!USE_LEGACY_BROADCAST) {
            const redisConnected = yield redisService_1.redisService.connect();
            if (redisConnected) {
                console.log('Redis connected - using Pub/Sub mode');
            }
            else {
                console.log('Redis unavailable - falling back to legacy broadcast mode');
            }
        }
        else {
            console.log('Legacy broadcast mode enabled via USE_LEGACY_BROADCAST');
        }
        server.listen(PORT, () => {
            console.log(`WebSocket server started on port ${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`Heartbeat interval: ${HEARTBEAT_INTERVAL}ms`);
            console.log(`Mode: ${redisService_1.redisService.connected ? 'Redis Pub/Sub' : 'Legacy Broadcast'}`);
        });
    });
}
startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
// Graceful shutdown
process.on('SIGTERM', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('SIGTERM received, closing server...');
    clearInterval(heartbeatInterval);
    yield redisService_1.redisService.disconnect();
    wss.close(() => {
        database_1.dbService.close();
        process.exit(0);
    });
}));
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    console.log('SIGINT received, closing server...');
    clearInterval(heartbeatInterval);
    yield redisService_1.redisService.disconnect();
    wss.close(() => {
        database_1.dbService.close();
        process.exit(0);
    });
}));
