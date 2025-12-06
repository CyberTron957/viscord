# How Viscord Works - Complete Guide for Beginners

## 🎯 What is Viscord?

Viscord is a VS Code extension that lets you see what your GitHub friends are coding in real-time. Think of it like Discord's "Now Playing" feature, but for coding!

You can see:
- Who's online and coding right now
- What programming language they're using
- What project they're working on
- Whether they're actively coding, debugging, or just idle

---

## 🏗️ Architecture Overview

Viscord has **two main parts**:

### 1. **Client (VS Code Extension)** 
   - Runs inside VS Code on your computer
   - Shows your friends' status in the sidebar
   - Sends your coding activity to the server

### 2. **Server (WebSocket Server)**
   - Runs on a remote server (like a website backend)
   - Connects all users together
   - Stores user data and relationships in a database

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│  Your VS Code   │ ◄─────► │    Server    │ ◄─────► │ Friend's VS Code│
│   (Client)      │         │ (WebSocket)  │         │    (Client)     │
└─────────────────┘         └──────────────┘         └─────────────────┘
                                    │
                                    ▼
                            ┌──────────────┐
                            │   Database   │
                            │   (SQLite)   │
                            └──────────────┘
```

---

## 📁 Project Structure

```
viscord/
├── src/                          # Client-side code (VS Code extension)
│   ├── extension.ts              # Main entry point
│   ├── sidebarProvider.ts        # Shows friends list in sidebar
│   ├── wsClient.ts               # Connects to server
│   ├── activityTracker.ts        # Tracks what you're coding
│   ├── githubService.ts          # Handles GitHub login
│   └── explorerPresenceProvider.ts # Shows friends in file explorer
│
├── server/                       # Server-side code
│   ├── index.ts                  # WebSocket server
│   └── database.ts               # Database operations
│
├── package.json                  # Extension configuration
├── dist/                         # Bundled code (ready to run)
└── database.sqlite               # User data storage
```

---

## 🔧 How Each File Works

### **Client Side (VS Code Extension)**

#### 1. `extension.ts` - The Brain 🧠
**Purpose:** This is the main file that starts everything when you open VS Code.

**What it does:**
1. **Checks if you're logged in** (GitHub or Guest mode)
2. **Creates the sidebar views** where you see your friends
3. **Registers all commands** (like "Connect GitHub", "Create Invite", etc.)
4. **Connects everything together** - links the activity tracker, sidebar, and server connection

**Key sections:**
```typescript
// When VS Code starts, this function runs
export async function activate(context: vscode.ExtensionContext) {
    // 1. Check if user was logged in before
    let authState = context.globalState.get('authState', null);
    
    // 2. If logged in with GitHub, get their info
    if (authState === 'github') {
        profile = await githubService.getProfile();
        followers = await githubService.getFollowers();
    }
    
    // 3. Create the sidebar that shows friends
    const sidebarProvider = new SidebarProvider(...);
    
    // 4. Register commands (buttons users can click)
    vscode.commands.registerCommand('viscord.connectGitHub', async () => {
        // Code to connect with GitHub
    });
}
```

---

#### 2. `sidebarProvider.ts` - The Friends List 👥
**Purpose:** Creates the tree view in VS Code's sidebar showing your friends.

**What it does:**
1. **Organizes friends into categories:**
   - Close Friends & Guests (people you connected via invite codes)
   - Following (GitHub users you follow)
   - Followers (GitHub users who follow you)

2. **Shows each friend with:**
   - Their username
   - Online/Away/Offline status (colored dot)
   - What they're doing (Coding, Debugging, Idle)
   - What project/language they're using

3. **Updates automatically** when friends come online/offline

**How it works:**
```typescript
class SidebarProvider {
    // This function is called to get the list of friends
    getChildren() {
        // Return categories like "Close Friends", "Following", etc.
        return [
            new Category('Close Friends', count),
            new Category('Following', count),
        ];
    }
    
