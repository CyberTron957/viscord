# Viscord 👥
<img width="800" alt="viscord_marketplace_hero_1765087439708" src="https://github.com/user-attachments/assets/cf450bfa-5f09-4d45-af4b-2e8f3e0fbe4a" />

<img width="400" alt="Generated Image December 07, 2025 - 3_01P" src="https://github.com/user-attachments/assets/c30d1dc1-10d8-461f-8406-a701ca9fa803" />


A VS Code extension that shows your GitHub friends' real-time coding status! See what your followers and following are working on, all within VS Code.

[Download from VS Code Extension Marketplace](https://marketplace.visualstudio.com/items?itemName=CyberTron957.viscord)





# To test locally:


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
# Install Redis (optional but recommended)
brew install redis  # macOS
# or: sudo apt install redis-server  # Ubuntu

# Start Redis (in separate terminal)
redis-server

# Compile and start the server
cd server
npm run compile:server
node index.js
 
# Server runs on ws://localhost:8080
# With Redis: Mode will show "Redis Pub/Sub"
# Without Redis: Falls back to "Legacy Broadcast"
```

### Environment Variables
```bash
# Copy example and configure
cp .env.example .env

# Key variables:
PORT=8080
REDIS_URL=redis://localhost:6379
USE_LEGACY_BROADCAST=false  # Set to true to disable Redis
```
 
### Production Deployment
- Supports any Linux server (Ubuntu recommended)
- **Redis** for Pub/Sub and caching (optional but recommended)
- **Secure WSS** via Caddy reverse proxy
- **Automatic SSL** with Let's Encrypt
- **Automatic Backups** of database
- Includes PM2 process management

 
## 📁 Project Structure
 
```
viscord/
├── src/
│   ├── extension.ts          # Extension entry point
│   ├── githubService.ts      # GitHub OAuth & API
│   ├── sidebarProvider.ts    # Multi-tab tree view
│   ├── activityTracker.ts    # Activity detection
│   └── wsClient.ts           # WebSocket client (handles delta updates)
├── server/
│   ├── index.ts              # WebSocket server (heartbeats, session resumption)
│   ├── database.ts           # SQLite persistence
│   ├── redisService.ts       # Redis Pub/Sub, caching, sessions
│   └── rateLimiter.ts        # Anti-abuse protection
├── .env.example              # Environment variable template
├── package.json              # Extension manifest
└── tsconfig.json             # TypeScript config
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
