import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

interface ClientData {
    username: string;
    status: string;
    activity: string;
    project: string;
    language: string;
}

const clients = new Map<WebSocket, ClientData>();

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());

            if (data.type === 'login') {
                clients.set(ws, {
                    username: data.username,
                    status: 'Online',
                    activity: 'Idle',
                    project: '',
                    language: ''
                });
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
        clients.delete(ws);
        broadcastUpdate();
        console.log('Client disconnected');
    });
});

function broadcastUpdate() {
    const userList = Array.from(clients.values());
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