    // For each friend, create a UserNode
    new UserNode(user, isManualConnection) {
        this.label = user.username;
        this.description = "Coding • MyProject (Python)";
        this.iconPath = greenDot; // if online
    }
}
```

---

#### 3. `wsClient.ts` - The Messenger 📡
**Purpose:** Connects to the server using WebSockets (like a phone call that stays open).

**What it does:**
1. **Opens a connection** to the server when you log in
2. **Sends your status** (what you're coding) to the server
3. **Receives updates** about your friends from the server
4. **Handles reconnection** if the internet drops

**Key concepts:**
```typescript
class WsClient {
    connect(username, token) {
        // Open WebSocket connection
        this.ws = new WebSocket('wss://viscord.bellnexx.com');
        
        // When connected, send login message
        this.ws.on('open', () => {
            this.send({ type: 'login', username, token });
        });
        
        // When server sends updates
        this.ws.on('message', (data) => {
            if (data.type === 'userList') {
                // Update the friends list in sidebar
                this.onUserListUpdate(data.users);
            }
        });
    }
    
    updateStatus(status) {
        // Send your current activity to server
        this.send({ type: 'statusUpdate', ...status });
    }
}
```

---

#### 4. `activityTracker.ts` - The Spy 🕵️
**Purpose:** Watches what you're doing in VS Code and reports it.

**What it tracks:**
- **Status:** Online, Away (if idle for 5 minutes), Offline
- **Activity:** Coding, Debugging, Reading, Idle
- **Project:** Name of the folder you're working in
- **Language:** JavaScript, Python, TypeScript, etc.

**How it works:**
```typescript
class ActivityTracker {
    constructor() {
        // Watch when you type
        vscode.workspace.onDidChangeTextDocument(() => {
            this.lastActivity = Date.now();
            this.status = 'Coding';
        });
        
        // Watch when you start debugging
        vscode.debug.onDidStartDebugSession(() => {
            this.status = 'Debugging';
        });
        
        // Check every 10 seconds
        setInterval(() => {
            const idleTime = Date.now() - this.lastActivity;
            if (idleTime > 5 * 60 * 1000) {
                this.status = 'Away'; // 5 minutes idle
            }
            
            // Send update to server
            this.onStatusChange({
                status: this.status,
                activity: this.activity,
                project: this.getProjectName(),
                language: this.getCurrentLanguage()
            });
        }, 10000);
    }
}
```

---

#### 5. `githubService.ts` - The GitHub Connector 🔐
**Purpose:** Handles logging in with GitHub and getting your followers/following.

**What it does:**
1. **Opens GitHub login** in your browser
2. **Gets an access token** (like a password that proves you're you)
3. **Fetches your GitHub data:**
   - Your username and avatar
   - List of followers
   - List of people you follow

**How it works:**
```typescript
class GitHubService {
    async authenticate() {
        // VS Code opens GitHub login in browser
        const session = await vscode.authentication.getSession('github', scopes);
        this.token = session.accessToken;
        return session;
    }
    
    async getProfile() {
        // Use GitHub API to get your info
        const octokit = new Octokit({ auth: this.token });
        const { data } = await octokit.users.getAuthenticated();
        return data; // { login: "username", avatar_url: "...", ... }
    }
    
    async getFollowers() {
        // Get list of people who follow you
        const response = await octokit.users.listFollowersForAuthenticatedUser();
        return response.data;
    }
}
```

---

### **Server Side (Backend)**

#### 6. `server/index.ts` - The Switchboard 📞
**Purpose:** This is the central server that connects everyone together.

**What it does:**
1. **Accepts WebSocket connections** from all users
2. **Validates GitHub tokens** to make sure users are who they say they are
3. **Broadcasts user lists** to everyone (who's online, what they're doing)
4. **Handles invite codes** for connecting with non-GitHub friends
5. **Manages privacy settings** (who can see your status)

**How it works:**
```typescript
// When someone connects
wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        
        if (data.type === 'login') {
            // Validate their GitHub token
            const githubUser = await validateGitHubToken(data.token);
            
            // Store their connection
            clients.set(ws, {
                username: githubUser.login,
                followers: [...],
                following: [...],
                status: 'Online'
            });
            
            // Tell everyone about the new user
            broadcastUpdate();
        }
        
        if (data.type === 'statusUpdate') {
            // Update user's status
            clientData.activity = data.activity;
            clientData.project = data.project;
            
            // Broadcast to all friends
            broadcastUpdate();
        }
    });
});

