import WebSocket from 'ws';

export interface UserStatus {
    username: string;
    status: string;
    activity: string;
    project: string;
    language: string;
    lastSeen?: number;
}

export class WsClient {
    private ws: WebSocket | null = null;
    private onUserListUpdate: (users: UserStatus[]) => void;
    private username: string = '';
    private token: string | undefined;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private isIntentionallyClosed = false;
    private lastSentStatus: string = ''; // Track last sent status to avoid duplicates
    private sessionId: string; // Unique ID for this VS Code window

    constructor(onUserListUpdate: (users: UserStatus[]) => void) {
        this.onUserListUpdate = onUserListUpdate;
        // Generate unique session ID for this window
        this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    connect(username: string, token?: string) {
        this.username = username;
        this.token = token;
        this.isIntentionallyClosed = false;
        this.attemptConnection();
    }

    private attemptConnection() {
        try {
            this.ws = new WebSocket('ws://localhost:8080');

            this.ws.on('open', () => {
                console.log('Connected to WebSocket server');
                this.reconnectAttempts = 0; // Reset on successful connection

                // Get visibility mode from VS Code settings
                const vscode = require('vscode');
                const config = vscode.workspace.getConfiguration('vscode-social-presence');
                const visibilityMode = config.get('visibilityMode', 'everyone');

                this.send({
                    type: 'login',
                    username: this.username,
                    token: this.token,
                    visibilityMode: visibilityMode,
                    sessionId: this.sessionId
                });
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'userList') {
                        this.onUserListUpdate(message.users);
                    } else if (message.type === 'friendJoined') {
                        // Handle friend joined notification
                        console.log('Friend joined:', message.user);
                        // Notification removed as per user request
                    } else if (message.type === 'inviteCreated') {
                        const vscode = require('vscode');
                        const inviteLink = `Invite Code: ${message.code}`;
                        vscode.window.showInformationMessage(
                            `${inviteLink} (expires in ${message.expiresIn})`,
                            'Copy Code'
                        ).then((selection: string | undefined) => {
                            if (selection === 'Copy Code') {
                                vscode.env.clipboard.writeText(message.code);
                                vscode.window.showInformationMessage('Invite code copied to clipboard!');
                            }
                        });
                    } else if (message.type === 'inviteAccepted') {
                        const vscode = require('vscode');
                        if (message.success) {
                            vscode.window.showInformationMessage(
                                `Successfully connected with ${message.friendUsername}!`
                            );
                        } else {
                            vscode.window.showErrorMessage(
                                message.error || 'Failed to accept invite code'
                            );
                        }
                    }
                } catch (e) {
                    console.error('Error parsing message', e);
                }
            });

            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error);
            });

            this.ws.on('close', (code, reason) => {
                console.log(`Disconnected from WebSocket server (code: ${code}, reason: ${reason})`);

                // Only reconnect if not intentionally closed
                if (!this.isIntentionallyClosed) {
                    this.scheduleReconnect();
                }
            });
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached. Giving up.');
            return;
        }

        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
        this.reconnectAttempts++;

        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        this.reconnectTimeout = setTimeout(() => {
            this.attemptConnection();
        }, delay);
    }

    send(data: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('WebSocket not connected, cannot send message');
        }
    }

    updateStatus(status: Partial<UserStatus>) {
        const statusString = JSON.stringify(status);

        // Only send if status has actually changed
        if (statusString === this.lastSentStatus) {
            return; // Skip duplicate updates
        }

        this.lastSentStatus = statusString;

        this.send({
            type: 'statusUpdate',
            ...status
        });
    }

    disconnect() {
        this.isIntentionallyClosed = true;

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
