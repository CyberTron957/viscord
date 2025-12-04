import { WebSocketServer, WebSocket } from 'ws';
import { Octokit } from '@octokit/rest';
import { dbService, UserPreferences, UserRecord } from './database';
import { rateLimiter } from './rateLimiter';
import http from 'http';

const PORT = parseInt(process.env.PORT || '8080');
const server = http.createServer();
const wss = new WebSocketServer({ server });

interface ClientData {
    sessionId: string;  // Unique per window
    githubId?: number;
    username: string;
    avatar?: string;
    followers: number[];
    following: number[];
    status: string;
    activity: string;
    project: string;
    language: string;
    preferences?: UserPreferences;
}

const clients = new Map<WebSocket, ClientData>();

async function validateGitHubToken(token: string): Promise<{
    id: number;
    login: string;
    avatar_url: string;
    followers: number[];
    following: number[];
} | null> {
    try {
        const octokit = new Octokit({ auth: token });
        const { data } = await octokit.users.getAuthenticated();

        const followersResponse = await octokit.users.listFollowersForAuthenticatedUser({ per_page: 100 });
        const followingResponse = await octokit.users.listFollowedByAuthenticatedUser({ per_page: 100 });

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
    } catch (error) {
        console.error('GitHub token validation failed:', error);
        return null;
    }
}

function canUserSee(viewerGithubId: number | undefined, targetClientData: ClientData): boolean {
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
            const closeFriends = dbService.getCloseFriends(targetClientData.githubId);
            return closeFriends.includes(viewerGithubId);

        default:
            return true;
    }
}