function broadcastUpdate() {
    // For each connected user
    for (const [ws, receiverData] of clients.entries()) {
        // Build list of friends they can see
        const visibleUsers = [];
        
        for (const clientData of allUsers) {
            // Check if they're friends (following/followers)
            if (canUserSee(receiverData, clientData)) {
                visibleUsers.push(clientData);
            }
        }
        
        // Send the list
        ws.send(JSON.stringify({
            type: 'userList',
            users: visibleUsers
        }));
    }
}
```

---

#### 7. `server/database.ts` - The Memory 💾
**Purpose:** Stores all user data in a SQLite database (like a spreadsheet on disk).

**What it stores:**
- **Users table:** GitHub ID, username, avatar, last seen time
- **Relationships table:** Who follows who
- **Manual connections table:** Invite code connections
- **Invite codes table:** Active invite codes
- **User preferences:** Privacy settings

**Key operations:**
```typescript
class DatabaseService {
    // Save a user
    upsertUser(githubId, username, avatar) {
        db.run('INSERT INTO users VALUES (?, ?, ?, ?)');
    }
    
    // Get someone's followers
    getFollowers(githubId) {
        return db.query('SELECT * FROM relationships WHERE ...');
    }
    
    // Create an invite code
    createInviteCode(username, expiresInHours) {
        const code = generateRandomCode(); // e.g., "ABC123"
        db.run('INSERT INTO invite_codes VALUES (?, ?, ?)');
        return code;
    }
    
    // Accept an invite code
    acceptInviteCode(code, acceptorUsername) {
        // Mark code as used
        // Create bidirectional connection
        this.addManualConnection(creator, acceptor);
    }
}
```

---

## 🔄 How Features Work

### Feature 1: **Connecting with GitHub**

**Step-by-step:**
1. User clicks "Connect GitHub" button
2. `githubService.authenticate()` opens GitHub in browser
3. User approves the app
4. GitHub gives VS Code an access token
5. Extension fetches user's profile, followers, following
6. `wsClient.connect(username, token)` connects to server
7. Server validates token with GitHub API
8. Server stores user in database
9. Server broadcasts "new user online" to all friends

**Code flow:**
```
User clicks button
    ↓
extension.ts: registerCommand('connectGitHub')
    ↓
githubService.ts: authenticate()
    ↓
githubService.ts: getProfile(), getFollowers(), getFollowing()
    ↓
wsClient.ts: connect(username, token)
    ↓
server/index.ts: validates token, stores user
    ↓
server/index.ts: broadcastUpdate()
    ↓
All friends see you online!
```

---

### Feature 2: **Guest Mode (No GitHub)**

**Step-by-step:**
1. User clicks "Continue as Guest"
2. Extension asks for a username
3. `wsClient.connect(username, undefined)` - no token
4. Server accepts connection without GitHub validation
5. User can create invite codes to connect with friends

**Why it exists:** Not everyone wants to connect GitHub, or they might want to connect with friends who don't use GitHub.

---

### Feature 3: **Invite Codes**

**Step-by-step:**

**Creating an invite:**
1. User clicks "Create Invite Link"
2. Extension sends `{ type: 'createInvite' }` to server
3. Server generates random 6-character code (e.g., "XYZ789")
4. Server stores code in database with expiration (48 hours)
5. Server sends code back to user
6. User copies code and shares with friend

**Accepting an invite:**
1. Friend clicks "Accept Invite Code"
2. Friend enters code "XYZ789"
3. Extension sends `{ type: 'acceptInvite', code: 'XYZ789' }` to server
4. Server checks if code is valid (not expired, not used)
5. Server creates bidirectional connection in database
6. Both users can now see each other online!

**Database:**
```sql
-- Invite codes table
CREATE TABLE invite_codes (
    code TEXT PRIMARY KEY,           -- "XYZ789"
    creator_username TEXT,           -- "alice"
    created_at INTEGER,              -- timestamp
    expires_at INTEGER,              -- timestamp + 48 hours
    used_by TEXT,                    -- "bob" (after accepted)
    used_at INTEGER                  -- timestamp when accepted
);

