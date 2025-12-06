# Viscord 👥

A VS Code extension that shows your GitHub friends' real-time coding status! See what your followers and following are working on, all within VS Code.

## ✨ Features

### 🔐 GitHub Authentication
- **One-click login** using VS Code's built-in GitHub OAuth
- **Auto-discovery**: Automatically finds which of your GitHub followers/following are using the extension
- **Guest Mode**: Use invite codes to connect without GitHub
- **Real-time notifications** when friends come online

### 📊 Multi-Tab Sidebar
- **Close Friends**: Pin your favorite collaborators for quick access
- **Following**: See GitHub users you follow who are online
- **Followers**: See your GitHub followers who are coding
- **All Users**: Browse all active users
- **Offline Users**: See when friends were last active (up to 7 days)

### 🪟 Multiple Windows Support
- **Smart Aggregation**: Open multiple VS Code windows with different projects
- **Window Focus Tracking**: Automatically updates status based on the active window
- **Activity Priority**: Shows your most active status (Debugging > Coding > Reading > Idle)
- **Seamless Experience**: Friends see one unified status across all your windows

### 🔒 Privacy Controls
- **Visibility Modes**:
  - `Everyone`: All users can see your status (default)
  - `Followers Only`: Only your GitHub followers can see you
  - `Following Only`: Only people you follow can see you
  - `Close Friends`: Only pinned friends can see you
  - `Invisible`: No one can see you online

- **Granular Sharing**:
  - Share/hide project name
  - Share/hide programming language
  - Share/hide activity (Coding, Debugging, Idle)

### 💾 Persistent Data
- Friend lists saved across sessions
- **Last seen timestamps** for offline users (shows "Last seen 5m ago")
- **Automatic Backups**: Database backed up every 6 hours (production)
- SQLite database for reliable storage
- Privacy preferences synced automatically

### 🛡️ Rate Limiting & Security
- Connection rate limiting (5 attempts/minute per IP)
- Message rate limiting (60 messages/minute per user)
- Server-side GitHub token validation
- Graceful error handling

### 🔄 Automatic Reconnection
- Exponential backoff retry logic
- Handles network interruptions gracefully
- Max 10 reconnection attempts

### ⚡ Performance Optimized
- **Broadcast Debouncing**: Batches rapid updates to reduce network traffic
- **Offline User Caching**: Reduces database queries by 99%
- **Batched Writes**: Reduces disk I/O by 90%
- **Smart Throttling**: 5-second throttle for general updates, immediate for coding/debugging
- Handles 1,000+ concurrent users smoothly

## 🚀 Getting Started

### Installation

####From Marketplace (Coming Soon)
1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` or `Ctrl+Shift+X`)
3. Search for "VS Code viscord"
4. Click Install

#### From Source
```bash
git clone https://github.com/CyberTron957/viscord.git
cd viscord
npm install
npm run compile
```

### First Launch

1. **Authenticate**: On first launch, you'll be prompted to sign in with GitHub
2. **Grant Permissions**: Allow access to your email and profile
3. **Start Coding**: Your status will automatically update based on your activity!

## ⚙️ Configuration
 
Access settings via `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux) and search for "viscord":

```json
{
  "vscode-viscord.visibilityMode": "everyone",
  "vscode-viscord.shareProjectName": true,
  "vscode-viscord.shareLanguage": true,
  "vscode-viscord.shareActivity": true
}
```

### Useful Commands
- **Reset Extension**: `vscode-viscord.resetExtension` (Full reset)
- **Clear Cache**: `vscode-viscord.clearCache` (Refresh data)
- **Sign Out**: `vscode-viscord.signOutGitHub` (Switch to guest)
- **Connect GitHub**: `vscode-viscord.connectGitHub`
- **Continue as Guest**: `vscode-viscord.continueAsGuest`
 
## 🖥️ Server Deployment
 
The extension requires a WebSocket server. See [DEPLOYMENT.md](./DEPLOYMENT.md) for secure production deployment instructions using Caddy and HTTPS/WSS.
 
### Quick Local Setup
```bash
# Start the server
node server/index.js
 
# Server runs on ws://localhost:8080
```
 
### Production Deployment
- Supports any Linux server (Ubuntu recommended)
- **Secure WSS** via Caddy reverse proxy
- **Automatic SSL** with Let's Encrypt
- **Automatic Backups** of database
- Includes PM2 process management
 
## 📁 Project Structure
 
```
viscord/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── githubService.ts       # GitHub OAuth & API
│   ├── sidebarProvider.ts     # Multi-tab tree view
│   ├── activityTracker.ts     # Activity detection
│   └── wsClient.ts            # WebSocket client
├── server/
│   ├── index.ts               # WebSocket server
│   ├── database.ts            # SQLite persistence
│   └── rateLimiter.ts         # Anti-abuse protection
├── package.json               # Extension manifest
└── tsconfig.json              # TypeScript config
```
 
## 🔧 Development
 
### Prerequisites
- Node.js 18+
- VS Code 1.80+
 
### Build
```bash
npm install
npm run compile
```
 
### Run Extension
1. Open in VS Code
2. Press `F5` to launch Extension Development Host
3. Test the extension in the new window
 
### Run Server
```bash
node server/index.js
```
 
## 🧪 Testing
 
### Manual Testing
1. Start the server: `node server/index.js`
2. Launch extension in debug mode (`F5`)
3. Sign in with GitHub
4. Open another Extension Development Host window
5. Sign in with a different GitHub account that follows/is followed by the first
6. Both should see each other in their respective tabs
 
## 📊 Database Schema
 
```sql
-- Users table
users (github_id, username, avatar, created_at, last_seen)
 
-- Relationships (followers/following)
user_relationships (user_github_id, related_github_id, relationship_type)
 
-- Close friends
close_friends (user_github_id, friend_github_id, added_at)
 
-- Privacy preferences
user_preferences (github_id, visibility_mode, share_project, share_language, share_activity)
```
 
## 🛠️ Troubleshooting
 
### "Failed to connect to WebSocket server"
- Ensure the server is running: `node server/index.js`
- Check firewall isn't blocking port 8080
- Verify `ws://localhost:8080` is accessible
- Try **Clear Cache** command (`Cmd+Shift+P` -> "Clear Cache")
 
### "GitHub authentication failed"
- Clear VS Code's GitHub auth: `Cmd+Shift+P` → "Sign out of GitHub"
- Try again
 
### "No friends showing up"
- Ensure your GitHub account has followers/following
- Check that they're also using the extension
- Verify privacy settings aren't set to "Invisible"
- Try **Clear Cache** command
 
### "Extension behaving strangely"
- Use **Reset Extension** command (`Cmd+Shift+P` -> "Reset Extension") to wipe all data and start fresh.

## 📝 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## 🙏 Acknowledgments

- Built with [VS Code Extension API](https://code.visualstudio.com/api)
- Uses [Octokit](https://github.com/octokit/octokit.js) for GitHub API
- WebSocket server powered by [ws](https://github.com/websockets/ws)
- Database powered by [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

## 📧 Support

- 🐛 Report bugs: [GitHub Issues](https://github.com/CyberTron957/viscord/issues)
- 💬 Discussion: [GitHub Discussions](https://github.com/CyberTron957/viscord/discussions)
- 🌐 Server: https://viscord.bellnexx.com

---

Made with ❤️ by [CyberTron957](https://github.com/CyberTron957)
