import WebSocket from 'ws';

export interface UserStatus {
    username: string;
    status: string;
    activity: string;
    project: string;
    language: string;
}

export class WsClient {
    private ws: WebSocket | null = null;
    private onUserListUpdate: (users: UserStatus[]) => void;

    constructor(onUserListUpdate: (users: UserStatus[]) => void) {
        this.onUserListUpdate = onUserListUpdate;
    }

    connect(username: string) {
        this.ws = new WebSocket('ws://localhost:8080');

        this.ws.on('open', () => {
            console.log('Connected to WebSocket server');
            this.send({
                type: 'login',
                username: username
            });
        });

        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.type === 'userList') {
                    this.onUserListUpdate(message.users);
                }
            } catch (e) {
                console.error('Error parsing message', e);
            }
        });

        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        this.ws.on('close', () => {
            console.log('Disconnected from WebSocket server');
        });
    }

    send(data: any) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    updateStatus(status: Partial<UserStatus>) {
        this.send({
            type: 'statusUpdate',
            ...status
        });
    }
}