-- Manual connections table
CREATE TABLE manual_connections (
    user1_username TEXT,             -- "alice"
    user2_username TEXT,             -- "bob"
    created_at INTEGER
);
-- Stored both ways: (alice, bob) and (bob, alice)
```

---

### Feature 4: **Real-time Status Updates**

**How your status is tracked:**

1. **Activity Tracker watches your VS Code:**
   ```typescript
   // Every time you type
   onDidChangeTextDocument() → activity = 'Coding'
   
   // Every time you debug
   onDidStartDebugSession() → activity = 'Debugging'
   
   // Every 10 seconds
   checkIdleTime() → if idle > 5 min, status = 'Away'
   ```

2. **Status is sent to server:**
   ```typescript
   wsClient.updateStatus({
       status: 'Online',
       activity: 'Coding',
       project: 'MyAwesomeApp',
       language: 'TypeScript'
   });
   ```

3. **Server broadcasts to all friends:**
   ```typescript
   // Server receives update
   clientData.activity = 'Coding';
   
   // Server sends to all friends
   broadcastUpdate() → sends userList to everyone
   ```

4. **Friends see update in their sidebar:**
   ```typescript
   // wsClient receives message
   onUserListUpdate(users) → sidebarProvider.refresh()
   
   // Sidebar updates
   UserNode shows: "alice • Coding • MyAwesomeApp (TypeScript)"
   ```

---

### Feature 5: **Privacy Settings**

**Visibility modes:**
- **Everyone:** Anyone can see your status
- **Followers:** Only GitHub followers can see you
- **Following:** Only people you follow can see you
- **Close Friends:** Only pinned close friends
- **Invisible:** Nobody can see you

**How it works:**
```typescript
// Server checks before showing you to someone
function canUserSee(viewer, target) {
    const mode = target.preferences.visibility_mode;
    
    if (mode === 'invisible') return false;
    if (mode === 'everyone') return true;
    if (mode === 'followers') {
        return target.followers.includes(viewer.githubId);
    }
    // ... etc
}

// When broadcasting
for (const friend of allUsers) {
    if (canUserSee(receiver, friend)) {
        visibleUsers.push(friend);
    }
}
```

---

## 🚀 How Data Flows

### Example: Alice sees Bob's status update

```
1. Bob types code in VS Code
   ↓
2. activityTracker.ts detects typing
   ↓
3. Sets activity = 'Coding', language = 'Python'
   ↓
4. wsClient.updateStatus({ activity: 'Coding', language: 'Python' })
   ↓
5. Message sent to server: { type: 'statusUpdate', activity: 'Coding', ... }
   ↓
6. Server receives message, updates Bob's data
   ↓
7. Server calls broadcastUpdate()
   ↓
