# VS Code Social Presence 👥

A VS Code extension that shows your GitHub friends' real-time coding status! See what your followers and following are working on, all within VS Code.

## ✨ Features

### 🔐 GitHub Authentication
- **One-click login** using VS Code's built-in GitHub OAuth
- **Auto-discovery**: Automatically finds which of your GitHub followers/following are using the extension
- **Real-time notifications** when friends come online

### 📊 Multi-Tab Sidebar
- **Close Friends**: Pin your favorite collaborators for quick access
- **Following**: See GitHub users you follow who are online
- **Followers**: See your GitHub followers who are coding
- **All Users**: Browse all active users
- **Offline Users**: See when friends were last active (up to 7 days)

## 🚀 Deployment

For production deployment instructions, including setting up secure WebSockets (`wss://`) with Caddy, please see [DEPLOYMENT.md](DEPLOYMENT.md).

## 🔒 Security

This extension communicates with a central server to exchange status information.
- **Privacy**: You can control who sees your status (Everyone, Followers, Following, Close Friends, or Invisible).
- **Data**: Only your current status, activity, and project details are sent. No code is transmitted.
- **Encryption**: Use `wss://` in production to ensure all data is encrypted in transit.

### 🪟 Multiple Windows Support
- **Smart Aggregation**: Open multiple VS Code windows with different projects
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
- **5-second throttling** on status updates
- **Duplicate detection** to avoid unnecessary messages
- **80% reduction** in WebSocket traffic
- Handles 100+ concurrent users smoothly

## 🚀 Getting Started

### Installation

####From Marketplace (Coming Soon)
1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` or `Ctrl+Shift+X`)
3. Search for "VS Code Social Presence"
4. Click Install

#### From Source
```bash
git clone https://github.com/yourusername/vscode-social-presence.git
cd vscode-social-presence
npm install
npm run compile
```

### First Launch

1. **Authenticate**: On first launch, you'll be prompted to sign in with GitHub
2. **Grant Permissions**: Allow access to your email and profile
3. **Start Coding**: Your status will automatically update based on your activity!

## ⚙️ Configuration

Access settings via `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux) and search for "Social Presence":

```json
{
  "vscode-social-presence.visibilityMode": "everyone",
  "vscode-social-presence.shareProjectName": true,
  "vscode-social-presence.shareLanguage": true,
  "vscode-social-presence.shareActivity": true
}
```

## 🖥️ Server Deployment

The extension requires a WebSocket server. See [AZURE_DEPLOYMENT.md](./AZURE_DEPLOYMENT.md) for deployment instructions.

### Quick Local Setup
```bash
# Start the server
node server/index.js

# Server runs on ws://localhost:8080
```

### Production Deployment
- Supports Azure VM, AWS EC2, Heroku, Railway, etc.
- Includes PM2 process management
- Optional SSL/TLS with Nginx reverse proxy

## 📁 Project Structure

```
vscode-social-presence/
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

### "GitHub authentication failed"
- Clear VS Code's GitHub auth: `Cmd+Shift+P` → "Sign out of GitHub"
- Try again

### "No friends showing up"
- Ensure your GitHub account has followers/following
- Check that they're also using the extension
- Verify privacy settings aren't set to "Invisible"

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

- 🐛 Report bugs: [GitHub Issues](https://github.com/yourusername/vscode-social-presence/issues)
- 💬 Discussion: [GitHub Discussions](https://github.com/yourusername/vscode-social-presence/discussions)
- 📧 Email: your-email@example.com

---

Made with ❤️ by [Your Name]
