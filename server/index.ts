import { WebSocketServer, WebSocket } from 'ws';
import { Octokit } from '@octokit/rest';

const wss = new WebSocketServer({ port: 8080 });

interface ClientData {
    githubId?: number;
    username: string;
    avatar?: string;
    followers: number[];  // GitHub IDs
    following: number[];  // GitHub IDs
    status: string;
    activity: string;
    project: string;
    language: string;
}

const clients = new Map<WebSocket, ClientData>();
const registeredUsers = new Map<string, ClientData>(); // username -> ClientData

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

        // Fetch followers and following
        const followersResponse = await octokit.users.listFollowersForAuthenticatedUser({ per_page: 100 });
        const followingResponse = await octokit.users.listFollowedByAuthenticatedUser({ per_page: 100 });

        return {
            id: data.id,
            login: data.login,
            avatar_url: data.avatar_url,
            followers: followersResponse.data.map(u => u.id),
            following: followingResponse.data.map(u => u.id)
        };
    } catch (error) {
        console.error('GitHub token validation failed:', error);
        return null;
    }
}

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'login') {
                let clientData: ClientData;

                if (data.token) {
                    // Validate GitHub token
                    const githubUser = await validateGitHubToken(data.token);

                    if (githubUser) {
                        console.log(`New GitHub user registered: ${githubUser.login}`);

                        clientData = {
                            githubId: githubUser.id,
                            username: githubUser.login,
                            avatar: githubUser.avatar_url,
                            followers: githubUser.followers || [],
                            following: githubUser.following || [],
                            status: 'Online',
                            activity: 'Idle',
                            project: '',
                            language: ''
                        };

                        // Check for mutual followers/following
                        for (const [existingWs, existingClient] of clients.entries()) {
                            if (existingClient.githubId) {
                                const isMutual =
                                    clientData.followers.includes(existingClient.githubId) ||
                                    clientData.following.includes(existingClient.githubId);

                                if (isMutual && existingWs.readyState === WebSocket.OPEN) {
                                    existingWs.send(JSON.stringify({
                                        type: 'friendJoined',
                                        user: {
                                            username: clientData.username,
                                            avatar: clientData.avatar
                                        }
                                    }));
                                    console.log(`Auto-matched GitHub friend: ${existingClient.username} <-> ${clientData.username}`);
                                }
                            }
                        }
                    } else {
                        console.log('Invalid GitHub token, falling back to username');
                        clientData = {
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
                    // No token, just username
                    clientData = {
                        username: data.username,
                        followers: [],
                        following: [],
                        status: 'Online',
                        activity: 'Idle',
                        project: '',
                        language: ''
                    };
                }

                clients.set(ws, clientData);
                registeredUsers.set(clientData.username, clientData);
                broadcastUpdate();
            } else if (data.type === 'statusUpdate') {
                const client = clients.get(ws);
                if (client) {
                    client.status = data.status || client.status;
                    client.activity = data.activity || client.activity;
                    client.project = data.project || client.project;
                    client.language = data.language || client.language;
                    broadcastUpdate();
                }
            }
        } catch (e) {
            console.error('Error parsing message', e);
        }
    });

    ws.on('close', () => {
        const clientData = clients.get(ws);
        if (clientData) {
            registeredUsers.delete(clientData.username);
        }
        clients.delete(ws);
        broadcastUpdate();
        console.log('Client disconnected');
    });
});

function broadcastUpdate() {
    const userList = Array.from(clients.values()).map(client => ({
        username: client.username,
        avatar: client.avatar,
        status: client.status,
        activity: client.activity,
        project: client.project,
        language: client.language
    }));

    const message = JSON.stringify({
        type: 'userList',
        users: userList
    });

    for (const client of clients.keys()) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

console.log('WebSocket server started on port 8080');
