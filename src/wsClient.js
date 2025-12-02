"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WsClient = void 0;
const ws_1 = __importDefault(require("ws"));
class WsClient {
    constructor(onUserListUpdate) {
        this.ws = null;
        this.onUserListUpdate = onUserListUpdate;
    }
    connect(username) {
        this.ws = new ws_1.default('ws://localhost:8080');
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
            }
            catch (e) {
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
    send(data) {
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }
    updateStatus(status) {
        this.send(Object.assign({ type: 'statusUpdate' }, status));
    }
}
exports.WsClient = WsClient;
