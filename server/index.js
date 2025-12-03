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
const http_1 = __importDefault(require("http"));
const PORT = parseInt(process.env.PORT || '8080');
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
            return {
                id: data.id,
                login: data.login,
                avatar_url: data.avatar_url,
                followers: followersResponse.data.map(u => u.id),
                following: followingResponse.data.map(u => u.id)
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
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress || 'unknown';
    // Rate limiting: connection attempts
    if (!rateLimiter_1.rateLimiter.checkConnectionLimit(clientIp)) {
        ws.close(1008, 'Rate limit exceeded');
        return;
    }
    console.log(`Client connected from ${clientIp}`);
    ws.on('message', (message) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const data = JSON.parse(message.toString());
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
                            preferences
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
                            language: ''
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
                        language: ''
                    };
                }
                clients.set(ws, newClientData);
                broadcastUpdate();
            }
            else if (data.type === 'statusUpdate') {
                if (clientData) {
                    clientData.status = data.status || clientData.status;
                    clientData.activity = data.activity || clientData.activity;
                    clientData.project = data.project || clientData.project;
                    clientData.language = data.language || clientData.language;
                    broadcastUpdate();
                }
            }
            else if (data.type === 'updatePreferences') {
                if (clientData && clientData.githubId) {
                    database_1.dbService.updateUserPreferences(clientData.githubId, data.preferences);
                    clientData.preferences = database_1.dbService.getUserPreferences(clientData.githubId);
                    ws.send(JSON.stringify({ type: 'preferencesUpdated', preferences: clientData.preferences }));
                    broadcastUpdate(); // Re-broadcast with new privacy settings
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
                        broadcastUpdate(); // Refresh for both users
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
        }
        catch (e) {
            console.error('Error parsing message', e);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
        }
    }));
    ws.on('close', () => {
        const clientData = clients.get(ws);
        if (clientData && clientData.githubId) {
            database_1.dbService.updateLastSeen(clientData.githubId);
            console.log(`User ${clientData.username} disconnected`);
        }
        clients.delete(ws);
        broadcastUpdate();
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
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
            const isManuallyConnected = database_1.dbService.isManuallyConnected(receiverData.username, clientData.username);
            if (isManuallyConnected || canUserSee(receiverData.githubId, clientData)) {
                visibleUsers.push(filterUserData(clientData));
            }
        }
        // Include recently disconnected users (offline with last seen)
        for (const [username, userData] of Object.entries(Array.from(clients.values()).reduce((acc, c) => {
            acc[c.username] = c;
            return acc;
        }, {}))) {
            // Skip if already in visible users
            if (visibleUsers.some(u => u.username === username)) {
                continue;
            }
            // Check if this offline user should be visible to receiver
            if (receiverData.githubId && userData.githubId) {
                const isFollower = receiverData.followers.includes(userData.githubId);
                const isFollowing = receiverData.following.includes(userData.githubId);
                const isCloseFriend = database_1.dbService.getCloseFriends(receiverData.githubId).includes(userData.githubId);
                if (isFollower || isFollowing || isCloseFriend) {
                    // Get from database for last seen
                    const dbUser = database_1.dbService.getUser(userData.githubId);
                    if (dbUser) {
                        const timeSinceLastSeen = Date.now() - dbUser.last_seen;
                        // Show if seen in last 7 days
                        if (timeSinceLastSeen < 7 * 24 * 60 * 60 * 1000) {
                            visibleUsers.push({
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
        database_1.dbService.close();
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    wss.close(() => {
        database_1.dbService.close();
        process.exit(0);
    });
});