function filterUserData(clientData: ClientData): any {
    const filtered: any = {
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

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress || 'unknown';

    // Rate limiting: connection attempts
    if (!rateLimiter.checkConnectionLimit(clientIp)) {
        ws.close(1008, 'Rate limit exceeded');
        return;
    }

    console.log(`Client connected from ${clientIp}`);

    ws.on('message', async (message) => {
        try {
            // Security: Enforce message size limit (16KB)
            if (message.toString().length > 16 * 1024) {
                console.warn(`Message too large from ${clientIp}`);
                ws.close(1009, 'Message too large');
                return;
            }

            const data = JSON.parse(message.toString());
            const clientData = clients.get(ws);

            // Rate limiting: messages
            if (clientData && clientData.githubId) {
                if (!rateLimiter.checkMessageLimit(clientData.githubId.toString())) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
                    return;
                }
            }

            if (data.type === 'login') {
                let newClientData: ClientData;

                if (data.token) {
                    const githubUser = await validateGitHubToken(data.token);

                    if (githubUser) {
                        console.log(`GitHub user logged in: ${githubUser.login}`);

                        // Save/update user in database
                        dbService.upsertUser(githubUser.id, githubUser.login, githubUser.avatar_url);

                        // Save relationships
                        const relationships = [
                            ...githubUser.followers.map(id => ({ id, type: 'follower' as const })),
                            ...githubUser.following.map(id => ({ id, type: 'following' as const }))
                        ];
                        dbService.upsertRelationships(githubUser.id, relationships);

                        // Get user preferences
                        let preferences = dbService.getUserPreferences(githubUser.id);

                        // Sync visibility mode from client if provided
                        if (data.visibilityMode) {
                            dbService.updateUserPreferences(githubUser.id, {
                                visibility_mode: data.visibilityMode
                            });
                            preferences = dbService.getUserPreferences(githubUser.id);
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
                            preferences
                        };

                        // Check for friend matches
                        for (const [existingWs, existingClient] of clients.entries()) {
                            if (existingClient.githubId && existingClient.githubId !== githubUser.id) {
                                const isMutual =
                                    newClientData.followers.includes(existingClient.githubId) ||
                                    newClientData.following.includes(existingClient.githubId);

                                if (isMutual && existingWs.readyState === WebSocket.OPEN) {
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
                    } else {
                        newClientData = {
                            sessionId: data.sessionId || `session_${Date.now()}_${Math.random()}`,
                            username: data.username,
                            followers: [],
                            following: [],
                            status: 'Online',
                            activity: 'Idle',
                            project: '',
                            language: ''
                        };
                    }
                } else {
                    newClientData = {
                        sessionId: data.sessionId || `session_${Date.now()}_${Math.random()}`,
                        username: data.username,
                        followers: [],
                        following: [],
                        status: 'Online',
                        activity: 'Idle',
                        project: '',
                        language: ''
                    };
                }

                clients.set(ws, newClientData);
                scheduleBroadcast();

            } else if (data.type === 'statusUpdate') {
                if (clientData) {
                    clientData.status = data.status || clientData.status;
                    clientData.activity = data.activity || clientData.activity;
                    clientData.project = data.project || clientData.project;
                    clientData.language = data.language || clientData.language;
                    scheduleBroadcast();
                }
            } else if (data.type === 'updatePreferences') {
                if (clientData && clientData.githubId) {
                    dbService.updateUserPreferences(clientData.githubId, data.preferences);
                    clientData.preferences = dbService.getUserPreferences(clientData.githubId);
                    ws.send(JSON.stringify({ type: 'preferencesUpdated', preferences: clientData.preferences }));
                    scheduleBroadcast(); // Re-broadcast with new privacy settings
                }
            } else if (data.type === 'createInvite') {
                if (clientData) {
                    const code = dbService.createInviteCode(clientData.username, 48); // 48 hours
                    ws.send(JSON.stringify({
                        type: 'inviteCreated',
                        code: code,
                        expiresIn: '48 hours'
                    }));
                    console.log(`Invite code created: ${code} by ${clientData.username}`);
                }
            } else if (data.type === 'acceptInvite') {
                if (clientData && data.code) {
                    const success = dbService.acceptInviteCode(data.code, clientData.username);

                    if (success) {
                        const invite = dbService.getInviteCode(data.code);

                        ws.send(JSON.stringify({
                            type: 'inviteAccepted',
                            success: true,
                            friendUsername: invite?.creator_username
                        }));

                        // Notify the creator
                        for (const [otherWs, otherClient] of clients.entries()) {
                            if (otherClient.username === invite?.creator_username && otherWs.readyState === WebSocket.OPEN) {
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
                        scheduleBroadcast(); // Refresh for both users
                    } else {
                        ws.send(JSON.stringify({
                            type: 'inviteAccepted',
                            success: false,
                            error: 'Invalid, expired, or already used invite code'
                        }));
                    }
                }
            } else if (data.type === 'createAlias') {
                // Create username alias (guest -> GitHub)
                if (data.githubUsername && data.guestUsername && data.githubId) {
                    dbService.createAlias(data.githubUsername, data.guestUsername, data.githubId);
                    console.log(`Created alias: ${data.guestUsername} -> ${data.githubUsername}`);

                    ws.send(JSON.stringify({
                        type: 'aliasCreated',
                        success: true
                    }));
                }
            } else if (data.type === 'removeConnection') {
                // Remove manual connection
                if (clientData && data.username) {
                    const resolvedClient = dbService.resolveUsername(clientData.username);
                    const resolvedTarget = dbService.resolveUsername(data.username);

                    dbService.removeManualConnection(resolvedClient, resolvedTarget);
                    console.log(`Removed manual connection: ${resolvedClient} <-> ${resolvedTarget}`);

                    ws.send(JSON.stringify({
                        type: 'connectionRemoved',
                        success: true,
                        username: data.username
                    }));

                    // Broadcast update to refresh user lists
                    scheduleBroadcast();
                }
            }
        } catch (e) {
            console.error('Error parsing message', e);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    });

    ws.on('close', () => {
        const clientData = clients.get(ws);
        if (clientData && clientData.githubId) {
            // Schedule batched write instead of immediate
            scheduleLastSeenUpdate(clientData.githubId);
            console.log(`User ${clientData.username} disconnected`);
        }
        clients.delete(ws);
        scheduleBroadcast();
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// --- Performance Optimizations ---

// 1. Broadcast Debouncing: Wait 2 seconds before broadcasting to batch updates
let broadcastTimer: NodeJS.Timeout | null = null;
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

// 2. Offline User Cache: Cache DB queries to avoid repeated lookups
interface OfflineUserCache {
    users: any[];
    timestamp: number;
}

const offlineUserCache = new Map<number, OfflineUserCache>();
const OFFLINE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCachedOfflineUsers(githubId: number, followers: number[], following: number[]): any[] {
    const cached = offlineUserCache.get(githubId);

    // Return cached if still valid
    if (cached && Date.now() - cached.timestamp < OFFLINE_CACHE_TTL) {
        return cached.users;
    }

    // Fetch from DB
    const dbFollowers = dbService.getFollowers(githubId);
    const dbFollowing = dbService.getFollowing(githubId);
    const closeFriends = dbService.getCloseFriends(githubId);

    const allRelatedIds = [...new Set([...dbFollowers, ...dbFollowing, ...closeFriends])];
    const offlineUsers: any[] = [];

    for (const relatedId of allRelatedIds) {
        const dbUser = dbService.getUser(relatedId);
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
const pendingLastSeenWrites = new Map<number, number>();

function scheduleLastSeenUpdate(githubId: number) {
    pendingLastSeenWrites.set(githubId, Date.now());
}

// Flush pending writes every 30 seconds
setInterval(() => {
    if (pendingLastSeenWrites.size > 0) {
        console.log(`Flushing ${pendingLastSeenWrites.size} last_seen updates`);
        for (const [githubId, timestamp] of pendingLastSeenWrites) {
            dbService.updateLastSeen(githubId);
        }
        pendingLastSeenWrites.clear();
    }
}, 30000);

function broadcastUpdate() {
    // First, aggregate all sessions per user (handle multiple windows)
    const userSessions = new Map<string, ClientData[]>();

    for (const clientData of clients.values()) {
        const sessions = userSessions.get(clientData.username) || [];
        sessions.push(clientData);
        userSessions.set(clientData.username, sessions);
    }

    // Create aggregated user data (most active status wins)
    const aggregatedUsers = new Map<string, ClientData>();

    for (const [username, sessions] of userSessions.entries()) {
        // Pick the most "active" session
        const mostActive = sessions.reduce((prev, curr) => {
            // Priority: Debugging > Coding > Reading > Idle
            const activityPriority: Record<string, number> = {
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
        if (receiverWs.readyState !== WebSocket.OPEN) {
            continue;
        }

        // Build user list visible to this receiver
        const visibleUsers: any[] = [];

        for (const clientData of aggregatedUsers.values()) {
            // Don't include self
            if (clientData.username === receiverData.username) {
                continue;
            }

            // Check privacy: can receiver see this user?
            // Include manual connections as well as GitHub relationships
            // Resolve usernames through aliases to handle guest->GitHub transitions
            const resolvedReceiver = dbService.resolveUsername(receiverData.username);
            const resolvedClient = dbService.resolveUsername(clientData.username);

            const isManuallyConnected =
                dbService.isManuallyConnected(resolvedReceiver, resolvedClient) ||
                dbService.isManuallyConnected(receiverData.username, clientData.username);

            if (isManuallyConnected || canUserSee(receiverData.githubId, clientData)) {
                visibleUsers.push(filterUserData(clientData));
            }
        }

        // Include recently disconnected users (offline with last seen)
        // Use cached offline users instead of querying DB every time
        if (receiverData.githubId) {
            const cachedOffline = getCachedOfflineUsers(
                receiverData.githubId,
                receiverData.followers,
                receiverData.following
            );

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
            const resolvedReceiver = dbService.resolveUsername(receiverData.username);
            const manualConnections = dbService.getManualConnections(resolvedReceiver);

            for (const connectedUsername of manualConnections) {
                // Skip if already visible
                if (visibleUsers.some(u => u.username === connectedUsername)) {
                    continue;
                }

                // Check if user is offline (not in current clients)
                const isOnline = Array.from(aggregatedUsers.values()).some(u => u.username === connectedUsername);

                if (!isOnline) {
                    // Try to get from database if they have a GitHub account
                    const resolvedUsername = dbService.resolveUsername(connectedUsername);

                    // Try to find user in database
                    const allUsers = dbService.getAllUsers();
                    const offlineUser = allUsers.find((u: UserRecord) => u.username === resolvedUsername || u.username === connectedUsername);

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


server.listen(PORT, () => {
    console.log(`WebSocket server started on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    wss.close(() => {
        dbService.close();
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    wss.close(() => {
        dbService.close();
        process.exit(0);
    });
});
