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
// Mock client to simulate interactions
class MockClient {
    constructor(username) {
        this.messages = [];
        this.onMessage = null;
        this.username = username;
        this.ws = new ws_1.default('ws://localhost:8080');
        this.ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            this.messages.push(msg);
            if (this.onMessage)
                this.onMessage(msg);
        });
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve) => {
                this.ws.on('open', () => {
                    this.ws.send(JSON.stringify({ type: 'login', username: this.username }));
                    resolve();
                });
            });
        });
    }
    connectWithGithub(token) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve) => {
                this.ws.on('open', () => {
                    this.ws.send(JSON.stringify({ type: 'loginWithGithub', token: token }));
                    resolve();
                });
            });
        });
    }
    createInvite() {
        return new Promise((resolve) => {
            this.onMessage = (msg) => {
                if (msg.type === 'inviteCreated') {
                    resolve(msg.code);
                }
            };
            this.ws.send(JSON.stringify({ type: 'createInvite' }));
        });
    }
    redeemInvite(code) {
        return new Promise((resolve) => {
            this.onMessage = (msg) => {
                if (msg.type === 'inviteRedeemed') {
                    resolve(msg.friend);
                }
            };
            this.ws.send(JSON.stringify({ type: 'redeemInvite', code }));
        });
    }
    waitForFriendList() {
        return new Promise((resolve) => {
            const check = () => {
                const msg = this.messages.find(m => m.type === 'friendList');
                if (msg)
                    resolve(msg.friends);
                else
                    setTimeout(check, 100);
            };
            check();
        });
    }
    close() {
        this.ws.close();
    }
}
function runTest() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        console.log('Starting Auth Integration Test...');
        // 1. Test Invite Flow (Local Users)
        console.log('Test 1: Invite Flow (Local Users)');
        const userA = new MockClient('UserA');
        const userB = new MockClient('UserB');
        yield userA.connect();
        yield userB.connect();
        const code = yield userA.createInvite();
        console.log(`UserA created invite code: ${code}`);
        const friendName = yield userB.redeemInvite(code);
        console.log(`UserB redeemed invite, added friend: ${friendName}`);
        if (friendName !== 'UserA')
            throw new Error('Friend name mismatch');
        // Verify UserA sees UserB
        // Wait a bit for broadcast
        yield new Promise(r => setTimeout(r, 500));
        // In real app, UserA gets update via broadcast. MockClient stores messages.
        const userAFriends = userA.messages.filter(m => m.type === 'friendList').pop().friends;
        console.log('UserA friends:', userAFriends.map((f) => f.username));
        if (!userAFriends.find((f) => f.username === 'UserB'))
            throw new Error('UserA did not see UserB');
        userA.close();
        userB.close();
        console.log('Test 1 Passed');
        // 2. Test Offline Status
        console.log('Test 2: Offline Status');
        // UserA is offline now. UserB connects. UserB should see UserA as offline.
        const userB2 = new MockClient('UserB');
        yield userB2.connect();
        // Wait for initial friend list
        yield new Promise(r => setTimeout(r, 1000));
        const friends = (_a = userB2.messages.find(m => m.type === 'friendList')) === null || _a === void 0 ? void 0 : _a.friends;
        console.log('UserB2 friends:', friends);
        const userAStatus = friends.find((f) => f.username === 'UserA');
        if (!userAStatus)
            throw new Error('UserA not found in friend list');
        if (userAStatus.status !== 'Offline')
            throw new Error(`UserA status is ${userAStatus.status}, expected Offline`);
        userB2.close();
        console.log('Test 2 Passed');
        console.log('All tests passed!');
        process.exit(0);
    });
}
runTest().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
