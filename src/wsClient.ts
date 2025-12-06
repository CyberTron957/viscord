import WebSocket from 'ws';
import * as vscode from 'vscode';

export interface UserStatus {
    username: string;
    status: string;
    activity: string;
    project: string;
    language: string;
    lastSeen?: number;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class WsClient {
    private ws: WebSocket | null = null;
    private onUserListUpdate: (users: UserStatus[]) => void;
    private onConnectionStatusChange: (status: ConnectionStatus) => void;
    private username: string = '';
    private token: string | undefined;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private isIntentionallyClosed = false;
    private lastSentStatus: string = '';
    private sessionId: string;
    private _connectionStatus: ConnectionStatus = 'disconnected';

    constructor(
        onUserListUpdate: (users: UserStatus[]) => void,
        onConnectionStatusChange?: (status: ConnectionStatus) => void
    ) {
        this.onUserListUpdate = onUserListUpdate;
        this.onConnectionStatusChange = onConnectionStatusChange || (() => { });
        this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    get connectionStatus(): ConnectionStatus {
        return this._connectionStatus;
    }

    private setConnectionStatus(status: ConnectionStatus) {
        this._connectionStatus = status;
        this.onConnectionStatusChange(status);
    }

    connect(username: string, token?: string) {
        this.username = username;
        this.token = token;
        this.isIntentionallyClosed = false;
        this.reconnectAttempts = 0;
        this.attemptConnection();
    }

    reconnect() {
        // Force a reconnection attempt
        this.isIntentionallyClosed = false;
        this.reconnectAttempts = 0;

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        this.attemptConnection();
    }

    private attemptConnection() {
        if (!this.username) {
            console.warn('Cannot connect without username');
            this.setConnectionStatus('error');
            return;
        }

        this.setConnectionStatus('connecting');

        try {
            // Get WebSocket URL from settings
            const config = vscode.workspace.getConfiguration('vscode-viscord');
            const useCustomServer = config.get<boolean>('useCustomServer', false);
            const customServerUrl = config.get<string>('customServerUrl', 'ws://localhost:8080');

            // Use official production server by default, or custom URL if enabled
            const serverUrl = useCustomServer ? customServerUrl : 'wss://viscord.bellnexx.com';

            console.log(`Connecting to WebSocket server: ${serverUrl}`);
            this.ws = new WebSocket(serverUrl);

            this.ws.on('open', () => {
                console.log('Connected to WebSocket server');
                this.reconnectAttempts = 0;
                this.setConnectionStatus('connected');

                const config = vscode.workspace.getConfiguration('vscode-viscord');
                const visibilityMode = config.get<string>('visibilityMode', 'everyone');

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
                        console.log('Friend joined:', message.user);
                    } else if (message.type === 'inviteCreated') {
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
                this.setConnectionStatus('error');
            });

            this.ws.on('close', (code, reason) => {
                console.log(`Disconnected from WebSocket server (code: ${code}, reason: ${reason})`);
                this.setConnectionStatus('disconnected');

                if (!this.isIntentionallyClosed) {
                    this.scheduleReconnect();
                }
            });
        } catch (error) {
            console.error('Failed to create WebSocket connection:', error);
            this.setConnectionStatus('error');
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached. Giving up.');
            this.setConnectionStatus('error');
            return;
        }

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

        if (statusString === this.lastSentStatus) {
            return;
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

        this.setConnectionStatus('disconnected');
    }
}
