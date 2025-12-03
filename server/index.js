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
                        const preferences = database_1.dbService.getUserPreferences(githubUser.id);
                        newClientData = {
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
    for (const [receiverWs, receiverData] of clients.entries()) {
        if (receiverWs.readyState !== ws_1.WebSocket.OPEN) {
            continue;
        }
        // Build user list visible to this receiver
        const visibleUsers = [];
        for (const clientData of clients.values()) {
            // Don't include self
            if (clientData.username === receiverData.username) {
                continue;
            }
            // Check privacy: can receiver see this user?
            if (canUserSee(receiverData.githubId, clientData)) {
                visibleUsers.push(filterUserData(clientData));
            }
        }
        // Also include recently offline users from database
        if (receiverData.githubId) {
            const closeFriends = database_1.dbService.getCloseFriends(receiverData.githubId);
            const followers = database_1.dbService.getFollowers(receiverData.githubId);
            const following = database_1.dbService.getFollowing(receiverData.githubId);
            // Get offline users who are followers/following or close friends
            const relevantUserIds = [...new Set([...closeFriends, ...followers, ...following])];
            for (const userId of relevantUserIds) {
                const user = database_1.dbService.getUser(userId);
                if (user && !clients.has(receiverWs)) { // Only if not already online
                    const now = Date.now();
                    const timeSinceLastSeen = now - user.last_seen;
                    // Show offline users who were seen in the last 7 days
                    if (timeSinceLastSeen < 7 * 24 * 60 * 60 * 1000) {
                        visibleUsers.push({
                            username: user.username,
                            avatar: user.avatar,
                            status: 'Offline',
                            activity: 'Offline',
                            project: '',
                            language: '',
                            lastSeen: user.last_seen
                        });
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
