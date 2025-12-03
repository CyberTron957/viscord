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
const ws_1 = __importDefault(require("ws"));
// Mock client with queueing logic simulation
class MockClient {
    constructor(username) {
        this.ws = null;
        this.messages = [];
        this.messageQueue = [];
        this.isConnected = false;
        this.username = username;
    }
    // Simulate connecting LATER
    connectLater() {
        return __awaiter(this, void 0, void 0, function* () {
            this.ws = new ws_1.default('ws://localhost:8080');
            this.ws.on('open', () => {
                this.isConnected = true;
                // Flush queue
                while (this.messageQueue.length > 0) {
                    const data = this.messageQueue.shift();
                    this.ws.send(JSON.stringify(data));
                }
            });
            this.ws.on('message', (data) => {
                this.messages.push(JSON.parse(data.toString()));
            });
        });
    }
    send(data) {
        if (this.isConnected && this.ws) {
            this.ws.send(JSON.stringify(data));
        }
        else {
            console.log(`Queueing message for ${this.username}:`, data.type);
            this.messageQueue.push(data);
        }
    }
    close() {
        if (this.ws)
            this.ws.close();
    }
}
function runTest() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Starting Invite Queueing Test...');
        // Scenario: User clicks invite link BEFORE connecting
        const userNew = new MockClient('UserNew');
        // 1. Queue Login and Redeem Invite
        userNew.send({ type: 'login', username: 'UserNew' });
        userNew.send({ type: 'redeemInvite', code: 'DUMMY_CODE' }); // We need a valid code, but let's see if it sends
        // 2. Connect
        console.log('Connecting now...');
        yield userNew.connectLater();
        // Wait for connection and flush
        yield new Promise(r => setTimeout(r, 1000));
        // Verify messages were sent? We can't easily verify what server received without server logs or response.
        // But we can check if we get a response.
        // Since 'DUMMY_CODE' is invalid, we won't get 'inviteRedeemed'.
        // But if we get 'friendList' (from login), it means login was sent and processed.
        const friendListMsg = userNew.messages.find(m => m.type === 'friendList');
        if (!friendListMsg)
            throw new Error('Did not receive friendList - Login message might not have been sent/processed');
        console.log('Received friendList, Login successful.');
        userNew.close();
        console.log('Queueing Test Passed');
        process.exit(0);
    });
}
runTest().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