8. Server checks: Can Alice see Bob? (Yes, they're followers)
   ↓
9. Server sends to Alice: { type: 'userList', users: [{ username: 'Bob', activity: 'Coding', ... }] }
   ↓
10. Alice's wsClient receives message
   ↓
11. wsClient calls onUserListUpdate(users)
   ↓
12. sidebarProvider.refresh() updates the tree view
   ↓
13. Alice sees: "Bob • Coding • (Python)" in her sidebar!
```

---

## 🔐 Security Features

### 1. **GitHub Token Validation**
- Server validates every GitHub token with GitHub's API
- Prevents impersonation (you can't pretend to be someone else)

### 2. **Rate Limiting**
```typescript
// Prevent spam/abuse
rateLimiter.checkConnectionLimit(ip) // Max connections per IP
rateLimiter.checkMessageLimit(userId) // Max messages per user
```

### 3. **Message Size Limits**
```typescript
// Prevent huge messages that could crash the server
if (message.length > 16 * 1024) { // 16KB max
    ws.close(1009, 'Message too large');
}
```

### 4. **Privacy Controls**
- Users control who sees their status
- Share settings for project name, language, activity

---

## 📦 Building & Packaging

### Why we use esbuild:

**Problem:** The extension uses npm packages like `ws` (WebSocket library). When you package the extension, by default these packages are excluded (`.vscodeignore` excludes `node_modules/`).

**Solution:** Use **esbuild** to bundle everything into one file:

```typescript
// Before bundling (doesn't work in packaged extension)
import WebSocket from 'ws'; // ❌ ws is in node_modules, not included

// After bundling with esbuild
// dist/extension.js contains:
// - Your code
// - ws library code
// - All dependencies
// All in ONE file! ✅
```

**Build process:**
```bash
# 1. Bundle extension code + dependencies
npm run esbuild
# Creates: dist/extension.js (300KB with all dependencies)

# 2. Package into .vsix file
vsce package
# Creates: viscord-1.0.0.vsix (can be installed in VS Code)
```

---

## 🗄️ Database Schema

```sql
-- Users (GitHub accounts)
CREATE TABLE users (
    github_id INTEGER PRIMARY KEY,    -- 12345678
    username TEXT UNIQUE,              -- "alice"
    avatar TEXT,                       -- "https://..."
    created_at INTEGER,                -- timestamp
    last_seen INTEGER                  -- timestamp (for offline status)
);

-- Who follows who
CREATE TABLE user_relationships (
    user_github_id INTEGER,            -- Alice's ID
    related_github_id INTEGER,         -- Bob's ID
    relationship_type TEXT,            -- 'follower' or 'following'
    PRIMARY KEY (user_github_id, related_github_id, relationship_type)
);

-- Pinned close friends
CREATE TABLE close_friends (
    user_github_id INTEGER,            -- Alice's ID
    friend_github_id INTEGER,          -- Bob's ID
    added_at INTEGER
);

-- Privacy settings
CREATE TABLE user_preferences (
    github_id INTEGER PRIMARY KEY,
    visibility_mode TEXT,              -- 'everyone', 'followers', etc.
    share_project BOOLEAN,             -- Show project name?
    share_language BOOLEAN,            -- Show language?
    share_activity BOOLEAN             -- Show activity?
);

-- Invite codes
CREATE TABLE invite_codes (
    code TEXT PRIMARY KEY,             -- "ABC123"
    creator_username TEXT,             -- "alice"
    created_at INTEGER,
    expires_at INTEGER,
    used_by TEXT,                      -- "bob"
    used_at INTEGER
);

-- Manual connections (invite code connections)
CREATE TABLE manual_connections (
    user1_username TEXT,               -- "alice"
    user2_username TEXT,               -- "bob"
    created_at INTEGER,
    PRIMARY KEY (user1_username, user2_username)
);

-- Guest → GitHub username mapping
CREATE TABLE username_aliases (
    github_username TEXT PRIMARY KEY,  -- "alice_github"
    guest_username TEXT,               -- "alice_guest"
    github_id INTEGER,
    created_at INTEGER
);
```

---

## 🎨 UI Components

### Sidebar Views:

1. **Close Friends & Guests**
   - Shows manually connected users (via invite codes)
   - Shows pinned close friends
   - Always expanded by default

2. **GitHub Network**
   - Following (people you follow)
   - Followers (people who follow you)
   - All Users (everyone online)

3. **Connection Status**
   - Shows: Connected ✅ / Connecting ⏳ / Disconnected ❌
   - Updates in real-time

### User Node Display:
```
👤 alice                    ← Username
   🟢 Coding • MyApp (Python)  ← Status • Activity • Project (Language)
```

**Status colors:**
- 🟢 Green = Online
- 🟡 Yellow = Away (idle 5+ minutes)
- ⚪ Gray outline = Offline

---

## 🔄 Performance Optimizations

### 1. **Broadcast Debouncing**
```typescript
// Don't broadcast immediately on every change
// Wait 2 seconds and batch updates
scheduleBroadcast() {
    if (broadcastTimer) return; // Already scheduled
    
    broadcastTimer = setTimeout(() => {
        broadcastUpdate(); // Send once for all changes
    }, 2000);
}
```

### 2. **Offline User Caching**
```typescript
// Don't query database every broadcast
// Cache offline users for 5 minutes
const offlineUserCache = new Map();

getCachedOfflineUsers(githubId) {
    const cached = offlineUserCache.get(githubId);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        return cached.users; // Return cached
    }
    // Otherwise, query database and cache
}
```

### 3. **Multi-Window Handling**
```typescript
// If user has multiple VS Code windows open
// Show the most active status

const sessions = [
    { activity: 'Idle', ... },
    { activity: 'Coding', ... },  // ← Pick this one
    { activity: 'Reading', ... }
];

const mostActive = sessions.reduce((prev, curr) => {
    const priority = { Debugging: 4, Coding: 3, Reading: 2, Idle: 1 };
    return priority[curr.activity] > priority[prev.activity] ? curr : prev;
});
```

---

## 🐛 Common Issues & Solutions

### Issue 1: "Commands not found"
**Cause:** Extension not activating
**Solution:** Added explicit `activationEvents` in package.json

### Issue 2: "Connection status not updating"
**Cause:** Status view missing event emitter
**Solution:** Added `EventEmitter` to status provider

### Issue 3: "Can't remove connection"
**Cause:** Offline user cache not invalidated
**Solution:** Call `invalidateOfflineCache()` when removing connection

---

## 🚀 Advanced Architecture (v1.0.1+)

### Redis Pub/Sub (Optional but Recommended)

The server can use Redis for improved performance and scalability:

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│  Your VS Code   │ ◄─────► │    Server    │ ◄─────► │ Friend's VS Code│
│   (Client)      │         │ (WebSocket)  │         │    (Client)     │
└─────────────────┘         └──────────────┘         └─────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                  ┌──────────────┐      ┌──────────────┐
                  │    Redis     │      │   Database   │
                  │  (Pub/Sub)   │      │   (SQLite)   │
                  └──────────────┘      └──────────────┘
```

**Benefits:**
- **Session Resumption**: If your WiFi drops for <60s, you reconnect silently (no flapping)
- **Delta Updates**: Only changed fields sent, not full user list
- **Read-Through Cache**: Friend lists cached in Redis (5 min TTL)
- **Horizontal Scaling**: Multiple server instances can share state via Redis

### Heartbeat System

Application-level ping/pong to detect dead connections faster than TCP:

```typescript
// Server sends ping every 30 seconds
setInterval(() => {
    clients.forEach((data, ws) => {
        if (!data.isAlive) {
            ws.terminate(); // Didn't respond to last ping
            return;
        }
        data.isAlive = false;
        ws.send({ t: 'hb', ts: Date.now() });
    });
}, 30000);

// Client responds to ping
ws.on('message', (msg) => {
    if (msg.t === 'hb') {
        ws.send({ t: 'hb', ts: msg.ts }); // Pong
    }
});
```

### Session Resumption Flow

```
1. User connects → Server issues resume token (stored in Redis, 60s TTL)
2. Connection drops (WiFi issue)
3. User reconnects within 60s → Sends resume token
4. Server validates token → Restores session silently
5. Friends NOT notified of disconnect/reconnect (no flapping)
```

### Delta Update Protocol

New efficient message types:

| Type | Direction | Purpose |
|------|-----------|---------|
| `hb` | Both | Heartbeat ping/pong |
| `token` | Server→Client | Resume token for session resumption |
| `u` | Server→Client | User status update (delta) |
| `o` | Server→Client | User came online |
| `x` | Server→Client | User went offline |
| `sync` | Server→Client | Full state sync (initial connect) |

---

## 📝 Summary

**Viscord is like a social network for coders:**

1. **You connect** with GitHub or as a guest
2. **You see friends** in your VS Code sidebar
3. **Your activity is tracked** automatically (what you're coding)
4. **Status is shared** with friends via WebSocket server
5. **Friends see updates** in real-time
6. **Privacy is protected** with visibility settings

**Key technologies:**
- **TypeScript** - Programming language (JavaScript with types)
- **WebSocket** - Real-time bidirectional communication
- **SQLite** - Database for storing user data
- **Redis** - Pub/Sub, caching, and session management (optional)
- **VS Code Extension API** - Integrates with VS Code
- **GitHub API** - Gets your followers/following
- **esbuild** - Bundles code for distribution

**The magic:** Everyone's VS Code connects to the same server, which acts like a chat room. When you code, your status is broadcast to all your friends who are also connected!
